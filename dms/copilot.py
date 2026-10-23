"""Copilot for the command console.

Uses Gemini 2.5 Flash when a key is configured. The offline tactical fallback
is deliberately useful on its own so the exhibition never depends on venue
internet: it reasons over the same live telemetry snapshot as the dashboard.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

SYSTEM_INSTRUCTION = """You are DRISHTI Copilot, a terse tactical assistant inside a driver-monitoring
command console. You advise the operator using the supplied live telemetry. Prioritise
driver safety, explain the current escalation level, and recommend a concrete next action.
Never claim to have actuated hardware yourself. Keep answers under 120 words unless asked
for an incident report. Use plain language, short paragraphs and at most three bullets.
"""


def _bullet(label: str, value: Any) -> str:
    return f"• {label}: {value}"


class CopilotService:
    def __init__(self) -> None:
        self.api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        self.model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    def _context(self, snap: dict[str, Any]) -> dict[str, Any]:
        driver = snap["driver"]
        vehicle = snap["vehicle"]
        safety = snap["safety"]
        incident = snap["incident"]
        return {
            "vehicle_id": vehicle["id"],
            "venue": vehicle["location"]["title"],
            "speed_kph": vehicle["speed_kph"],
            "engine": vehicle["engine"],
            "driver_state": driver["state"],
            "attention_index": driver["attention"],
            "fatigue_risk_pct": driver["risk"],
            "ear": driver["ear"],
            "mar": driver["mar"],
            "yaw_deg": driver["yaw"],
            "pitch_deg": driver["pitch"],
            "eye_closure_s": driver["unresponsive_s"],
            "blink_rate": driver["blink_rate"],
            "microsleeps": driver["microsleeps"],
            "safety_level": safety["level"],
            "safety_stage": safety["label"],
            "actuation_mode": snap["actuators"]["mode"],
            "alert_output": snap["actuators"]["alert"]["on"],
            "motor_pwm": snap["actuators"]["motor"]["power"],
            "incident_active": incident["active"],
            "incident_id": incident["id"],
            "telegram_status": incident["telegram"]["status"],
            "agencies": [
                {"name": a["name"], "status": a["status"]} for a in snap["agencies"]
            ],
        }

    def _local_reply(self, snap: dict[str, Any], question: str) -> str:
        q = question.lower()
        driver = snap["driver"]
        safety = snap["safety"]
        incident = snap["incident"]
        vehicle = snap["vehicle"]
        act = snap["actuators"]
        risk = driver["risk"]
        stage = safety["level"]
        stage_name = safety["label"].upper()

        if any(word in q for word in ("hello", "hi", "hey", "who are you", "what can you do")):
            return (
                "DRISHTI Copilot online. I can read the live biometric stream, explain the "
                "escalation ladder, prepare an incident hand-off, or talk you through the "
                "actuator bench. Try: “Give me a status brief” or “Why is the buzzer active?”"
            )

        if any(word in q for word in ("incident", "resolve", "report", "hand-off", "handoff")):
            if incident["active"]:
                return (
                    f"Incident {incident['id']} is open for {incident['age_s']} s.\n\n"
                    + _bullet("Cause", incident["cause"])
                    + _bullet("Peak fatigue", f"{incident['peak_fatigue']:.0f}%")
                    + _bullet("Powertrain", snap["vehicle"]["engine"])
                    + _bullet("Telegram", incident["telegram"]["status"])
                    + "\n\nBefore closing: confirm the driver is responsive, inspect the "
                    "cabin, reset the powertrain interlock, then resolve the incident."
                )
            return (
                "No incident is open. The system is logging routine biometric telemetry and "
                "all response agencies are on standby. A Level 4 event would auto-create an "
                "incident packet with snapshot, GPS and venue routing."
            )

        if any(word in q for word in ("telegram", "uplink", "message", "send", "police", "ems", "ambulance", "agency", "dispatch")):
            u = incident["telegram"]
            agencies = ", ".join(f"{a['name']} {a['status'].lower()}" for a in snap["agencies"])
            mode = "live credentials loaded" if snap["meta"]["telegram_configured"] else "sandbox — no credentials loaded"
            return (
                f"Uplink is {mode}. Telegram status: {u['status']}.\n\n"
                + _bullet("Incident", incident["id"] or "none open")
                + _bullet("Agencies", agencies)
                + _bullet("Payload", "cabin snapshot, timestamp, vehicle ID, GPS, venue route")
                + "\n\nDo not transmit a live emergency packet as a test. Use the staged drill "
                "unless a real driver is at risk."
            )

        if any(word in q for word in ("location", "gps", "where", "venue", "patna", "route", "map")):
            loc = vehicle["location"]
            return (
                f"Vehicle {vehicle['id']} is pinned at {loc['title']}, {loc['city']} "
                f"({loc['lat']:.4f}, {loc['lon']:.4f}), accuracy ±{loc['accuracy_m']} m. "
                f"Heading {loc['heading_deg']}° with a {vehicle['network']['latency_ms']} ms "
                f"hotspot link.\n\nRoute link: {loc['maps_url']}"
            )

        if any(word in q for word in ("buzzer", "led", "motor", "actuator", "hardware", "arduino", "pin", "haptic")):
            alert = "on" if act["alert"]["on"] else "off"
            return (
                f"Actuation mode is {act['mode']}. Cabin alert (D9 buzzer + LED) is {alert}; "
                f"L298N actuator is {'at ' + str(act['motor']['power']) + '/255 PWM' if act['motor']['on'] else 'off'}.\n\n"
                + _bullet("Safety ladder", f"Level {stage} · {stage_name}")
                + _bullet("Shared output", "D9 drives both the buzzer and the indicator LED")
                + _bullet("Guard", "Switch to MANUAL before using direct actuator controls" if act["mode"] == "AUTO" else "Manual override is active")
                + "\n\nThe dashboard patterns binary outputs into advisories, pulses and an "
                "emergency latch, so the software adds behaviour without changing the wiring."
            )

        if any(word in q for word in ("engine", "speed", "stop", "immobil", "run", "throttle", "cut")):
            return (
                f"Powertrain state is {vehicle['engine']} at {vehicle['speed_kph']:.1f} km/h. "
                f"The software interlock is {'latched after the emergency threshold' if vehicle['engine'] == 'HALTED' else 'released'}.\n\n"
                "Only release the interlock after visual confirmation that the driver is awake, "
                "the vehicle is stationary, and the incident commander has cleared the scene."
            )

        if any(word in q for word in ("level", "escalat", "protocol", "safety", "why", "next", "recommend", "risk", "fatigue", "attention", "status", "brief", "driver", "state")):
            next_action = {
                0: "Continue monitoring. No intervention is required.",
                1: "Surface an advisory and watch for sustained eye closure. Do not actuate yet.",
                2: "Cabin alert is appropriate. Confirm the driver responds to the buzzer/HUD.",
                3: "Haptic intervention is warranted. Prepare for a Level 4 emergency hand-off.",
                4: "Keep the powertrain interlocked. Confirm driver response and transmit the incident packet.",
            }.get(stage, "Continue monitoring.")
            return (
                f"DRIVER {driver['state']} · attention {driver['attention']:.0f}/100 · fatigue risk "
                f"{risk:.0f}%.\n\n"
                + _bullet("Safety level", f"{stage} · {stage_name}")
                + _bullet("EAR / MAR", f"{driver['ear']:.3f} / {driver['mar']:.2f}")
                + _bullet("Head pose", f"yaw {driver['yaw']:+.1f}°, pitch {driver['pitch']:+.1f}°")
                + _bullet("Eye closure", f"{driver['unresponsive_s']:.1f} s")
                + _bullet("Blink rate", f"{driver['blink_rate']:.1f}/min")
                + f"\n\nNext: {next_action}"
            )

        if any(word in q for word in ("demo", "test", "drill", "simulate")):
            return (
                "The Fatigue Cascade drill is a 46-second walkthrough: advisory at Level 1, "
                "cabin alert at Level 2, haptic pulse at Level 3, then a sustained microsleep "
                "that latches Level 4 and cuts the powertrain. Start it from Driver State → "
                "Run fatigue demo. Use Stop at any time."
            )

        return (
            f"Current tactical picture: driver {driver['state'].lower()}, risk {risk:.0f}%, "
            f"safety Level {stage} ({stage_name}), vehicle {vehicle['engine'].lower()} at "
            f"{vehicle['speed_kph']:.0f} km/h. "
            f"{'Incident ' + str(incident['id']) + ' remains open.' if incident['active'] else 'No incident is open.'}\n\n"
            "Ask me about the driver status, escalation protocol, response agencies, hardware "
            "channels, or the incident hand-off."
        )

    def _gemini_reply(self, snap: dict[str, Any], question: str, history: list[dict[str, str]]) -> str:
        context = json.dumps(self._context(snap), ensure_ascii=True)
        contents = []
        for item in history[-6:]:
            role = "user" if item.get("role") == "user" else "model"
            contents.append({"role": role, "parts": [{"text": item.get("content", "")[:2000]}]})
        contents.append(
            {
                "role": "user",
                "parts": [
                    {
                        "text": f"LIVE TELEMETRY:\n{context}\n\nOPERATOR QUESTION:\n{question}"
                    }
                ],
            }
        )
        payload = {
            "system_instruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.35, "maxOutputTokens": 300, "topP": 0.9},
        }
        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent?key={self.api_key}"
        )
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=16) as response:
            data = json.loads(response.read().decode("utf-8"))
        candidates = data.get("candidates") or []
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "\n".join(part.get("text", "") for part in parts).strip()
        if not text:
            raise RuntimeError("Gemini returned an empty answer")
        return text

    def ask(self, snap: dict[str, Any], question: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
        started = time.time()
        question = (question or "").strip()[:1200]
        if not question:
            return {"reply": "Ask me about the driver, escalation protocol or incident hand-off.", "source": "tactical-fallback"}
        if self.api_key:
            try:
                answer = self._gemini_reply(snap, question, history or [])
                return {
                    "reply": answer,
                    "source": self.model,
                    "latency_ms": int((time.time() - started) * 1000),
                }
            except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError, OSError):
                pass
        return {
            "reply": self._local_reply(snap, question),
            "source": "tactical-fallback",
            "latency_ms": int((time.time() - started) * 1000),
            "offline": True,
        }
