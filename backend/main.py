"""
==============================================================================
FILE: main.py
PURPOSE:
Unified FastAPI Application Server for ColdChain CMS & TracX Fleet Telemetry.
Combines real-time WebSocket streaming, indexed SQLite query performance,
dual-layer AI predictions, hardware ingestion, and React SPA static serving.
==============================================================================
"""

import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .database.coldchain_db import coldchain_db
from .services.coldchain_engine import coldchain_engine
from .api.websocket import websocket_router, manager
from .api.routes.telemetry import telemetry_router
from .api.routes.devices import devices_router
from .api.routes.trips import trips_router
from .api.routes.alerts import alerts_router
from .api.routes.ai import ai_router
from .api.routes.geofences import geofences_router
from .api.routes.notifications import notifications_router

logger = logging.getLogger("coldchain.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown hooks."""
    # 1. Initialize DB tables and indexes
    coldchain_db.init_schema()
    # 2. Sync devices into simulation engine
    coldchain_engine.sync_devices()
    # 3. Start 1Hz background simulation loop
    sim_task = asyncio.create_task(coldchain_engine.run_loop())
    yield
    # Shutdown cleanup
    coldchain_engine.is_running = False
    sim_task.cancel()
    try:
        await sim_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="ColdChain CMS & Fleet Telemetry Platform",
    description="Real-time Cold-Chain Command Center with SQLite WAL Optimization and Dual-Layer AI Forecasting",
    version="2.5.0",
    lifespan=lifespan
)

# Cross-Origin Resource Sharing (CORS) Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    """Enforces no-cache headers for real-time telemetry updates."""
    response = await call_next(request)
    if (
        request.url.path.endswith((".js", ".css", ".html"))
        or request.url.path == "/"
        or "/api/" in request.url.path
    ):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ============================================================================
# REGISTER MODULAR ROUTERS
# ============================================================================
app.include_router(telemetry_router)
app.include_router(devices_router)
app.include_router(trips_router)
app.include_router(geofences_router)
app.include_router(alerts_router)
app.include_router(notifications_router)
app.include_router(ai_router)
app.include_router(websocket_router)


# ============================================================================
# MOUNT STATIC REACT FRONTEND SPA
# ============================================================================
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
frontend_dist = os.path.join(base_dir, "Frontend", "dist")

if os.path.exists(frontend_dist) and os.path.exists(os.path.join(frontend_dist, "index.html")):
    # Mount dist directory for CSS/JS assets
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't intercept API or WebSocket paths
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            return None
        candidate = os.path.join(frontend_dist, full_path)
        if os.path.exists(candidate) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
