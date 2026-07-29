const NICE_SPACINGS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const MIN_LABEL_GAP_PX = 70;
const MIN_SCALE = 0.02;
const MAX_SCALE = 12;
const PIN_HIT_RADIUS = 20;
const PIN_ICON_HEIGHT = 24;

function pickSpacing(scale) {
  for (const s of NICE_SPACINGS) {
    if (s * scale >= MIN_LABEL_GAP_PX) return s;
  }
  return NICE_SPACINGS[NICE_SPACINGS.length - 1];
}

export class Grid {
  constructor(container, { dimensionColor = "#a78bfa" } = {}) {
    this.container = container;
    this.dimensionColor = dimensionColor;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "grid-canvas";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.readout = document.createElement("div");
    this.readout.className = "grid-readout";
    this.readout.style.color = this.dimensionColor;
    this.readout.hidden = true;
    container.appendChild(this.readout);

    // World coordinate currently at the screen center.
    this.centerX = 0;
    this.centerZ = 0;
    this.scale = 0.5; // screen px per block

    this.waypoints = [];

    this._dragging = false;
    this._dragMoved = false;
    this._dragStart = null;
    this._dragOriginCenter = null;

    this.onEmptyRightClick = null; // (worldX, worldZ) => void
    this.onEmptyClick = null; // () => void
    this.onPinClick = null; // (waypoint) => void
    this.onViewChange = null; // () => void
    this._jumpAnimation = null;

    this._bind();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this._raf = requestAnimationFrame(() => this.draw());
    document.fonts?.ready.then(() => this.draw());
  }

  setDimensionColor(color) {
    this.dimensionColor = color;
    this.readout.style.color = color;
    this.draw();
  }

  setWaypoints(waypoints) {
    this.waypoints = waypoints;
    this.draw();
  }

  recenter() {
    cancelAnimationFrame(this._jumpAnimation);
    this.centerX = 0;
    this.centerZ = 0;
    this.scale = 0.5;
    this.draw();
    this.onViewChange?.();
  }

