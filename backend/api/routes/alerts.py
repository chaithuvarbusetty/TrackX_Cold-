"""
==============================================================================
FILE: alerts.py
PURPOSE:
Safety Excursion, Tamper, and Real-Time Alarm Audit Routes for ColdChain CMS.
==============================================================================
"""

import time
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from ...database.coldchain_db import coldchain_db
from ..websocket import manager

alerts_router = APIRouter(tags=["Alerts"])


@alerts_router.get("/api/v1/alerts")
async def list_alerts(
    device_id: Optional[str] = Query(None),
    alert_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None)
):
    """Retrieves real-time alerts audit feed with optional device, status, or severity filters."""
    alerts = coldchain_db.get_alerts(device_id=device_id, alert_type=alert_type, status=status)
    return {"alerts": alerts}


@alerts_router.post("/api/v1/alerts/{alert_id}/status")
async def update_alert_status(alert_id: str, payload: Dict[str, Any]):
    """Updates the acknowledgement or resolution state of an active safety alarm."""
    new_status = payload.get("status")
    if new_status not in ["Active", "Acknowledged", "Resolved"]:
        raise HTTPException(status_code=400, detail="Invalid status. Must be Active, Acknowledged, or Resolved.")

    updated = coldchain_db.update_alert_status(alert_id, new_status)
    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")

    await manager.broadcast({
        "type": "ALERT_UPDATED",
        "server_ts_ms": int(time.time() * 1000),
        "alert": updated
    })

    return {"alert": updated}
