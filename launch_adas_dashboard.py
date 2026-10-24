#!/usr/bin/env python3
"""
Launch DRISHTI Dashboard + Camera Window (Single Command, Perfect Sync).

- Starts Flask dashboard on port 5000
- Opens CV2 window with live camera feed + ADAS overlays
- **Both share the exact same VisionWorker and DMSState**
- Dashboard cockpit shows live MJPEG feed at /video_feed
- Camera window reads same frames directly from the worker
- Press ESC in camera window to close it; dashboard keeps running
"""

import sys
import threading
import time
import os
import cv2
import numpy as np

from pathlib import Path

# Ensure project directory is resolved dynamically
PROJECT_ROOT = Path(__file__).resolve().parent
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import argparse

parser = argparse.ArgumentParser(description="Launch DRISHTI Dashboard + Camera Window")
parser.add_argument("--camera", type=int, default=int(os.environ.get("DMS_CAMERA_INDEX", 0)), help="Webcam device index (default: 0)")
parser.add_argument("--serial", action="store_true", help="Enable Arduino serial bridge on boot")
parser.add_argument("--port", type=int, default=5000, help="HTTP port (default: 5000)")
args, _ = parser.parse_known_args()

if args.serial:
    os.environ["DMS_SERIAL"] = "1"
if args.camera != 0:
    os.environ["DMS_CAMERA_INDEX"] = str(args.camera)

# ── 1. Import Flask app and its shared runtime ────────────────────────────
from app import app as flask_app, runtime as get_runtime

def run_flask():
    try:
        flask_app.run(host="0.0.0.0", port=args.port, debug=False, threaded=True, use_reloader=False)
    except Exception as e:
        print(f"[Flask error] {e}")

flask_thread = threading.Thread(target=run_flask, daemon=True)
flask_thread.start()

# Wait for Flask to fully start
print(f"[INFO] Starting Flask server on port {args.port}...")
time.sleep(2.5)

# ── 2. Get the shared runtime and start live vision ───────────────────────
rt = get_runtime()  # This creates the singleton if needed
print("[INFO] Runtime initialized")

# Stop any demo scenario and start live vision
rt.state.stop_scenario(reset_incident=True)
started = rt.vision.start()
if not started.get("ok"):
    print(f"[ERROR] Could not start camera: {started.get('error')}")
    sys.exit(1)

# Wait for first frame
deadline = time.time() + 3.5
while time.time() < deadline:
    if rt.vision.get_frame() is not None:
        break
    if not rt.vision.running:
        print("[ERROR] Camera pipeline exited")
        sys.exit(1)
    time.sleep(0.08)

if not rt.vision.running:
    print("[ERROR] Camera failed to produce frames")
    sys.exit(1)

rt.state.set_vision_mode(True)  # Switch dashboard to LIVE mode
print("[INFO] Live vision started ✓  (Dashboard mode: LIVE)")

# ── 3. Main loop: show camera feed with ADAS overlays ─────────────────────
cv2_named_window = True
try:
    cv2.namedWindow("DRISHTI · Live Cabin Feed + ADAS", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("DRISHTI · Live Cabin Feed + ADAS", 1280, 720)
except Exception as e:
    print(f"[WARNING] Could not create CV2 window: {e}")
    cv2_named_window = False

try:
    while True:
        if not cv2_named_window:
            time.sleep(1)
            continue

        # Get frame from THE SAME WORKER that feeds /video_feed
        frame = rt.vision.get_frame()
        if frame is not None:
            img = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)

            # Read metrics directly from shared state (no HTTP, perfectly synced)
            snap = rt.state.state_snapshot()
            d = snap.get("driver", {})
            ear = d.get("ear", 0.0)
            mar = d.get("mar", 0.0)
            risk = d.get("risk", 0.0)
            attention = d.get("attention", 0.0)
            head_dir = d.get("head_direction", "FORWARD")
            pitch = d.get("pitch", 0.0)
            yaw = d.get("yaw", 0.0)

            # Draw ADAS overlays - ALL REAL VALUES
            cv2.putText(img, f"EAR:{ear:.2f}", (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.putText(img, f"MAR:{mar:.2f}", (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            risk_color = (0, 255, 0) if risk < 30 else (0, 165, 255) if risk < 70 else (0, 0, 255)
            cv2.putText(img, f"RISK:{risk:.0f}%", (10, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, risk_color, 2)
            att_color = (0, 255, 0) if attention > 80 else (0, 165, 255) if attention > 50 else (0, 0, 255)
            cv2.putText(img, f"ATT:{attention:.0f}%", (10, 120),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, att_color, 2)
            cv2.putText(img, f"Head: {head_dir}  pitch:{pitch:.1f}  yaw:{yaw:.1f}", (10, 150),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            if ear < 0.23:
                cv2.putText(img, "⚠ EYE CLOSURE ALERT", (10, img.shape[0] - 20),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            # Resize for display (max height 720, keep aspect)
            scale = 720 / img.shape[0] if img.shape[0] > 0 else 1
            new_w = int(img.shape[1] * scale)
            img = cv2.resize(img, (new_w, 720))

            cv2.imshow("DRISHTI · Live Cabin Feed + ADAS", img)

        # ESC to close camera window only
        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            print(f"\n[INFO] Camera window closed. Dashboard still LIVE at http://127.0.0.1:{args.port}")
            cv2.destroyAllWindows()
            cv2_named_window = False
            # Keep main thread alive so Flask continues
            while True:
                time.sleep(1)

        time.sleep(0.03)

except KeyboardInterrupt:
    print("\n[INFO] Interrupted by user")

finally:
    rt.vision.stop()
    rt.state.set_vision_mode(False)
    if cv2_named_window:
        cv2.destroyAllWindows()
    print("\n[DONE] Dashboard stopped. Close terminal to exit.")