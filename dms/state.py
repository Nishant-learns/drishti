"""Thread-safe state, safety escalation ladder and demo scenario engine.

The dashboard consumes one snapshot of this object roughly four times a second.
Keeping the model in one place means the browser, the Arduino bridge, Telegram
and the copilot all reason about exactly the same version of reality.
"""

from __future__ import annotations

import math
import os
import random
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

VEHICLE_ID = "BR-01-EXP-2026"
VENUE = {
    "name": "State Science & Tech Pavilion",
    "city": "Patna, Bihar",
    "lat": 25.6193,
    "lon": 85.1415,
    "maps_url": "https://maps.google.com/?q=25.6193,85.1415",
}
MODEL_NAME = "FaceMesh + RF-EDGE"
VERSION = "2.4.0"

STAGE_DEFS = [
    {
        "id": 0,
        "label": "Monitor",
        "short": "MON",
        "title": "Continuous biometric watch",
        "rule": "Risk < 30%",
        "action": "No intervention",
    },
    {
        "id": 1,
        "label": "Advisory",
        "short": "ADV",
        "title": "Fatigue signature detected",
        "rule": "Risk ≥ 30%",
        "action": "HUD advisory + event ledger",
    },
    {
        "id": 2,
        "label": "Cabin alert",
        "short": "ALT",
        "title": "Drowsiness threshold crossed",
        "rule": "Risk ≥ 55%",
        "action": "Buzzer + LED pulse · D9",
    },
    {
        "id": 3,
        "label": "Haptic",
        "short": "HAP",
        "title": "Microsleep intervention",
        "rule": "Risk ≥ 75%",
        "action": "L298N actuator pulse · D5",
    },
    {
        "id": 4,
        "label": "Emergency",
        "short": "EMG",
        "title": "Driver unresponsive",
        "rule": "Eyes closed > 5.0 s",
        "action": "Throttle cut + multi-agency uplink",
    },
]

