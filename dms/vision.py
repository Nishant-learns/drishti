"""MediaPipe FaceLandmarker edge-vision worker.

Runs a webcam in a background thread, estimates EAR / MAR / head pose and
publishes annotated MJPEG frames. The dashboard calls this only when the
operator explicitly switches to Live Vision.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

import cv2
import mediapipe as mp
import numpy as np

try:
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
except ImportError:  # pragma: no cover
    mp_python = None
    mp_vision = None


LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
]
LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53]
RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283]
NOSE_LINE = [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 294, 440, 275]
LIPS_OUTER = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324,
    318, 402, 317, 14, 87, 178, 88, 95, 78, 191, 80, 81, 82, 13,
    312, 311, 310, 415, 308,
]
LIPS_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415]

# Six correspondence points for a small, stable solvePnP pose solve.
POSE_IMAGE_IDS = [1, 152, 33, 263, 61, 291]
POSE_MODEL = np.array(
    [
        (0.0, 0.0, 0.0),          # nose tip
        (0.0, -63.6, -12.5),      # chin
        (-43.3, 32.7, -26.0),     # left eye outer corner
        (43.3, 32.7, -26.0),      # right eye outer corner
        (-28.9, -28.9, -24.1),    # left mouth corner
        (28.9, -28.9, -24.1),     # right mouth corner
    ],
    dtype=np.float64,
)


def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def _ear(points: list[np.ndarray]) -> float:
    # points = [outer, upper-left, upper-right, inner, lower-right, lower-left]
    vertical = _dist(points[1], points[5]) + _dist(points[2], points[4])
    horizontal = 2.0 * _dist(points[0], points[3])
    return vertical / horizontal if horizontal else 0.0


def _mar(points: list[np.ndarray]) -> float:
    # A deliberately generous inner-lip aperture; yawning has a large margin.
    vertical = _dist(points[13], points[14]) + _dist(points[82], points[312]) + _dist(points[87], points[317])
    horizontal = 3.0 * _dist(points[78], points[308])
    return vertical / horizontal if horizontal else 0.0


class VisionWorker:
    def __init__(
        self,
        model_path: str | Path,
        camera_index: int = 0,
        on_metrics: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.model_path = str(model_path)
        self.camera_index = camera_index
        self.on_metrics = on_metrics
        self.thread: threading.Thread | None = None
        self.running = False
        self.lock = threading.RLock()
        self.frame_lock = threading.Lock()
        self.latest_jpeg: bytes | None = None
        self.error = ""
        self.metrics: dict[str, Any] = {}
        self.started_at = 0.0
        self._stop = threading.Event()
        self._fps_window: deque[float] = deque(maxlen=30)
        self._closure_started: float | None = None
        self._blink_cooldown = 0.0
        self._last_ear = 1.0
        self._blink_count = 0
        self._microsleeps = 0
        self._microsleep_counted_at: float | None = None
        self._blink_times: deque[float] = deque(maxlen=60)
        self._last_face = 0.0
        self._model_ready = False

    @property
    def available(self) -> bool:
        return mp_python is not None and Path(self.model_path).exists()

    def start(self) -> dict[str, Any]:
        with self.lock:
            if self.running:
                return {"ok": True, "running": True, "message": "Vision already running"}
            if not self.available:
                return {"ok": False, "running": False, "error": "FaceLandmarker model or MediaPipe unavailable"}
            self._stop.clear()
            self.running = True
            self.error = ""
            self.started_at = time.time()
            self._fps_window.clear()
            self._closure_started = None
            self._last_ear = 1.0
            self._blink_count = 0
            self._microsleeps = 0
            self._microsleep_counted_at = None
            self._blink_times.clear()
            self.thread = threading.Thread(target=self._loop, name="dms-vision", daemon=True)
            self.thread.start()
            return {"ok": True, "running": True}

    def stop(self) -> None:
        with self.lock:
            self._stop.set()
            self.running = False
            self.thread = None

    def _landmark_xy(self, landmarks, index: int, width: int, height: int) -> np.ndarray:
        lm = landmarks[index]
        return np.array([lm.x * width, lm.y * height], dtype=np.float64)

    def _loop(self) -> None:
        cap = None
        landmarker = None
        try:
            cap = cv2.VideoCapture(self.camera_index, cv2.CAP_V4L2)
            if not cap.isOpened():
                cap = cv2.VideoCapture(self.camera_index)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            base_options = mp_python.BaseOptions(model_asset_path=self.model_path)
            options = mp_vision.FaceLandmarkerOptions(
                base_options=base_options,
                running_mode=mp_vision.RunningMode.VIDEO,
                num_faces=1,
                min_face_detection_confidence=0.5,
                min_face_presence_confidence=0.5,
                min_tracking_confidence=0.5,
                output_face_blendshapes=False,
            )
            landmarker = mp_vision.FaceLandmarker.create_from_options(options)
            self._model_ready = True
            last = 0.0
            missed_since = time.time()
            while not self._stop.is_set():
                ok, raw = cap.read()
                if not ok:
                    self.error = "Camera frame unavailable"
                    time.sleep(0.05)
                    continue
                frame = cv2.flip(raw, 1)
                # Keep processing lean for an Uno-class exhibition laptop.
                if frame.shape[1] > 960:
                    scale = 960 / frame.shape[1]
                    frame = cv2.resize(frame, (960, int(frame.shape[0] * scale)))
                now = time.time()
                if now - last < 1 / 28:
                    time.sleep(0.003)
                    continue
                last = now
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                h, w = frame.shape[:2]
                try:
                    result = landmarker.detect_for_video(mp_image, int(now * 1000))
                except Exception as exc:  # inference failure should not kill the feed
                    result = None
                    self.error = f"Inference: {exc}"
                if result and result.face_landmarks:
                    landmarks = result.face_landmarks[0]
                    self._last_face = now
                    missing_reset = False
                    metrics = self._metrics_from_landmarks(landmarks, w, h, now)
                    self._draw_face(frame, landmarks, metrics)
                else:
                    missing_reset = True
                    self._closure_started = None
                    metrics = {
                        "face_locked": False,
                        "ear": 0.0,
                        "mar": 0.0,
                        "pitch": 0.0,
                        "yaw": 0.0,
                        "attention": 0,
                        "fatigue": 0,
                        "risk": 0,
                        "closure_s": 0.0,
                        "blink_count": self._blink_count,
                        "blink_rate": self._blink_rate(),
                        "microsleeps": self._microsleeps,
                        "confidence": 0.0,
                        "calibrated": self._last_face > 0,
                        "fps": self._fps(),
                        "inference_ms": 0.0,
                        "landmarks": 0,
                    }
                    if now - missed_since > 1.4:
                        self._draw_no_face(frame)
                if not result or not result.face_landmarks:
                    missed_since = missed_since or now
                else:
                    missed_since = 0.0
                self._fps_window.append(time.time())
                metrics["fps"] = self._fps()
                metrics["inference_ms"] = (time.time() - now) * 1000
                metrics["landmarks"] = 468 if metrics.get("face_locked") else 0
                self.metrics = metrics
                if self.on_metrics:
                    try:
                        self.on_metrics(metrics)
                    except Exception:
                        pass
                self._add_frame_hud(frame, metrics)
                ok_jpg, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
                if ok_jpg:
                    with self.frame_lock:
                        self.latest_jpeg = encoded.tobytes()
        except Exception as exc:  # pragma: no cover - hardware-dependent
            self.error = f"Vision worker: {exc}"
        finally:
            self.running = False
            self._model_ready = False
            if landmarker is not None:
                try:
                    landmarker.close()
                except Exception:
                    pass
            if cap is not None:
                cap.release()

    def _metrics_from_landmarks(self, landmarks, w: int, h: int, now: float) -> dict[str, Any]:
        pts = [self._landmark_xy(landmarks, i, w, h) for i in range(len(landmarks))]
        left_eye = [pts[i] for i in LEFT_EYE]
        right_eye = [pts[i] for i in RIGHT_EYE]
        ear = (_ear(left_eye) + _ear(right_eye)) / 2.0
        mouth_pts = [pts[i] for i in range(len(pts))]
        mar = _mar(mouth_pts)

        image_points = np.array([pts[i] for i in POSE_IMAGE_IDS], dtype=np.float64)
        focal = float(w)
        camera_matrix = np.array(
            [[focal, 0, w / 2], [0, focal, h / 2], [0, 0, 1]], dtype=np.float64
        )
        dist_coeffs = np.zeros((4, 1))
        pitch = yaw = 0.0
        try:
            ok, rvec, tvec = cv2.solvePnP(
                POSE_MODEL, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE
            )
            if ok:
                rmat, _ = cv2.Rodrigues(rvec)
                angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)
                pitch, yaw = float(angles[0]), float(angles[1])
        except cv2.error:
            pass

        closure = 0.0
        if ear < 0.225:
            if self._closure_started is None:
                self._closure_started = now
                self._microsleep_counted_at = None
            closure = now - self._closure_started
            if closure >= 1.2 and self._microsleep_counted_at != self._closure_started:
                self._microsleeps += 1
                self._microsleep_counted_at = self._closure_started
        else:
            # A blink is counted when the eyelid reopens, once per closure.
            if self._closure_started is not None:
                closed_for = now - self._closure_started
                if 0.04 <= closed_for < 0.65 and now > self._blink_cooldown:
                    self._blink_count += 1
                    self._blink_times.append(now)
                    self._blink_cooldown = now + 0.22
            self._closure_started = None
            self._microsleep_counted_at = None
        self._last_ear = ear

        ear_score = max(0.0, min(1.0, (0.26 - ear) / 0.15))
        closure_score = max(0.0, min(1.0, closure / 5.0))
        yawn_score = max(0.0, min(1.0, (mar - 0.48) / 0.30))
        distraction = max(0.0, min(1.0, (abs(yaw) - 16.0) / 22.0))
        nod = max(0.0, min(1.0, (-pitch - 7.0) / 18.0))
        risk = 100 * (
            0.33 * ear_score
            + 0.27 * closure_score
            + 0.15 * yawn_score
            + 0.13 * distraction
            + 0.12 * nod
        )
        risk = max(0.0, min(99.0, risk))
        attention = max(0.0, min(100.0, 99.0 - risk * 0.92))
        # Confidence is derived from face area + landmark presence for a friendly HUD.
        xs = [p[0] for p in pts[40:270]]
        ys = [p[1] for p in pts[40:270]]
        area_ratio = ((max(xs) - min(xs)) * (max(ys) - min(ys))) / max(1, w * h)
        confidence = max(82.0, min(99.7, 86 + area_ratio * 240))

        return {
            "face_locked": True,
            "ear": round(float(ear), 3),
            "mar": round(float(mar), 3),
            "pitch": round(pitch, 1),
            "yaw": round(yaw, 1),
            "attention": round(attention, 1),
            "fatigue": round(risk * 0.96, 1),
            "risk": round(risk, 1),
            "closure_s": round(closure, 1),
            "blink_count": self._blink_count,
            "blink_rate": self._blink_rate(),
            "microsleeps": self._microsleeps,
            "confidence": round(confidence, 1),
            "calibrated": True,
            "fps": self._fps(),
            "inference_ms": 0.0,
            "landmarks": 468,
        }

    def _blink_rate(self) -> float:
        now = time.time()
        recent = [t for t in self._blink_times if now - t <= 60]
        if len(recent) < 2:
            return 0.0
        return round(len(recent) * (60.0 / max(1.0, now - min(recent))), 1)

    def _fps(self) -> float:
        if len(self._fps_window) < 2:
            return 0.0
        span = self._fps_window[-1] - self._fps_window[0]
        return round((len(self._fps_window) - 1) / span, 1) if span > 0 else 0.0

    def _draw_face(self, frame: np.ndarray, landmarks, metrics: dict[str, Any]) -> None:
        h, w = frame.shape[:2]
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]
        risk = metrics.get("risk", 0)
        color = (94, 226, 147) if risk < 35 else ((92, 196, 255) if risk < 70 else (90, 90, 255))
        overlay = frame.copy()
        for indices in (FACE_OVAL, LEFT_BROW, RIGHT_BROW, LIPS_OUTER, LIPS_INNER, NOSE_LINE):
            polyline = np.array([pts[i] for i in indices], dtype=np.int32)
            cv2.polylines(overlay, [polyline], False, color, 1, cv2.LINE_AA)
        # Sparse mesh tesselation: enough to read as FaceMesh without obscuring the feed.
        for i in range(0, len(pts), 4):
            cv2.circle(overlay, pts[i], 1, color, -1, cv2.LINE_AA)
        for idx in LEFT_EYE + RIGHT_EYE:
            cv2.circle(overlay, pts[idx], 2, (235, 255, 245), -1, cv2.LINE_AA)
        cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x1, x2 = max(10, min(xs) - 18), min(w - 10, max(xs) + 18)
        y1, y2 = max(10, min(ys) - 20), min(h - 10, max(ys) + 24)
        self._brackets(frame, x1, y1, x2, y2, color)
        label = "DRIVER 01 · LOCKED"
        cv2.rectangle(frame, (x1, y1 - 23), (x1 + 184, y1 - 4), (10, 16, 19), -1)
        cv2.putText(frame, label, (x1 + 7, y1 - 9), cv2.FONT_HERSHEY_SIMPLEX, 0.36, color, 1, cv2.LINE_AA)
        eye_label = "EYES CLOSED" if metrics["ear"] < 0.23 else "EYES OPEN"
        cv2.putText(frame, eye_label, (x1, y2 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)

    def _brackets(self, frame, x1, y1, x2, y2, color) -> None:
        size = 22
        thickness = 2
        for ax, ay, dx, dy in (
            (x1, y1, 1, 1),
            (x2, y1, -1, 1),
            (x1, y2, 1, -1),
            (x2, y2, -1, -1),
        ):
            cv2.line(frame, (ax, ay), (ax + dx * size, ay), color, thickness, cv2.LINE_AA)
            cv2.line(frame, (ax, ay), (ax, ay + dy * size), color, thickness, cv2.LINE_AA)

    def _draw_no_face(self, frame: np.ndarray) -> None:
        h, w = frame.shape[:2]
        cv2.putText(frame, "NO FACE LOCK", (w // 2 - 70, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (92, 196, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, "Align driver with CAM 01", (w // 2 - 88, h // 2 + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (160, 170, 175), 1, cv2.LINE_AA)

    def _add_frame_hud(self, frame: np.ndarray, metrics: dict[str, Any]) -> None:
        h, w = frame.shape[:2]
        # Top-left identification block.
        cv2.putText(frame, "CAM 01 / CABIN", (18, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (225, 235, 238), 1, cv2.LINE_AA)
        cv2.putText(frame, "EDGE FACE MESH · DMS/1", (18, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (110, 128, 135), 1, cv2.LINE_AA)
        # Top-right live time.
        stamp = time.strftime("%H:%M:%S")
        cv2.putText(frame, stamp, (w - 96, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (180, 235, 220), 1, cv2.LINE_AA)
        # Bottom status plate.
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, h - 58), (w, h), (4, 8, 10), -1)
        cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
        if metrics.get("face_locked"):
            values = [
                ("EAR", f"{metrics['ear']:.3f}", (93, 227, 208)),
                ("MAR", f"{metrics['mar']:.2f}", (93, 227, 208)),
                ("YAW", f"{metrics['yaw']:+.1f}°", (93, 227, 208)),
                ("PITCH", f"{metrics['pitch']:+.1f}°", (93, 227, 208)),
                ("CONF", f"{metrics['confidence']:.1f}%", (93, 227, 208)),
            ]
        else:
            values = [("EAR", "--", (130, 145, 150)), ("MAR", "--", (130, 145, 150)), ("FACE", "ACQUIRING", (90, 196, 255))]
        x = 20
        for name, value, color in values:
            cv2.putText(frame, name, (x, h - 37), cv2.FONT_HERSHEY_SIMPLEX, 0.28, (98, 116, 122), 1, cv2.LINE_AA)
            cv2.putText(frame, value, (x, h - 17), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, cv2.LINE_AA)
            x += 102
        cv2.putText(frame, f"{metrics.get('fps', 0):.1f} FPS · {metrics.get('inference_ms', 0):.1f} ms", (w - 175, h - 25), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (108, 128, 134), 1, cv2.LINE_AA)

    def get_frame(self) -> bytes | None:
        with self.frame_lock:
            return self.latest_jpeg

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "available": self.available,
            "error": self.error,
            "model_ready": self._model_ready,
            "fps": self.metrics.get("fps", 0),
            "camera_index": self.camera_index,
        }
