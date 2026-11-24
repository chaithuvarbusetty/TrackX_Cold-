"""
==============================================================================
FILE: start_public.py
PURPOSE:
One-click public launcher for the TracX Cold Chain Management System.
Boots the FastAPI backend on port 8000 and establishes a high-speed, secure
Cloudflare Tunnel (trycloudflare.com) with zero password/interstitial screens.
==============================================================================
"""

import os
import re
import sys
import time
import signal
import subprocess
import urllib.request
import urllib.error

if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BASE_DIR, ".env"))
except ImportError:
    pass

PYTHON_EXE = os.path.join(BASE_DIR, ".venv", "Scripts", "python.exe")
if not os.path.exists(PYTHON_EXE):
    PYTHON_EXE = sys.executable

CLOUDFLARED_EXE = os.path.join(BASE_DIR, "cloudflared.exe")
NGROK_EXE = os.path.join(BASE_DIR, "ngrok.exe")

APP_PORT = int(os.environ.get("PORT", 8000))
SUBPROCESS_ENV = {**os.environ, "PORT": str(APP_PORT), "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}

def free_port(port=APP_PORT):
    for im in ["cloudflared.exe", "ngrok.exe"]:
        try:
            subprocess.run(["taskkill", "/F", "/IM", im], capture_output=True, timeout=2)
        except Exception:
            pass
    try:
        proc = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=3)
        for line in proc.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.strip().split()
                if len(parts) >= 5:
                    pid = int(parts[-1])
                    if pid > 4 and pid != os.getpid():
                        try:
                            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=2)
                        except Exception:
                            pass
    except Exception:
        pass

def is_backend_ready(port=APP_PORT):
    try:
        req = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=1)
        return req.getcode() == 200
    except Exception:
        return False

