"""
==============================================================================
FILE: websocket.py
PURPOSE:
Real-time WebSocket Connection Manager for ColdChain Fleet & Telemetry CMS.
Streams 1Hz vehicle kinematics, thermal forecasts, and instant safety alerts
to connected frontend dashboards with per-client selected device routing.
==============================================================================
"""

import json
import time
import logging
from typing import List, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..database.coldchain_db import coldchain_db
from ..services.coldchain_engine import coldchain_engine

logger = logging.getLogger("coldchain.websocket")
websocket_router = APIRouter(tags=["WebSocket"])


class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, str] = {}  # ws -> selected_device_id
        self.active_selected_device: str = "GW-001"

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections[ws] = self.active_selected_device
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

        # Send initial fleet state
        overview = coldchain_db.get_fleet_overview()
        init_msg = {
            "type": "INITIAL_FLEET_STATE",
            "server_ts_ms": int(time.time() * 1000),
            "query_latency_ms": overview.get("query_latency_ms", 0.1),
            "fleet": overview.get("fleet_table", [])
        }
        try:
            await ws.send_text(json.dumps(init_msg))
        except Exception as e:
            logger.warning(f"Failed to send initial fleet state: {e}")

    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections:
            del self.active_connections[ws]
            logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    def set_client_device(self, ws: WebSocket, device_id: str):
        if ws in self.active_connections:
            self.active_connections[ws] = device_id
        self.active_selected_device = device_id

    async def broadcast(self, message: Dict[str, Any]):
        dead_sockets: List[WebSocket] = []
        is_tick = message.get("type") == "TELEMETRY_TICK" and "tick" in message

        for ws, selected_dev in list(self.active_connections.items()):
            try:
                if is_tick:
                    dev_packet = coldchain_db.get_latest_packet(selected_dev)
                    tick_payload = dict(message)
                    tick_payload["tick"] = dict(message["tick"])
                    tick_payload["tick"]["selected_packet"] = dev_packet
                    await ws.send_text(json.dumps(tick_payload))
                else:
                    await ws.send_text(json.dumps(message))
            except Exception as e:
                dead_sockets.append(ws)

        for ws in dead_sockets:
            self.disconnect(ws)


manager = WebSocketManager()
coldchain_engine.register_broadcast_callback(manager.broadcast)


@websocket_router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
                if data.get("type") == "SELECT_DEVICE" and data.get("device_id"):
                    manager.set_client_device(websocket, data["device_id"])
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
