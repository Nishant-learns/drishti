"""Telegram incident uplink with a safe local-sandbox mode."""

from __future__ import annotations

import io
import os
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from typing import Any

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    Image = None


class TelegramUplink:
    def __init__(self) -> None:
        self.token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        self.chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        self.enabled = bool(self.token and self.chat_id)
        self.last_error = ""
        self.auto = os.environ.get("DMS_TELEGRAM_AUTO", "0") == "1"

    def status(self) -> dict[str, Any]:
        return {
            "configured": self.enabled,
            "mode": "LIVE" if self.enabled else "SANDBOX",
            "auto": self.auto,
            "error": self.last_error,
        }

    def _caption(self, snap: dict[str, Any]) -> str:
        incident = snap["incident"]
        driver = snap["driver"]
        vehicle = snap["vehicle"]
        loc = vehicle["location"]
        return (
            "🚨 DRISHTI EMERGENCY UPLINK\n"
            f"Vehicle: {vehicle['id']}\n"
            f"Incident: {incident['id'] or 'UNASSIGNED'}\n"
            f"Driver: {driver['state']} · fatigue risk {driver['risk']:.0f}%\n"
            f"Attention: {driver['attention']:.0f}/100 · eye closure {driver['unresponsive_s']:.1f}s\n"
            f"Speed: {vehicle['speed_kph']:.1f} km/h · engine {vehicle['engine']}\n"
            f"Location: {loc['title']}, {loc['city']}\n"
            f"GPS: {loc['lat']:.4f}, {loc['lon']:.4f}\n"
            f"Route: {loc['maps_url']}\n"
            f"Time: {datetime.now().astimezone().strftime('%d %b %Y · %H:%M:%S %Z')}"
        )

    def _multipart(self, snap: dict[str, Any], image_bytes: bytes | None) -> tuple[bytes, str]:
        boundary = f"----DRISHTI{uuid.uuid4().hex}"
        chunks: list[bytes] = []

        def add_field(name: str, value: str) -> None:
            chunks.append(
                (
                    f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n"
                    f"{value}\r\n"
                ).encode("utf-8")
            )

        add_field("chat_id", self.chat_id)
        add_field("caption", self._caption(snap)[:1024])
        add_field("disable_notification", "false")
        if image_bytes:
            chunks.append(
                (
                    f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; "
                    f"filename=\"drishti-incident.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"
                ).encode("utf-8")
            )
            chunks.append(image_bytes)
            chunks.append(b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
        return b"".join(chunks), boundary

    def send_incident(self, snap: dict[str, Any], image_bytes: bytes | None = None) -> dict[str, Any]:
        """Returns a delivery status. Never raises into the HTTP command route."""
        if not self.enabled:
            time.sleep(0.45)
            return {
                "ok": True,
                "status": "SIMULATED",
                "detail": "Sandbox mode: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not configured.",
            }
        body, boundary = self._multipart(snap, image_bytes)
        endpoint = f"https://api.telegram.org/bot{self.token}/sendPhoto" if image_bytes else f"https://api.telegram.org/bot{self.token}/sendMessage"
        if not image_bytes:
            import urllib.parse

            body = urllib.parse.urlencode(
                {"chat_id": self.chat_id, "text": self._caption(snap)[:4096]}
            ).encode("utf-8")
            content_type = "application/x-www-form-urlencoded"
        else:
            content_type = f"multipart/form-data; boundary={boundary}"
        req = urllib.request.Request(
            endpoint,
            data=body,
            headers={"Content-Type": content_type},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=18) as response:
                payload = response.read().decode("utf-8", "replace")
            self.last_error = ""
            return {"ok": True, "status": "SENT", "detail": payload[:400]}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            self.last_error = f"HTTP {exc.code}: {detail}"
            return {"ok": False, "status": "FAILED", "detail": self.last_error}
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.last_error = str(exc)
            return {"ok": False, "status": "FAILED", "detail": self.last_error}


def _load_font(path: str, size: int):
    if Image is None:
        return None
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def make_incident_snapshot(snap: dict[str, Any], camera_jpeg: bytes | None = None) -> bytes:
    """Prefer the current camera frame; otherwise make a clean incident card."""
    if camera_jpeg:
        return camera_jpeg
    if Image is None:
        # A tiny valid JPEG fallback is better than failing the uplink.
        return b""

    width, height = 1280, 720
    image = Image.new("RGB", (width, height), (5, 9, 11))
    draw = ImageDraw.Draw(image)
    font_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "fonts")
    regular = _load_font(os.path.join(font_dir, "Lato-Regular.ttf"), 24)
    bold = _load_font(os.path.join(font_dir, "Lato-Bold.ttf"), 58)
    heavy = _load_font(os.path.join(font_dir, "Lato-Heavy.ttf"), 90)
    mono = _load_font(os.path.join(font_dir, "JetBrainsMono-Regular.ttf"), 22)
    label = _load_font(os.path.join(font_dir, "JetBrainsMono-Medium.ttf"), 16)

    # Ambient geometry / grid.
    for x in range(0, width, 80):
        draw.line([(x, 0), (x, height)], fill=(10, 20, 24), width=1)
    for y in range(0, height, 80):
        draw.line([(0, y), (width, y)], fill=(10, 20, 24), width=1)
    draw.rectangle((28, 28, width - 28, height - 28), outline=(29, 65, 66), width=2)
    draw.rectangle((28, 28, width - 28, 104), fill=(11, 24, 27))
    draw.text((52, 47), "DRISHTI / EMERGENCY INCIDENT SNAPSHOT", font=label, fill=(110, 230, 205))
    draw.text((width - 330, 49), datetime.now().strftime("%d %b %Y  %H:%M:%S"), font=mono, fill=(148, 167, 172))

    driver = snap["driver"]
    vehicle = snap["vehicle"]
    incident = snap["incident"]
    loc = vehicle["location"]
    draw.text((58, 148), "DRIVER UNRESPONSIVE", font=heavy, fill=(255, 99, 103))
    draw.text((62, 256), "EMERGENCY PROTOCOL LATCHED", font=label, fill=(255, 183, 89))

    # Primary data columns.
    draw.text((64, 326), "FATIGUE PROBABILITY", font=label, fill=(118, 142, 150))
    draw.text((64, 350), f"{driver['risk']:.0f}%", font=bold, fill=(244, 248, 249))
    draw.text((64, 438), "ATTENTION INDEX", font=label, fill=(118, 142, 150))
    draw.text((64, 462), f"{driver['attention']:.0f}/100", font=bold, fill=(244, 248, 249))
    draw.text((470, 326), "EYE CLOSURE", font=label, fill=(118, 142, 150))
    draw.text((470, 350), f"{driver['unresponsive_s']:.1f} s", font=bold, fill=(244, 248, 249))
    draw.text((470, 438), "VEHICLE SPEED", font=label, fill=(118, 142, 150))
    draw.text((470, 462), f"{vehicle['speed_kph']:.0f} km/h", font=bold, fill=(244, 248, 249))
    draw.text((860, 326), "VEHICLE", font=label, fill=(118, 142, 150))
    draw.text((860, 352), vehicle["id"], font=mono, fill=(224, 234, 236))
    draw.text((860, 390), f"Engine: {vehicle['engine']}", font=regular, fill=(171, 189, 194))
    draw.text((860, 428), f"Incident: {incident['id'] or 'PENDING'}", font=regular, fill=(171, 189, 194))

    draw.line((58, 560, width - 58, 560), fill=(36, 64, 68), width=2)
    draw.text((62, 590), "LOCATION", font=label, fill=(118, 142, 150))
    draw.text((62, 614), f"{loc['title']}, {loc['city']}", font=regular, fill=(231, 237, 239))
    draw.text((62, 650), f"GPS {loc['lat']:.4f}, {loc['lon']:.4f}   ·   {loc['maps_url']}", font=mono, fill=(103, 206, 201))
    draw.text((width - 330, 650), "DMS/1 · PATNA NODE", font=label, fill=(91, 115, 122))

    output = io.BytesIO()
    image.save(output, format="JPEG", quality=91)
    return output.getvalue()
