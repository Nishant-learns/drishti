# DRISHTI · Edge-AI Driver Safety

Exhibition demo for the Chief Minister of Bihar. A polished dashboard UI for drowsiness-detector hardware.

## Quick Start

```bash
# 1. Activate environment
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Run the unified launcher (Dashboard + Live Camera Window in sync)
python launch_adas_dashboard.py

# Or run just the dashboard web console:
# python app.py --live --serial
```

Open http://127.0.0.1:5000 in your browser.

### Command Line Options

- `--camera <index>`: Select camera (default: `0`, or set `DMS_CAMERA_INDEX=1`)
- `--serial`: Auto-connect to Arduino Uno (auto-detects `/dev/ttyUSB*`, `/dev/ttyACM*`, or `COM*` on Windows)
- `--port <port>`: Change dashboard port (default: `5000`)

## Views

| View | Description |
|------|-------------|
| **Live cockpit** | Real-time cabin vision, EAR/MAR/head pose, escalation ladder, actuator bus |
| **Response ops** | Multi-agency emergency response, incident banner, Telegram uplink, remote engine controls |
| **Session analytics** | Trends, evidence & audit ledger, chart visualisations |
| **DRISHTI copilot** | Gemini 2.5 Flash tactical fallback with offline local responses |

## Hardware

- **Camera** — MediaPipe FaceLandmarker (468 facial landmarks). EAR < 0.23 triggers alert; MAR > 0.65 triggers yawn detection; head pose via solvePnP.
- **Arduino Uno** — L298N motor (ENA/D5, IN1/D6, IN2/D7) + buzzer/LED on D9. DMS/1 protocol at 9600 baud.
- **Flask** — port 5000, mobile‑hotspot accessible.

## Emergency Uplink

- Eye closure > 5.0 s or impact flag → Telegram packet with snapshot, timestamp, vehicle ID `BR-01-EXP-2026`, GPS, venue route.
- Credentials read from `.env`; sandbox mode when absent.
- Gemini 2.5 Flash copilot with local tactical fallback (always functional offline).

## Credentials

Copy `.env.example` to `.env` and fill:

```
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
GEMINI_API_KEY=your_key  # optional
```

Without these, Telegram runs in sandbox (nothing leaves the laptop).

## Safety

- Remote engine STOP is a **software interlock only**. A physical throttle cut requires an added relay.
- Cabin intercom uses browser `SpeechSynthesis`; no server‑side TTS.
- Auto safety guard can be manually overridden; outputs return to safe state on re‑arm.

## Files

- `app.py` — Flask entrypoint and all API routes.
- `dms/` — Python state, vision, hardware, copilot, Telegram modules.
- `static/` — HTML template, 8 CSS files, JS, Lato + JetBrains Mono fonts.
- `templates/index.html` — complete markup.
- `arduino/dms_actuator/dms_actuator.ino` — Arduino sketch.
- `requirements.txt` — Python dependencies.
- `.env.example` — environment variable template.
- `.gitignore` — standard Python/OS ignores.

## Dependencies & Installation

### Python environment

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

The `requirements.txt` file lists all pinned dependencies (Flask, OpenCV, MediaPipe, numpy, pyserial, Pillow, etc.). Installing from this file ensures the exact library versions used in development.

### System-level

- **Google Chrome** or Chromium browser (for the dashboard UI; tested with Chrome 146+)
- **Chromedriver** (version matching the installed Chrome; `opencv-python` and `mediapipe` pull their own native dependencies, but on Linux you may need `libgl1-mesa-glx` and `libglib2.0-0` for hardware acceleration)
- **Webcam** — `cv2.VideoCapture(0)` must succeed; the FaceLandmarker model `face_landmarker.task` must be present at the project root

### Verified working

```bash
source venv/bin/activate
python app.py
# then open http://127.0.0.1:5000
```

### Optional: live hardware

- **Arduino Uno** connected at 9600 baud on `/dev/ttyUSB0` (or COMxx) for real L298N motor and buzzer/LED control
- **Telegram bot** — set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` for live emergency uplink
- **Gemini API** — set `GEMINI_API_KEY` in `.env` for Gemini 2.5 Flash copilot (offline tactical fallback works without it)

### Notes

- No npm / Node build step is required; the dashboard is served entirely by Flask with local HTML/CSS/JS and local TTF fonts.
- The `face_landmarker.task` file (MediaPipe model) is included in the repo at `face_landmarker.task`.
- The `.env` file is gitignored; copy `.env.example` and fill only if you need live Telegram or Gemini.

---

Built with Flask, vanilla JS/CSS, OpenCV, MediaPipe, and Gemini 2.5 Flash.