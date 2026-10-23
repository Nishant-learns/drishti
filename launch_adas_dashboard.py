#!/usr/bin/env python3
"""
Launch DRISHTI Dashboard + ADAS Camera Window (Single Command).

- Starts Flask dashboard on port 5000 (accessible from phone via hotspot)
- Opens CV2 window with live camera feed + ADAS overlays
- Both share the same MediaPipe pipeline → perfectly synchronized
- Press ESC in the camera window to close just the window; dashboard stays running
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
    flask_app.run(host="0.0.0.0", port=5000, debug=False, threaded=True, use_reloader=False)

flask_thread = threading.Thread(target=run_flask, daemon=True)
flask_thread.start()

# Wait for Flask to start
time.sleep(2)

print("=" * 60)
print("DRISHTI · ADAS + Dashboard  •  Single-Launch Mode")
print("=" * 60)
print("📡 Dashboard:    http://127.0.0.1:5000")
print("   (open on phone: http://<laptop-ip>:5000)")
print("📷 Camera window: press ESC to close (dashboard stays up)")
print("=" * 60)
print()
print("Starting Vision pipeline and ADAS overlays...")
print()

# ── 2. Initialize MediaPipe FaceLandmarker (shared pipeline) ───────────────
from dms.vision import VisionWorker

vw = VisionWorker(
    "/home/nishant/drowsiness_test/face_landmarker.task",
    camera_index=0,
    on_metrics=lambda m: None,  # we read state directly; no callback spam
)

# Start the vision capture thread
vw.start()

# ── 3. Main loop: show camera feed with ADAS overlays ─────────────────────
import requests

try:
    while True:
        frame = vw.get_frame()
        if frame is not None:
            # Decode the JPEG frame back to numpy array
            img = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)
            
            # Get metrics from state (shared with dashboard, so they're synchronized)
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
            
            # Draw ADAS overlays on the frame
            # Draw EAR/MAR text
            cv2.putText(img, f"EAR:{ear:.2f}  MAR:{mar:.2f}", (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            # Risk level color
            risk_color = (0, 255, 0) if risk < 30 else (0, 165, 255) if risk < 70 else (0, 0, 255)
            cv2.putText(img, f"RISK:{risk:.0f}%", (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, risk_color, 2)
            
            # Attention
            att_color = (0, 255, 0) if attention > 80 else (0, 165, 255) if attention > 50 else (0, 0, 255)
            cv2.putText(img, f"ATT:{attention:.0f}%", (10, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, att_color, 2)
            
            # Head pose
            cv2.putText(img, f"Head: {head_dir}  pitch:{pitch:.1f}  yaw:{yaw:.1f}", (10, 120),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            
            # Eye closure warning if EAR < 0.23 (same threshold as dashboard)
            if ear < 0.23:
                cv2.putText(img, "⚠ EYE CLOSURE ALERT", (10, h - 20) if (h := img.shape[0]) else (10, 480),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            
            # Resize for display window - keep aspect ratio, max height 900
            scale = 900 / img.shape[0] if img.shape[0] > 0 else 1
            new_w = int(img.shape[1] * scale)
            img = cv2.resize(img, (new_w, 900))
            
            # Show window
            cv2.imshow("DRISHTI · Live Cabin Feed + ADAS", img)
        
        key = cv2.waitKey(1) & 0xFF
        if key == 27:  # ESC key
            break
        time.sleep(0.03)

finally:
    # Cleanup
    vw.stop()
    cv2.destroyAllWindows()
    print("\n" + "=" * 60)
    print("Dashboard still running: http://127.0.0.1:5000")
    print("Close this terminal only to stop Flask")
    print("=" * 60)