#!/usr/bin/env python3
"""Simple test: just the CV2 camera window + ADAS overlays from state."""
import sys
import time
import os
import cv2
import numpy as np
import requests

from pathlib import Path

# Ensure project directory is resolved dynamically
PROJECT_ROOT = Path(__file__).resolve().parent
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dms.vision import VisionWorker

MODEL_PATH = PROJECT_ROOT / "face_landmarker.task"
camera_index = int(os.environ.get("DMS_CAMERA_INDEX", 0))

vw = VisionWorker(
    MODEL_PATH,
    camera_index=camera_index,
    on_metrics=lambda m: None,
)
vw.start()
time.sleep(2)

cv2.namedWindow("DRISHTI Camera Test", cv2.WINDOW_AUTOSIZE)

try:
    while True:
        frame = vw.get_frame()
        if frame is not None:
            img = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)
            # Get state overlays
            try:
                snap = requests.get("http://127.0.0.1:5000/api/state", timeout=0.5).json()
                d = snap.get("driver", {})
                ear = d.get("ear", 0.0)
                mar = d.get("mar", 0.0)
                risk = d.get("risk", 0.0)
                att = d.get("attention", 0.0)
                hd = d.get("head_direction", "FORWARD")
                p = d.get("pitch", 0.0)
                yaw = d.get("yaw", 0.0)
            except Exception:
                ear = mar = risk = att = 0.0
                hd = "FORWARD"; p = yaw = 0.0
            cv2.putText(img, f"EAR:{ear:.2f} MAR:{mar:.2f} Risk:{risk:.0f}% ATT:{att:.0f}% Head:{hd} pitch:{p:.1f} yaw:{yaw:.1f}", (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            if ear < 0.23:
                cv2.putText(img, "⚠ EYE CLOSURE ALERT", (10, img.shape[0]-20),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.imshow("DRISHTI Camera Test", img)
        if cv2.waitKey(1) & 0xFF == 27:  # ESC
            break
        time.sleep(0.03)
finally:
    vw.stop()
    cv2.destroyAllWindows()
    print("Camera test ended. Run launch_adas_dashboard.py for dashboard+camera.")