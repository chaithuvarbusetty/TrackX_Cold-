# TracX ColdChain 3D Digital Twin & Fleet Telemetry CMS

Real-time pharmaceutical cold chain telemetry platform with 3D digital twin visualization, real-time GPS kinematics, chamber cutaway thermal monitoring, and synchronized historical trip replays.

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **Git**
- **Python 3.10+** (Python 3.11 or 3.12 recommended)
- **Node.js 18+** / **npm** (or **Bun**)
- *(Optional)* **PostgreSQL** — If omitted, the platform runs automatically in SQLite WAL mode out of the box with zero setup.

---

### 2. Clone the Repository
```bash
git clone https://github.com/chaithuvarbusetty/TrackX_Cold-.git
cd TrackX_Cold-
```

---

### 3. Backend Setup (Python)
1. **Create and activate a virtual environment:**
   ```bash
   # Windows (cmd/PowerShell)
   python -m venv .venv
   .\.venv\Scripts\activate

   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment:**
   ```bash
   # Windows
   copy .env.example .env

   # macOS / Linux
   cp .env.example .env
   ```
   *(By default, `DATABASE_URL` is blank in `.env`, which enables the built-in SQLite WAL engine automatically without needing PostgreSQL).*

---

### 4. Frontend Setup (React + Three.js)
1. **Navigate to the frontend directory:**
   ```bash
   cd Frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   # or if you use Bun:
   bun install
   ```

3. **Build production assets:**
   ```bash
   npm run build
   # or with Bun:
   bun run build
   ```

4. **Return to project root:**
   ```bash
   cd ..
   ```

---

### 5. Launch Application
Start the master server daemon:
```bash
python run_tracx.py
```

Open your browser at:
👉 **[http://localhost:8000](http://localhost:8000)**

---

## 📦 Features Overview

1. **Live Tracking**:
   - 2D Map, 3D Live Rig, and Split-screen view toggle.
   - Dynamic wheel rotation synced to vehicle GPS velocity.
   - Five interactive camera docks (Chase, Orbit, Top-Down, Cargo Hold, Driver Cabin).
   - Real-time cutaway mode.

2. **Thermal Status**:
   - 3D cutaway refrigerated chamber.
   - Real-time temperature illumination (Ice-Blue safe 2–8°C zone, Crimson-Red excursion >8°C).
   - DS18B20 digital sensor node locator.

3. **Vehicle Monitoring**:
   - Hardware diagnostic twin.
   - Interactive 3D door clicks (toggles rear sealed doors).
   - Simulation fault triggers (`COMPRESSOR_FAULT`, `DOOR_BREACH`, `RESTORE_NORMAL`).
   - Diagnostic specification sheet.

4. **Trips Replay**:
   - Synchronized 4D replay with interactive timeline scrubber.
   - Halt detection and automated cargo door animation during unloading stops.

---

## 🛠️ Verification Tests
To run the automated platform sync test suite (12 tests):
```bash
python test_sync.py
```
