/* DRISHTI · command console runtime.
   Vanilla JS, no build step. The browser is a thin, resilient view over the
   Flask telemetry state; every critical command is confirmed and logged. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const qs = (selector, root) => (root || document).querySelector(selector);

  const VIEW_META = {
    cockpit: { title: "Live cockpit", subtitle: "Edge-AI cabin observation" },
    response: { title: "Response ops", subtitle: "Incident & multi-agency response" },
    analytics: { title: "Session analytics", subtitle: "Trends, evidence & audit" },
    copilot: { title: "DRISHTI copilot", subtitle: "Contextual decision support" },
  };

  const STATE_LABELS = {
    ATTENTIVE: "ATTENTIVE",
    CAUTION: "CAUTION",
    FATIGUED: "FATIGUED",
    CRITICAL: "CRITICAL",
    RECOVERING: "RECOVERING",
    NO_FACE: "NO FACE",
    HALTED: "SECURED",
  };

  const SEVERITY_ICONS = {
    critical: "i-shield-alert",
    warning: "i-alert",
    success: "i-check",
    info: "i-grid",
  };

  const CATEGORY_ICONS = {
    vision: "i-vision",
    driver: "i-eye",
    safety: "i-shield-alert",
    control: "i-sliders",
    uplink: "i-telegram",
    hardware: "i-chip",
    system: "i-grid",
  };

  const ICON = (id, cls) =>
    `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#${id}"></use></svg>`;

  const ui = {};
  const app = {
    snap: null,
    samples: [],
    booted: false,
    polling: false,
    pollTimer: 0,
    live: false,
    visionBusy: false,
    lastStateAt: 0,
    uptimeBase: 0,
    uptimeMark: 0,
    eventsSignature: "",
    seenEvents: new Set(),
    incidentId: null,
    networkUrl: "",
    chatHistory: [],
    chatPending: false,
    copilotSource: null,
    confirmResolver: null,
    view: "cockpit",
    demoFeed: null,
    trendChart: null,
    analyticsChart: null,
    feedErrorShown: false,
  };

  const UI_IDS = [
    "sidebar", "sidebarUnitDot", "sidebarEngine", "hardwareShort", "uptimeShort", "openSystem",
    "pageTitle", "pageSubtitle", "linkPill", "linkMode", "linkLatency", "clockTime", "clockDate",
    "notificationButton", "notificationCount", "responseBadge", "mainCanvas",
    "speedValue", "speedSub", "engineLamp", "engineValue", "locationValue", "coordsValue",
    "signalBars", "latencyValue", "venueButton",
    "visionStage", "visionCanvas", "liveFeed", "visionSourceChip", "feedModeChip", "visionIrMode",
    "visionTimestamp", "faceLockCard", "visionConfidence", "visionEyeState", "visionHeadState",
    "visionAlertTag", "visionAlertText", "visionNoFace", "visionFps", "visionInference",
    "feedLiveLabel", "snapshotButton", "visionToggle", "visionToggleText", "expandVision",
    "attentionOrbit", "attentionArc", "attentionCap", "orbitTicks", "attentionValue",
    "attentionDelta", "driverStateTag", "driverHeadline", "driverDescription", "fatigueValue",
    "fatigueBar", "earValue", "earNote", "marValue", "marNote", "headValue", "headNote",
    "stageLabel", "escalationTrack", "escalationFill", "stageAction", "stageRule",
    "demoButton", "demoProgress", "demoProgressBar", "stopDemoButton", "ackButton",
    "trendEar", "trendMar", "trendRisk", "trendChart", "chartStatusLine", "chartLegend",
    "actuatorModeButton", "actuatorModeLabel", "alertOutputRow", "alertWave", "alertToggle",
    "motorOutputRow", "motorPwmValue", "motorToggle", "motorRange", "motorPercent",
    "alertPattern", "activeOutputCount", "actuatorModeHint", "overrideButton",
    "eventList", "eventCount", "openLedgerButton",
    "responseInlineStatus", "responseDrillButton", "resolveButton", "incidentBanner",
    "incidentTitle", "incidentDescription", "incidentId", "incidentAge", "incidentDriver",
    "incidentTelegram", "mapsLink", "mapRouteLink", "copyCoordsButton", "agencyList",
    "tgStatus", "tgTarget", "tgLastAttempt", "tgMode", "telegramButton", "snapshotButton2",
    "engineStateBig", "remoteSpeed", "haltButton", "runButton", "intercomInput",
    "intercomSend", "reportButton", "responseLedger",
    "analyticsReportButton", "kpiUptime", "kpiBlinks", "kpiMicrosleeps", "kpiRiskExposure",
    "analyticsChart", "analyticsTabs", "analyticsRiskLegend", "analyticsMarkerCount",
    "copilotSourceStatus", "clearChatButton", "chatLog", "copilotModeChip", "copilotInfo",
    "promptSuggestions", "chatForm", "chatInput", "chatSend", "copilotLatency", "ctxDriver",
    "ctxAttention", "ctxFatigue", "ctxSafety", "ctxClosure", "ctxEngine", "ctxIncident",
    "ctxUplink", "contextUpdated",
    "drawerScrim", "systemDrawer", "closeSystem", "drawerHardwareStatus", "drawerPort",
    "hardwareConnectButton", "hardwareTestButton", "hardwareDisconnectButton",
    "drawerTelegramStatus", "drawerTelegramMode", "drawerGeminiMode", "drawerActuatorMode",
    "serverUrl", "toastStack", "confirmScrim", "confirmIcon", "confirmTitle", "confirmBody",
    "confirmCancel", "confirmAccept",
  ];

  const driverCard = () => qs(".driver-card");
  const actuatorCard = () => qs(".actuator-card");

  /* ------------------------------------------------------------------ utils */
  function text(node, value) {
    if (!node) return;
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
  }

  function html(node, value) {
    if (!node) return;
    if (node.innerHTML !== value) node.innerHTML = value;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function fmtClock(date) {
    const d = date || new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function fmtDate(date) {
    const d = date || new Date();
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return fmtClock(d);
  }

  function fmtAge(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function fmtTimer(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  }

  function signed(value, digits) {
    const n = Number(value) || 0;
    const body = Math.abs(n).toFixed(digits);
    return n < 0 ? `−${body}` : `+${body}`;
  }

  function pct(value) {
    return `${Math.round(Number(value) || 0)}%`;
  }

  function chip(node, iconless, label) {
    html(node, `${iconless ? "" : '<i class="dot"></i>'}${label}`);
  }

  function setToneChip(node, ok) {
    if (!node) return;
    node.classList.toggle("ok", !!ok);
  }

  function iconForEvent(event) {
    return CATEGORY_ICONS[event.category] || SEVERITY_ICONS[event.severity] || "i-grid";
  }

  /* -------------------------------------------------------------- networking */
  async function apiJson(path, options) {
    const response = await fetch(path, Object.assign({ cache: "no-store" }, options || {}));
    const type = response.headers.get("content-type") || "";
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      if (type.includes("application/json")) {
        try {
          const payload = await response.json();
          message = payload.error || payload.detail || message;
        } catch (_) {
          /* keep status text */
        }
      }
      throw new Error(message);
    }
    return response.json();
  }

  function control(action, extra) {
    return apiJson("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action }, extra || {})),
    });
  }

  function refreshSoon(delay) {
    window.clearTimeout(app.pollTimer);
    app.pollTimer = window.setTimeout(poll, app.polling ? 120 : delay == null ? 60 : delay);
  }

  function pollDelay() {
    return document.hidden ? 1800 : 250;
  }

  async function poll() {
    if (app.polling) return;
    app.polling = true;
    window.clearTimeout(app.pollTimer);
    try {
      const snap = await apiJson("/api/state");
      applySnapshot(snap);
      if (ui.linkPill) ui.linkPill.classList.remove("is-offline");
    } catch (_) {
      text(ui.linkMode, "LINK LOST");
      text(ui.linkLatency, "reconnecting…");
      if (ui.linkPill) ui.linkPill.classList.add("is-offline");
    } finally {
      app.polling = false;
      window.clearTimeout(app.pollTimer);
      app.pollTimer = window.setTimeout(poll, pollDelay());
    }
  }

  function applySnapshot(snap, options) {
    if (!snap || !snap.meta) return;
    const first = !app.booted;
    app.snap = snap;
    app.lastStateAt = Date.now();
    app.uptimeBase = Number(snap.meta.uptime_s) || 0;
    app.uptimeMark = app.lastStateAt;

    appendSample(snap);
    renderAll(snap);

    if (first) {
      (snap.events || []).forEach((event) => app.seenEvents.add(event.id));
      app.booted = true;
      app.incidentId = snap.incident && snap.incident.active ? snap.incident.id : null;
      if (snap.meta.mode === "LIVE") setLiveFeed(true);
    } else {
      announceCritical(snap.events || []);
      if (snap.incident && snap.incident.active && snap.incident.id !== app.incidentId) {
        app.incidentId = snap.incident.id;
      } else if (!snap.incident || !snap.incident.active) {
        app.incidentId = null;
      }
    }
    if (!first && options && options.toast) toast(options.toast.title, options.toast.body, options.toast.tone);
  }

  function appendSample(snap) {
    const t = Number(snap.meta.server_epoch_ms) || Date.now();
    const sample = {
      t,
      ear: Number(snap.driver.ear) || 0,
      mar: Number(snap.driver.mar) || 0,
      risk: Number(snap.driver.risk) || 0,
      attention: Number(snap.driver.attention) || 0,
      yaw: Number(snap.driver.yaw) || 0,
    };
    const last = app.samples[app.samples.length - 1];
    if (last && Math.abs(t - last.t) < 50) {
      app.samples[app.samples.length - 1] = sample;
    } else {
      app.samples.push(sample);
    }
    const cutoff = t - 100000;
    while (app.samples.length && app.samples[0].t < cutoff) app.samples.shift();
    if (app.samples.length > 240) app.samples.splice(0, app.samples.length - 240);
  }

  async function refreshHistory() {
    try {
      const payload = await apiJson("/api/history");
      if (payload && Array.isArray(payload.samples)) {
        const latest = app.samples[app.samples.length - 1];
        const fetched = payload.samples;
        if (!latest || !fetched.length || fetched[fetched.length - 1].t >= latest.t) {
          app.samples = fetched;
        } else {
          const firstFetched = fetched[0] ? fetched[0].t : 0;
          app.samples = fetched.concat(app.samples.filter((s) => s.t > firstFetched));
        }
        updateCharts();
      }
    } catch (_) {
      /* history is a convenience; the live state remains authoritative */
    }
  }

  /* ------------------------------------------------------------------ render */
  function renderAll(snap) {
    renderHeader(snap);
    renderVision(snap);
    renderDriver(snap);
    renderActuator(snap);
    renderEvents(snap);
    renderIncident(snap);
    renderAgencies(snap);
    renderTelegram(snap);
    renderAnalytics(snap);
    renderCopilotContext(snap);
    renderHardware(snap);
    updateCharts();
    renderCopilotMeta();
  }

  function renderHeader(snap) {
    const meta = snap.meta;
    const vehicle = snap.vehicle;
    const safety = snap.safety;

    text(ui.speedValue, Number(vehicle.speed_kph).toFixed(1));
    const halted = vehicle.engine === "HALTED";
    if (halted) text(ui.speedSub, vehicle.speed_kph < 0.5 ? "Secured · interlock latched" : "Emergency deceleration");
    else if (vehicle.speed_kph < 1) text(ui.speedSub, "Stationary · idle");
    else if (safety.level >= 3) text(ui.speedSub, "Caution · driver impaired");
    else text(ui.speedSub, "Cruise · stable");

    text(ui.engineValue, vehicle.engine);
    ui.engineLamp.classList.toggle("is-halted", halted);
    text(ui.sidebarEngine, halted ? "INTERLOCK ACTIVE" : "ENGINE RUNNING");
    if (ui.sidebarUnitDot) {
      ui.sidebarUnitDot.style.background = halted ? "var(--coral)" : "";
      ui.sidebarUnitDot.style.boxShadow = halted ? "0 0 8px rgba(255,123,126,.65)" : "";
    }

    const loc = vehicle.location;
    text(ui.locationValue, loc.title);
    text(ui.coordsValue, `${loc.lat.toFixed(4)}° N · ${loc.lon.toFixed(4)}° E`);
    text(ui.latencyValue, `${vehicle.network.latency_ms} ms · GPS ±${loc.accuracy_m} m`);

    const modeLive = meta.mode === "LIVE";
    text(ui.linkMode, modeLive ? "LIVE CAM LINK" : "DEMO LINK");
    const inference = Number(snap.sensing.inference_ms) || 0;
    text(ui.linkLatency, `${inference ? Math.round(inference) : vehicle.network.latency_ms} ms · EDGE`);

    if (ui.notificationCount) {
      const count = Number(meta.unacknowledged) || 0;
      ui.notificationCount.hidden = count === 0;
      text(ui.notificationCount, count > 99 ? "99+" : count);
    }
    if (ui.responseBadge) {
      const count = Number(meta.unacknowledged) || 0;
      ui.responseBadge.hidden = count === 0;
      text(ui.responseBadge, count > 99 ? "99+" : count);
    }

    ui.signalBars.querySelectorAll("i").forEach((bar, index) => {
      bar.style.opacity = String(index < Math.ceil((vehicle.network.signal / 100) * 4) ? 0.85 : 0.25);
    });

    document.body.dataset.alert = (snap.incident.active || safety.level >= 4) ? "critical" : "";
    if (ui.venueButton) ui.venueButton.dataset.maps = loc.maps_url;
  }

  function renderVision(snap) {
    const driver = snap.driver;
    const meta = snap.meta;
    const safety = snap.safety;
    const live = meta.mode === "LIVE";
    const sensing = snap.sensing;

    if (live !== app.live) setLiveFeed(live);

    text(ui.visionToggleText, live ? "Return to synthetic" : "Enable live vision");
    html(ui.visionSourceChip, `<i class="dot"></i>${live ? "LIVE CAM 01" : "SYNTHETIC"}`);
    html(ui.feedModeChip, `<i></i>${live ? "LIVE CAMERA" : "SIMULATION FEED"}`);
    text(ui.visionIrMode, live ? "CAM" : "SYN");
    html(ui.feedLiveLabel, live ? "LIVE" : "SIMULATED");

    text(ui.visionFps, Number(sensing.fps || 0).toFixed(1));
    text(ui.visionInference, `${Number(sensing.inference_ms || 0).toFixed(1)} ms`);
    text(ui.visionConfidence, Number(driver.confidence || 0).toFixed(1));
    text(ui.visionEyeState, Number(driver.ear) < 0.23 ? "CLOSED" : Number(driver.ear) < 0.26 ? "DROWSY" : "OPEN");
    text(ui.visionHeadState, driver.head_direction || "FORWARD");

    ui.visionEyeState.style.color =
      Number(driver.ear) < 0.23 ? "var(--coral)" : Number(driver.ear) < 0.26 ? "var(--amber)" : "";
    ui.visionHeadState.style.color = driver.head_direction && driver.head_direction !== "FORWARD" ? "var(--amber)" : "";

    const faceLost = driver.face_locked === false;
    ui.visionNoFace.hidden = !live || !faceLost;
    ui.visionCard = qs(".vision-card");
    if (ui.visionCard) {
      ui.visionCard.classList.toggle("is-live", live);
      ui.visionCard.classList.toggle("is-no-face", faceLost);
    }

    const alertLevel = safety.level;
    const alertActive = alertLevel >= 2 || snap.incident.active;
    ui.visionAlertTag.hidden = !alertActive;
    const alertLabel =
      alertLevel >= 4 || snap.incident.active
        ? "EMERGENCY LATCH · THROTTLE CUT"
        : alertLevel === 3
          ? "HAPTIC INTERVENTION · D5"
          : "DROWSINESS THRESHOLD · D9";
    text(ui.visionAlertText, alertLabel);

    if (app.demoFeed) {
      app.demoFeed.setState({
        ear: driver.ear,
        mar: driver.mar,
        yaw: driver.yaw,
        pitch: driver.pitch,
        risk: driver.risk,
        face_locked: driver.face_locked !== false,
      });
    }
  }

  function setLiveFeed(live) {
    app.live = live;
    if (!ui.liveFeed) return;
    if (live) {
      ui.liveFeed.hidden = false;
      if (!ui.liveFeed.src || !ui.liveFeed.src.includes("/video_feed")) {
        ui.liveFeed.src = `/video_feed?t=${Date.now()}`;
      }
      if (app.demoFeed) app.demoFeed.stop();
    } else {
      ui.liveFeed.hidden = true;
      ui.liveFeed.removeAttribute("src");
      if (app.demoFeed) app.demoFeed.start();
    }
  }

  function renderDriver(snap) {
    const driver = snap.driver;
    const safety = snap.safety;
    const level = Number(safety.level) || 0;
    const critical = level >= 4 || snap.incident.active || driver.state === "CRITICAL";
    const warning = !critical && (level >= 2 || driver.state === "FATIGUED" || driver.state === "CAUTION");
    const card = driverCard();
    if (card) {
      card.classList.toggle("is-critical", critical);
      card.classList.toggle("is-warning", warning);
    }

    const label = STATE_LABELS[driver.state] || String(driver.state || "UNKNOWN").replace(/_/g, " ");
    ui.driverStateTag.className = `state-tag${critical ? " is-critical" : warning ? " is-caution" : ""}`;
    html(ui.driverStateTag, `<i></i>${label}`);
    text(ui.driverHeadline, driver.headline || "Driver responsive");
    text(ui.driverDescription, driver.description || "");

    const attention = clamp(Math.round(Number(driver.attention) || 0), 0, 100);
    text(ui.attentionValue, attention);
    ui.attentionArc.style.strokeDashoffset = String(100 - attention);
    const arcColor = critical ? "#ff7b7e" : warning ? "#ffc36b" : "#6ee8d2";
    ui.attentionArc.style.stroke = arcColor;
    ui.attentionCap.style.fill = arcColor;
    const angle = ((-90 + attention * 3.6) * Math.PI) / 180;
    ui.attentionCap.setAttribute("cx", String(110 + Math.cos(angle) * 90));
    ui.attentionCap.setAttribute("cy", String(110 + Math.sin(angle) * 90));
    ui.attentionCap.style.opacity = attention > 0 ? "0.85" : "0";

    let delta = "STABLE";
    if (driver.state === "NO_FACE") delta = "NO FACE LOCK";
    else if (critical) delta = "CRITICAL";
    else if (driver.state === "RECOVERING") delta = "RECOVERING";
    else if (warning) delta = "DEGRADED";
    else if (attention < 65) delta = "DRIFTING";
    text(ui.attentionDelta, delta);
    ui.attentionDelta.style.color = critical
      ? "var(--coral)"
      : warning
        ? "var(--amber)"
        : driver.state === "RECOVERING"
          ? "var(--teal)"
          : "";

    const risk = clamp(Number(driver.risk) || 0, 0, 100);
    text(ui.fatigueValue, pct(risk));
    ui.fatigueBar.style.width = `${risk}%`;
    ui.fatigueBar.style.background = critical
      ? "linear-gradient(90deg, #e05358, #ff7b7e)"
      : warning
        ? "linear-gradient(90deg, #d89134, #ffc36b)"
        : "linear-gradient(90deg, var(--teal-deep), var(--teal))";

    text(ui.earValue, Number(driver.ear).toFixed(3));
    text(ui.marValue, Number(driver.mar).toFixed(2));
    text(ui.headValue, `${Number(driver.yaw) < 0 ? "−" : ""}${Math.abs(Number(driver.yaw) || 0).toFixed(1)}°`);
    text(ui.headNote, `Yaw · pitch ${signed(driver.pitch, 1)}°`);
    text(
      ui.earNote,
      Number(driver.ear) < 0.23 ? "Closure below threshold" : Number(driver.ear) < 0.26 ? "Eyelid flutter" : "Open · within band",
    );
    text(
      ui.marNote,
      Number(driver.mar) > 0.65 ? "Yawn signature" : Number(driver.mar) > 0.32 ? "Elevated" : "Relaxed",
    );

    text(ui.stageLabel, `LEVEL ${level} · ${String(safety.label).toUpperCase()}`);
    text(ui.stageAction, level === 0 ? "No intervention required" : safety.action);
    text(ui.stageRule, safety.rule || "");
    ui.escalationFill.style.width = `${(level / 4) * 100}%`;
    ui.escalationFill.style.background =
      level >= 4
        ? "linear-gradient(90deg, #d89134, #ff7b7e)"
        : level >= 2
          ? "linear-gradient(90deg, #d89134, #ffc36b)"
          : "linear-gradient(90deg, var(--teal-deep), var(--teal))";

    $$(".esc-step", ui.escalationTrack).forEach((button) => {
      const stage = Number(button.dataset.stage);
      button.classList.toggle("complete", stage < level);
      button.classList.toggle("is-active", stage === level);
    });

    text(ui.decisionModeChip, safety.actuation_mode === "MANUAL" ? "MANUAL CONTROL" : "AUTO DECISION");

    const scenario = snap.meta.scenario;
    const demoRunning = !!scenario;
    ui.demoButton.disabled = demoRunning && !scenario ? false : demoRunning;
    ui.stopDemoButton.disabled = !demoRunning;
    if (demoRunning) {
      ui.demoProgress.hidden = false;
      ui.demoProgressBar.style.width = `${clamp(Number(scenario.progress) || 0, 0, 100)}%`;
      const labelEl = qs("b", ui.demoButton);
      const smallEl = qs("small", ui.demoButton);
      text(labelEl, "Fatigue cascade active");
      text(smallEl, `${scenario.elapsed_s}s / ${scenario.duration_s}s · LEVEL ${level}`);
      if (ui.demoButton) ui.demoButton.classList.add("is-running");
    } else {
      ui.demoProgress.hidden = true;
      ui.demoProgressBar.style.width = "0%";
      const labelEl = qs("b", ui.demoButton);
      const smallEl = qs("small", ui.demoButton);
      text(labelEl, "Run fatigue demo");
      text(smallEl, "46-second safety cascade");
      if (ui.demoButton) ui.demoButton.classList.remove("is-running");
    }
  }

  function renderActuator(snap) {
    const actuators = snap.actuators;
    const mode = actuators.mode;
    const alert = actuators.alert;
    const motor = actuators.motor;
    const manual = mode === "MANUAL";
    const count = (alert.on ? 1 : 0) + (motor.on ? 1 : 0);

    ui.alertOutputRow.classList.toggle("is-on", !!alert.on);
    ui.motorOutputRow.classList.toggle("is-on", !!motor.on);
    const card = actuatorCard();
    if (card) {
      card.classList.toggle("is-manual", manual);
      card.classList.toggle("has-output", count > 0);
    }
    ui.actuatorModeButton.classList.toggle("is-manual", manual);
    text(ui.actuatorModeLabel, mode);

    ui.alertToggle.classList.toggle("is-on", !!alert.on);
    ui.alertToggle.setAttribute("aria-checked", String(!!alert.on));
    ui.motorToggle.classList.toggle("is-on", !!motor.on);
    ui.motorToggle.setAttribute("aria-checked", String(!!motor.on));

    text(ui.motorPwmValue, alert.pattern === "IDLE" && !motor.on ? "0" : motor.power);
    text(ui.motorPercent, `${motor.percent}%`);
    if (document.activeElement !== ui.motorRange) ui.motorRange.value = String(motor.power);
    ui.motorRange.disabled = !manual;
    ui.motorRange.title = manual ? "Manual PWM torque" : "Engage manual override to adjust torque";

    text(ui.alertPattern, alert.pattern);
    text(ui.activeOutputCount, count);

    if (manual) {
      html(ui.actuatorModeHint, `${ICON("i-lock")}Manual override active · safety guard bypassed`);
      html(ui.overrideButton, `Re-arm auto guard ${ICON("i-arrow-right")}`);
    } else {
      html(ui.actuatorModeHint, `${ICON("i-lock")}Auto guard interlocks manual controls`);
      html(ui.overrideButton, `Manual override ${ICON("i-arrow-right")}`);
    }
    text(ui.drawerActuatorMode, manual ? "MANUAL OVERRIDE" : "AUTO GUARD");
  }

  function renderEvents(snap) {
    const events = snap.events || [];
    const signature = events.map((event) => `${event.id}:${event.acknowledged ? 1 : 0}`).join("|");
    if (signature !== app.eventsSignature) {
      app.eventsSignature = signature;
      ui.eventList.replaceChildren();
      if (!events.length) {
        const empty = document.createElement("div");
        empty.className = "event-empty";
        empty.textContent = "NO EVENTS RECORDED";
        ui.eventList.appendChild(empty);
      } else {
        events.slice(0, 7).forEach((event) => ui.eventList.appendChild(eventNode(event)));
      }
      ui.responseLedger.replaceChildren();
      if (!events.length) {
        const empty = document.createElement("div");
        empty.className = "event-empty";
        empty.textContent = "BLACKBOX EMPTY";
        ui.responseLedger.appendChild(empty);
      } else {
        events.slice(0, 30).forEach((event) => ui.responseLedger.appendChild(eventNode(event)));
      }
    }
    text(ui.eventCount, `${snap.counters.events} EVENT${snap.counters.events === 1 ? "" : "S"}`);
  }

  function eventNode(event) {
    const row = document.createElement("div");
    row.className = `event-item${event.acknowledged ? "" : " is-unread"}`;
    row.dataset.severity = event.severity || "info";
    row.title = event.detail || "";

    const icon = document.createElement("span");
    icon.className = "event-icon";
    icon.innerHTML = ICON(iconForEvent(event));

    const copy = document.createElement("span");
    copy.className = "event-copy";
    const title = document.createElement("strong");
    title.textContent = event.title || "System event";
    const detail = document.createElement("small");
    detail.textContent = event.detail || "";
    copy.append(title, detail);

    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = fmtTime(event.ts);

    row.append(icon, copy, time);
    return row;
  }

  function renderIncident(snap) {
    const incident = snap.incident;
    const safety = snap.safety;
    const active = !!incident.active;
    ui.incidentBanner.classList.toggle("is-active", active);
    ui.resolveButton.disabled = !active;

    if (active) {
      text(ui.incidentTitle, "Emergency protocol latched");
      text(
        ui.incidentDescription,
        `${incident.id} · ${incident.cause}. Powertrain ${snap.vehicle.engine.toLowerCase()}; snapshot captured and response agencies placed on notice.`,
      );
      text(ui.incidentId, incident.id || "—");
      text(ui.incidentAge, fmtAge(incident.age_s));
      text(ui.incidentDriver, String(snap.driver.state || "").replace(/_/g, " "));
      text(ui.incidentTelegram, incident.telegram.status);
      text(ui.responseInlineStatus, "INCIDENT ACTIVE · AGENCIES ON NOTICE");
      const dot = qs("i", ui.responseInlineStatus);
      if (dot) {
        dot.style.background = "var(--coral)";
        dot.style.boxShadow = "0 0 8px rgba(255,123,126,.65)";
      }
    } else {
      text(ui.incidentTitle, "No active incident");
      text(
        ui.incidentDescription,
        safety.level >= 2
          ? `Safety level ${safety.level} · ${safety.label}. Cabin intervention is active and the incident ledger is recording.`
          : "All safety layers are operating normally. Response agencies are on standby and the uplink is armed.",
      );
      text(ui.incidentId, "—");
      text(ui.incidentAge, "00:00");
      text(ui.incidentDriver, String(snap.driver.state || "ATTENTIVE").replace(/_/g, " "));
      text(ui.incidentTelegram, incident.telegram.status);
      text(ui.responseInlineStatus, "ALL AGENCIES ON STANDBY");
      const dot = qs("i", ui.responseInlineStatus);
      if (dot) {
        dot.style.background = "";
        dot.style.boxShadow = "";
      }
    }

    text(ui.engineStateBig, snap.vehicle.engine);
    ui.engineStateBig.style.color = snap.vehicle.engine === "HALTED" ? "var(--coral)" : "var(--text)";
    text(ui.remoteSpeed, Math.round(Number(snap.vehicle.speed_kph) || 0));
    ui.haltButton.disabled = snap.vehicle.engine === "HALTED";
    ui.runButton.disabled = snap.vehicle.engine === "RUNNING";
    ui.telegramButton.disabled = !active;
  }

  function renderAgencies(snap) {
    const agencies = snap.agencies || [];
    agencies.forEach((agency) => {
      const row = qs(`[data-agency="${agency.id}"]`, ui.agencyList);
      if (!row) return;
      const status = qs("[data-agency-status]", row);
      if (status) {
        const tone = agency.tone === "critical" ? "is-critical" : agency.tone === "warn" ? "is-warn" : agency.tone === "ok" ? "is-ok" : "";
        status.className = `agency-status${tone ? " " + tone : ""}`;
        text(status, String(agency.status).toUpperCase());
      }
      const button = qs("[data-alert-agency]", row);
      if (button) text(button, agency.status === "NOTIFIED" ? "Resend" : "Alert");
    });
  }

  function renderTelegram(snap) {
    const incident = snap.incident;
    const configured = !!snap.meta.telegram_configured;
    const tg = incident.telegram;
    const active = !!incident.active;

    ui.tgStatus.classList.toggle("is-live", configured);
    text(ui.tgStatus, configured ? (active ? tg.status : "ARMED") : "SANDBOX");
    text(ui.tgMode, tg.mode || (configured ? "LIVE" : "SIMULATION"));
    text(ui.tgTarget, configured ? "CONFIGURED VIA ENV" : "NOT CONFIGURED");
    text(ui.tgLastAttempt, tg.last_sent ? fmtTime(tg.last_sent) : "—");
    ui.telegramButton.disabled = !active;

    const hw = snap.actuators.hardware;
    text(ui.hardwareShort, hw.connected ? `SERIAL · ${hw.port}` : "SIMULATED OUTPUTS");
    text(ui.drawerPort, hw.connected ? `${hw.port} · 9600 BAUD` : hw.enabled ? "SCAN · NO SERIAL DEVICE" : "SIMULATED · 9600 BAUD");
    text(ui.drawerHardwareStatus, hw.connected ? "CONNECTED" : hw.enabled ? "NO LINK" : "SIMULATED");
    setToneChip(ui.drawerHardwareStatus, !!hw.connected);
    text(ui.hardwareConnectButton, hw.connected ? "Reconnect" : "Connect");
    ui.hardwareTestButton.disabled = !hw.connected;
    ui.hardwareDisconnectButton.disabled = !hw.connected;

    const gemini = !!(snap.meta && snap.meta.gemini_configured);
    text(ui.drawerTelegramMode, configured ? "LIVE CREDENTIALS" : "SIMULATION");
    setToneChip(ui.drawerTelegramStatus, configured);
    text(ui.drawerTelegramStatus, configured ? "LIVE" : "SANDBOX");
    text(ui.drawerGeminiMode, gemini ? "GEMINI 2.5 FLASH" : "OFFLINE FALLBACK");
  }

  function renderAnalytics(snap) {
    const counters = snap.counters;
    const risk = clamp(Number(snap.driver.risk) || 0, 0, 100);
    text(ui.kpiBlinks, counters.blinks);
    text(ui.kpiMicrosleeps, counters.microsleeps);
    text(ui.analyticsRiskLegend, pct(risk));

    const cutoff = (Number(snap.meta.server_epoch_ms) || Date.now()) - 90000;
    const windowSamples = app.samples.filter((sample) => sample.t >= cutoff);
    const meanRisk = windowSamples.length
      ? windowSamples.reduce((total, sample) => total + (Number(sample.risk) || 0), 0) / windowSamples.length
      : risk;
    ui.kpiRiskExposure.replaceChildren();
    ui.kpiRiskExposure.append(document.createTextNode(String(Math.round(meanRisk))));
    const small = document.createElement("small");
    small.textContent = "%";
    ui.kpiRiskExposure.appendChild(small);

    const events = (snap.events || []).filter((event) => Number(event.epoch_ms) >= cutoff);
    text(ui.analyticsMarkerCount, events.length);
  }

  function renderCopilotContext(snap) {
    const driver = snap.driver;
    const safety = snap.safety;
    const incident = snap.incident;
    text(ui.ctxDriver, String(driver.state || "").replace(/_/g, " "));
    text(ui.ctxAttention, `${Math.round(Number(driver.attention) || 0)} / 100`);
    text(ui.ctxFatigue, pct(driver.risk));
    text(ui.ctxSafety, `${safety.level} · ${String(safety.label).toUpperCase()}`);
    text(ui.ctxClosure, `${Number(driver.unresponsive_s || 0).toFixed(1)} s`);
    text(ui.ctxEngine, snap.vehicle.engine);
    text(ui.ctxIncident, incident.active ? incident.id : "NONE");
    text(ui.ctxUplink, incident.telegram.status || (snap.meta.telegram_configured ? "ARMED" : "SANDBOX"));
  }

  function renderHardware(snap) {
    const hw = snap.actuators.hardware;
    text(ui.hardwareShort, hw.connected ? `SERIAL · ${hw.port}` : "SIMULATED OUTPUTS");
    text(ui.drawerHardwareStatus, hw.connected ? "CONNECTED" : hw.enabled ? "NO LINK" : "SIMULATED");
    setToneChip(ui.drawerHardwareStatus, !!hw.connected);
    ui.hardwareConnectButton.textContent = hw.connected ? "Reconnect" : "Connect";
    ui.hardwareTestButton.disabled = !hw.connected;
    ui.hardwareDisconnectButton.disabled = !hw.connected;
  }

  function updateCharts() {
    const snap = app.snap;
    if (!snap) return;
    const driver = snap.driver;
    text(ui.trendEar, Number(driver.ear).toFixed(3));
    text(ui.trendMar, Number(driver.mar).toFixed(2));
    text(ui.trendRisk, pct(driver.risk));

    let status = "Thresholds nominal";
    if (Number(driver.ear) < 0.23) status = "EAR below drowsiness threshold";
    else if (Number(driver.mar) > 0.65) status = "MAR above yawn threshold";
    else if (driver.head_direction && driver.head_direction !== "FORWARD") status = `Head pose · ${driver.head_direction}`;
    text(ui.chartStatusLine, status);

    if (app.trendChart) app.trendChart.setData(app.samples);
    if (app.analyticsChart) app.analyticsChart.setData(app.samples, snap.events || []);
  }

  function renderCopilotMeta() {
    const snap = app.snap;
    if (!snap) return;
    const configured = !!snap.meta.gemini_configured;
    const fallback = app.copilotSource === "tactical-fallback";
    const source = configured && !fallback ? "GEMINI 2.5 FLASH" : "OFFLINE TACTICAL";
    text(ui.copilotModeChip, source);
    text(ui.copilotSourceStatus, configured && !fallback ? "GEMINI LINK READY" : "TACTICAL FALLBACK READY");
    const dot = qs("i", ui.copilotSourceStatus);
    if (dot) {
      dot.style.background = configured && !fallback ? "var(--teal)" : "var(--amber)";
      dot.style.boxShadow = `0 0 8px ${configured && !fallback ? "rgba(110,232,210,.55)" : "rgba(255,195,107,.5)"}`;
    }
  }

  /* -------------------------------------------------------------- countdowns */
  function tickClock() {
    const now = new Date();
    text(ui.clockTime, fmtClock(now));
    text(ui.clockDate, fmtDate(now));
    text(ui.visionTimestamp, `${fmtClock(now)}.${String(now.getMilliseconds()).padStart(3, "0")}`);

    if (app.snap) {
      const uptime = app.uptimeBase + Math.max(0, (Date.now() - app.uptimeMark) / 1000);
      text(ui.uptimeShort, fmtTimer(uptime));
      text(ui.kpiUptime, fmtTimer(uptime));
      const age = Date.now() - app.lastStateAt;
      text(ui.contextUpdated, age < 2400 ? "just now" : age < 60000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60000)}m ago`);

      if (app.snap.incident.active) {
        const since = Date.parse(app.snap.incident.since || "");
        if (!Number.isNaN(since)) {
          text(ui.incidentAge, fmtAge((Date.now() - since) / 1000));
        }
      }
    }
  }

  /* ------------------------------------------------------------------- toasts */
  function toast(title, body, tone, ms) {
    if (!ui.toastStack) return;
    const kind = tone || "success";
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.tone = kind;
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    const symbol = kind === "danger" ? "i-shield-alert" : kind === "warning" ? "i-alert" : kind === "info" ? "i-grid" : "i-check";
    icon.innerHTML = ICON(symbol);
    const copy = document.createElement("span");
    copy.className = "toast-copy";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = body || "";
    copy.append(strong);
    if (body) copy.append(detail);
    node.append(icon, copy);
    ui.toastStack.appendChild(node);
    while (ui.toastStack.children.length > 4) ui.toastStack.firstElementChild.remove();
    window.setTimeout(() => {
      node.classList.add("is-out");
      window.setTimeout(() => node.remove(), 280);
    }, ms || (kind === "danger" ? 6200 : 4200));
  }

  function announceCritical(events) {
    let newest = null;
    for (const event of events) {
      if (!app.seenEvents.has(event.id)) {
        app.seenEvents.add(event.id);
        if (!newest && event.severity === "critical") newest = event;
      }
    }
    if (newest) toast(newest.title, newest.detail, "danger", 6200);
  }

  /* -------------------------------------------------------------------- busy */
  async function withBusy(button, task, errorTitle) {
    if (!button) {
      try {
        await task();
      } catch (err) {
        toast(errorTitle || "Command failed", err.message || String(err), "danger");
      }
      return;
    }
    if (button.dataset.busy === "1") return;
    button.dataset.busy = "1";
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    try {
      await task();
    } catch (err) {
      toast(errorTitle || "Command failed", err.message || String(err), "danger");
    } finally {
      button.dataset.busy = "";
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
    }
  }

  /* ----------------------------------------------------------------- confirms */
  function confirmAction(options) {
    const opts = options || {};
    if (app.confirmResolver) return Promise.resolve(false);
    text(ui.confirmTitle, opts.title || "Confirm command");
    text(ui.confirmBody, opts.body || "This command affects the physical actuator bench.");
    text(ui.confirmAccept, opts.accept || "Confirm");
    ui.confirmAccept.classList.toggle("danger-button", opts.tone !== "normal");
    ui.confirmAccept.classList.toggle("primary-button", opts.tone === "normal");
    const use = qs("use", ui.confirmIcon);
    if (use) use.setAttribute("href", opts.icon || (opts.tone === "normal" ? "#i-check" : "#i-alert"));
    ui.confirmScrim.hidden = false;
    window.setTimeout(() => ui.confirmCancel.focus(), 30);
    return new Promise((resolve) => {
      app.confirmResolver = (answer) => {
        app.confirmResolver = null;
        ui.confirmScrim.hidden = true;
        resolve(answer);
      };
    });
  }

  function resolveConfirm(answer) {
    if (app.confirmResolver) app.confirmResolver(!!answer);
  }

  /* --------------------------------------------------------------- navigation */
  function navigate(view, push) {
    if (!VIEW_META[view]) view = "cockpit";
    app.view = view;
    $$(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
    $$(".view").forEach((panel) => {
      const active = panel.dataset.panel === view;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    text(ui.pageTitle, VIEW_META[view].title);
    text(ui.pageSubtitle, VIEW_META[view].subtitle);
    document.title = `${VIEW_META[view].title} · DRISHTI`;
    if (ui.mainCanvas) ui.mainCanvas.scrollTop = 0;
    if (push) {
      try {
        history.pushState({ view }, "", `#${view}`);
      } catch (_) {
        /* file:// or restricted history */
      }
    }
    window.setTimeout(() => {
      if (app.trendChart) app.trendChart.draw();
      if (app.analyticsChart) app.analyticsChart.draw();
    }, 80);
  }

  function bindNavigation() {
    $$(".nav-item").forEach((button) => {
      button.addEventListener("click", () => navigate(button.dataset.view, true));
    });
    window.addEventListener("popstate", () => {
      const view = (location.hash || "").replace("#", "");
      navigate(VIEW_META[view] ? view : "cockpit", false);
    });
    ui.notificationButton.addEventListener("click", () => navigate("response", true));
    ui.openLedgerButton.addEventListener("click", () => {
      navigate("response", true);
      window.setTimeout(() => {
        const card = ui.responseLedger.closest(".card");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 140);
    });
  }

  /* ------------------------------------------------------------------ drawer */
  let drawerCloseTimer = 0;
  function openDrawer() {
    window.clearTimeout(drawerCloseTimer);
    ui.drawerScrim.hidden = false;
    ui.systemDrawer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      ui.drawerScrim.classList.add("is-open");
      ui.systemDrawer.classList.add("is-open");
    });
    window.setTimeout(() => ui.closeSystem.focus(), 60);
  }

  function closeDrawer() {
    ui.drawerScrim.classList.remove("is-open");
    ui.systemDrawer.classList.remove("is-open");
    ui.systemDrawer.setAttribute("aria-hidden", "true");
    window.clearTimeout(drawerCloseTimer);
    drawerCloseTimer = window.setTimeout(() => {
      ui.drawerScrim.hidden = true;
    }, 320);
  }

  function bindDrawer() {
    ui.openSystem.addEventListener("click", openDrawer);
    ui.closeSystem.addEventListener("click", closeDrawer);
    ui.drawerScrim.addEventListener("click", closeDrawer);
    ui.hardwareConnectButton.addEventListener("click", () => {
      withBusy(
        ui.hardwareConnectButton,
        async () => {
          const result = await apiJson("/api/hardware/connect", { method: "POST" });
          if (result.ok) toast("Arduino connected", `${result.port} · 9600 baud · DMS/1`, "success");
          else toast("No controller detected", result.error || "Check the USB cable and serial permissions.", "warning", 5600);
          refreshSoon();
        },
        "Hardware connection failed",
      );
    });
    ui.hardwareTestButton.addEventListener("click", () => {
      withBusy(
        ui.hardwareTestButton,
        async () => {
          await apiJson("/api/hardware/test", { method: "POST" });
          toast("Controller responded", "DMS/1 heartbeat acknowledged.", "success");
          refreshSoon();
        },
        "Ping failed",
      );
    });
    ui.hardwareDisconnectButton.addEventListener("click", () => {
      withBusy(
        ui.hardwareDisconnectButton,
        async () => {
          await apiJson("/api/hardware/disconnect", { method: "POST" });
          toast("Controller disconnected", "Outputs returned to the safe state.", "info");
          refreshSoon();
        },
        "Disconnect failed",
      );
    });
  }

  /* ------------------------------------------------------------------ actions */
  function bindActions() {
    ui.demoButton.addEventListener("click", () => {
      withBusy(
        ui.demoButton,
        async () => {
          await control("scenario", { scenario: "fatigue" });
          toast("Fatigue cascade armed", "46-second scripted sequence. Watch the escalation ladder and actuator bus.", "warning");
          refreshSoon();
        },
        "Could not start demo",
      );
    });

    ui.stopDemoButton.addEventListener("click", () => {
      withBusy(
        ui.stopDemoButton,
        async () => {
          await control("scenario", { scenario: "stop", reset: true });
          toast("Demo stopped", "Vehicle and agencies returned to nominal simulation.", "info");
          refreshSoon();
        },
        "Could not stop demo",
      );
    });

    ui.ackButton.addEventListener("click", () => {
      withBusy(
        ui.ackButton,
        async () => {
          const result = await control("acknowledge");
          toast("Events acknowledged", `${result.acknowledged} event${result.acknowledged === 1 ? "" : "s"} marked reviewed.`, "success");
          refreshSoon();
        },
        "Acknowledgement failed",
      );
    });

    ui.visionToggle.addEventListener("click", () => {
      withBusy(
        ui.visionToggle,
        async () => {
          if (app.live) {
            await apiJson("/api/vision/stop", { method: "POST" });
            toast("Live vision stopped", "Synthetic infrared feed restored.", "info");
          } else {
            await apiJson("/api/vision/start", { method: "POST" });
            setLiveFeed(true);
            toast("Live vision online", "FaceLandmarker is streaming from CAM 01.", "success");
          }
          refreshSoon();
        },
        app.live ? "Could not stop camera" : "Camera unavailable",
      );
    });

    ui.expandVision.addEventListener("click", () => {
      const expanded = ui.visionStage.classList.toggle("is-expanded");
      document.body.style.overflow = expanded ? "hidden" : "";
      ui.expandVision.setAttribute("aria-label", expanded ? "Collapse camera view" : "Expand camera view");
      window.setTimeout(() => {
        if (app.trendChart) app.trendChart.draw();
      }, 60);
    });

    ui.liveFeed.addEventListener("error", () => {
      if (!app.live || app.feedErrorShown) return;
      app.feedErrorShown = true;
      toast("Camera stream interrupted", "Synthetic cockpit remains available. Try re-enabling live vision.", "warning", 5200);
    });
    ui.liveFeed.addEventListener("load", () => {
      app.feedErrorShown = false;
    });

    ui.snapshotButton.addEventListener("click", () => withBusy(ui.snapshotButton, downloadSnapshot, "Snapshot failed"));
    ui.snapshotButton2.addEventListener("click", () => withBusy(ui.snapshotButton2, downloadSnapshot, "Snapshot failed"));
    ui.reportButton.addEventListener("click", () => withBusy(ui.reportButton, downloadReport, "Export failed"));
    ui.analyticsReportButton.addEventListener("click", () => withBusy(ui.analyticsReportButton, downloadReport, "Export failed"));

    ui.venueButton.addEventListener("click", () => {
      window.open("https://maps.google.com/?q=25.6193,85.1415", "_blank", "noopener");
    });

    ui.copyCoordsButton.addEventListener("click", async () => {
      try {
        await copyText("25.6193, 85.1415");
        toast("Coordinates copied", "25.6193° N, 85.1415° E", "success");
      } catch (_) {
        toast("Copy failed", "Select the coordinate text manually.", "warning");
      }
    });

    ui.actuatorModeButton.addEventListener("click", () => toggleActuatorMode());
    ui.overrideButton.addEventListener("click", () => toggleActuatorMode());
    ui.alertToggle.addEventListener("click", () => {
      setOutput("alert", !(app.snap && app.snap.actuators.alert.on), ui.alertToggle);
    });
    ui.motorToggle.addEventListener("click", () => {
      setOutput("motor", !(app.snap && app.snap.actuators.motor.on), ui.motorToggle);
    });
    ui.motorRange.addEventListener("input", () => {
      if (!app.snap || app.snap.actuators.mode !== "MANUAL") return;
      const value = Number(ui.motorRange.value);
      text(ui.motorPwmValue, value);
      text(ui.motorPercent, `${Math.round((value / 255) * 100)}%`);
    });
    ui.motorRange.addEventListener("change", () => {
      const value = Number(ui.motorRange.value);
      withBusy(
        ui.motorRange,
        async () => {
          await control("motor_power", { value });
          refreshSoon();
        },
        "Torque update failed",
      );
    });

    ui.telegramButton.addEventListener("click", () => {
      const configured = app.snap && app.snap.meta.telegram_configured;
      withBusy(
        ui.telegramButton,
        async () => {
          const approved = await confirmAction({
            title: "Transmit emergency packet?",
            body: configured
              ? "This will send the cabin snapshot, GPS fix, vehicle ID and venue route to the configured Telegram chat."
              : "No credentials are configured, so this runs the full packet flow in sandbox mode and logs the attempt. Nothing leaves the laptop.",
            accept: configured ? "Transmit" : "Run sandbox",
            icon: "i-telegram",
          });
          if (!approved) return;
          const result = await control("telegram");
          if (result.status === "SENT") {
            toast("Telegram packet delivered", "Snapshot, telemetry and venue route transmitted.", "success", 5200);
          } else if (result.status === "SIMULATED") {
            toast("Sandbox transmission complete", result.detail || "Configure credentials in .env for live delivery.", "warning", 6200);
          } else {
            toast("Transmission failed", result.detail || "Telegram rejected the packet.", "danger", 6200);
          }
          refreshSoon();
        },
        "Uplink error",
      );
    });

    ui.haltButton.addEventListener("click", () => {
      withBusy(
        ui.haltButton,
        async () => {
          const approved = await confirmAction({
            title: "Halt powertrain?",
            body: "This latches the software interlock, logs a critical control event and marks the vehicle as secured. A physical throttle cut requires an additional relay.",
            accept: "Halt powertrain",
            icon: "i-power",
          });
          if (!approved) return;
          await control("engine", { value: "HALTED" });
          toast("Powertrain interlocked", "Remote STOP latched and written to the audit ledger.", "danger");
          refreshSoon();
        },
        "Powertrain command failed",
      );
    });

    ui.runButton.addEventListener("click", () => {
      withBusy(
        ui.runButton,
        async () => {
          const incidentOpen = app.snap && app.snap.incident.active;
          if (incidentOpen) {
            const approved = await confirmAction({
              title: "Release interlock?",
              body: "An incident is still open. Confirm that the driver has been visually checked and it is safe to release the powertrain.",
              accept: "Release interlock",
              icon: "i-play",
            });
            if (!approved) return;
          }
          await control("engine", { value: "RUNNING" });
          toast("Interlock released", "Powertrain returned to operator control.", "success");
          refreshSoon();
        },
        "Release failed",
      );
    });

    ui.resolveButton.addEventListener("click", () => {
      withBusy(
        ui.resolveButton,
        async () => {
          const approved = await confirmAction({
            title: "Resolve incident?",
            body: "This closes the incident, returns all agencies to standby and resets the powertrain interlock. Confirm the driver is responsive and the scene is secure.",
            accept: "Resolve incident",
            tone: "normal",
            icon: "i-check",
          });
          if (!approved) return;
          const result = await control("resolve_incident");
          toast("Incident resolved", `${result.incident_id || "Incident"} closed. Agencies returned to standby.`, "success");
          refreshSoon();
        },
        "Could not resolve incident",
      );
    });

    ui.responseDrillButton.addEventListener("click", () => {
      withBusy(
        ui.responseDrillButton,
        async () => {
          await control("scenario", { scenario: "fatigue" });
          navigate("response", true);
          toast("Critical drill started", "Agencies will be placed on notice when Level 4 latches.", "warning");
          refreshSoon();
        },
        "Drill failed",
      );
    });

    ui.agencyList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-alert-agency]");
      if (!button) return;
      const agency = button.dataset.alertAgency;
      withBusy(
        button,
        async () => {
          const result = await control("alert_agency", { agency });
          toast(`${result.agency.name} notified`, "Incident brief and live telemetry handed off.", "warning");
          refreshSoon();
        },
        "Agency alert failed",
      );
    });

    ui.intercomSend.addEventListener("click", () => broadcastIntercom(ui.intercomInput.value));
    ui.intercomInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        broadcastIntercom(ui.intercomInput.value);
      }
    });
    ui.promptSuggestions = ui.promptSuggestions;
    $$("[data-intercom]").forEach((button) => {
      button.addEventListener("click", () => {
        ui.intercomInput.value = button.dataset.intercom;
        broadcastIntercom(button.dataset.intercom);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (app.confirmResolver) {
        resolveConfirm(false);
        return;
      }
      if (ui.visionStage.classList.contains("is-expanded")) {
        ui.expandVision.click();
        return;
      }
      if (ui.systemDrawer.classList.contains("is-open")) closeDrawer();
    });

    $$(ui.chartLegend ? "[data-series]" : "[data-series]", ui.chartLegend || document).forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.series;
        if (!key) return;
        const active = !button.classList.contains("is-active");
        const buttons = $$("[data-series]", ui.chartLegend);
        if (!active && buttons.filter((item) => item.classList.contains("is-active")).length <= 1) return;
        button.classList.toggle("is-active", active);
        if (app.trendChart) app.trendChart.setVisible({ [key]: active });
      });
    });

    $$("[data-analytics-series]", ui.analyticsTabs).forEach((button) => {
      button.addEventListener("click", () => {
        $$("[data-analytics-series]", ui.analyticsTabs).forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        if (app.analyticsChart) app.analyticsChart.setSeries(button.dataset.analyticsSeries);
      });
    });
  }

  async function toggleActuatorMode() {
    const mode = app.snap ? app.snap.actuators.mode : "AUTO";
    if (mode === "AUTO") {
      const approved = await confirmAction({
        title: "Engage manual override?",
        body: "Manual mode bypasses the automatic safety guard. The D5 haptic motor and D9 cabin alert will only respond to operator commands until auto guard is re-armed.",
        accept: "Engage override",
        icon: "i-sliders",
      });
      if (!approved) return;
      withBusy(
        ui.actuatorModeButton,
        async () => {
          await control("actuator_mode", { value: "MANUAL" });
          toast("Manual override engaged", "Automatic safety guard is bypassed. Re-arm it when finished.", "warning", 5600);
          refreshSoon();
        },
        "Mode change failed",
      );
      return;
    }
    withBusy(
      ui.actuatorModeButton,
      async () => {
        // Release physical outputs before returning authority to the guard.
        await control("actuator", { target: "motor", value: false });
        await control("actuator", { target: "alert", value: false });
        await control("actuator_mode", { value: "AUTO" });
        toast("Auto guard re-armed", "Actuator outputs returned to the escalation ladder.", "success");
        refreshSoon();
      },
      "Could not re-arm auto guard",
    );
  }

  async function setOutput(target, on, button) {
    if (!app.snap) return;
    if (app.snap.actuators.mode !== "MANUAL") {
      const approved = await confirmAction({
        title: "Engage manual override?",
        body: "The automatic safety guard currently owns this output. Engaging manual override is required before operating the actuator bench.",
        accept: "Engage override",
        icon: "i-sliders",
      });
      if (!approved) return;
      try {
        await control("actuator_mode", { value: "MANUAL" });
      } catch (err) {
        toast("Override failed", err.message, "danger");
        return;
      }
      refreshSoon(120);
    }
    // A zero slider value would energise the driver at 0% duty. Treat it as
    // "use the demo default" so the operator always gets visible feedback.
    const sliderPower = Number(ui.motorRange.value);
    const power = target === "motor" ? (sliderPower > 0 ? sliderPower : 160) : undefined;
    withBusy(
      button,
      async () => {
        await control("actuator", { target, value: on, power });
        toast(
          target === "alert" ? (on ? "Cabin alert energised" : "Cabin alert released") : on ? "Haptic actuator energised" : "Haptic actuator released",
          target === "alert" ? "D9 · buzzer and indicator LED" : `ENA PWM ${on ? power : 0}/255 · L298N`,
          on ? "warning" : "info",
        );
        refreshSoon();
      },
      "Actuator command failed",
    );
  }

  /* --------------------------------------------------------------- snapshots */
  async function downloadSnapshot() {
    const response = await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snapshot" }),
      cache: "no-store",
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch (_) {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    downloadBlob(blob, `drishti-snapshot-${stampName()}.jpg`);
    toast("Snapshot saved", "Cabin frame captured to the operator downloads folder.", "success");
  }

  async function downloadReport() {
    const response = await fetch("/api/report", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    downloadBlob(blob, `drishti-session-${stampName()}.json`);
    toast("Session report exported", "Full telemetry, event ledger and incident history.", "success");
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function stampName() {
    const now = new Date();
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy rejected");
  }

  /* ----------------------------------------------------------------- intercom */
  function speakCabin(message) {
    const line = String(message || "").trim();
    if (!line) {
      toast("Broadcast empty", "Type a short instruction for the cabin speaker.", "warning");
      return false;
    }
    if (!("speechSynthesis" in window)) return false;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(line);
      utterance.rate = 0.92;
      utterance.pitch = 0.94;
      utterance.volume = 1;
      const voices = window.speechSynthesis.getVoices();
      const voice =
        voices.find((item) => /en[-_]IN/i.test(item.lang)) ||
        voices.find((item) => /en[-_]GB/i.test(item.lang)) ||
        voices.find((item) => /en[-_]US/i.test(item.lang));
      if (voice) utterance.voice = voice;
      const shell = qs(".intercom-control");
      utterance.onstart = () => shell && shell.classList.add("is-speaking");
      utterance.onend = () => shell && shell.classList.remove("is-speaking");
      utterance.onerror = () => shell && shell.classList.remove("is-speaking");
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (_) {
      return false;
    }
  }

  function broadcastIntercom(raw) {
    const message = String(raw || "").trim();
    if (!message) {
      toast("Broadcast empty", "Type a short instruction for the cabin speaker.", "warning");
      return;
    }
    const spoken = speakCabin(message);
    withBusy(
      ui.intercomSend,
      async () => {
        await control("intercom", { message });
        toast(
          "Cabin broadcast sent",
          spoken ? `Speech synthesis: “${message}”` : "Message logged; speech synthesis is unavailable in this browser.",
          "warning",
          5200,
        );
        refreshSoon();
      },
      "Intercom failed",
    );
  }

  /* ------------------------------------------------------------------ copilot */
  const WELCOME_TEXT =
    "Good afternoon. I have the live cabin feed, biometric stream and escalation state in context.\n\nAsk me for a status brief, an escalation rationale, or a hand-off message for the response agencies.";

  function bindCopilot() {
    ui.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      sendChat(ui.chatInput.value);
    });
    ui.chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendChat(ui.chatInput.value);
      }
    });
    ui.chatInput.addEventListener("input", autoGrowChat);
    ui.clearChatButton.addEventListener("click", () => {
      if (app.chatPending) return;
      app.chatHistory = [];
      app.copilotSource = null;
      ui.chatLog.replaceChildren();
      appendChatMessage("assistant", WELCOME_TEXT);
      text(ui.copilotLatency, "READY");
      renderCopilotMeta();
      toast("Copilot thread reset", "Live telemetry context remains injected.", "info");
      autoGrowChat();
    });
    ui.copilotInfo.addEventListener("click", () => {
      toast(
        "Copilot context",
        "Reads sanitised telemetry at 4 Hz: driver state, EAR/MAR, escalation level, actuator mode and incident status. It has no write access.",
        "info",
        5600,
      );
    });
    $$("[data-prompt]", ui.promptSuggestions).forEach((button) => {
      button.addEventListener("click", () => {
        ui.chatInput.value = button.dataset.prompt;
        autoGrowChat();
        sendChat(button.dataset.prompt);
      });
    });
  }

  function autoGrowChat() {
    ui.chatInput.style.height = "auto";
    ui.chatInput.style.height = `${Math.min(96, Math.max(28, ui.chatInput.scrollHeight))}px`;
  }

  function appendChatMessage(role, content) {
    const row = document.createElement("div");
    row.className = `chat-row ${role}`;
    const avatar = document.createElement("span");
    avatar.className = "chat-avatar";
    avatar.innerHTML = ICON(role === "user" ? "i-user" : "i-spark");
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    const meta = document.createElement("span");
    meta.className = "chat-meta";
    meta.textContent = `${role === "user" ? "OPERATOR" : "DRISHTI COPILOT"} · ${fmtClock()}`;
    bubble.appendChild(meta);

    const chunks = String(content || "").split(/\n{2,}/);
    chunks.forEach((chunk) => {
      const lines = chunk.split("\n").filter((line) => line.trim() !== "");
      if (!lines.length) return;
      if (lines.every((line) => /^•\s+/.test(line.trim()))) {
        const list = document.createElement("ul");
        lines.forEach((line) => {
          const item = document.createElement("li");
          item.textContent = line.trim().replace(/^•\s+/, "");
          list.appendChild(item);
        });
        bubble.appendChild(list);
      } else {
        lines.forEach((line) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = line;
          bubble.appendChild(paragraph);
        });
      }
    });
    row.append(avatar, bubble);
    ui.chatLog.appendChild(row);
    scrollChat();
    return row;
  }

  function showTyping() {
    if (qs("#copilotTyping", ui.chatLog)) return;
    const row = document.createElement("div");
    row.id = "copilotTyping";
    row.className = "chat-row assistant is-typing";
    const avatar = document.createElement("span");
    avatar.className = "chat-avatar";
    avatar.innerHTML = ICON("i-spark");
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    const meta = document.createElement("span");
    meta.className = "chat-meta";
    meta.textContent = "DRISHTI COPILOT · THINKING";
    const dots = document.createElement("div");
    dots.className = "typing-dots";
    dots.innerHTML = "<i></i><i></i><i></i>";
    bubble.append(meta, dots);
    row.append(avatar, bubble);
    ui.chatLog.appendChild(row);
    scrollChat();
  }

  function hideTyping() {
    const row = qs("#copilotTyping", ui.chatLog);
    if (row) row.remove();
  }

  function scrollChat() {
    requestAnimationFrame(() => {
      ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
    });
  }

  async function sendChat(raw) {
    const message = String(raw || "").trim();
    if (!message || app.chatPending) return;
    app.chatPending = true;
    ui.chatSend.disabled = true;
    ui.chatInput.value = "";
    autoGrowChat();
    appendChatMessage("user", message);
    const history = app.chatHistory.slice(-8);
    showTyping();

    try {
      const result = await apiJson("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      hideTyping();
      const source = result.source || "tactical-fallback";
      app.copilotSource = source;
      app.chatHistory.push({ role: "user", content: message });
      app.chatHistory.push({ role: "assistant", content: result.reply || "" });
      if (app.chatHistory.length > 16) app.chatHistory = app.chatHistory.slice(-16);
      appendChatMessage("assistant", result.reply || "No response was produced.");
      const ms = Number(result.latency_ms) || 0;
      const label = source === "tactical-fallback" ? "TACTICAL" : "GEMINI";
      text(ui.copilotLatency, ms ? `${label} · ${ms} MS` : `${label} · READY`);
      renderCopilotMeta();
    } catch (err) {
      hideTyping();
      appendChatMessage(
        "assistant",
        "I could not reach the reasoning service. The local cockpit remains authoritative — check the incident ledger and safety ladder before acting.",
      );
      text(ui.copilotLatency, "OFFLINE");
      toast("Copilot unavailable", err.message || "Network request failed.", "warning");
    } finally {
      app.chatPending = false;
      ui.chatSend.disabled = false;
      ui.chatInput.focus();
    }
  }

  /* ------------------------------------------------------------------- charts */
  function buildOrbitTicks() {
    const ns = "http://www.w3.org/2000/svg";
    const g = ui.orbitTicks;
    if (!g || g.childElementCount) return;
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const major = i % 5 === 0;
      const r1 = 95;
      const r2 = major ? 101 : 98.3;
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(110 + Math.cos(angle) * r1));
      line.setAttribute("y1", String(110 + Math.sin(angle) * r1));
      line.setAttribute("x2", String(110 + Math.cos(angle) * r2));
      line.setAttribute("y2", String(110 + Math.sin(angle) * r2));
      if (major) line.setAttribute("class", "major");
      g.appendChild(line);
    }
  }

  function initCharts() {
    if (!window.DrishtiCharts) return;
    app.trendChart = new window.DrishtiCharts.TrendChart(ui.trendChart);
    app.analyticsChart = new window.DrishtiCharts.AnalyticsChart(ui.analyticsChart);
  }

  /* -------------------------------------------------------------------- boot */
  function bindInputs() {
    // Keep the browser from submitting forms on stray Enter presses.
    $$("form").forEach((form) => form.addEventListener("submit", (event) => event.preventDefault()));
    ui.chatForm.removeEventListener("submit", () => {});
  }

  async function bootstrap() {
    UI_IDS.forEach((id) => {
      ui[id] = $(id);
    });
    ui.mainCanvas = qs(".main-canvas");
    ui.visionCard = qs(".vision-card");

    ui.confirmAccept.addEventListener("click", () => resolveConfirm(true));
    ui.confirmCancel.addEventListener("click", () => resolveConfirm(false));
    ui.confirmScrim.addEventListener("click", (event) => {
      if (event.target === ui.confirmScrim) resolveConfirm(false);
    });

    buildOrbitTicks();
    bindNavigation();
    bindActions();
    bindCopilot();
    bindDrawer();
    bindInputs();
    if (ui.chatForm) {
      // bindCopilot added the real submit handler; remove the generic preventDefault listener.
      ui.chatForm.addEventListener("submit", (event) => event.preventDefault());
    }
    initCharts();

    if (window.DemoFeed && ui.visionCanvas) {
      try {
        app.demoFeed = new window.DemoFeed(ui.visionCanvas);
      } catch (_) {
        app.demoFeed = null;
      }
    }

    const hash = (location.hash || "").replace("#", "");
    navigate(VIEW_META[hash] ? hash : "cockpit", false);

    tickClock();
    window.setInterval(tickClock, 1000);

    // Initial paint: state, history and hotspot URL in parallel.
    const [stateResult, historyResult, networkResult] = await Promise.allSettled([
      apiJson("/api/state"),
      apiJson("/api/history"),
      apiJson("/api/network"),
    ]);

    if (historyResult.status === "fulfilled" && historyResult.value && Array.isArray(historyResult.value.samples)) {
      app.samples = historyResult.value.samples;
    }
    if (networkResult.status === "fulfilled" && networkResult.value && networkResult.value.urls && networkResult.value.urls[0]) {
      app.networkUrl = networkResult.value.urls[0];
      text(ui.serverUrl, app.networkUrl);
    }

    if (stateResult.status === "fulfilled") {
      applySnapshot(stateResult.value);
    } else {
      text(ui.linkMode, "LINK LOST");
      text(ui.linkLatency, "retrying · edge node");
      toast("Telemetry link unavailable", "Retrying the local Flask edge node.", "warning", 5200);
    }

    if (ui.chatLog && !ui.chatLog.childElementCount) appendChatMessage("assistant", WELCOME_TEXT);
    autoGrowChat();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshHistory();
        refreshSoon(80);
      }
    });
    window.addEventListener("online", () => refreshSoon(80));

    app.pollTimer = window.setTimeout(poll, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
