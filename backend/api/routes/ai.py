"""
==============================================================================
FILE: ai.py
PURPOSE:
Interactive Telemetry Simulator Controls, Dual-Layer AI Predictions,
and SQLite Query Diagnostics & Benchmark Routes for ColdChain CMS.
==============================================================================
"""

from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ...database.coldchain_db import coldchain_db
from ...services.coldchain_engine import coldchain_engine

ai_router = APIRouter(tags=["AI & Simulation"])


@ai_router.post("/api/v1/simulate/action")
async def handle_simulation_action(payload: Dict[str, Any]):
    """
    Executes live simulation scenarios:
    DOOR_BREACH, COMPRESSOR_FAULT, SIGNAL_DROP, RESTORE_NORMAL, PAUSE_STREAM, RESUME_STREAM, step.
    """
    action = payload.get("action")
    device_id = payload.get("device_id") or "GW-001"
    if not action:
        raise HTTPException(status_code=400, detail="action parameter is required")

    try:
        result = coldchain_engine.perform_action(str(device_id), str(action))
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@ai_router.get("/api/v1/db/diagnostics")
async def get_database_diagnostics():
    """Retrieves SQLite WAL configuration, table telemetry counts, and indexing metrics."""
    return coldchain_db.get_diagnostics()


@ai_router.post("/api/v1/db/benchmark")
async def run_live_database_benchmark():
    """Executes live query performance benchmarks comparing raw scans against materialized hot state."""
    coldchain_db.run_live_benchmark()
    return coldchain_db.get_diagnostics()


# --- BACKWARD COMPATIBILITY AI ROUTES ---
@ai_router.get("/api/v1/ai/{device_id}/latest")
@ai_router.get("/{device_id}/latest")
async def get_ai_latest_insights(device_id: str):
    """Retrieves latest AI thermal risk and anomaly assessments."""
    pkt = coldchain_db.get_latest_packet(device_id)
    if not pkt:
        raise HTTPException(status_code=404, detail="Device telemetry not found")
    dev = coldchain_db.get_device(device_id)
    t_min = float(dev["target_min_c"]) if dev else 2.0
    t_max = float(dev["target_max_c"]) if dev else 8.0
    history = coldchain_db.get_device_telemetry_history(device_id, limit=30)
    samples = [{"recorded_at_ms": p["recorded_at_ms"], "cargo_temp_c": p["cargo_temp_c"]} for p in history]
    from ...services.coldchain_engine import compute_thermal_forecast
    forecast = compute_thermal_forecast(samples, t_min, t_max)
    return {
        "device_id": device_id,
        "temperature_forecast": forecast,
        "risk_level": forecast["risk_level"],
        "excursion_risk_pct": forecast["excursion_risk_pct"]
    }
