"""DRISHTI · Edge-AI Driver Safety command console.

Run:
    source venv/bin/activate
    python app.py

The dashboard opens at http://127.0.0.1:5000 and is available to the venue
hotspot on http://<laptop-ip>:5000. Simulation is the default; camera and
Arduino hardware are opt-in so the exhibition can never fail because a cable
is loose.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, render_template, request, send_file

from dms.copilot import CopilotService
from dms.hardware import SerialBridge
from dms.state import DMSState, VENUE, VEHICLE_ID
from dms.telegram_uplink import TelegramUplink, make_incident_snapshot
from dms.vision import VisionWorker

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "face_landmarker.task"


def load_dotenv(path: Path) -> None:
    """Small dependency-free .env loader so the exhibition setup stays simple."""
    if not path.exists():
        return
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        pass


load_dotenv(ROOT / ".env")

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config.update(
    JSON_SORT_KEYS=False,
    SEND_FILE_MAX_AGE_DEFAULT=0,
    TEMPLATES_AUTO_RELOAD=True,
)


class Runtime:
    def __init__(self, serial_enabled: bool = False) -> None:
        self.telegram = TelegramUplink()
        self.state = DMSState(telegram_configured=self.telegram.enabled)
        self.copilot = CopilotService()
        self.hardware = SerialBridge(enabled=serial_enabled)
        self.vision = VisionWorker(MODEL_PATH, camera_index=0, on_metrics=self.state.update_vision_metrics)
        self.vision_lock = threading.Lock()
        self._stop = threading.Event()
        self.started_at = time.time()
        self.hardware.connect()
        self._sync_hardware_status()
        self.thread = threading.Thread(target=self._loop, name="dms-simulation", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            started = time.perf_counter()
            try:
                self.state.tick()
                self.hardware.sync(self.state.hardware_outputs())
                self._sync_hardware_status()
            except Exception as exc:  # keep the exhibition running
                print(f"[loop] {exc}")
            # 4 Hz snapshot cadence leaves plenty of CPU headroom for FaceMesh.
            wait = max(0.02, 0.25 - (time.perf_counter() - started))
            self._stop.wait(wait)

    def _sync_hardware_status(self) -> None:
        status = self.hardware.status()
        self.state.set_hardware_status(
            status["connected"],
            status["port"],
            status.get("last_command", ""),
            bool(status.get("enabled")),
        )

    def stop(self) -> None:
        self._stop.set()
        self.vision.stop()
        self.hardware.close()


_runtime: Runtime | None = None
_runtime_lock = threading.Lock()


def runtime() -> Runtime:
    global _runtime
    with _runtime_lock:
        if _runtime is None:
            _runtime = Runtime(serial_enabled=os.environ.get("DMS_SERIAL", "0") == "1")
        return _runtime


def error(message: str, code: int = 400, **extra: Any):
    return jsonify({"ok": False, "error": message, **extra}), code


@app.after_request
def no_cache_api(response):
    if request.path.startswith("/api/") or request.path == "/video_feed":
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


@app.get("/")
def index():
    return render_template("index.html", vehicle_id=VEHICLE_ID, venue=VENUE, version="2.4.0")


@app.get("/api/state")
def api_state():
    rt = runtime()
    return jsonify(rt.state.state_snapshot())


@app.get("/api/history")
def api_history():
    rt = runtime()
    return jsonify({"samples": rt.state.history_snapshot(), "sample_rate_hz": 2, "window_s": 90})


@app.get("/api/health")
def api_health():
    rt = runtime()
    return jsonify(
        {
            "ok": True,
            "uptime_s": int(time.time() - rt.started_at),
            "mode": rt.state.mode,
            "camera": rt.vision.status(),
            "hardware": rt.hardware.status(),
            "telegram": rt.telegram.status(),
            "gemini": bool(rt.copilot.api_key),
        }
    )


@app.post("/api/control")
def api_control():
    rt = runtime()
    payload = request.get_json(silent=True) or {}
    action = str(payload.get("action", "")).strip()
    try:
        if action == "scenario":
            scenario = str(payload.get("scenario", "fatigue"))
            if scenario == "stop":
                if rt.vision.running:
                    rt.vision.stop()
                    rt.state.set_vision_mode(False)
                result = rt.state.stop_scenario(reset_incident=bool(payload.get("reset", True)))
            else:
                if rt.vision.running:
                    rt.vision.stop()
                    rt.state.set_vision_mode(False)
                result = rt.state.start_scenario("fatigue")
            return jsonify(result)
        if action == "engine":
            engine = str(payload.get("value", "")).upper()
            return jsonify(rt.state.set_engine(engine, source="remote command bus"))
        if action == "actuator_mode":
            return jsonify(rt.state.set_actuator_mode(str(payload.get("value", "")).upper()))
        if action == "actuator":
            target = str(payload.get("target", ""))
            on = bool(payload.get("value", False))
            power = payload.get("power")
            result = rt.state.set_actuator(target, on, int(power) if power is not None else None)
            return jsonify(result)
        if action == "motor_power":
            return jsonify(rt.state.set_motor_power(int(payload.get("value", 0))))
        if action == "acknowledge":
            return jsonify(rt.state.acknowledge_all())
        if action == "resolve_incident":
            return jsonify(rt.state.resolve_incident())
        if action == "alert_agency":
            return jsonify(rt.state.alert_agency(str(payload.get("agency", ""))))
        if action == "intercom":
            message = str(payload.get("message", "")).strip()
            if not message:
                raise ValueError("Intercom message cannot be empty")
            if len(message) > 180:
                message = message[:180]
            event = rt.state.add_event(
                "warning" if rt.state.incident["active"] else "info",
                "control",
                "Cabin voice broadcast",
                f"Speech synthesis · {message}",
            )
            return jsonify(
                {
                    "ok": True,
                    "event_id": event["id"],
                    "message": message,
                    "channel": "cabin-speech",
                    "renderer": "browser speech synthesis",
                }
            )
        if action == "telegram":
            return _send_telegram(rt)
        if action == "snapshot":
            snap = rt.state.state_snapshot()
            frame = rt.vision.get_frame() if rt.vision.running else None
            image = make_incident_snapshot(snap, frame)
            if not image:
                return error("Snapshot renderer unavailable", 503)
            return Response(image, mimetype="image/jpeg", headers={"Content-Disposition": "inline; filename=drishti-snapshot.jpg"})
        return error(f"Unknown action: {action or '(empty)'}")
    except PermissionError as exc:
        return error(str(exc), 409)
    except (ValueError, TypeError) as exc:
        return error(str(exc), 400)


def _send_telegram(rt: Runtime):
    snap = rt.state.state_snapshot()
    if not snap["incident"]["active"]:
        return error("No active incident to transmit. Run the drill or wait for a Level 4 event.", 409)
    frame = rt.vision.get_frame() if rt.vision.running else None
    image = make_incident_snapshot(snap, frame)
    result = rt.telegram.send_incident(snap, image)
    status = result.get("status", "FAILED")
    rt.state.mark_telegram_sent(status if status in ("SENT", "SIMULATED") else "FAILED")
    if result.get("detail"):
        rt.state.add_event(
            "success" if status in ("SENT", "SIMULATED") else "warning",
            "uplink",
            "Telegram uplink response",
            str(result["detail"])[:220],
        )
    return jsonify(result)


@app.post("/api/vision/start")
def api_vision_start():
    rt = runtime()
    with rt.vision_lock:
        if rt.vision.running:
            return jsonify({"ok": True, "running": True})
        rt.state.stop_scenario(reset_incident=True)
        started = rt.vision.start()
        if not started.get("ok"):
            return error(started.get("error", "Unable to start camera"), 503)
        # Let the capture thread produce its first frame / fail before replying.
        deadline = time.time() + 3.5
        while time.time() < deadline:
            if rt.vision.get_frame() is not None:
                break
            if not rt.vision.running:
                break
            time.sleep(0.08)
        if not rt.vision.running:
            err = rt.vision.error or "Camera pipeline exited"
            rt.vision.stop()
            return error(err, 503)
        rt.state.set_vision_mode(True)
        return jsonify({"ok": True, "running": True, **rt.vision.status()})


@app.post("/api/vision/stop")
def api_vision_stop():
    rt = runtime()
    with rt.vision_lock:
        rt.vision.stop()
        rt.state.set_vision_mode(False)
        time.sleep(0.12)
        return jsonify({"ok": True, "running": False})


@app.get("/api/vision/status")
def api_vision_status():
    rt = runtime()
    return jsonify(rt.vision.status())


@app.get("/video_feed")
def video_feed():
    rt = runtime()
    if not rt.vision.running:
        return error("Live vision is not running", 503)

    def generate():
        last = None
        while rt.vision.running:
            frame = rt.vision.get_frame()
            if frame and frame is not last:
                last = frame
                yield (
                    b"--frame\r\nContent-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode("ascii") + b"\r\n\r\n" + frame + b"\r\n"
                )
            time.sleep(1 / 28)

    return Response(
        generate(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.get("/api/hardware")
def api_hardware():
    rt = runtime()
    return jsonify(rt.hardware.status())


@app.post("/api/hardware/connect")
def api_hardware_connect():
    rt = runtime()
    rt.hardware.enabled = True
    status = rt.hardware.connect()
    rt._sync_hardware_status()
    if status["connected"]:
        rt.state.add_event(
            "success",
            "hardware",
            "Arduino Uno connected",
            f"{status['port']} · 9600 baud · DMS/1 protocol",
        )
    else:
        rt.state.add_event(
            "warning",
            "hardware",
            "Arduino link unavailable",
            status.get("error", "No serial device found"),
        )
    return jsonify({"ok": status["connected"], **status})


@app.post("/api/hardware/disconnect")
def api_hardware_disconnect():
    rt = runtime()
    status = rt.hardware.disconnect()
    rt._sync_hardware_status()
    rt.state.add_event("info", "hardware", "Arduino link closed", "Outputs returned to safe state")
    return jsonify({"ok": True, **status})


@app.post("/api/hardware/test")
def api_hardware_test():
    rt = runtime()
    if not rt.hardware.connected:
        return error("Serial bridge is not connected", 409)
    rt.hardware.send("PING")
    return jsonify({"ok": True, "command": "PING"})


@app.post("/api/copilot")
def api_copilot():
    rt = runtime()
    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", ""))[:1400]
    history = payload.get("history") or []
    if not isinstance(history, list):
        history = []
    clean_history = []
    for item in history[-8:]:
        if isinstance(item, dict) and item.get("role") in ("user", "assistant"):
            clean_history.append(
                {"role": "assistant" if item.get("role") == "assistant" else "user", "content": str(item.get("content", ""))[:2000]}
            )
    result = rt.copilot.ask(rt.state.state_snapshot(), message, clean_history)
    return jsonify(result)


@app.get("/api/report")
def api_report():
    rt = runtime()
    report = rt.state.report_data()
    data = json.dumps(report, indent=2, ensure_ascii=False).encode("utf-8")
    name = f"drishti-session-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    return Response(
        data,
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename={name}"},
    )


@app.get("/api/network")
def api_network():
    return jsonify({"host": get_lan_ip(), "port": 5000, "urls": [f"http://{get_lan_ip()}:5000"]})


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return error("Not found", 404)
    return render_template("index.html", vehicle_id=VEHICLE_ID, venue=VENUE, version="2.4.0")


@app.errorhandler(500)
def internal_error(exc):
    print(f"[http] {exc}")
    if request.path.startswith("/api/"):
        return error("Internal server error", 500)
    return "Internal server error", 500


def get_lan_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.4)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def main() -> None:
    parser = argparse.ArgumentParser(description="DRISHTI driver monitoring dashboard")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=5000, help="HTTP port (default: 5000)")
    parser.add_argument("--serial", action="store_true", help="Enable Arduino serial bridge on boot")
    parser.add_argument("--live", action="store_true", help="Start the camera pipeline immediately")
    args = parser.parse_args()

    if args.serial:
        os.environ["DMS_SERIAL"] = "1"
    rt = runtime()
    if args.live:
        rt.state.stop_scenario(reset_incident=True)
        started = rt.vision.start()
        if started.get("ok"):
            rt.state.set_vision_mode(True)
        else:
            print(f"[vision] {started.get('error')}")

    ip = get_lan_ip()
    print("")
    print("  DRISHTI / EDGE-AI DRIVER SAFETY")
    print("  ─────────────────────────────────────────────")
    print(f"  Local console  http://127.0.0.1:{args.port}")
    print(f"  Venue hotspot  http://{ip}:{args.port}")
    print(f"  Camera         {'LIVE requested' if args.live else 'synthetic demo feed'}")
    print(f"  Arduino        {'serial enabled' if args.serial else 'simulated outputs'}")
    print(f"  Telegram       {'live credentials' if rt.telegram.enabled else 'sandbox / no credentials'}")
    print(f"  Copilot        {'Gemini 2.5 Flash' if rt.copilot.api_key else 'offline tactical fallback'}")
    print("  ─────────────────────────────────────────────")
    print("  Ctrl+C to stop the console")
    print("")
    try:
        app.run(host=args.host, port=args.port, debug=False, threaded=True, use_reloader=False)
    finally:
        rt.stop()


if __name__ == "__main__":
    main()
