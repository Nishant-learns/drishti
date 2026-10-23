# DRISHTI · Edge-AI Driver Safety

Exhibition demo for the Chief Minister of Bihar. A polished dashboard UI for drowsiness-detector hardware.

## Quick Start

```bash
cd drowsiness_test
source venv/bin/activate
python app.py
```

Open http://127.0.0.1:5000 in a browser.

## Modes

- **Synthetic demo** (default) — safe for exhibitions; no camera or serial hardware needed.
- **Live camera** — opt-in via the "Enable live vision" button (requires OpenCV + MediaPipe).
- **Arduino bridge** — simulated by default; connect a Uno at 9600 baud for real actuator control.

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

## Exhibition Notes

- Hotspot access: `http://<laptop-ip>:5000`
- Venue: State Science & Tech Pavilion, Patna (25.6193°, 85.1415°)
- Gemini and Telegram are optional; the local tactical fallback keeps the exhibition functional offline.
- No build step and no external CDN assets; all fonts live in `static/fonts/`.

---

Built with Flask, vanilla JS/CSS, OpenCV, MediaPipe, and Gemini 2.5 Flash.