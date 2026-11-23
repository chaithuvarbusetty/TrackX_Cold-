"""
==============================================================================
FILE: backend/api/routes/notifications.py
PURPOSE:
API endpoints for Mobile Push Notifications management.
Enables 1-click native Web Push registration and zero-cost lock-screen alerts.
==============================================================================
"""

import json
from fastapi import APIRouter, HTTPException, Body
from typing import Dict, Any, Optional
from backend.services.push_service import push_service

notifications_router = APIRouter(tags=["Notifications"])

@notifications_router.get("/api/v1/notifications/vapid-public-key")
async def get_vapid_public_key():
    """Returns the VAPID public key for frontend pushManager subscription."""
    key = push_service.get_vapid_public_key()
    return {
        "status": "ok",
        "public_key": key
    }

@notifications_router.get("/api/v1/notifications/mobiles")
async def get_registered_mobiles():
    """Lists all registered mobile devices for alert dispatch."""
    mobiles = push_service.list_mobiles()
    return {
        "count": len(mobiles),
        "mobiles": mobiles
    }

@notifications_router.post("/api/v1/notifications/register")
async def register_mobile_device(payload: Dict[str, Any] = Body(...)):
    """Registers a mobile phone number and push notification subscription."""
    phone = payload.get("phone_number")
    sub = payload.get("push_subscription")
    if (not phone or len(str(phone).strip()) < 7) and not sub:
        raise HTTPException(status_code=400, detail="A valid phone number or WebPush subscription is required.")

    res = push_service.register_mobile(payload)
    return res

@notifications_router.post("/api/v1/notifications/webpush/subscribe")
async def subscribe_webpush(payload: Dict[str, Any] = Body(...)):
    """1-Click native browser Web Push registration endpoint."""
    sub = payload.get("push_subscription")
    if not sub or not isinstance(sub, dict) or not sub.get("endpoint"):
        raise HTTPException(status_code=400, detail="Valid W3C PushSubscription is required.")

    res = push_service.register_mobile(payload)
    return res

@notifications_router.delete("/api/v1/notifications/mobiles/{phone_number}")
async def unregister_mobile_device(phone_number: str):
    """Unlinks a registered mobile phone or WebPush subscription."""
    deleted = push_service.delete_mobile(phone_number)
    return {
        "status": "ok" if deleted else "not_found",
        "phone_number": phone_number,
        "deleted": deleted
    }

@notifications_router.post("/api/v1/notifications/test")
async def send_test_notification(payload: Dict[str, Any] = Body(...)):
    """Dispatches an instant test push notification to verify phone reception."""
    phone = payload.get("phone_number")
    sub = payload.get("push_subscription")

    # If subscription provided directly
    if sub and isinstance(sub, dict) and sub.get("endpoint"):
        ok = push_service.send_direct_webpush(
            sub,
            title="🚨 ColdChain Mobile Alert Verified",
            body="Zero-cost lock screen alert active! Live hardware telemetry excursions will ring this device.",
            url="/"
        )
        return {
            "status": "ok" if ok else "error",
            "message": "✓ Test alert delivered to your mobile lock screen!" if ok else "WebPush delivery failed."
        }

    # If phone identifier provided, look up if it has a native WebPush subscription in DB
    if phone:
        phone_str = str(phone).strip()
        mobiles = push_service.list_mobiles()
        target = next((m for m in mobiles if m["phone_number"] == phone_str), None)
        if target and target.get("has_webpush") and target.get("push_subscription"):
            ok = push_service.send_direct_webpush(
                target["push_subscription"],
                title="🚨 ColdChain Mobile Alert Verified",
                body=f"Test alert for {target['recipient_name']} ({target['device_name']}). Lock screen alerts active!",
                url="/"
            )
            return {
                "status": "ok" if ok else "error",
                "message": "✓ Test alert delivered to your phone lock screen!" if ok else "WebPush delivery failed."
            }

        # Otherwise dispatch to open topic
        res = push_service.send_test_push(phone_str)
        return res

    raise HTTPException(status_code=400, detail="Phone number or push subscription required.")
