/* DRISHTI · synthetic infrared cabin feed.
   A deliberately technical digital-twin visual for demo mode. The real
   MediaPipe stream replaces this canvas when Live Vision is enabled. */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  class DemoFeed {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.state = {
        ear: 0.305,
        mar: 0.18,
        yaw: -3.6,
        pitch: 2.8,
        risk: 19,
        face_locked: true,
      };
      this.smooth = { ear: 0.305, mar: 0.18, yaw: -3.6, pitch: 2.8, risk: 19 };
      this.noise = [];
      this.last = 0;
      this.running = false;
      this._resize = this._resize.bind(this);
      this._frame = this._frame.bind(this);
      if (window.ResizeObserver) {
        this._observer = new ResizeObserver(this._resize);
        this._observer.observe(canvas.parentElement || canvas);
      } else {
        window.addEventListener("resize", this._resize);
      }
      this._seedNoise();
      this._resize();
      this.start();
    }

    _seedNoise() {
      let seed = 41;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      this.noise = Array.from({ length: 74 }, () => ({
        x: rand(),
        y: rand(),
        r: rand() * 1.15 + 0.2,
        a: rand() * 0.32 + 0.04,
        p: rand() * TAU,
      }));
    }

    setState(state) {
      if (!state) return;
      this.state = state;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._raf = requestAnimationFrame(this._frame);
    }

    stop() {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
    }

    _resize() {
      const rect = this.canvas.parentElement
        ? this.canvas.parentElement.getBoundingClientRect()
        : this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _frame(now) {
      if (!this.running) return;
      // 30 FPS is plenty for the synthetic twin and saves exhibition CPU.
      if (now - this.last > 32) {
        this._draw(now / 1000);
        this.last = now;
      }
      this._raf = requestAnimationFrame(this._frame);
    }

    _palette() {
      const risk = this.smooth.risk;
      if (risk >= 78) return { line: "255, 123, 126", bright: "#ffb0ae", soft: "255, 95, 102" };
      if (risk >= 52) return { line: "255, 195, 107", bright: "#ffdc9d", soft: "255, 175, 76" };
      return { line: "110, 232, 210", bright: "#b5ffef", soft: "66, 207, 184" };
    }

    _draw(t) {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      if (!w || !h) return;
      const s = this.smooth;
      s.ear = lerp(s.ear, Number(this.state.ear) || 0, 0.11);
      s.mar = lerp(s.mar, Number(this.state.mar) || 0, 0.11);
      s.yaw = lerp(s.yaw, Number(this.state.yaw) || 0, 0.08);
      s.pitch = lerp(s.pitch, Number(this.state.pitch) || 0, 0.08);
      s.risk = lerp(s.risk, Number(this.state.risk) || 0, 0.07);

      const pal = this._palette();
      ctx.clearRect(0, 0, w, h);
      this._background(t, w, h);
      if (this.state.face_locked === false) {
        this._grain(t, w, h);
        return;
      }

      const cx = w * 0.515 + s.yaw * 0.95 + Math.sin(t * 0.48) * 1.4;
      const cy = h * 0.435 + (s.pitch - 4) * 0.72 + Math.sin(t * 0.7) * 1.1;
      const faceH = clamp(h * 0.5, 170, 285);
      const faceW = faceH * 0.72;
      const yawNorm = clamp(s.yaw / 38, -1, 1);
      const pitchNorm = clamp(s.pitch / 30, -1, 1.4);
      const blinkCycle = t % 4.9;
      const naturalBlink = blinkCycle < 0.13 ? clamp(blinkCycle / 0.04, 0, 1) * clamp((0.13 - blinkCycle) / 0.06, 0, 1) : 1;
      const openness = clamp((s.ear - 0.06) / 0.235, 0.035, 1.12) * (s.risk < 55 ? (naturalBlink > 0.45 ? naturalBlink : 1) : 1);

      this._cabin(t, w, h, cx, cy, faceW, faceH);
      this._silhouette(t, w, h, cx, cy, faceW, faceH, yawNorm, pitchNorm);
      this._face(t, w, h, cx, cy, faceW, faceH, yawNorm, pitchNorm, openness, pal);
      this._mesh(t, w, h, cx, cy, faceW, faceH, yawNorm, pitchNorm, openness, pal);
      this._targeting(t, w, h, cx, cy, faceW, faceH, pal);
      this._grain(t, w, h);
    }

    _background(t, w, h) {
      const ctx = this.ctx;
      const bg = ctx.createRadialGradient(w * 0.47, h * 0.4, 10, w * 0.5, h * 0.45, Math.max(w, h) * 0.7);
      bg.addColorStop(0, "#111b1e");
      bg.addColorStop(0.36, "#0a1215");
      bg.addColorStop(0.76, "#050a0c");
      bg.addColorStop(1, "#020506");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // A faint IR source bloom from the upper-left.
      const bloom = ctx.createRadialGradient(w * 0.24, h * 0.06, 0, w * 0.24, h * 0.06, h * 0.92);
      bloom.addColorStop(0, "rgba(102, 190, 177, 0.09)");
      bloom.addColorStop(0.35, "rgba(67, 135, 131, 0.025)");
      bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, w, h);

      // Cabin pillars.
      ctx.fillStyle = "rgba(1, 4, 5, 0.58)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.11, 0);
      ctx.bezierCurveTo(w * 0.065, h * 0.28, w * 0.055, h * 0.7, w * 0.12, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w, 0);
      ctx.lineTo(w * 0.87, 0);
      ctx.bezierCurveTo(w * 0.91, h * 0.25, w * 0.92, h * 0.7, w * 0.85, h);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      // Rain / light streaks outside the windscreen.
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.strokeStyle = "rgba(113, 173, 170, 0.23)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = h * (0.17 + i * 0.13);
        ctx.beginPath();
        ctx.moveTo(w * 0.13, y);
        ctx.bezierCurveTo(w * 0.34, y - 6, w * 0.65, y + 8, w * 0.87, y - 2);
        ctx.stroke();
      }
      ctx.restore();

      // Bokeh lights from the venue beyond the cabin.
      const lights = [
        [0.18, 0.28, 3.2], [0.25, 0.18, 1.5], [0.76, 0.24, 2.1],
        [0.83, 0.37, 3.8], [0.68, 0.15, 1.4], [0.3, 0.37, 2.4],
      ];
      lights.forEach(([x, y, r], i) => {
        const glow = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, r * 5);
        const alpha = 0.1 + Math.sin(t * 0.65 + i * 2.1) * 0.04;
        glow.addColorStop(0, `rgba(110, 205, 190, ${alpha})`);
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(w * x, h * y, r * 5, 0, TAU);
        ctx.fill();
      });

      // Dashboard / steering geometry.
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = "rgba(90, 126, 125, 0.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 1.02, w * 0.24, Math.PI * 1.07, Math.PI * 1.93);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 1.03, w * 0.183, Math.PI * 1.04, Math.PI * 1.96);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.32, h * 0.95);
      ctx.quadraticCurveTo(w * 0.5, h * 0.85, w * 0.68, h * 0.95);
      ctx.stroke();
      ctx.restore();

      // Vignette to keep attention at the face.
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.46, h * 0.15, w * 0.5, h * 0.5, w * 0.65);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(0.62, "rgba(0,0,0,0.18)");
      vig.addColorStop(1, "rgba(0,0,0,0.74)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }

    _cabin(t, w, h, cx, cy, fw, fh) {
      const ctx = this.ctx;
      // Seat / shoulders. Deliberately low contrast, infrared-like.
      const shoulderY = cy + fh * 0.52;
      const grad = ctx.createLinearGradient(0, shoulderY, 0, h);
      grad.addColorStop(0, "rgba(38, 51, 53, 0.48)");
      grad.addColorStop(0.55, "rgba(16, 24, 26, 0.74)");
      grad.addColorStop(1, "rgba(3, 7, 8, 0.95)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - fw * 1.55, h);
      ctx.bezierCurveTo(cx - fw * 1.34, shoulderY + 8, cx - fw * 0.82, shoulderY - 8, cx - fw * 0.32, shoulderY - 18);
      ctx.lineTo(cx + fw * 0.32, shoulderY - 18);
      ctx.bezierCurveTo(cx + fw * 0.82, shoulderY - 8, cx + fw * 1.34, shoulderY + 8, cx + fw * 1.55, h);
      ctx.closePath();
      ctx.fill();

      // Jacket seams.
      ctx.strokeStyle = "rgba(133, 179, 175, 0.075)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - fw * 0.38, shoulderY - 2);
      ctx.bezierCurveTo(cx - fw * 0.52, shoulderY + 30, cx - fw * 0.57, shoulderY + 70, cx - fw * 0.6, h);
      ctx.moveTo(cx + fw * 0.38, shoulderY - 2);
      ctx.bezierCurveTo(cx + fw * 0.52, shoulderY + 30, cx + fw * 0.57, shoulderY + 70, cx + fw * 0.6, h);
      ctx.stroke();

      // Steering wheel foreground.
      ctx.save();
      ctx.globalAlpha = 0.64;
      const wheelGrad = ctx.createLinearGradient(0, h - 110, 0, h);
      wheelGrad.addColorStop(0, "rgba(54, 70, 70, 0.66)");
      wheelGrad.addColorStop(1, "rgba(9, 14, 15, 0.94)");
      ctx.strokeStyle = wheelGrad;
      ctx.lineWidth = Math.max(9, w * 0.013);
      ctx.beginPath();
      ctx.ellipse(cx, h + h * 0.12, w * 0.29, h * 0.25, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(120, 160, 157, 0.11)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, h + h * 0.12, w * 0.29, h * 0.25, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.restore();

      // Neck.
      const neckGrad = ctx.createLinearGradient(cx - fw * 0.2, 0, cx + fw * 0.2, 0);
      neckGrad.addColorStop(0, "rgba(31, 43, 45, 0.7)");
      neckGrad.addColorStop(0.48, "rgba(78, 92, 91, 0.7)");
      neckGrad.addColorStop(1, "rgba(18, 27, 29, 0.8)");
      ctx.fillStyle = neckGrad;
      ctx.beginPath();
      ctx.moveTo(cx - fw * 0.22, cy + fh * 0.28);
      ctx.bezierCurveTo(cx - fw * 0.25, cy + fh * 0.44, cx - fw * 0.29, shoulderY - 20, cx - fw * 0.3, shoulderY - 15);
      ctx.lineTo(cx + fw * 0.3, shoulderY - 15);
      ctx.bezierCurveTo(cx + fw * 0.29, shoulderY - 20, cx + fw * 0.25, cy + fh * 0.44, cx + fw * 0.22, cy + fh * 0.28);
      ctx.closePath();
      ctx.fill();
    }

    _silhouette(t, w, h, cx, cy, fw, fh, yaw, pitch) {
      const ctx = this.ctx;
      const tilt = clamp(pitch * 0.0016 + Math.sin(t * 0.53) * 0.003, -0.06, 0.06);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.scale(1 - Math.abs(yaw) * 0.075, 1);

      // Hair / head cap.
      const hairGrad = ctx.createLinearGradient(-fw * 0.4, -fh * 0.48, fw * 0.35, fh * 0.1);
      hairGrad.addColorStop(0, "rgba(21, 29, 31, 0.98)");
      hairGrad.addColorStop(0.52, "rgba(42, 51, 52, 0.94)");
      hairGrad.addColorStop(1, "rgba(11, 17, 19, 0.96)");
      ctx.fillStyle = hairGrad;
      ctx.beginPath();
      ctx.ellipse(0, -fh * 0.03, fw * 0.485, fh * 0.46, 0, 0, TAU);
      ctx.fill();

      // Face volume.
      const skin = ctx.createLinearGradient(-fw * 0.4, -fh * 0.3, fw * 0.4, fh * 0.42);
      skin.addColorStop(0, "#263033");
      skin.addColorStop(0.32, "#3f4849");
      skin.addColorStop(0.62, "#283133");
      skin.addColorStop(1, "#0e1517");
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.moveTo(0, -fh * 0.44);
      ctx.bezierCurveTo(fw * 0.39, -fh * 0.4, fw * 0.49, -fh * 0.08, fw * 0.39, fh * 0.16);
      ctx.bezierCurveTo(fw * 0.3, fh * 0.38, fw * 0.14, fh * 0.49, 0, fh * 0.5);
      ctx.bezierCurveTo(-fw * 0.14, fh * 0.49, -fw * 0.3, fh * 0.38, -fw * 0.39, fh * 0.16);
      ctx.bezierCurveTo(-fw * 0.49, -fh * 0.08, -fw * 0.39, -fh * 0.4, 0, -fh * 0.44);
      ctx.fill();

      // Ear volumes.
      const earGrad = ctx.createLinearGradient(-fw * 0.5, 0, -fw * 0.34, 0);
      earGrad.addColorStop(0, "#1b2527");
      earGrad.addColorStop(1, "#303b3c");
      ctx.fillStyle = earGrad;
      ctx.beginPath();
      ctx.ellipse(-fw * 0.43, fh * 0.04, fw * 0.075, fh * 0.125, -0.12, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(fw * 0.43, fh * 0.04, fw * 0.075, fh * 0.125, 0.12, 0, TAU);
      ctx.fill();

      // Forehead / cheek IR highlights.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const highlight = ctx.createRadialGradient(-fw * 0.08, -fh * 0.2, 1, -fw * 0.04, -fh * 0.04, fw * 0.5);
      highlight.addColorStop(0, "rgba(163, 197, 192, 0.19)");
      highlight.addColorStop(0.55, "rgba(110, 146, 142, 0.055)");
      highlight.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.ellipse(0, 0, fw * 0.44, fh * 0.44, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Hair line readable as a soft silhouette.
      ctx.strokeStyle = "rgba(8, 12, 13, 0.76)";
      ctx.lineWidth = Math.max(8, fw * 0.035);
      ctx.beginPath();
      ctx.moveTo(-fw * 0.4, -fh * 0.14);
      ctx.bezierCurveTo(-fw * 0.34, -fh * 0.41, -fw * 0.12, -fh * 0.48, fw * 0.07, -fh * 0.45);
      ctx.bezierCurveTo(fw * 0.31, -fh * 0.42, fw * 0.42, -fh * 0.22, fw * 0.41, -fh * 0.08);
      ctx.stroke();
      ctx.restore();
    }

    _face(t, w, h, cx, cy, fw, fh, yaw, pitch, open, pal) {
      const ctx = this.ctx;
      const tilt = clamp(pitch * 0.0016 + Math.sin(t * 0.53) * 0.003, -0.06, 0.06);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.scale(1 - Math.abs(yaw) * 0.075, 1);
      const eyeY = -fh * 0.075;
      const eyeX = fw * 0.225;
      const yawShift = yaw * fw * 0.06;

      // Brows.
      ctx.strokeStyle = "rgba(10, 15, 16, 0.8)";
      ctx.lineWidth = Math.max(3, fw * 0.022);
      ctx.lineCap = "round";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * (eyeX - fw * 0.095) + yawShift * 0.4, eyeY - fh * 0.075);
        ctx.quadraticCurveTo(side * (eyeX + yawShift * 0.4), eyeY - fh * 0.115, side * (eyeX + fw * 0.105), eyeY - fh * 0.062);
        ctx.stroke();
      }

      // Eye sockets.
      for (const side of [-1, 1]) {
        const ex = side * eyeX + yawShift;
        ctx.fillStyle = "rgba(7, 11, 12, 0.56)";
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, fw * 0.14, fh * 0.055, 0, 0, TAU);
        ctx.fill();

        const openness = clamp(open, 0.035, 1);
        const hh = fh * 0.037 * openness;
        const eyeGlow = ctx.createRadialGradient(ex, eyeY, 1, ex, eyeY, fw * 0.16);
        eyeGlow.addColorStop(0, "rgba(224, 244, 238, 0.34)");
        eyeGlow.addColorStop(0.4, "rgba(178, 220, 212, 0.1)");
        eyeGlow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = eyeGlow;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, fw * 0.115, fh * 0.05, 0, 0, TAU);
        ctx.fill();

        if (open > 0.14) {
          // Almond shape around the sclera.
          ctx.fillStyle = "rgba(205, 220, 214, 0.72)";
          ctx.beginPath();
          ctx.moveTo(ex - fw * 0.1, eyeY);
          ctx.quadraticCurveTo(ex, eyeY - hh * 1.72, ex + fw * 0.1, eyeY);
          ctx.quadraticCurveTo(ex, eyeY + hh * 1.1, ex - fw * 0.1, eyeY);
          ctx.fill();

          // Iris follows a tiny amount of viewer/head movement.
          const irisX = ex + clamp(yaw * 0.14, -fw * 0.026, fw * 0.026);
          const iris = ctx.createRadialGradient(irisX, eyeY, 1, irisX, eyeY, fh * 0.028);
          iris.addColorStop(0, "#0a1112");
          iris.addColorStop(0.5, "#101c1e");
          iris.addColorStop(0.82, "#334344");
          iris.addColorStop(1, "rgba(80, 111, 108, 0.35)");
          ctx.fillStyle = iris;
          ctx.beginPath();
          ctx.arc(irisX, eyeY, fh * 0.028, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "rgba(3, 7, 8, 0.9)";
          ctx.beginPath();
          ctx.arc(irisX, eyeY, fh * 0.011, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "rgba(214, 244, 236, 0.55)";
          ctx.beginPath();
          ctx.arc(irisX - fh * 0.009, eyeY - fh * 0.009, 1.2, 0, TAU);
          ctx.fill();
        }

        // Upper lid / lashes close over the eye as EAR drops.
        ctx.strokeStyle = "rgba(11, 16, 17, 0.93)";
        ctx.lineWidth = Math.max(2.2, fw * 0.015);
        ctx.beginPath();
        ctx.moveTo(ex - fw * 0.11, eyeY + hh * 0.1);
        ctx.quadraticCurveTo(ex, eyeY - hh * 1.45 - fh * 0.022, ex + fw * 0.11, eyeY + hh * 0.05);
        ctx.stroke();
        ctx.strokeStyle = "rgba(10, 14, 15, 0.5)";
        ctx.lineWidth = Math.max(1, fw * 0.006);
        ctx.beginPath();
        ctx.moveTo(ex - fw * 0.09, eyeY + hh * 0.55);
        ctx.quadraticCurveTo(ex, eyeY + hh * 0.95, ex + fw * 0.09, eyeY + hh * 0.4);
        ctx.stroke();

        // Infra-red catchlight.
        ctx.fillStyle = "rgba(141, 223, 210, 0.16)";
        ctx.beginPath();
        ctx.arc(ex - fw * 0.012, eyeY - fh * 0.007, fh * 0.008, 0, TAU);
        ctx.fill();
      }

      // Nose: bridge highlight + nostril shadows.
      ctx.strokeStyle = "rgba(170, 195, 189, 0.13)";
      ctx.lineWidth = Math.max(1, fw * 0.007);
      ctx.beginPath();
      ctx.moveTo(-fw * 0.018, -fh * 0.015);
      ctx.bezierCurveTo(-fw * 0.045, fh * 0.085, -fw * 0.045, fh * 0.14, -fw * 0.07, fh * 0.155);
      ctx.bezierCurveTo(-fw * 0.02, fh * 0.185, fw * 0.045, fh * 0.185, fw * 0.07, fh * 0.155);
      ctx.stroke();
      ctx.fillStyle = "rgba(7, 11, 12, 0.38)";
      ctx.beginPath();
      ctx.ellipse(-fw * 0.052, fh * 0.16, fw * 0.027, fh * 0.012, -0.1, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(fw * 0.052, fh * 0.16, fw * 0.027, fh * 0.012, 0.1, 0, TAU);
      ctx.fill();

      // Mouth: aperture responds to MAR while retaining a human lip line.
      const mouthOpen = clamp((this.smooth.mar - 0.18) * 1.75, 0, 0.8);
      const mouthY = fh * 0.285;
      const lipW = fw * 0.18;
      ctx.strokeStyle = "rgba(14, 18, 19, 0.66)";
      ctx.lineWidth = Math.max(2, fw * 0.012);
      ctx.beginPath();
      ctx.moveTo(-lipW, mouthY);
      ctx.quadraticCurveTo(0, mouthY - fh * 0.01, lipW, mouthY);
      ctx.stroke();
      if (mouthOpen > 0.04) {
        ctx.fillStyle = "rgba(12, 8, 9, 0.58)";
        ctx.beginPath();
        ctx.ellipse(0, mouthY + fh * 0.01, lipW * 0.8, fh * 0.018 + mouthOpen * fh * 0.045, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "rgba(162, 125, 121, 0.12)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Lower lip highlight.
      ctx.strokeStyle = "rgba(192, 172, 164, 0.075)";
      ctx.lineWidth = Math.max(1, fw * 0.008);
      ctx.beginPath();
      ctx.moveTo(-lipW * 0.7, mouthY + fh * 0.044 + mouthOpen * fh * 0.03);
      ctx.quadraticCurveTo(0, mouthY + fh * 0.056 + mouthOpen * fh * 0.02, lipW * 0.7, mouthY + fh * 0.044 + mouthOpen * fh * 0.03);
      ctx.stroke();

      // Jaw shadow.
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = fw * 0.02;
      ctx.beginPath();
      ctx.moveTo(-fw * 0.25, fh * 0.29);
      ctx.quadraticCurveTo(0, fh * 0.5, fw * 0.25, fh * 0.29);
      ctx.stroke();
      ctx.restore();
    }

    _mesh(t, w, h, cx, cy, fw, fh, yaw, pitch, open, pal) {
      const ctx = this.ctx;
      const tilt = clamp(pitch * 0.0016 + Math.sin(t * 0.53) * 0.003, -0.06, 0.06);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.scale(1 - Math.abs(yaw) * 0.075, 1);
      const line = pal.line;
      const yawShift = yaw * fw * 0.06;

      // Outline vertices of the visible face mesh.
      const outline = [
        [0, -0.455], [0.17, -0.43], [0.32, -0.33], [0.4, -0.17], [0.435, 0.02],
        [0.41, 0.2], [0.33, 0.35], [0.2, 0.455], [0.06, 0.507], [-0.06, 0.507],
        [-0.2, 0.455], [-0.33, 0.35], [-0.41, 0.2], [-0.435, 0.02], [-0.4, -0.17],
        [-0.32, -0.33], [-0.17, -0.43],
      ].map(([x, y]) => [x * fw, y * fh]);
      const inner = [
        [0, -0.35], [0.135, -0.327], [0.252, -0.25], [0.316, -0.11], [0.33, 0.06],
        [0.287, 0.206], [0.18, 0.307], [0.055, 0.358], [-0.055, 0.358], [-0.18, 0.307],
        [-0.287, 0.206], [-0.33, 0.06], [-0.316, -0.11], [-0.252, -0.25], [-0.135, -0.327],
      ].map(([x, y]) => [x * fw, y * fh]);
      const nose = [
        [0, -0.255], [0, -0.13], [0, -0.02], [0.02, 0.09], [0.052, 0.155],
        [0, 0.18],
      ].map(([x, y]) => [x * fw, y * fh]);
      // Eye and mouth nodes match the face's approximate geometry.
      const eyeNodes = (side) => {
        const ex = side * fw * 0.225 + yawShift;
        const ey = -fh * 0.075;
        const hh = fh * 0.044;
        return [
          [ex - fw * 0.105, ey], [ex - fw * 0.06, ey - hh], [ex, ey - hh * 1.3],
          [ex + fw * 0.065, ey - hh], [ex + fw * 0.105, ey], [ex + fw * 0.06, ey + hh * 0.8],
          [ex, ey + hh], [ex - fw * 0.06, ey + hh * 0.8],
        ];
      };
      const leftEye = eyeNodes(-1);
      const rightEye = eyeNodes(1);
      const mouthNodes = Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * TAU;
        return [Math.cos(a) * fw * 0.16, fh * 0.285 + Math.sin(a) * fh * 0.023];
      });

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Glow pass.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = `rgba(${line}, 0.065)`;
      ctx.lineWidth = 4;
      this._polyline(outline, true);
      this._polyline(inner, true);
      ctx.restore();

      // Thin topographic lines.
      ctx.strokeStyle = `rgba(${line}, 0.21)`;
      ctx.lineWidth = 0.8;
      this._polyline(outline, true);
      this._polyline(inner, true);
      ctx.strokeStyle = `rgba(${line}, 0.15)`;
      ctx.lineWidth = 0.7;
      // Radial tesselation.
      for (let i = 0; i < outline.length - 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(outline[i][0], outline[i][1]);
        ctx.lineTo(inner[(i + 7) % inner.length][0], inner[(i + 7) % inner.length][1]);
        ctx.lineTo(nose[i % nose.length][0] * 0.65, nose[i % nose.length][1]);
        ctx.stroke();
      }
      // Brow / nose contour.
      ctx.strokeStyle = `rgba(${line}, 0.25)`;
      ctx.beginPath();
      ctx.moveTo(-fw * 0.32, -fh * 0.18);
      ctx.quadraticCurveTo(-fw * 0.19, -fh * 0.21, -fw * 0.075, -fh * 0.185);
      ctx.moveTo(fw * 0.32, -fh * 0.18);
      ctx.quadraticCurveTo(fw * 0.19, -fh * 0.21, fw * 0.075, -fh * 0.185);
      ctx.stroke();
      this._polyline(nose, false);
      this._polyline(leftEye, true);
      this._polyline(rightEye, true);
      this._polyline(mouthNodes, true);

      // Mesh points.
      const all = [...outline, ...inner, ...leftEye, ...rightEye, ...mouthNodes];
      for (let i = 0; i < all.length; i++) {
        const [x, y] = all[i];
        const bob = Math.sin(t * 1.7 + i) * 0.18;
        ctx.fillStyle = `rgba(${line}, ${i % 3 === 0 ? 0.65 : 0.32})`;
        ctx.beginPath();
        ctx.arc(x, y + bob, i % 7 === 0 ? 1.35 : 0.8, 0, TAU);
        ctx.fill();
      }

      // Head pose axis at the nose bridge.
      const ox = 0;
      const oy = -fh * 0.02;
      const axis = [
        [fw * 0.16, 0, "X", "132, 184, 255"],
        [0, -fh * 0.13, "Y", "110, 232, 210"],
        [fw * 0.06, -fh * 0.08, "Z", "255, 195, 107"],
      ];
      ctx.lineWidth = 1;
      axis.forEach(([dx, dy, label, color]) => {
        ctx.strokeStyle = `rgba(${color}, 0.45)`;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + dx - yaw * 0.2, oy + dy + pitch * 0.18);
        ctx.stroke();
      });

      // Eye status marker is rendered in DOM; this is a tiny active node.
      ctx.fillStyle = `rgba(${line}, 0.9)`;
      ctx.beginPath();
      ctx.arc(yawShift, -fh * 0.075, 1.4, 0, TAU);
      ctx.fill();

      ctx.restore();
    }

    _polyline(points, close) {
      const ctx = this.ctx;
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (close) ctx.closePath();
      ctx.stroke();
    }

    _targeting(t, w, h, cx, cy, fw, fh, pal) {
      const ctx = this.ctx;
      const color = pal.line;
      const x1 = cx - fw * 0.52;
      const x2 = cx + fw * 0.52;
      const y1 = cy - fh * 0.51;
      const y2 = cy + fh * 0.55;
      const size = Math.min(22, fw * 0.11);
      ctx.strokeStyle = `rgba(${color}, 0.72)`;
      ctx.lineWidth = 1.2;
      const corners = [
        [x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1],
      ];
      corners.forEach(([x, y, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * size);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * size, y);
        ctx.stroke();
      });

      // A slowly rotating tracking reticle around the face.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.045);
      ctx.strokeStyle = `rgba(${color}, 0.13)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 9]);
      ctx.beginPath();
      ctx.ellipse(0, fh * 0.015, fw * 0.61, fh * 0.54, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // Corner identification tag.
      const tag = "DRIVER 01 · FACE MESH";
      ctx.font = "500 9px 'JetBrains Mono', monospace";
      const tagW = ctx.measureText(tag).width + 18;
      ctx.fillStyle = "rgba(2, 8, 9, 0.66)";
      ctx.fillRect(x1, y1 - 22, tagW, 16);
      ctx.fillStyle = `rgba(${color}, 0.8)`;
      ctx.fillRect(x1, y1 - 22, 2, 16);
      ctx.fillStyle = "rgba(208, 235, 231, 0.72)";
      ctx.fillText(tag, x1 + 8, y1 - 11);
      ctx.fillStyle = `rgba(${color}, 0.7)`;
      ctx.font = "500 8px 'JetBrains Mono', monospace";
      ctx.fillText(`${this.smooth.risk >= 52 ? "FATIGUE WATCH" : "FACIAL LOCK"}`, x1, y2 + 17);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(137, 160, 159, 0.62)";
      ctx.fillText("468 PT / 3D", x2, y2 + 17);
      ctx.textAlign = "left";
    }

    _grain(t, w, h) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      this.noise.forEach((n) => {
        const flicker = 0.6 + Math.sin(t * 7 + n.p) * 0.4;
        ctx.fillStyle = `rgba(163, 211, 204, ${n.a * flicker})`;
        ctx.beginPath();
        ctx.arc(n.x * w, n.y * h, n.r, 0, TAU);
        ctx.fill();
      });
      // Sparse horizontal sensor scan artefacts.
      ctx.strokeStyle = "rgba(132, 202, 193, 0.025)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        const y = ((t * (i === 0 ? 14 : 7) + i * 190) % (h + 20)) - 10;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  window.DemoFeed = DemoFeed;
})();
