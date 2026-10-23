/* DRISHTI · canvas signal charts.
   Two small, dependency-free renderers tuned for the command console:
   a 30-second cockpit stream and a 90-second session correlation view. */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const DPR_CAP = 2;

  const C = {
    teal: "#6ee8d2",
    tealDeep: "#2ebba6",
    amber: "#ffc36b",
    coral: "#ff7b7e",
    grid: "rgba(146, 193, 190, 0.075)",
    gridStrong: "rgba(146, 193, 190, 0.13)",
    text: "rgba(130, 151, 152, 0.9)",
    faint: "rgba(86, 107, 108, 0.85)",
    dot: "rgba(180, 215, 209, 0.7)",
  };

  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function font(size, weight) {
    return `${weight || 500} ${size}px 'JetBrains Mono', ui-monospace, monospace`;
  }

  class ChartBase {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this._resize = this._resize.bind(this);
      if (window.ResizeObserver) {
        this._observer = new ResizeObserver(this._resize);
        this._observer.observe(canvas.parentElement || canvas);
      } else {
        window.addEventListener("resize", this._resize);
      }
      this._resize();
    }

    _resize() {
      const host = this.canvas.parentElement;
      const rect = host ? host.getBoundingClientRect() : this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.draw();
    }

    _surface() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      return {
        w: this.width,
        h: this.height,
        left: 1,
        right: Math.max(2, this.width - 7),
        top: 6,
        bottom: Math.max(7, this.height - 6),
        ctx,
      };
    }

    _grid(s, rows, cols) {
      const { ctx, left, right, top, bottom } = s;
      ctx.save();
      ctx.lineWidth = 1;
      for (let i = 1; i < rows; i++) {
        const y = top + ((bottom - top) / rows) * i;
        ctx.strokeStyle = i % 2 === 0 ? C.grid : "rgba(146, 193, 190, 0.035)";
        ctx.setLineDash([1, 5]);
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y) + 0.5);
        ctx.lineTo(right, Math.round(y) + 0.5);
        ctx.stroke();
      }
      for (let i = 1; i < cols; i++) {
        const x = left + ((right - left) / cols) * i;
        ctx.strokeStyle = "rgba(146, 193, 190, 0.028)";
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, top);
        ctx.lineTo(Math.round(x) + 0.5, bottom);
        ctx.stroke();
      }
      ctx.restore();
    }

    _empty(message) {
      const { ctx, w, h } = this._surface ? this._surface() : { ctx: this.ctx, w: this.width, h: this.height };
      ctx.save();
      ctx.fillStyle = C.faint;
      ctx.font = font(7);
      ctx.textAlign = "center";
      ctx.fillText(message || "AWAITING TELEMETRY", w / 2, h / 2);
      ctx.restore();
    }

    _path(points, s, xOf, yOf) {
      const { ctx, top, bottom } = s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.left, top - 2, s.right - s.left, bottom - top + 4);
      ctx.clip();
      ctx.beginPath();
      let started = false;
      let lastT = 0;
      for (const p of points) {
        const x = xOf(p.t);
        const y = yOf(p.v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else if (p.t - lastT > 2400) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        lastT = p.t;
      }
      ctx.restore();
      return started;
    }
  }

  /* ------------------------------------------------------------------ trend */
  class TrendChart extends ChartBase {
    constructor(canvas) {
      super(canvas);
      this.samples = [];
      this.visible = { ear: true, mar: true };
      this.domain = 0.8;
      this.windowMs = 30000;
    }

    setData(samples) {
      this.samples = Array.isArray(samples) ? samples.slice(-160) : [];
      this.draw();
    }

    setVisible(visible) {
      this.visible = Object.assign({}, this.visible, visible);
      this.draw();
    }

    draw() {
      if (!this.width || !this.height || !this.samples) return;
      const s = this._surface();
      const { ctx, left, right, top, bottom } = s;
      const w = right - left;
      const h = bottom - top;
      const now = this.samples.length ? this.samples[this.samples.length - 1].t : Date.now();
      const start = now - this.windowMs;
      const domain = this.domain;
      const xOf = (t) => left + ((t - start) / this.windowMs) * w;
      const yOf = (v) => bottom - clamp(v / domain, 0, 1) * h;

      ctx.save();
      // Subtle right-edge fade gives the stream a sense of continuing.
      const fade = ctx.createLinearGradient(left, 0, right, 0);
      fade.addColorStop(0, "rgba(8, 16, 19, 0)");
      fade.addColorStop(0.82, "rgba(8, 16, 19, 0)");
      fade.addColorStop(1, "rgba(8, 16, 19, 0.55)");
      ctx.fillStyle = fade;
      ctx.fillRect(left, top, w, h);
      ctx.restore();

      this._grid(s, 4, 6);

      const pts = this.samples.filter((p) => p && Number.isFinite(p.t));

      const drawSeries = (key, color, threshold, fillOpacity) => {
        const points = pts.filter((p) => Number.isFinite(Number(p[key]))).map((p) => ({ t: p.t, v: Number(p[key]) }));
        if (points.length < 2) return;
        // Area wash first.
        if (fillOpacity > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top - 1, w, h + 2);
          ctx.clip();
          ctx.beginPath();
          ctx.moveTo(xOf(points[0].t), yOf(0));
          for (const p of points) {
            const x = xOf(p.t);
            const y = yOf(p.v);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(xOf(points[points.length - 1].t), yOf(0));
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, top, 0, bottom);
          grad.addColorStop(0, alpha(color, fillOpacity));
          grad.addColorStop(1, alpha(color, 0.005));
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.restore();
        }
        this._path(points, s, xOf, yOf);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.35;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = alpha(color, 0.45);
        ctx.shadowBlur = 5;
        this._path(points, s, xOf, yOf);
        ctx.stroke();
        ctx.restore();

        const last = points[points.length - 1];
        if (last.t >= start) {
          const lx = xOf(last.t);
          const ly = yOf(last.v);
          ctx.save();
          ctx.fillStyle = alpha(color, 0.13);
          ctx.beginPath();
          ctx.arc(lx, ly, 4.2, 0, TAU);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(lx, ly, 1.7, 0, TAU);
          ctx.fill();
          ctx.restore();
        }

        if (threshold != null) {
          const y = yOf(threshold);
          ctx.save();
          ctx.strokeStyle = alpha(color, 0.27);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(left, Math.round(y) + 0.5);
          ctx.lineTo(right, Math.round(y) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = font(5.4);
          ctx.fillStyle = alpha(color, 0.52);
          ctx.textAlign = "right";
          ctx.fillText(`THR ${threshold.toFixed(2)}`, right - 2, y - 3);
          ctx.restore();
        }
      };

      if (this.visible.mar) drawSeries("mar", C.amber, 0.65, 0.055);
      if (this.visible.ear) drawSeries("ear", C.teal, 0.23, 0.105);

      // Scan marker at the live edge.
      ctx.save();
      const edgeX = right - 0.5;
      const pulse = 0.25 + 0.2 * Math.sin(performance.now() / 460);
      ctx.strokeStyle = alpha(C.teal, pulse);
      ctx.beginPath();
      ctx.moveTo(edgeX, top);
      ctx.lineTo(edgeX, bottom);
      ctx.stroke();
      ctx.restore();

      if (!pts.length) {
        ctx.save();
        ctx.fillStyle = C.faint;
        ctx.font = font(6.4);
        ctx.textAlign = "center";
        ctx.fillText("SYNCHRONISING BIOMETRIC STREAM", left + w / 2, top + h / 2);
        ctx.restore();
      }
    }
  }

  /* --------------------------------------------------------------- analytics */
  class AnalyticsChart extends ChartBase {
    constructor(canvas) {
      super(canvas);
      this.samples = [];
      this.events = [];
      this.mode = "all";
      this.windowMs = 90000;
    }

    setData(samples, events) {
      this.samples = Array.isArray(samples) ? samples.slice(-220) : [];
      if (Array.isArray(events)) this.events = events;
      this.draw();
    }

    setSeries(mode) {
      this.mode = mode || "all";
      this.draw();
    }

    _series(kind) {
      const pts = this.samples.filter((p) => p && Number.isFinite(p.t));
      return pts
        .filter((p) => Number.isFinite(Number(p[kind])))
        .map((p) => ({ t: p.t, v: Number(p[kind]) }));
    }

    _line(points, s, xOf, yOf, color, width, fill) {
      if (points.length < 2) return;
      const { ctx, left, right, top, bottom } = s;
      if (fill) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top - 1, right - left, bottom - top + 2);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(xOf(points[0].t), bottom);
        for (const p of points) ctx.lineTo(xOf(p.t), yOf(p.v));
        ctx.lineTo(xOf(points[points.length - 1].t), bottom);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, top, 0, bottom);
        grad.addColorStop(0, alpha(color, fill));
        grad.addColorStop(1, alpha(color, 0));
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width || 1.4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (width > 1.5) {
        ctx.shadowColor = alpha(color, 0.35);
        ctx.shadowBlur = 5;
      }
      this._path(points, s, xOf, yOf);
      ctx.stroke();
      ctx.restore();
      const last = points[points.length - 1];
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(xOf(last.t), yOf(last.v), width > 1.5 ? 2 : 1.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    _threshold(s, value, domain, color, label) {
      const { ctx, left, right, top, bottom } = s;
      const y = bottom - clamp(value / domain, 0, 1) * (bottom - top);
      ctx.save();
      ctx.strokeStyle = alpha(color, 0.24);
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(right, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      if (label) {
        ctx.font = font(5.3);
        ctx.fillStyle = alpha(color, 0.52);
        ctx.textAlign = "left";
        ctx.fillText(label, left + 3, y - 3);
      }
      ctx.restore();
    }

    draw() {
      if (!this.width || !this.height || !this.samples) return;
      const s = this._surface();
      const { ctx, left, right, top, bottom } = s;
      const w = right - left;
      const h = bottom - top;
      const pts = this.samples.filter((p) => p && Number.isFinite(p.t));
      const end = pts.length ? pts[pts.length - 1].t : Date.now();
      const start = end - this.windowMs;
      const xOf = (t) => left + ((t - start) / this.windowMs) * w;
      const yFor = (domain) => (v) => bottom - clamp(v / domain, 0, 1) * h;

      ctx.save();
      ctx.fillStyle = "rgba(4, 9, 11, 0.16)";
      ctx.fillRect(left, top, w, h);
      ctx.restore();

      this._grid(s, 4, 8);

      // Event markers sit under the traces so they never obscure the waveform.
      const markerColors = {
        critical: C.coral,
        warning: C.amber,
        success: C.teal,
        info: "rgba(132, 184, 255, 0.55)",
      };
      for (const event of this.events || []) {
        const t = Number(event.epoch_ms);
        if (!Number.isFinite(t) || t < start || t > end) continue;
        const x = Math.round(xOf(t)) + 0.5;
        const tone = markerColors[event.severity] || markerColors.info;
        ctx.save();
        ctx.strokeStyle = alpha(tone.startsWith("#") ? tone : "#84b8ff", 0.17);
        ctx.setLineDash([1, 4]);
        ctx.beginPath();
        ctx.moveTo(x, top + 2);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = alpha(tone.startsWith("#") ? tone : "#84b8ff", 0.65);
        ctx.beginPath();
        ctx.moveTo(x, bottom - 3.5);
        ctx.lineTo(x + 2.2, bottom);
        ctx.lineTo(x - 2.2, bottom);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const mode = this.mode;
      if (mode === "ear") {
        this._threshold(s, 0.23, 0.52, C.amber, "EAR THRESHOLD 0.230");
        this._threshold(s, 0.30, 0.52, C.teal, null);
        this._line(this._series("ear"), s, xOf, yFor(0.52), C.teal, 1.7, 0.12);
      } else if (mode === "mar") {
        this._threshold(s, 0.65, 1.0, C.amber, "MAR THRESHOLD 0.650");
        this._line(this._series("mar"), s, xOf, yFor(1.0), C.amber, 1.7, 0.1);
      } else if (mode === "risk") {
        this._threshold(s, 30, 100, C.teal, "ADVISORY 30");
        this._threshold(s, 55, 100, C.amber, "ALERT 55");
        this._threshold(s, 75, 100, C.coral, "EMERGENCY 75");
        this._line(this._series("risk"), s, xOf, yFor(100), C.coral, 1.7, 0.12);
      } else {
        this._threshold(s, 0.65, 0.8, C.amber, null);
        this._line(this._series("risk"), s, xOf, yFor(100), C.coral, 1.0, 0);
        this._line(this._series("mar"), s, xOf, yFor(0.8), C.amber, 1.2, 0);
        this._line(this._series("ear"), s, xOf, yFor(0.8), C.teal, 1.6, 0.08);
        // Tiny scale key in the corner keeps the dual axes honest.
        ctx.save();
        ctx.font = font(5.1);
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255, 123, 126, 0.48)";
        ctx.fillText("RISK 0–100", right - 2, top + 8);
        ctx.fillStyle = "rgba(110, 232, 210, 0.38)";
        ctx.fillText("RATIO 0–0.8", right - 2, top + 16);
        ctx.restore();
      }

      if (!pts.length) {
        ctx.save();
        ctx.fillStyle = C.faint;
        ctx.font = font(7);
        ctx.textAlign = "center";
        ctx.fillText("SESSION BUFFER INITIALISING", left + w / 2, top + h / 2);
        ctx.restore();
      }

      // Left-edge time rail markers.
      ctx.save();
      ctx.font = font(5);
      ctx.fillStyle = "rgba(86, 107, 108, 0.5)";
      ctx.textAlign = "left";
      ctx.fillText("−90s", left + 2, bottom - 3);
      ctx.textAlign = "right";
      ctx.fillText("NOW", right - 2, bottom - 3);
      ctx.restore();
    }
  }

  window.DrishtiCharts = { TrendChart, AnalyticsChart };
})();
