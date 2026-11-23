"""
==============================================================================
FILE: notifications.py
PURPOSE:
Multi-Channel Alert Dispatcher for Smart CCMS.

CHANNELS SUPPORTED:
1. In-App WebSockets: Real-time broadcast to browser dashboard.
2. Webhooks: Dispatches instant HTTP POST JSON alerts to Slack, Discord, Microsoft Teams, or Custom ERP.
3. Telegram Bot: Free, zero-setup instant mobile push alerts with Google Maps links.
4. WhatsApp / SMS: Cellular SMS or WhatsApp Business template alerts via Twilio/Meta Cloud API.
==============================================================================
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
import urllib.request
import urllib.parse
import urllib.error

from .database import db_get_setting, db_set_setting


class NotificationChannelDispatcher:
    """Manages multi-channel emergency notification dispatching."""

    def __init__(self):
        # Configuration initialized from database (persistent) or environment variables
        self.webhook_url = db_get_setting("webhook_url", os.getenv("ALERT_WEBHOOK_URL", ""))
        self.telegram_bot_token = db_get_setting("telegram_bot_token", os.getenv("TELEGRAM_BOT_TOKEN", ""))
        self.telegram_chat_id = db_get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", ""))
        self.whatsapp_api_url = db_get_setting("whatsapp_api_url", os.getenv("WHATSAPP_API_URL", ""))
        self.whatsapp_token = db_get_setting("whatsapp_token", os.getenv("WHATSAPP_API_TOKEN", ""))
        self.alert_min_severity = db_get_setting("alert_min_severity", "WARNING")  # "ALL", "WARNING", "CRITICAL"

    def get_config(self) -> Dict[str, Any]:
        """Returns active configuration with sensitive tokens masked for security."""
        def mask_token(t: str) -> str:
            if not t or len(t) < 8:
                return "••••••••" if t else ""
            return t[:6] + "••••••••" + t[-4:]

        return {
            "webhook_url": self.webhook_url or "",
            "webhook_configured": bool(self.webhook_url),
            "telegram_bot_token_masked": mask_token(self.telegram_bot_token),
            "telegram_bot_token_set": bool(self.telegram_bot_token),
            "telegram_chat_id": self.telegram_chat_id or "",
            "telegram_configured": bool(self.telegram_bot_token and self.telegram_chat_id),
            "whatsapp_api_url": self.whatsapp_api_url or "",
            "whatsapp_token_masked": mask_token(self.whatsapp_token),
            "whatsapp_configured": bool(self.whatsapp_api_url and self.whatsapp_token),
            "alert_min_severity": self.alert_min_severity
        }

    def update_config(self, config: Dict[str, str]):
        """Dynamically updates and persists notification channel credentials."""
        if "webhook_url" in config:
            self.webhook_url = config["webhook_url"].strip()
            db_set_setting("webhook_url", self.webhook_url)

        if "telegram_bot_token" in config and config["telegram_bot_token"].strip():
            # Only update if not masked placeholder
            val = config["telegram_bot_token"].strip()
            if "••" not in val:
                self.telegram_bot_token = val
                db_set_setting("telegram_bot_token", self.telegram_bot_token)

        if "telegram_chat_id" in config:
            self.telegram_chat_id = config["telegram_chat_id"].strip()
            db_set_setting("telegram_chat_id", self.telegram_chat_id)

        if "whatsapp_api_url" in config:
            self.whatsapp_api_url = config["whatsapp_api_url"].strip()
            db_set_setting("whatsapp_api_url", self.whatsapp_api_url)

        if "whatsapp_token" in config and config["whatsapp_token"].strip():
            val = config["whatsapp_token"].strip()
            if "••" not in val:
                self.whatsapp_token = val
                db_set_setting("whatsapp_token", self.whatsapp_token)

        if "alert_min_severity" in config:
            self.alert_min_severity = config["alert_min_severity"].strip()
            db_set_setting("alert_min_severity", self.alert_min_severity)

    async def dispatch_alert(self, device_id: str, alert_name: str, message: str, severity: str, details: Dict[str, Any] = None):
        """Asynchronously dispatches an alert across all active configured channels."""
        # Filter based on severity setting
        if self.alert_min_severity == "CRITICAL" and severity != "CRITICAL":
            return
        if self.alert_min_severity == "WARNING" and severity not in ["CRITICAL", "WARNING"]:
            return

        tasks = []

        # 1. Dispatch Webhook (Slack / Discord / ERP)
        if self.webhook_url:
            tasks.append(self._send_webhook(device_id, alert_name, message, severity, details))

        # 2. Dispatch Telegram Bot (Free mobile alerts)
        if self.telegram_bot_token and self.telegram_chat_id:
            tasks.append(self._send_telegram(device_id, alert_name, message, severity, details))

        # 3. Dispatch WhatsApp if configured
        if self.whatsapp_api_url and self.whatsapp_token:
            tasks.append(self._send_whatsapp(device_id, alert_name, message, severity, details))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def test_channel(self, channel: str, custom_params: Dict[str, str] = None) -> Dict[str, Any]:
        """Runs an isolated verification test dispatch to a specific channel and returns diagnostics."""
        params = custom_params or {}
        test_device = params.get("device_id", "TEST-UNIT")
        test_alert = "COLD_CHAIN_TEMPERATURE_EXCURSION_TEST"
        test_msg = "Test Alert: Cargo temperature warming (+9.4°C breach). Refrigerator unit malfunction simulated."
        test_details = {
            "lat": 17.4435,
            "lng": 78.3772,
            "cargo_temp_c": 9.4,
            "threshold_min": 2.0,
            "threshold_max": 8.0,
            "test_mode": True
        }

        if channel == "telegram":
            bot_token = params.get("telegram_bot_token") or self.telegram_bot_token
            chat_id = params.get("telegram_chat_id") or self.telegram_chat_id
            if not bot_token or not chat_id:
                return {"status": "error", "message": "Telegram Bot Token and Chat ID are required."}
            try:
                res = await self._send_telegram_direct(bot_token, chat_id, test_device, test_alert, test_msg, "CRITICAL", test_details)
                return {"status": "ok", "message": f"Telegram test message sent successfully to Chat ID: {chat_id}!"}
            except Exception as e:
                return {"status": "error", "message": f"Telegram test failed: {str(e)}"}

        elif channel == "webhook":
            webhook_url = params.get("webhook_url") or self.webhook_url
            if not webhook_url:
                return {"status": "error", "message": "Webhook URL is required."}
            try:
                await self._send_webhook_direct(webhook_url, test_device, test_alert, test_msg, "CRITICAL", test_details)
                return {"status": "ok", "message": f"Webhook payload successfully delivered to {webhook_url}!"}
            except Exception as e:
                return {"status": "error", "message": f"Webhook delivery failed: {str(e)}"}

        elif channel == "whatsapp":
            api_url = params.get("whatsapp_api_url") or self.whatsapp_api_url
            token = params.get("whatsapp_token") or self.whatsapp_token
            if not api_url or not token:
                return {"status": "error", "message": "WhatsApp API URL and Token are required."}
            try:
                await self._send_whatsapp_direct(api_url, token, test_device, test_alert, test_msg, "CRITICAL", test_details)
                return {"status": "ok", "message": "WhatsApp message test submitted successfully!"}
            except Exception as e:
                return {"status": "error", "message": f"WhatsApp test failed: {str(e)}"}

        return {"status": "error", "message": f"Unknown channel '{channel}'"}

    async def _send_webhook(self, device_id: str, alert_name: str, message: str, severity: str, details: Dict[str, Any] = None):
        return await self._send_webhook_direct(self.webhook_url, device_id, alert_name, message, severity, details)

    async def _send_webhook_direct(self, url: str, device_id: str, alert_name: str, message: str, severity: str, details: Dict[str, Any] = None):
        """Posts alert JSON payload to custom Webhook / Slack / Discord."""
        payload = {
            "system": "Smart CCMS Cold-Chain Platform",
            "device_id": device_id,
            "alert": alert_name,
            "severity": severity,
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
            "details": details or {}
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Smart-CCMS-Alerts/2.0"}
        )
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=7))
        print(f"✅ Webhook alert delivered to {url} for {device_id}")

    async def _send_telegram(self, device_id: str, alert_name: str, message: str, severity: str, details: Dict[str, Any] = None):
        return await self._send_telegram_direct(self.telegram_bot_token, self.telegram_chat_id, device_id, alert_name, message, severity, details)

    async def _send_telegram_direct(self, bot_token: str, chat_id: str, device_id: str, alert_name: str, message: str, severity: str, details: Dict[str, Any] = None):
        """Sends rich Telegram alert message."""
        icon = "🚨" if severity == "CRITICAL" else "⚠️"
        text = (
            f"{icon} *Smart CCMS Alert: {severity}*\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"🚛 *Vehicle / Device:* `{device_id}`\n"
            f"📋 *Rule:* `{alert_name}`\n"
            f"💬 *Event:* {message}\n"
            f"🕒 *Time:* `{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}`\n"
        )
        if details:
            if "cargo_temp_c" in details:
                text += f"🌡️ *Temperature:* `{details['cargo_temp_c']}°C` (Safe: {details.get('threshold_min', 2.0)}°C - {details.get('threshold_max', 8.0)}°C)\n"
            if "lat" in details and "lng" in details:
                text += f"📍 *Live Map:* [Google Maps Link](https://maps.google.com/?q={details['lat']},{details['lng']})\n"

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": False
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=7))
        print(f"✅ Telegram alert dispatched to chat {chat_id} for {device_id}")

    async def _send_whatsapp(self, device_id: str, alert_name: str, message: str, severity: str, details: Dict[str, Any] = None):
        return await self._send_whatsapp_direct(self.whatsapp_api_url, self.whatsapp_token, device_id, alert_name, message, severity, details)

    async def _send_whatsapp_direct(self, api_url: str, token: str, device_id: str, alert_name: str, message: str, severity: str, details: Dict[str, Any] = None):
        """Sends WhatsApp alert via Meta Cloud API or Twilio."""
        payload = {
            "messaging_product": "whatsapp",
            "type": "text",
            "text": {"body": f"🚨 Smart CCMS Cold-Chain Alert [{severity}]: {device_id} - {message}"}
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            api_url,
            data=data,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=7))
        print(f"✅ WhatsApp alert dispatched for {device_id}")


# Singleton instance
notifications = NotificationChannelDispatcher()
