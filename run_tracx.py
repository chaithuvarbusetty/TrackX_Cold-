"""
==============================================================================
FILE: run_tracx.py
PURPOSE:
Master launcher script for the Unified ColdChain CMS & Telemetry Platform.
Boots the FastAPI ASGI server with WebSockets, SQLite WAL, and React Dashboard.
==============================================================================
"""

import os
import sys
import uvicorn

if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")

    print("=" * 70)
    print("[*] ColdChain CMS & Telemetry Command Center")
    print(f"[*] Real-time Dashboard:    http://{host}:{port}/")
    print(f"[*] Fleet Overview API:     http://{host}:{port}/api/v1/fleet/overview")
    print(f"[*] Live WebSocket Stream:  ws://{host}:{port}/ws/telemetry")
    print(f"[*] Hardware Ingestion:     http://{host}:{port}/api/v1/telemetry")
    print("=" * 70)

    uvicorn.run("backend.main:app", host=host, port=port, reload=False)
