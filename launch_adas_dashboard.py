#!/usr/bin/env python3
"""
Launch DRISHTI Dashboard + Camera Window (Single Command).

Starts Flask dashboard on port 5000 AND opens CV2 window with live feed.
Both share the same MediaPipe pipeline → perfectly synchronized.

Press ESC in the camera window to close just the window; dashboard stays running.

TROUBLESHOOTING:
  - If camera window doesn't open: run `xhost +local:` (Linux) or ensure X11 forwarding
  - If dashboard can't start: ensure venv is active and Flask deps installed
  - If you only want the camera (no dashboard): use test_camera.py
"""

import sys
import threading
import time
import os
import cv2
import numpy as np

# Ensure project directory
os.chdir("/home/nishant/drowsiness_test")
sys.path.insert(0, "/home/nishant/drowsiness_test")

# ── 1. Start Flask dashboard in background thread ─────────────────────────
from app import app as flask_app

def run_flask():
    try:
        flask_app.run(host="0.0.0.0", port=5000, debug=False, threaded=True, use_reloader=False)
    except Exception as e:
        print(f"[Flask error] {e}")

flask_thread = threading.Thread(target=run_flask, daemon=True)
flask_thread.start()

# Wait for Flask to start
time.sleep(2)

# ── 2. Initialize MediaPipe FaceLandmarker (shared pipeline) ───────────────
from dms.vision import VisionWorker

try:
    vw = VisionWorker(
        "/home/nishant/drowsiness_test/face_landmarker.task",
        camera_index=0,
        on_metrics=lambda m: None,
    )
    vw.start()
    print("[INFO] Vision pipeline started ✓")
except FileNotFoundError as e:
    print(f"[ERROR] Model file not found: {e}")
    print("  Ensure face_landmarker.task is in /home/nishant/drowsiness_test/")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Could not start vision pipeline: {e}")
    sys.exit(1)

# ── 3. Main loop: show camera feed with ADAS overlays ─────────────────────
import requests

# Create resizable window (WINDOW_NORMAL allows dragging and resizing)
cv2_named_window = True
try:
    cv2.namedWindow("DRISHTI · Live Cabin Feed + ADAS", cv2.WINDOW_NORMAL)
    # Set initial size - wide enough for ADAS info but adjustable
    cv2.resizeWindow("DRISHTI · Live Cabin Feed + ADAS", 1280, 720)
except Exception as e:
    print(f"[WARNING] Could not create CV2 window: {e}")
    print("  (running dashboard only - no camera window)")
    cv2_named_window = False

try:
    while True:
        if not cv2_named_window:
            # If no window, just keep alive and show state via dashboard
            time.sleep(1)
            continue

        frame = vw.get_frame()
        if frame is not None:
            # Decode JPEG frame back to numpy array
            img = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)

            # Get latest state from dashboard (shared → synchronized, real data)
            try:
                snap = requests.get("http://127.0.0.1:5000/api/state", timeout=0.5).json()
                d = snap.get("driver", {})
                ear = d.get("ear", 0.0)
                mar = d.get("mar", 0.0)
                risk = d.get("risk", 0.0)
                attention = d.get("attention", 0.0)
                head_dir = d.get("head_direction", "FORWARD")
                pitch = d.get("pitch", 0.0)
                yaw = d.get("yaw", 0.0)
            except Exception:
                ear, mar, risk, attention = 0.0, 0.0, 0.0, 0.0
                head_dir = "FORWARD"
                pitch, yaw = 0.0, 0.0

            # Draw ADAS overlays on the frame - ALL VALUES ARE REAL from dashboard API
            # EAR: Eye Aspect Ratio (< 0.23 triggers alert)
            cv2.putText(img, f"EAR:{ear:.2f}", (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            # MAR: Mouth Aspect Ratio
            cv2.putText(img, f"MAR:{mar:.2f}", (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            # Risk level (computed from EAR/MAR/pitch/yaw/blink metrics)
            risk_color = (0, 255, 0) if risk < 30 else (0, 165, 255) if risk < 70 else (0, 0, 255)
            cv2.putText(img, f"RISK:{risk:.0f}%", (10, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, risk_color, 2)
            # Attention level
            att_color = (0, 255, 0) if attention > 80 else (0, 165, 255) if attention > 50 else (0, 0, 255)
            cv2.putText(img, f"ATT:{attention:.0f}%", (10, 120),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, att_color, 2)
            # Head pose direction
            cv2.putText(img, f"Head: {head_dir}  pitch:{pitch:.1f}  yaw:{yaw:.1f}", (10, 150),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            # Eye closure warning if EAR < 0.23 (the drowsiness threshold)
            if ear < 0.23:
                cv2.putText(img, "⚠ EYE CLOSURE ALERT", (10, img.shape[0] - 20),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            # Resize for display while keeping aspect ratio (max height 720)
            scale = 720 / img.shape[0] if img.shape[0] > 0 else 1
            new_w = int(img.shape[1] * scale)
            img = cv2.resize(img, (new_w, 720))

            cv2.imshow("DRISHTI · Live Cabin Feed + ADAS", img)
        else:
            # No frame yet - still keep UI responsive
            if cv2.waitKey(1) & 0xFF == 27:  # ESC key
                break
            time.sleep(0.1)

        time.sleep(0.03)

except KeyboardInterrupt:
    print("\n[INFO] Interrupted by user")

finally:
    # Cleanup
    vw.stop()
    if cv2_named_window:
        cv2.destroyAllWindows()
    print("\n[DONE] Dashboard still running: http://127.0.0.1:5000")
    print("     Close this terminal only to stop Flask")