STATE_COPY = {
    "ATTENTIVE": ("Driver responsive", "Eyes on road. Cognitive load is within the calibrated safe band."),
    "CAUTION": ("Fatigue signature rising", "Blink interval and mouth aperture indicate early-onset fatigue."),
    "FATIGUED": ("Fatigue threshold crossed", "Sustained eye closure and yawning detected. Cabin alert has been armed."),
    "CRITICAL": ("Microsleep · driver unresponsive", "Continuous eye closure exceeds the emergency threshold."),
    "RECOVERING": ("Driver re-engaging", "Visual attention is returning. Emergency protocol remains latched."),
    "NO_FACE": ("Driver face not acquired", "Check camera alignment or infrared illumination."),
    "HALTED": ("Vehicle secured", "Powertrain interlock is engaged. Emergency protocol is active."),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * _clamp(t, 0.0, 1.0)


def _round(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


class DMSState:
    """Single source of truth for the exhibition dashboard."""

    def __init__(self, telegram_configured: bool = False) -> None:
        self.lock = threading.RLock()
        self.started_at = time.time()
        self.demo_started_at: float | None = None
        self.scenario: str | None = None
        self.scenario_flags: set[str] = set()
        self.scenario_completed = False
        self.events: deque[dict[str, Any]] = deque(maxlen=300)
        self.history: deque[dict[str, Any]] = deque(maxlen=180)
        self.event_seq = 0
        self.telegram_configured = telegram_configured
        self.mode = "DEMO"
        self.engine = "RUNNING"
        self.speed = 42.0
        self.actuator_mode = "AUTO"
        self.vision_started_at: float | None = None
        self.vision_metrics: dict[str, Any] | None = None
        self.vision_metrics_at = 0.0
        self.last_hardware_command = "boot:all-off"
        self.agencies = self._fresh_agencies()
        self.incident = self._fresh_incident()
        self.driver = self._fresh_driver()
        self.sensing = self._fresh_sensing()
        self.alert_output = False
        self.motor_output = False
        self.motor_power = 0
        self.motor_direction = "STOP"
        self.alert_pattern = "IDLE"
        self.actuators_changed_at = 0.0
        self._last_stage = -1
        self._last_face_locked = True
        self._last_blink = time.time()
        self._last_yawn = 0.0
        self._last_level_event = -10.0
        self._critical_latched = False
        self._baseline_t = time.time()
        self._seed_events()
        self._seed_history()
        self._tick_actions()

    # ------------------------------------------------------------------ setup
    def _fresh_agencies(self) -> list[dict[str, Any]]:
        return [
            {
                "id": "guardian",
                "name": "Fleet Guardian",
                "eyebrow": "PRIMARY ESCALATION",
                "status": "MONITORING",
                "tone": "ok",
                "detail": "Telegram bot armed",
                "latency": "24 ms",
                "channels": ["Telegram", "Dashboard"],
            },
            {
                "id": "police",
                "name": "Police Control",
                "eyebrow": "ROAD SAFETY",
                "status": "STANDBY",
                "tone": "idle",
                "detail": "Activated at Level 4",
                "latency": "—",
                "channels": ["Telemetry", "Incident brief"],
            },
            {
                "id": "ems",
                "name": "EMS Triage",
                "eyebrow": "MEDICAL RESPONSE",
                "status": "STANDBY",
                "tone": "idle",
                "detail": "Vitals payload ready",
                "latency": "—",
                "channels": ["Telemetry", "Route link"],
            },
        ]

    def _fresh_incident(self) -> dict[str, Any]:
        return {
            "active": False,
            "id": None,
            "since": None,
            "resolved_at": None,
            "age_s": 0,
            "cause": None,
            "peak_fatigue": 0,
            "telegram": {
                "status": "ARMED" if self.telegram_configured else "SANDBOX",
                "last_sent": None,
                "mode": "LIVE" if self.telegram_configured else "SIMULATION",
            },
            "snapshot_ready": False,
            "throttle_cut": False,
        }

    def _fresh_driver(self) -> dict[str, Any]:
        return {
            "name": "OPERATOR 01",
            "state": "ATTENTIVE",
            "risk_band": "LOW",
            "attention": 86,
            "fatigue": 19,
            "ear": 0.305,
            "mar": 0.18,
            "pitch": 2.8,
            "yaw": -3.6,
            "blink_rate": 16,
            "blink_count": 214,
            "yawn_count": 2,
            "microsleeps": 1,
            "closure_ms": 0,
            "unresponsive_s": 0.0,
            "face_locked": True,
            "confidence": 98.4,
            "calibrated": True,
            "head_direction": "FORWARD",
        }

    def _fresh_sensing(self) -> dict[str, Any]:
        return {
            "camera": "DEMO",
            "source": "SYNTHETIC CABIN FEED",
            "fps": 30,
            "inference_ms": 18.6,
            "model": MODEL_NAME,
            "landmarks": 468,
            "ir_mode": "NIR / SIM",
            "frame": "1280 × 720",
            "stream_url": None,
        }

    def _seed_events(self) -> None:
        seeds = [
            (-252, "info", "system", "Vision pipeline ready", "468-point facial mesh · 30 FPS"),
            (-186, "info", "hardware", "Actuator bus self-check passed", "D9 alert · D5/D6/D7 L298N driver"),
            (-94, "warning", "driver", "Microsleep episode · 0.7 s", "Eyes closed below EAR threshold · acknowledged"),
            (-31, "info", "uplink", "Telemetry node online", "Venue hotspot · dashboard sync at 4 Hz"),
        ]
        for offset, severity, category, title, detail in seeds:
            event = self._make_event(severity, category, title, detail, dt=_now() + timedelta(seconds=offset))
            event["acknowledged"] = offset < -60
            self.events.append(event)

    def _seed_history(self) -> None:
        now = time.time()
        base = 0.305
        for i in range(112, 0, -1):
            t = now - i * 0.5
            phase = t / 4.0
            ear = base + math.sin(phase) * 0.028 + random.uniform(-0.007, 0.007)
            blink = (i % 31) in (0, 1)
            if blink:
                ear = 0.13
            mar = 0.18 + max(0.0, math.sin(t / 12.0)) * 0.055 + random.uniform(-0.01, 0.01)
            risk = _clamp(19 + math.sin(t / 5.0) * 4 + random.uniform(-2, 2), 7, 32)
            attention = _clamp(100 - risk - 3 + random.uniform(-1, 1), 0, 100)
            self.history.append(
                {
                    "t": int(t * 1000),
                    "ear": _round(ear, 3),
                    "mar": _round(mar, 3),
                    "risk": _round(risk, 1),
                    "attention": _round(attention, 1),
                    "yaw": _round(3.4 + math.sin(t / 9) * 3.5, 1),
                }
            )

    # ----------------------------------------------------------------- helpers
    def _make_event(
        self,
        severity: str,
        category: str,
        title: str,
        detail: str,
        dt: datetime | None = None,
    ) -> dict[str, Any]:
        self.event_seq += 1
        moment = dt or _now()
        return {
            "id": f"evt_{self.event_seq:04d}_{uuid.uuid4().hex[:4]}",
            "ts": _iso(moment),
            "epoch_ms": int(moment.timestamp() * 1000),
            "severity": severity,  # info | success | warning | critical
            "category": category,  # vision | driver | safety | control | uplink | hardware | system
            "title": title,
            "detail": detail,
            "acknowledged": False,
        }

    def add_event(self, severity: str, category: str, title: str, detail: str) -> dict[str, Any]:
        with self.lock:
            event = self._make_event(severity, category, title, detail)
            self.events.append(event)
            return event

    def _stage_for(self, risk: float, unresponsive: float) -> int:
        if self.incident["active"] or unresponsive >= 5.0:
            return 4
        if risk >= 75 or unresponsive >= 3.0:
            return 3
        if risk >= 55 or unresponsive >= 1.5:
            return 2
        if risk >= 30:
            return 1
        return 0

    def _driver_copy(self, state: str) -> tuple[str, str]:
        return STATE_COPY.get(state, STATE_COPY["ATTENTIVE"])

    def _risk_band(self, risk: float, state: str) -> str:
        if state == "CRITICAL" or risk >= 85:
            return "CRITICAL"
        if risk >= 55:
            return "HIGH"
        if risk >= 30:
            return "MODERATE"
        return "LOW"

    def _state_for(self, risk: float, ear: float, closure: float) -> str:
        if not self.driver.get("face_locked", True):
            return "NO_FACE"
        if self.incident["active"] and risk > 55:
            return "CRITICAL"
        if closure >= 4.0 or risk >= 88:
            return "CRITICAL"
        if risk >= 58:
            return "FATIGUED"
        if self.incident["active"]:
            return "RECOVERING"
        if risk >= 32:
            return "CAUTION"
        return "ATTENTIVE"

    def _head_direction(self, yaw: float, pitch: float) -> str:
        if abs(yaw) > 25:
            return "LEFT" if yaw > 0 else "RIGHT"
        if pitch < -15:
            return "DOWN"
        if pitch > 18:
            return "UP"
        return "FORWARD"

    # ------------------------------------------------------------------- tick
    def tick(self) -> None:
        with self.lock:
            now = time.time()
            live_fresh = self.mode == "LIVE" and self.vision_metrics and (now - self.vision_metrics_at) < 1.2
            if self.scenario:
                self._tick_scenario(now)
            elif live_fresh:
                self._tick_live()
            else:
                self._tick_baseline(now)

            self._update_vehicle(now)
            self._tick_actions(now)
            self._evaluate_transitions(now)
            self._maybe_raise_incident()
            self._push_history(now)

    def _tick_scenario(self, now: float) -> None:
        elapsed = now - (self.demo_started_at or now)
        driver = self.driver
        driver["face_locked"] = True
        driver["calibrated"] = True
        driver["confidence"] = _clamp(97.8 + math.sin(now / 2.1) * 0.9, 94, 99.8)
        driver["state"] = "ATTENTIVE"
        closure = 0.0

        if elapsed < 5:
            risk = 22 + math.sin(now * 1.4) * 3
            ear = 0.305 + math.sin(now / 2.2) * 0.018
            mar = 0.18
            yaw = math.sin(now / 5) * 4
            pitch = 2 + math.sin(now / 3) * 2
        elif elapsed < 12:
            p = (elapsed - 5) / 7
            risk = _lerp(26, 58, p) + math.sin(now * 2.4) * 2
            ear = _lerp(0.30, 0.225, p) + math.sin(now / 1.3) * 0.012
            mar = _lerp(0.20, 0.70, _clamp((p - 0.2) / 0.8, 0, 1))
            yaw = math.sin(now / 4.3) * 6
            pitch = _lerp(2, 8, p)
            driver["state"] = "CAUTION" if elapsed < 9 else "FATIGUED"
            if elapsed > 7.4:
                self._scenario_event(
                    "fatigue_signature",
                    "warning",
                    "driver",
                    "Fatigue signature emerging",
                    "Yawn detected · blink interval shortening · advisory stage",
                )
        elif elapsed < 18:
            p = (elapsed - 12) / 6
            risk = _lerp(61, 83, p) + math.sin(now * 3) * 2
            blink_gate = math.sin(elapsed * 5.1) > -0.15
            ear = 0.18 if blink_gate else 0.105
            closure = _clamp((elapsed - 12) * 0.32, 0.2, 2.2)
            mar = _lerp(0.62, 0.30, p)
            yaw = 4 + math.sin(now * 2.7) * 7
            pitch = _lerp(5, 17, p)
            driver["state"] = "FATIGUED"
            driver["microsleeps"] = max(driver["microsleeps"], 2)
            if elapsed > 13.2:
                self._scenario_event(
                    "microsleep",
                    "warning",
                    "driver",
                    "Microsleep detected · 1.4 s",
                    "Bilateral eye closure below EAR 0.23 · cabin alert engaged",
                )
        elif elapsed < 28:
            p = (elapsed - 18) / 10
            risk = _lerp(86, 95, min(p, 1)) + math.sin(now * 2.1) * 1.2
            ear = _lerp(0.095, 0.12, p)
            closure = _clamp(0.4 + (elapsed - 18) * 1.04, 0.4, 10.2)
            mar = 0.28
            yaw = 2 + math.sin(now / 2.2) * 2
            pitch = _lerp(18, 25, p)
            driver["state"] = "CRITICAL"
            driver["microsleeps"] = max(driver["microsleeps"], 3)
            if elapsed > 19.4:
                self._scenario_event(
                    "unresponsive",
                    "critical",
                    "driver",
                    "Driver unresponsive · emergency protocol arming",
                    "Continuous eye closure extending · throttle cut and multi-agency uplink arming",
                )
        elif elapsed < 35:
            p = (elapsed - 28) / 7
            risk = _lerp(88, 37, p)
            ear = _lerp(0.14, 0.275, p)
            mar = _lerp(0.34, 0.22, p)
            yaw = _lerp(1, 8, p)
            pitch = _lerp(22, 4, p)
            driver["state"] = "RECOVERING"
            driver["unresponsive_s"] = 0
            if elapsed > 30:
                self._scenario_event(
                    "reengage",
                    "success",
                    "driver",
                    "Driver re-engaging · visual attention restored",
                    "Recovery observed · emergency protocol remains latched for operator review",
                )
        else:
            p = (elapsed - 35) / 9
            risk = _lerp(25, 18, p) + math.sin(now) * 1.5
            ear = 0.29 + math.sin(now / 1.5) * 0.02
            mar = 0.19
            yaw = 4 + math.sin(now / 2.8) * 3
            pitch = 3
            driver["state"] = "RECOVERING" if self.incident["active"] else "ATTENTIVE"
            if elapsed > 42 and not self.scenario_completed:
                self.scenario_completed = True
                self.add_event(
                    "info",
                    "system",
                    "Demo sequence complete",
                    "Fatigue cascade resolved · incident remains open for review",
                )
            if elapsed > 46:
                self.demo_started_at = None
                self.scenario = None

        driver["ear"] = _round(_clamp(ear, 0.05, 0.42), 3)
        driver["mar"] = _round(_clamp(mar, 0.05, 1.0), 3)
        driver["risk"] = _round(_clamp(risk, 0, 99), 1)
        driver["fatigue"] = _round(_clamp(risk * 0.94 + math.sin(now) * 1.5, 0, 99), 1)
        driver["attention"] = _round(_clamp(100 - risk * 0.9 - random.uniform(0, 2), 3, 100), 1)
        driver["pitch"] = _round(pitch, 1)
        driver["yaw"] = _round(yaw, 1)
        driver["head_direction"] = self._head_direction(yaw, pitch)
        driver["unresponsive_s"] = _round(closure if driver["state"] in ("CRITICAL", "FATIGUED") else 0, 1)
        driver["closure_ms"] = int(closure * 1000)
        driver["blink_rate"] = 18 if risk < 40 else 11
        driver["yawn_count"] = max(2, self.driver["yawn_count"] + (1 if elapsed > 8.2 and self.scenario and "yawn_counted" not in self.scenario_flags else 0))
        if elapsed > 8.2:
            self.scenario_flags.add("yawn_counted")
        driver["risk_band"] = self._risk_band(risk, driver["state"])
        driver["blink_count"] = self.driver["blink_count"]

    def _tick_baseline(self, now: float) -> None:
        driver = self.driver
        driver["face_locked"] = True
        driver["state"] = "ATTENTIVE"
        driver["calibrated"] = True
        driver["confidence"] = _clamp(98.1 + math.sin(now / 3.1) * 0.7, 96, 99.6)
        # Tiny synthetic variations keep the dashboard alive between real frames.
        blink_cycle = now % 4.7
        blinking = blink_cycle < 0.16
        ear = 0.303 + math.sin(now / 3.4) * 0.026 + random.uniform(-0.005, 0.005)
        if blinking:
            ear = 0.115
            if now - self._last_blink > 2.0:
                driver["blink_count"] += 1
                self._last_blink = now
        yawn = (now % 71) < 2.4
        mar = 0.19 + random.uniform(-0.01, 0.01)
        if yawn:
            mar = 0.72
            if now - self._last_yawn > 30:
                driver["yawn_count"] += 1
                self.add_event(
                    "info",
                    "driver",
                    "Yawn observed",
                    "Mouth aperture above 0.65 · fatigue feature buffered",
                )
                self._last_yawn = now
        risk = 20.5 + math.sin(now / 7.2) * 5 + random.uniform(-1.2, 1.4)
        if blinking:
            risk += 2
        yaw = 4.2 + math.sin(now / 8.4) * 5.2 + random.uniform(-0.7, 0.7)
        pitch = 3.0 + math.sin(now / 11.1) * 2.4
        driver["ear"] = _round(_clamp(ear, 0.08, 0.4), 3)
        driver["mar"] = _round(_clamp(mar, 0.08, 1.0), 3)
        driver["risk"] = _round(_clamp(risk, 4, 34), 1)
        driver["fatigue"] = _round(_clamp(risk + random.uniform(-1.5, 2), 0, 80), 1)
        driver["attention"] = _round(_clamp(97.5 - risk + random.uniform(-1.2, 1.2), 45, 100), 1)
        driver["pitch"] = _round(pitch, 1)
        driver["yaw"] = _round(yaw, 1)
        driver["head_direction"] = self._head_direction(yaw, pitch)
        driver["unresponsive_s"] = 0.0
        driver["closure_ms"] = 120 if blinking else 0
        driver["blink_rate"] = 15.5
        driver["risk_band"] = "LOW"
        self.sensing["source"] = "SYNTHETIC CABIN FEED"
        self.sensing["camera"] = "DEMO"
        self.sensing["fps"] = 30
        self.sensing["inference_ms"] = _round(17.4 + math.sin(now / 2.2) * 1.4 + random.uniform(0, 1.1), 1)
        self.sensing["stream_url"] = None

    def _tick_live(self) -> None:
        metrics = self.vision_metrics or {}
        driver = self.driver
        driver.update(
            {
                "face_locked": bool(metrics.get("face_locked")),
                "ear": _round(metrics.get("ear", 0), 3),
                "mar": _round(metrics.get("mar", 0), 3),
                "pitch": _round(metrics.get("pitch", 0), 1),
                "yaw": _round(metrics.get("yaw", 0), 1),
                "attention": _round(metrics.get("attention", 0), 1),
                "fatigue": _round(metrics.get("fatigue", 0), 1),
                "risk": _round(metrics.get("risk", 0), 1),
                "closure_ms": int(metrics.get("closure_s", 0) * 1000),
                "unresponsive_s": _round(metrics.get("closure_s", 0), 1),
                "blink_count": metrics.get("blink_count", driver.get("blink_count", 0)),
                "blink_rate": _round(metrics.get("blink_rate", 0), 1),
                "microsleeps": metrics.get("microsleeps", driver.get("microsleeps", 0)),
                "confidence": _round(metrics.get("confidence", 0), 1),
                "calibrated": metrics.get("calibrated", True),
                "head_direction": self._head_direction(metrics.get("yaw", 0), metrics.get("pitch", 0)),
            }
        )
        closure = metrics.get("closure_s", 0)
        driver["state"] = self._state_for(driver["risk"], driver["ear"], closure)
        if not driver["face_locked"]:
            driver["state"] = "NO_FACE"
            driver["risk_band"] = "UNKNOWN"
        else:
            driver["risk_band"] = self._risk_band(driver["risk"], driver["state"])
        self.sensing.update(
            {
                "camera": "ONLINE",
                "source": "CAM 01 / LIVE",
                "fps": metrics.get("fps", 0),
                "inference_ms": metrics.get("inference_ms", 0),
                "stream_url": "/video_feed",
                "ir_mode": "CAMERA",
            }
        )

    def _update_vehicle(self, now: float) -> None:
        if self.engine == "RUNNING":
            target = 42 + math.sin(now / 4.2) * 2.3
            self.speed += (target - self.speed) * 0.08
        else:
            self.speed *= 0.91
            if self.speed < 0.4:
                self.speed = 0.0
        self.speed = _round(_clamp(self.speed, 0, 160), 1)
        if self.incident["active"] and self.incident["since"]:
            try:
                started = datetime.fromisoformat(self.incident["since"].replace("Z", "+00:00"))
                self.incident["age_s"] = int((_now() - started).total_seconds())
            except ValueError:
                pass

    def _tick_actions(self, now: float | None = None) -> None:
        now = now or time.time()
        if self.actuator_mode == "AUTO":
            stage = self._current_level()
            pulse = (now % 0.9) < 0.52
            if stage >= 4:
                self.alert_output = True
                self.motor_output = True
                self.motor_power = 205
                self.alert_pattern = "CONTINUOUS"
            elif stage == 3:
                self.alert_output = pulse
                self.motor_output = (now % 1.8) < 0.62
                self.motor_power = 150
                self.alert_pattern = "PULSE 2 HZ"
            elif stage == 2:
                self.alert_output = pulse
                self.motor_output = False
                self.motor_power = 0
                self.alert_pattern = "PULSE 2 HZ"
            else:
                self.alert_output = False
                self.motor_output = False
                self.motor_power = 0
                self.alert_pattern = "IDLE"
            self.motor_direction = "F" if self.motor_output else "STOP"
        else:
            if self.motor_output:
                self.motor_direction = "F"
                self.alert_pattern = "MANUAL"
            else:
                self.motor_direction = "STOP"
                self.alert_pattern = "MANUAL / OFF"

    def _current_level(self) -> int:
        return int(getattr(self, "_level", 0))

    def _push_history(self, now: float) -> None:
        d = self.driver
        self.history.append(
            {
                "t": int(now * 1000),
                "ear": _round(d.get("ear", 0), 3),
                "mar": _round(d.get("mar", 0), 3),
                "risk": _round(d.get("risk", 0), 1),
                "attention": _round(d.get("attention", 0), 1),
                "yaw": _round(d.get("yaw", 0), 1),
            }
        )

    def _evaluate_transitions(self, now: float) -> None:
        risk = self.driver.get("risk", 0)
        closure = self.driver.get("unresponsive_s", 0)
        level = self._stage_for(risk, closure)
        if self.incident["active"]:
            level = 4
        self._level = level
        if level != self._last_stage:
            if level >= 2 and now - self._last_level_event > 6:
                self.add_event(
                    "warning" if level < 4 else "critical",
                    "safety",
                    f"Safety level {level} · {STAGE_DEFS[level]['label']}",
                    STAGE_DEFS[level]["action"],
                )
                self._last_level_event = now
            self._last_stage = level

        if self.driver.get("face_locked") is False and self._last_face_locked:
            self.add_event(
                "warning",
                "vision",
                "Face lock lost",
                "Driver landmarks not available · check camera alignment",
            )
        if self.driver.get("face_locked") is True and not self._last_face_locked:
            self.add_event(
                "success",
                "vision",
                "Face lock reacquired",
                "468 landmarks tracking · biometric stream restored",
            )
        self._last_face_locked = bool(self.driver.get("face_locked"))

        if self.scenario and not self.incident["active"] and closure >= 5.0:
            self._maybe_raise_incident()

        if self.incident["active"]:
            self.incident["peak_fatigue"] = max(
                self.incident["peak_fatigue"], self.driver.get("fatigue", 0)
            )
            if self.incident["telegram"]["status"] == "ARMED" and not self.telegram_configured:
                self.incident["telegram"]["status"] = "SANDBOX"

    def _scenario_event(self, key: str, severity: str, category: str, title: str, detail: str) -> None:
        if key in self.scenario_flags:
            return
        self.scenario_flags.add(key)
        self.add_event(severity, category, title, detail)

    def _maybe_raise_incident(self) -> None:
        if self.incident["active"] or self.driver.get("unresponsive_s", 0) < 5.0:
            return
        incident_id = f"INC-{datetime.now().strftime('%y%m%d-%H%M%S')}"
        self.incident = {
            "active": True,
            "id": incident_id,
            "since": _iso(),
            "resolved_at": None,
            "age_s": 0,
            "cause": "Prolonged eye closure / microsleep",
            "peak_fatigue": self.driver.get("fatigue", 0),
            "telegram": {
                "status": "SANDBOX" if not self.telegram_configured else "READY",
                "last_sent": None,
                "mode": "LIVE" if self.telegram_configured else "SIMULATION",
            },
            "snapshot_ready": True,
            "throttle_cut": True,
        }
        self.engine = "HALTED"
        self._critical_latched = True
        self.agencies[0].update(
            {
                "status": "ALERTED",
                "tone": "critical",
                "detail": "Incident packet staged",
                "latency": "12 ms",
            }
        )
        self.add_event(
            "critical",
            "safety",
            "Emergency protocol latched",
            f"{incident_id} · throttle cut · cabin alert · incident snapshot captured",
        )
        if self.telegram_configured:
            self.add_event(
                "warning",
                "uplink",
                "Telegram emergency uplink staged",
                "Press TRANSMIT ALERT to deliver the incident packet",
            )
        else:
            self.add_event(
                "info",
                "uplink",
                "Telegram uplink running in sandbox",
                "Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable live delivery",
            )

    def _apply_level(self) -> None:
        # Used after manual operations so the stage label updates immediately.
        self._evaluate_transitions(time.time())

    # --------------------------------------------------------------- commands
    def start_scenario(self, scenario: str = "fatigue") -> dict[str, Any]:
        with self.lock:
            if scenario not in ("fatigue",):
                raise ValueError("Unknown demo scenario")
            if self.mode == "LIVE":
                self.mode = "DEMO"
            self.scenario = scenario
            self.demo_started_at = time.time()
            self.scenario_flags.clear()
            self.scenario_completed = False
            self.incident = self._fresh_incident()
            self.agencies = self._fresh_agencies()
            self.engine = "RUNNING"
            self.speed = 42.0
            self.actuator_mode = "AUTO"
            self.alert_output = False
            self.motor_output = False
            self.motor_power = 0
            self._last_stage = -1
            self._critical_latched = False
            self.add_event(
                "warning",
                "system",
                "Fatigue cascade demo armed",
                "A scripted 46-second drowsiness event will exercise every safety layer",
            )
            return {"ok": True, "scenario": scenario}

    def stop_scenario(self, reset_incident: bool = True) -> dict[str, Any]:
        with self.lock:
            self.scenario = None
            self.demo_started_at = None
            self.scenario_flags.clear()
            self.scenario_completed = False
            self.actuator_mode = "AUTO"
            self.alert_output = False
            self.motor_output = False
            self.motor_power = 0
            self.alert_pattern = "IDLE"
            if reset_incident:
                self.incident = self._fresh_incident()
                self.agencies = self._fresh_agencies()
                self.engine = "RUNNING"
            self.add_event(
                "info",
                "system",
                "Demo sequence stopped",
                "Returning to nominal biometric simulation",
            )
            return {"ok": True}

    def set_engine(self, engine: str, source: str = "dashboard") -> dict[str, Any]:
        with self.lock:
            if engine not in ("RUNNING", "HALTED"):
                raise ValueError("Engine must be RUNNING or HALTED")
            if engine == self.engine:
                return {"ok": True, "engine": engine}
            self.engine = engine
            if engine == "HALTED":
                self.add_event(
                    "critical" if self.incident["active"] else "warning",
                    "control",
                    "Powertrain interlock engaged",
                    f"Remote STOP command · source {source}",
                )
            else:
                self.add_event(
                    "success",
                    "control",
                    "Powertrain interlock released",
                    f"Remote RUN command · source {source}",
                )
            return {"ok": True, "engine": engine}

    def set_actuator_mode(self, mode: str) -> dict[str, Any]:
        with self.lock:
            if mode not in ("AUTO", "MANUAL"):
                raise ValueError("Actuator mode must be AUTO or MANUAL")
            if mode == self.actuator_mode:
                return {"ok": True, "mode": mode}
            self.actuator_mode = mode
            if mode == "AUTO":
                self.add_event(
                    "success",
                    "safety",
                    "Automatic safety guard re-armed",
                    "Actuator outputs are now managed by the escalation ladder",
                )
            else:
                self.add_event(
                    "warning",
                    "control",
                    "Manual actuator override engaged",
                    "Automatic safety guard is bypassed until re-armed",
                )
            return {"ok": True, "mode": mode}

    def set_actuator(self, target: str, on: bool, power: int | None = None) -> dict[str, Any]:
        with self.lock:
            if self.actuator_mode != "MANUAL":
                raise PermissionError("Engage MANUAL override before operating actuators")
            if target == "alert":
                self.alert_output = bool(on)
                self.alert_pattern = "MANUAL" if on else "MANUAL / OFF"
                self.add_event(
                    "warning" if on else "info",
                    "control",
                    f"Cabin alert {'energised' if on else 'released'}",
                    "Manual command · buzzer + D9 indicator",
                )
            elif target == "motor":
                self.motor_output = bool(on)
                self.motor_power = int(_clamp(power if power is not None else 160, 0, 255))
                if not on:
                    self.motor_power = 0
                self.motor_direction = "F" if on else "STOP"
                self.add_event(
                    "warning" if on else "info",
                    "control",
                    f"Haptic actuator {'energised' if on else 'released'}",
                    f"Manual command · ENA PWM {self.motor_power}/255 · L298N",
                )
            else:
                raise ValueError("Unknown actuator target")
            return {
                "ok": True,
                "mode": self.actuator_mode,
                "alert": self.alert_output,
                "motor": self.motor_output,
                "power": self.motor_power,
            }

    def set_motor_power(self, power: int) -> dict[str, Any]:
        with self.lock:
            if self.actuator_mode != "MANUAL":
                raise PermissionError("Engage MANUAL override before operating actuators")
            self.motor_power = int(_clamp(power, 0, 255))
            self.motor_output = self.motor_power > 0
            self.motor_direction = "F" if self.motor_output else "STOP"
            self.add_event(
                "info",
                "control",
                "Actuator torque updated",
                f"ENA PWM {self.motor_power}/255 · manual override",
            )
            return {"ok": True, "power": self.motor_power}

    def acknowledge_all(self) -> dict[str, Any]:
        with self.lock:
            count = 0
            for event in self.events:
                if not event["acknowledged"]:
                    event["acknowledged"] = True
                    count += 1
            self.add_event(
                "success",
                "system",
                "Operator acknowledgement",
                f"{count} event{'s' if count != 1 else ''} acknowledged from command console",
            )
            # Acknowledging events is not the same as resolving the incident.
            return {"ok": True, "acknowledged": count}

    def resolve_incident(self) -> dict[str, Any]:
        with self.lock:
            if not self.incident["active"]:
                return {"ok": True, "active": False}
            incident_id = self.incident["id"]
            self.incident = self._fresh_incident()
            self.agencies = self._fresh_agencies()
            self.actuator_mode = "AUTO"
            self.engine = "RUNNING"
            self.add_event(
                "success",
                "safety",
                "Incident resolved by operator",
                f"{incident_id} closed · vehicle released · agencies returned to standby",
            )
            return {"ok": True, "active": False, "incident_id": incident_id}

    def alert_agency(self, agency_id: str) -> dict[str, Any]:
        with self.lock:
            agency = next((a for a in self.agencies if a["id"] == agency_id), None)
            if not agency:
                raise ValueError("Unknown agency")
            agency["status"] = "NOTIFIED"
            agency["tone"] = "warn"
            agency["latency"] = "31 ms"
            agency["detail"] = "Incident brief delivered"
            self.add_event(
                "warning",
                "uplink",
                f"{agency['name']} notified",
                "Live telemetry, location and incident context transmitted",
            )
            return {"ok": True, "agency": agency}

    def mark_telegram_sent(self, status: str) -> dict[str, Any]:
        with self.lock:
            self.incident["telegram"]["status"] = status
            self.incident["telegram"]["last_sent"] = _iso()
            if status == "SENT":
                self.add_event(
                    "success",
                    "uplink",
                    "Telegram emergency packet delivered",
                    "Snapshot · GPS · vehicle ID · venue route transmitted",
                )
                self.agencies[0].update(
                    {"status": "NOTIFIED", "tone": "warn", "detail": "Telegram packet delivered"}
                )
            else:
                self.add_event(
                    "info",
                    "uplink",
                    "Telegram transmission simulated",
                    "No credentials loaded · incident packet staged but not sent",
                )
            return {"ok": True, "status": status}

    def set_vision_mode(self, active: bool) -> None:
        with self.lock:
            self.mode = "LIVE" if active else "DEMO"
            self.vision_started_at = time.time() if active else None
            if active:
                self.scenario = None
                self.demo_started_at = None
                self.add_event(
                    "info",
                    "vision",
                    "Live camera pipeline requested",
                    "Opening CAM 01 · FaceLandmarker 468-point inference",
                )
            else:
                self.vision_metrics = None
                self.sensing = self._fresh_sensing()
                self.driver = self._fresh_driver()
                self.add_event(
                    "info",
                    "vision",
                    "Live camera pipeline stopped",
                    "Synthetic cabin feed restored",
                )

    def update_vision_metrics(self, metrics: dict[str, Any]) -> None:
        with self.lock:
            self.vision_metrics = metrics
            self.vision_metrics_at = time.time()

    # --------------------------------------------------------------- snapshots
    def state_snapshot(self) -> dict[str, Any]:
        with self.lock:
            stage = self._current_level()
            definition = STAGE_DEFS[stage]
            headline, description = self._driver_copy(self.driver.get("state", "ATTENTIVE"))
            if self.incident["active"] and stage == 4:
                headline, description = self._driver_copy("CRITICAL")
            stages = []
            for item in STAGE_DEFS:
                stages.append(
                    {
                        **item,
                        "state": "active" if item["id"] == stage else ("complete" if item["id"] < stage else "pending"),
                    }
                )
            now = time.time()
            unacknowledged = sum(1 for event in self.events if not event.get("acknowledged"))
            events = list(self.events)[-18:][::-1]
            return {
                "meta": {
                    "server_time": _iso(),
                    "server_epoch_ms": int(now * 1000),
                    "uptime_s": int(now - self.started_at),
                    "mode": self.mode,
                    "demo_running": bool(self.scenario),
                    "scenario": (
                        {
                            "id": self.scenario,
                            "label": "Fatigue cascade",
                            "elapsed_s": int(now - (self.demo_started_at or now)),
                            "duration_s": 46,
                            "progress": int(_clamp(((now - (self.demo_started_at or now)) / 46) * 100, 0, 100)),
                        }
                        if self.scenario
                        else None
                    ),
                    "venue": VENUE,
                    "vehicle_id": VEHICLE_ID,
                    "version": VERSION,
                    "refresh_ms": 500,
                    "unacknowledged": unacknowledged,
                    "telegram_configured": self.telegram_configured,
                    "gemini_configured": bool(os.environ.get("GEMINI_API_KEY")),
                },
                "vehicle": {
                    "id": VEHICLE_ID,
                    "speed_kph": self.speed,
                    "engine": self.engine,
                    "location": {
                        "title": VENUE["name"],
                        "city": VENUE["city"],
                        "lat": VENUE["lat"],
                        "lon": VENUE["lon"],
                        "maps_url": VENUE["maps_url"],
                        "heading_deg": 74,
                        "accuracy_m": 4.2,
                    },
                    "gps_lock": True,
                    "trip_km": 12.8,
                    "network": {"link": "HOTSPOT / 4G", "latency_ms": 18, "signal": 86},
                    "ambient_c": 27.4,
                    "voltage": 12.4,
                },
                "driver": {**self.driver, "headline": headline, "description": description},
                "sensing": self.sensing,
                "safety": {
                    "level": stage,
                    "label": definition["label"],
                    "title": definition["title"],
                    "rule": definition["rule"],
                    "action": definition["action"],
                    "stages": stages,
                    "actuation_mode": self.actuator_mode,
                    "headline": headline,
                    "description": description,
                },
                "actuators": {
                    "mode": self.actuator_mode,
                    "alert": {
                        "on": self.alert_output,
                        "pin": 9,
                        "label": "Cabin alert",
                        "detail": "Buzzer + indicator LED",
                        "pattern": self.alert_pattern,
                        "shared_channel": True,
                    },
                    "motor": {
                        "on": self.motor_output,
                        "power": self.motor_power,
                        "percent": int(round((self.motor_power / 255) * 100)),
                        "pin": 5,
                        "pins": [5, 6, 7],
                        "direction": self.motor_direction,
                        "label": "Haptic actuator",
                        "detail": "L298N · ENA PWM",
                    },
                    "hardware": {
                        "connected": False,
                        "port": "SIMULATED",
                        "baud": 9600,
                        "controller": "Arduino Uno",
                        "protocol": "DMS/1",
                        "voltage": 12.4,
                        "last_command": self.last_hardware_command,
                    },
                    "last_changed_at": _iso(datetime.fromtimestamp(self.actuators_changed_at or now)),
                },
                "incident": self.incident,
                "agencies": self.agencies,
                "events": events,
                "counters": {
                    "events": self.event_seq,
                    "unacknowledged": unacknowledged,
                    "blinks": self.driver.get("blink_count", 0),
                    "microsleeps": self.driver.get("microsleeps", 0),
                    "yawns": self.driver.get("yawn_count", 0),
                },
                "history_meta": {
                    "window_s": 90,
                    "sample_rate_hz": 2,
                },
            }

    def history_snapshot(self) -> list[dict[str, Any]]:
        with self.lock:
            return list(self.history)

    def hardware_outputs(self) -> dict[str, Any]:
        with self.lock:
            return {
                "alert": self.alert_output,
                "motor_power": self.motor_power,
                "motor_direction": self.motor_direction,
            }

    def set_hardware_status(
        self,
        connected: bool,
        port: str,
        command: str | None = None,
        enabled: bool | None = None,
    ) -> None:
        with self.lock:
            # The next snapshot reads this from meta; kept on the state so the UI
            # can render the physical status honestly rather than pretending.
            self._hardware_connected = connected
            self._hardware_port = port
            if enabled is not None:
                self._hardware_enabled = enabled
            if command:
                self.last_hardware_command = command

    def report_data(self) -> dict[str, Any]:
        with self.lock:
            snap = self.state_snapshot()
            return {
                "generated_at": _iso(),
                "vehicle": snap["vehicle"],
                "driver": snap["driver"],
                "safety": snap["safety"],
                "counters": snap["counters"],
                "events": list(self.events)[::-1],
                "history": list(self.history),
                "incident": self.incident,
            }


# The Flask app attaches the live serial state after construction. Keep a tiny
# mix-in helper so snapshots do not need to import the hardware module.
_original_state_snapshot = DMSState.state_snapshot


def _state_snapshot_with_hardware(self: DMSState) -> dict[str, Any]:
    snap = _original_state_snapshot(self)
    snap["actuators"]["hardware"].update(
        {
            "connected": getattr(self, "_hardware_connected", False),
            "port": getattr(self, "_hardware_port", "SIMULATED"),
            "enabled": getattr(self, "_hardware_enabled", False),
            "last_command": getattr(self, "last_hardware_command", "boot:all-off"),
        }
    )
    return snap


DMSState.state_snapshot = _state_snapshot_with_hardware
