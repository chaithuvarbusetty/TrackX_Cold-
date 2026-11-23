"""
==============================================================================
FILE: backend/services/push_service.py
PURPOSE:
Zero-Cost Mobile Push Notification Engine for ColdChain CMS.
Dispatches critical temperature excursions, door breaches, tamper alarms,
and signal drops to registered mobile phones via Native WebPush (W3C/VAPID)
and open push standards. 100% zero external app requirement.
==============================================================================
"""

import os
import time
import json
import logging
import requests
from typing import Dict, Any, List, Optional
from pywebpush import webpush, WebPushException
from backend.database.coldchain_db import coldchain_db

logger = logging.getLogger("coldchain_push")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAPID_PRIVATE_KEY_PATH = os.path.join(BASE_DIR, "vapid_private.pem")
VAPID_PUBLIC_KEY_PATH = os.path.join(BASE_DIR, "vapid_public.txt")
VAPID_CLAIMS = {"sub": "mailto:admin@coldchain.local"}

class PushNotificationService:
    def __init__(self):
        self.db = coldchain_db

    def get_vapid_public_key(self) -> str:
        """Returns the URL-safe base64 VAPID public key for frontend pushManager.subscribe."""
        if os.path.exists(VAPID_PUBLIC_KEY_PATH):
            with open(VAPID_PUBLIC_KEY_PATH, "r") as f:
                return f.read().strip()
        return ""

    def register_mobile(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Registers or updates a mobile device for instant push alerts."""
        phone = str(data.get("phone_number", "")).strip()
        recipient = str(data.get("recipient_name", "Fleet Manager")).strip()
        device_name = str(data.get("device_name", "Mobile Phone")).strip()
        channel = str(data.get("channel", "web_push")).strip()
        sub_raw = data.get("push_subscription")
        sub_json = json.dumps(sub_raw) if sub_raw else ""
        now_ms = int(time.time() * 1000)

        # Fallback identifier if phone is empty
        if not phone and sub_raw and isinstance(sub_raw, dict):
            endpoint = sub_raw.get("endpoint", "")
            phone = f"webpush_{endpoint[-16:]}" if endpoint else f"webpush_{now_ms}"

        with self.db.get_connection() as conn:
            cur = conn.execute("SELECT id FROM registered_mobile_devices WHERE phone_number = ?", (phone,))
            row = cur.fetchone()
            if row:
                conn.execute("""
                    UPDATE registered_mobile_devices
                    SET recipient_name = ?, device_name = ?, channel = ?, push_subscription_json = ?,
                        notify_temperature = ?, notify_door = ?, notify_tamper = ?, notify_offline = ?,
                        is_active = 1
                    WHERE phone_number = ?
                """, (
                    recipient, device_name, channel, sub_json,
                    1 if data.get("notify_temperature", True) else 0,
                    1 if data.get("notify_door", True) else 0,
                    1 if data.get("notify_tamper", True) else 0,
                    1 if data.get("notify_offline", True) else 0,
                    phone
                ))
                dev_id = row["id"]
            else:
                cur_ins = conn.execute("""
                    INSERT INTO registered_mobile_devices (
                        phone_number, recipient_name, device_name, channel, push_subscription_json,
                        notify_temperature, notify_door, notify_tamper, notify_offline, is_active, created_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (
                    phone, recipient, device_name, channel, sub_json,
                    1 if data.get("notify_temperature", True) else 0,
                    1 if data.get("notify_door", True) else 0,
                    1 if data.get("notify_tamper", True) else 0,
                    1 if data.get("notify_offline", True) else 0,
                    now_ms
                ))
                dev_id = getattr(cur_ins, "lastrowid", None) or dev_id if 'dev_id' in locals() else 1

            conn.commit()

        # If native WebPush subscription is included, send a welcome ping
        if sub_raw and isinstance(sub_raw, dict) and sub_raw.get("endpoint"):
            self.send_direct_webpush(
                sub_raw,
                title="ColdChain Alert System Linked",
                body=f"Lock-screen push alerts enabled for {recipient} ({device_name}).",
                url="/"
            )

        return {
            "status": "ok",
            "message": f"Mobile device {phone} successfully registered for instant alerts.",
            "device": {
                "phone_number": phone,
                "recipient_name": recipient,
                "device_name": device_name,
                "channel": channel,
                "is_active": True
            }
        }

    def list_mobiles(self) -> List[Dict[str, Any]]:
        """Returns all registered mobile recipients."""
        with self.db.get_connection() as conn:
            cur = conn.execute("SELECT * FROM registered_mobile_devices ORDER BY created_at_ms DESC")
            rows = cur.fetchall()
            result = []
            for r in rows:
                sub_parsed = None
                if r.get("push_subscription_json"):
                    try:
                        sub_parsed = json.loads(r["push_subscription_json"])
                    except Exception:
                        pass
                result.append({
                    "id": r["id"],
                    "phone_number": str(r["phone_number"]),
                    "recipient_name": str(r["recipient_name"]),
                    "device_name": str(r["device_name"]),
                    "channel": str(r["channel"]),
                    "has_webpush": bool(sub_parsed and sub_parsed.get("endpoint")),
                    "push_subscription": sub_parsed,
                    "notify_temperature": bool(r["notify_temperature"]),
                    "notify_door": bool(r["notify_door"]),
                    "notify_tamper": bool(r["notify_tamper"]),
                    "notify_offline": bool(r["notify_offline"]),
                    "is_active": bool(r["is_active"]),
                    "created_at_ms": int(r["created_at_ms"]),
                    "last_notified_at_ms": int(r["last_notified_at_ms"]) if r["last_notified_at_ms"] else None
                })
            return result

    def delete_mobile(self, phone_number: str) -> bool:
        """Removes a mobile device registration."""
        with self.db.get_connection() as conn:
            cur = conn.execute("DELETE FROM registered_mobile_devices WHERE phone_number = ?", (phone_number,))
            conn.commit()
            return cur.rowcount > 0

    def send_direct_webpush(self, subscription: Dict[str, Any], title: str, body: str, url: str = "/") -> bool:
        """Directly sends a W3C VAPID Web Push notification to a browser/device."""
        if not subscription or not subscription.get("endpoint"):
            return False
        if not os.path.exists(VAPID_PRIVATE_KEY_PATH):
            logger.warning("VAPID private key missing at %s", VAPID_PRIVATE_KEY_PATH)
            return False

        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": "/favicon.ico",
            "badge": "/favicon.ico",
            "url": url,
            "timestamp": int(time.time() * 1000)
        })

        try:
            webpush(
                subscription_info=subscription,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY_PATH,
                vapid_claims=VAPID_CLAIMS,
                timeout=5
            )
            return True
        except WebPushException as ex:
            logger.warning(f"WebPush dispatch error: {ex}")
            return False
        except Exception as e:
            logger.warning(f"Unexpected WebPush failure: {e}")
            return False

    def dispatch_alert(self, alert: Dict[str, Any]) -> int:
        """Dispatches an alert to all active registered mobile recipients."""
        recipients = self.list_mobiles()
        if not recipients:
            return 0

        alert_type = alert.get("alert_type", "Critical Alert")
        severity = alert.get("severity", "CRITICAL")
        message = alert.get("message", "ColdChain Excursion Detected")
        dev_id = alert.get("device_id", "GW-001")
        now_ms = int(time.time() * 1000)

        dispatched = 0
        for r in recipients:
            if not r["is_active"]:
                continue

            # Filter by alert type preference
            at_lower = alert_type.lower()
            is_temp = any(k in at_lower for k in ["temp", "freeze", "thermal", "excursion", "limit"])
            is_door = any(k in at_lower for k in ["door", "breach"])
            is_tamper = any(k in at_lower for k in ["tamper", "enclosure", "chassis"])
            is_offline = any(k in at_lower for k in ["offline", "probe", "disconnect", "signal", "battery", "sensor"])

            if is_temp and not r["notify_temperature"]:
                continue
            if is_door and not r["notify_door"]:
                continue
            if is_tamper and not r["notify_tamper"]:
                continue
            if is_offline and not r["notify_offline"]:
                continue

            push_success = False

            # 1. Native W3C WebPush (Zero external apps, rings mobile lock screen directly)
            sub = r.get("push_subscription")
            if sub and sub.get("endpoint"):
                title = f"ColdChain [{dev_id}] {alert_type}"
                push_success = self.send_direct_webpush(sub, title=title, body=message, url=f"/?device={dev_id}")
                if push_success:
                    dispatched += 1

            # 2. Resilient Fallback: Open HTTP Push topic if phone number was provided
            if not push_success and r.get("phone_number") and not r["phone_number"].startswith("webpush_"):
                clean_phone = "".join([c for c in r["phone_number"] if c.isdigit()])
                topic = f"coldchain-alerts-{clean_phone}" if clean_phone else f"coldchain-alerts-{dev_id.lower()}"
                try:
                    priority = "urgent" if severity == "CRITICAL" else "high"
                    tags = "rotating_light,warning" if severity == "CRITICAL" else "bell,snowflake"
                    requests.post(
                        f"https://ntfy.sh/{topic}",
                        data=message.encode("utf-8"),
                        headers={
                            "Title": f"ColdChain [{dev_id}] {alert_type}".encode("utf-8"),
                            "Priority": priority,
                            "Tags": tags,
                            "Click": f"https://tipper-compost-fantasize.ngrok-free.dev/?device={dev_id}"
                        },
                        timeout=3.0
                    )
                    dispatched += 1
                except Exception as e:
                    logger.warning(f"Push to {topic} failed: {e}")

            # Update last_notified_at_ms in DB
            try:
                with self.db.get_connection() as conn:
                    conn.execute(
                        "UPDATE registered_mobile_devices SET last_notified_at_ms = ? WHERE id = ?",
                        (now_ms, r["id"])
                    )
                    conn.commit()
            except Exception:
                pass

        return dispatched

    def send_test_push(self, phone_number: str) -> Dict[str, Any]:
        """Sends an immediate test push alert to a mobile number."""
        clean_phone = "".join([c for c in phone_number if c.isdigit()])
        topic = f"coldchain-alerts-{clean_phone}" if clean_phone else "coldchain-alerts-test"
        
        try:
            resp = requests.post(
                f"https://ntfy.sh/{topic}",
                data=f"🔔 Test Alert: Mobile push verification for {phone_number} is successful! Live excursions will ring your lock screen.".encode("utf-8"),
                headers={
                    "Title": "ColdChain Verified: Push Notifications Active".encode("utf-8"),
                    "Priority": "high",
                    "Tags": "white_check_mark,shield",
                    "Click": "https://tipper-compost-fantasize.ngrok-free.dev"
                },
                timeout=4.0
            )
            return {
                "status": "ok",
                "phone_number": phone_number,
                "topic": topic,
                "subscribe_url": f"https://ntfy.sh/{topic}",
                "message": f"Test push alert dispatched successfully to topic {topic}!"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }

push_service = PushNotificationService()