def main():
    print("=" * 75, flush=True)
    print("[*] TRACX COLD CHAIN COMMAND CENTER — PUBLIC LAUNCHER", flush=True)
    print("=" * 75, flush=True)

    # 1. Start FastAPI Backend
    free_port(APP_PORT)
    print(f"[1/3] Starting backend server on http://127.0.0.1:{APP_PORT} ...", flush=True)
    
    # Initialize clean UTF-8 log file without null bytes
    backend_log_path = os.path.join(BASE_DIR, "backend.log")
    with open(backend_log_path, "w", encoding="utf-8") as f:
        f.write("")
    backend_log = open(backend_log_path, "a", encoding="utf-8", buffering=1)

    backend_proc = subprocess.Popen(
        [PYTHON_EXE, "-u", os.path.join(BASE_DIR, "run_tracx.py")],
        cwd=BASE_DIR,
        stdout=backend_log,
        stderr=subprocess.STDOUT,
        text=True,
        env=SUBPROCESS_ENV
    )

    # Wait for backend to be ready
    retries = 30
    ready = False
    while retries > 0:
        if is_backend_ready():
            ready = True
            break
        time.sleep(0.5)
        retries -= 1

    if not ready:
        print("[-] Error: Backend failed to start on port 8000.", flush=True)
        backend_proc.terminate()
        backend_log.close()
        # Read and display backend.log error details
        try:
            with open(os.path.join(BASE_DIR, "backend.log"), "r", encoding="utf-8", errors="ignore") as bf:
                print("--- Backend Log Output ---", flush=True)
                print(bf.read(), flush=True)
                print("--------------------------", flush=True)
        except Exception:
            pass
        sys.exit(1)

    print("[OK] Backend is active and healthy.", flush=True)

    def start_tunnel():
        nonlocal tunnel_proc, public_url
        ngrok_domain = os.environ.get("NGROK_DOMAIN", "").strip()
        ngrok_token = os.environ.get("NGROK_AUTHTOKEN", "").strip()

        # --- OPTION A: Permanent Static ngrok Domain ---
        if ngrok_domain and os.path.exists(NGROK_EXE):
            public_url = f"https://{ngrok_domain}" if not ngrok_domain.startswith("http") else ngrok_domain
            print(f"[*] Establishing permanent ngrok tunnel on: {public_url} ...", flush=True)
            if ngrok_token:
                subprocess.run([NGROK_EXE, "config", "add-authtoken", ngrok_token], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            tunnel_log = open(tunnel_log_path, "w", encoding="utf-8")
            tunnel_proc = subprocess.Popen(
                [NGROK_EXE, "http", f"--url={public_url}", str(APP_PORT), "--pooling-enabled"],
                cwd=BASE_DIR,
                stdout=tunnel_log,
                stderr=subprocess.STDOUT,
                text=True
            )
            time.sleep(2)
            if tunnel_proc.poll() is not None:
                # Retry once after 2 seconds in case a previous tunnel session was still closing
                time.sleep(2)
                tunnel_log = open(tunnel_log_path, "w", encoding="utf-8")
                tunnel_proc = subprocess.Popen(
                    [NGROK_EXE, "http", f"--url={public_url}", str(APP_PORT), "--pooling-enabled"],
                    cwd=BASE_DIR,
                    stdout=tunnel_log,
                    stderr=subprocess.STDOUT,
                    text=True
                )
                time.sleep(2)
                if tunnel_proc.poll() is not None:
                    print("[-] Error: ngrok failed to start. Check tunnel.log.", flush=True)
                    return False

            url_file = os.path.join(BASE_DIR, "PUBLIC_URL.txt")
            with open(url_file, "w", encoding="utf-8") as f:
                f.write(public_url + "\n")
            print("\n" + "=" * 75, flush=True)
            print("[*] PERMANENT STATIC HARDWARE ACCESS IS LIVE! (ngrok)", flush=True)
            print("=" * 75, flush=True)
            print(f"[*] Permanent Dashboard:     {public_url}", flush=True)
            print(f"[*] Fleet Overview API:      {public_url}/api/v1/fleet/overview", flush=True)
            print(f"[*] Live WebSocket Stream:   {public_url.replace('https://', 'wss://')}/ws/telemetry", flush=True)
            print(f"[*] Hardware Ingestion:      {public_url}/api/v1/telemetry", flush=True)
            print(f"[*] Live Telemetry Console:  {public_url}/logs", flush=True)
            print("=" * 75, flush=True)
            print(f"[OK] Permanent Firmware Endpoint: {public_url}/api/v1/telemetry", flush=True)
            print(f"[OK] This URL will NEVER rotate or change across restarts!", flush=True)
            print("System running. Press Ctrl+C to stop.\n", flush=True)
            return True

        # --- OPTION B: Cloudflare Quick Edge Tunnel ---
        print("[*] Establishing Cloudflare edge tunnel (HTTP/2 persistent connection) ...", flush=True)
        tunnel_log = open(tunnel_log_path, "w", encoding="utf-8")
        tunnel_proc = subprocess.Popen(
            [CLOUDFLARED_EXE, "tunnel", "--protocol", "http2", "--url", f"http://127.0.0.1:{APP_PORT}", "--no-autoupdate"],
            cwd=BASE_DIR,
            stdout=tunnel_log,
            stderr=subprocess.STDOUT,
            text=True
        )

        start_time = time.time()
        new_url = None
        while time.time() - start_time < 30:
            if os.path.exists(tunnel_log_path):
                with open(tunnel_log_path, "r", encoding="utf-8", errors="ignore") as lf:
                    content = lf.read()
                    match = url_pattern.search(content)
                    if match:
                        new_url = match.group(0)
                        break
            time.sleep(0.5)

        if new_url:
            public_url = new_url
            url_file = os.path.join(BASE_DIR, "PUBLIC_URL.txt")
            with open(url_file, "w", encoding="utf-8") as f:
                f.write(public_url + "\n")
            print("\n" + "=" * 75, flush=True)
            print("[*] PUBLIC ACCESS IS LIVE! (Cloudflare Edge Tunnel)", flush=True)
            print("=" * 75, flush=True)
            print(f"[*] Public Dashboard:        {public_url}", flush=True)
            print(f"[*] Fleet Overview API:      {public_url}/api/v1/fleet/overview", flush=True)
            print(f"[*] Live WebSocket Stream:   {public_url.replace('https://', 'wss://')}/ws/telemetry", flush=True)
            print(f"[*] Hardware Ingestion:      {public_url}/api/v1/telemetry", flush=True)
            print("=" * 75, flush=True)
            print(f"[OK] Public URL saved to: {url_file}", flush=True)
            print("System running. Press Ctrl+C to stop.\n", flush=True)
            return True
        return False

    tunnel_proc = None
    public_url = None
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    tunnel_log_path = os.path.join(BASE_DIR, "tunnel.log")

    if not start_tunnel():
        print("❌ Could not extract public tunnel URL. Check tunnel.log.", flush=True)
        backend_proc.terminate()
        backend_log.close()
        sys.exit(1)

    def handle_exit(sig=None, frame=None):
        print("\nStopping public tunnel and backend...", flush=True)
        try:
            if tunnel_proc:
                subprocess.run(f"taskkill /F /T /PID {tunnel_proc.pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if backend_proc:
                subprocess.run(f"taskkill /F /T /PID {backend_proc.pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            backend_log.flush()
            backend_log.close()
        except Exception:
            pass
        print("Done. Goodbye!", flush=True)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    try:
        # Self-healing keepalive loop
        restart_failures = 0
        while True:
            time.sleep(2)
            if backend_proc.poll() is not None:
                if is_backend_ready():
                    # Backend is responding healthy on port 8000
                    continue

                restart_failures += 1
                if restart_failures > 3:
                    print("\n[-] Backend stopped and failed to recover after 3 retries.", flush=True)
                    print("    Please inspect backend.log for details.\n", flush=True)
                    handle_exit()
                    break

                print(f"Backend stopped. Cleaning port {APP_PORT} and restarting [{restart_failures}/3] ...", flush=True)
                free_port(APP_PORT)
                time.sleep(1)
                backend_proc = subprocess.Popen(
                    [PYTHON_EXE, "-u", os.path.join(BASE_DIR, "run_tracx.py")],
                    cwd=BASE_DIR,
                    stdout=backend_log,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env=SUBPROCESS_ENV
                )
            else:
                restart_failures = 0

            if tunnel_proc and tunnel_proc.poll() is not None:
                print("Tunnel disconnected. Auto-reconnecting tunnel ...", flush=True)
                start_tunnel()
    except KeyboardInterrupt:
        handle_exit()

if __name__ == "__main__":
    main()
