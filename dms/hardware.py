"""Optional Arduino Uno serial bridge for the physical actuator bench.

The browser can run the entire experience in simulation. When a real Uno is
attached, this bridge mirrors the UI state to the DMS/1 line protocol in
``arduino/dms_actuator/dms_actuator.ino``.

Line protocol
-------------
ALERT:1\n                     buzzer + indicator LED (D9) on
ALERT:0\n                     buzzer + indicator LED off
MOTOR:<0-255>:<F|R|S>\n       ENA PWM, IN1/IN2 direction
PING\n                        heartbeat
"""

from __future__ import annotations

import glob
import os
import threading
import time
from typing import Any

try:  # pyserial is optional for browser-only use
    import serial
    from serial import SerialException
except ImportError:  # pragma: no cover - optional dependency path
    serial = None

    class SerialException(Exception):  # type: ignore[no-redef]
        pass


class SerialBridge:
    def __init__(self, enabled: bool = False, port: str | None = None) -> None:
        self.enabled = enabled or os.environ.get("DMS_SERIAL", "0") == "1"
        self.preferred_port = port or os.environ.get("DMS_SERIAL_PORT") or ""
        self.port = "SIMULATED"
        self.connected = False
        self.serial = None
        self.lock = threading.RLock()
        self.last_error = "Not connected"
        self.last_command = "boot:all-off"
        self._last_alert: bool | None = None
        self._last_motor: tuple[int, str] | None = None

    def _candidates(self) -> list[str]:
        if self.preferred_port:
            return [self.preferred_port]
        ports: list[str] = []
        if serial is not None:
            try:
                import serial.tools.list_ports
                com_ports = serial.tools.list_ports.comports()
                # Prioritize USB / ACM / Arduino devices
                usb_ports = [
                    p.device for p in com_ports
                    if "usb" in p.device.lower()
                    or "acm" in p.device.lower()
                    or "arduino" in (p.description or "").lower()
                    or "usb" in (p.description or "").lower()
                    or p.device.upper().startswith("COM")
                ]
                other_ports = [p.device for p in com_ports if p.device not in usb_ports]
                ports = usb_ports + other_ports
            except Exception:
                ports = []
        if not ports:
            ports = sorted(
                glob.glob("/dev/ttyACM*")
                + glob.glob("/dev/ttyUSB*")
                + glob.glob("/dev/cu.usb*")
                + glob.glob("/dev/tty.usb*")
            )
        return ports

    def connect(self) -> dict[str, Any]:
        if not self.enabled:
            self.port = "SIMULATED"
            self.connected = False
            self.last_error = "Serial bridge disabled (simulation mode)"
            return self.status()
        if serial is None:
            self.last_error = "pyserial is not installed"
            return self.status()
        with self.lock:
            if self.serial and self.serial.is_open:
                return self.status()
            for candidate in self._candidates():
                try:
                    self.serial = serial.Serial(candidate, 9600, timeout=0.25, write_timeout=0.5)
                    time.sleep(1.6)  # Uno auto-reset on serial open
                    self.port = candidate
                    self.connected = True
                    self.last_error = ""
                    self._last_alert = None
                    self._last_motor = None
                    self.send("PING")
                    # Safe boot state: never leave the actuator bench energised.
                    self.send("ALERT:0")
                    self.send("MOTOR:0:S")
                    return self.status()
                except (SerialException, OSError) as exc:
                    self.last_error = str(exc)
                    self.serial = None
            self.connected = False
            self.port = "DISCONNECTED"
            return self.status()

    def disconnect(self) -> dict[str, Any]:
        with self.lock:
            if self.serial:
                try:
                    self.serial.write(b"ALERT:0\n")
                    self.serial.write(b"MOTOR:0:S\n")
                except (SerialException, OSError):
                    pass
                try:
                    self.serial.close()
                except (SerialException, OSError):
                    pass
            self.serial = None
            self.connected = False
            self.port = "DISCONNECTED"
            self.last_error = "Disconnected by operator"
            return self.status()

    def send(self, command: str) -> bool:
        with self.lock:
            self.last_command = command
            if not self.serial or not self.connected:
                return False
            try:
                self.serial.write((command + "\n").encode("ascii", "ignore"))
                self.serial.flush()
                return True
            except (SerialException, OSError) as exc:
                self.connected = False
                self.last_error = str(exc)
                return False

    def sync(self, outputs: dict[str, Any]) -> None:
        """Mirror only actual changes so the Uno is not flooded at 4 Hz."""
        with self.lock:
            if not self.connected:
                return
            alert = bool(outputs.get("alert"))
            motor_power = int(outputs.get("motor_power", 0))
            direction = outputs.get("motor_direction", "STOP")
            if direction not in ("F", "R", "S", "STOP"):
                direction = "S"
            if direction == "STOP":
                direction = "S"
            if alert != self._last_alert:
                self.send(f"ALERT:{1 if alert else 0}")
                self._last_alert = alert
            if (motor_power, direction) != self._last_motor:
                self.send(f"MOTOR:{motor_power}:{direction}")
                self._last_motor = (motor_power, direction)

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "port": self.port,
            "baud": 9600,
            "controller": "Arduino Uno",
            "enabled": self.enabled,
            "error": self.last_error,
            "last_command": self.last_command,
            "protocol": "DMS/1",
        }

    def close(self) -> None:
        self.disconnect()