  jumpTo(x, z) {
    cancelAnimationFrame(this._jumpAnimation);
    const start = { x: this.centerX, z: this.centerZ, scale: this.scale };
    const targetScale = Math.max(this.scale, 0.5);
    const startedAt = performance.now();
    const duration = 360;
    const step = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      this.centerX = start.x + (x - start.x) * eased;
      this.centerZ = start.z + (z - start.z) * eased;
      this.scale = start.scale + (targetScale - start.scale) * eased;
      this.draw();
      this.onViewChange?.();
      if (progress < 1) this._jumpAnimation = requestAnimationFrame(step);
    };
    this._jumpAnimation = requestAnimationFrame(step);
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.draw();
  }

  worldToScreen(wx, wz) {
    return {
      x: this.cssWidth / 2 + (wx - this.centerX) * this.scale,
      y: this.cssHeight / 2 + (wz - this.centerZ) * this.scale,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: this.centerX + (sx - this.cssWidth / 2) / this.scale,
      z: this.centerZ + (sy - this.cssHeight / 2) / this.scale,
    };
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      cancelAnimationFrame(this._jumpAnimation);
      this._dragging = true;
      this._dragMoved = false;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._dragOriginCenter = { x: this.centerX, z: this.centerZ };
      c.classList.add("dragging");
    });

    window.addEventListener("mousemove", (e) => {
      if (this._dragging) {
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._dragMoved = true;
      this.centerX = this._dragOriginCenter.x - dx / this.scale;
      this.centerZ = this._dragOriginCenter.z - dy / this.scale;
      this.draw();
      this.onViewChange?.();
      }

      const rect = c.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = this.screenToWorld(sx, sy);
        this.readout.hidden = false;
        this.readout.textContent = `x ${Math.round(w.x)}, z ${Math.round(w.z)}`;
        this.readout.style.left = `${Math.min(sx + 16, rect.width - 140)}px`;
        this.readout.style.top = `${Math.min(sy + 16, rect.height - 30)}px`;
      } else {
        this.readout.hidden = true;
      }
    });

    window.addEventListener("mouseup", () => {
      this._dragging = false;
      c.classList.remove("dragging");
    });

    c.addEventListener("mouseleave", () => {
      this.readout.hidden = true;
    });

    c.addEventListener("click", (e) => {
      if (this._dragMoved) return; // was a pan, not a click
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const hit = this._hitTestPin(sx, sy);
      if (hit) {
        this.onPinClick?.(hit);
      } else {
        this.onEmptyClick?.();
      }
    });

    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (this._hitTestPin(sx, sy)) return;
      const w = this.screenToWorld(sx, sy);
      this.onEmptyRightClick?.(Math.round(w.x), Math.round(w.z));
    });

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const before = this.screenToWorld(sx, sy);

        const factor = Math.exp(-e.deltaY * 0.001);
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));

        const after = this.screenToWorld(sx, sy);
        this.centerX += before.x - after.x;
        this.centerZ += before.z - after.z;
        this.draw();
        this.onViewChange?.();
      },
      { passive: false },
    );
  }

  zoomBy(factor) {
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    const before = this.screenToWorld(cx, cy);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const after = this.screenToWorld(cx, cy);
    this.centerX += before.x - after.x;
    this.centerZ += before.z - after.z;
    this.draw();
    this.onViewChange?.();
  }

  _hitTestPin(sx, sy) {
    for (let i = this.waypoints.length - 1; i >= 0; i--) {
      const wp = this.waypoints[i];
      const p = this.worldToScreen(wp.x, wp.z);
      const d = Math.hypot(p.x - sx, p.y - PIN_ICON_HEIGHT / 2 - sy);
      if (d <= PIN_HIT_RADIUS) return wp;
    }
    return null;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    ctx.clearRect(0, 0, w, h);

    const spacing = pickSpacing(this.scale);

    const worldLeft = this.centerX - w / 2 / this.scale;
    const worldRight = this.centerX + w / 2 / this.scale;
    const worldTop = this.centerZ - h / 2 / this.scale;
    const worldBottom = this.centerZ + h / 2 / this.scale;

    ctx.lineWidth = 1;
    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(200, 196, 224, 0.55)";

    // vertical lines (constant x)
    const startX = Math.floor(worldLeft / spacing) * spacing;
    for (let x = startX; x <= worldRight; x += spacing) {
      const sx = this.worldToScreen(x, 0).x;
      const isOrigin = x === 0;
      ctx.beginPath();
      ctx.strokeStyle = isOrigin ? this.dimensionColor : "rgba(255, 255, 255, 0.06)";
      ctx.globalAlpha = isOrigin ? 0.55 : 1;
      ctx.lineWidth = isOrigin ? 1.5 : 1;
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (x % spacing === 0) {
        ctx.fillStyle = isOrigin ? this.dimensionColor : "rgba(200, 196, 224, 0.5)";
        ctx.globalAlpha = isOrigin ? 0.85 : 1;
        ctx.fillText(`x ${x}`, sx + 4, 14);
        ctx.globalAlpha = 1;
      }
    }

    // horizontal lines (constant z)
    const startZ = Math.floor(worldTop / spacing) * spacing;
    for (let z = startZ; z <= worldBottom; z += spacing) {
      const sy = this.worldToScreen(0, z).y;
      const isOrigin = z === 0;
      ctx.beginPath();
      ctx.strokeStyle = isOrigin ? this.dimensionColor : "rgba(255, 255, 255, 0.06)";
      ctx.globalAlpha = isOrigin ? 0.55 : 1;
      ctx.lineWidth = isOrigin ? 1.5 : 1;
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(w, sy + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = isOrigin ? this.dimensionColor : "rgba(200, 196, 224, 0.5)";
      ctx.globalAlpha = isOrigin ? 0.85 : 1;
      ctx.fillText(`z ${z}`, 4, sy - 4 < 10 ? sy + 14 : sy - 4);
      ctx.globalAlpha = 1;
    }

    // waypoint pins
    const showLabels = spacing <= 250;
    for (const wp of this.waypoints) {
      const p = this.worldToScreen(wp.x, wp.z);
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;

      const color = wp.color || this.dimensionColor;
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.font = "900 24px 'Font Awesome 6 Free'";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.strokeStyle = "rgba(10, 10, 15, 0.9)";
      ctx.lineWidth = 2;
      ctx.strokeText("\uf3c5", p.x, p.y);
      ctx.fillText("\uf3c5", p.x, p.y);
      ctx.restore();

      if (showLabels) {
        ctx.fillStyle = "rgba(232, 230, 240, 0.9)";
        ctx.font = "12px 'Inter', system-ui, sans-serif";
        ctx.fillText(wp.name, p.x + 14, p.y + 4);
      }
    }
  }
}
