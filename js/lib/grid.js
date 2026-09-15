const NICE_SPACINGS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const MIN_LABEL_GAP_PX = 70;
const MIN_SCALE = 0.02;
const MAX_SCALE = 12;
const OVERWORLD_NETHER_RATIO = 8; // 1 nether block = 8 overworld blocks
const PIN_HIT_RADIUS = 20;
const PIN_HIT_RADIUS_TOUCH = 28;
const PIN_ICON_HEIGHT = 24;
const TOUCH_TAP_MOVE_THRESHOLD = 10;
const PLAYER_ANIM_DURATION_MS = 1000;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function pickSpacing(scale) {
  for (const s of NICE_SPACINGS) {
    if (s * scale >= MIN_LABEL_GAP_PX) return s;
  }
  return NICE_SPACINGS[NICE_SPACINGS.length - 1];
}

export class Grid {
  constructor(container, { dimensionColor = "#9683e0", defaultScale = 0.5 } = {}) {
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

    this.centerX = 0;
    this.centerZ = 0;
    this.defaultScale = defaultScale;
    this.scale = defaultScale;

    this.waypoints = [];
    this.selectedWaypoint = null;
    this.players = [];
    this.playerHeadCache = new Map();
    this.playerAnimations = new Map();
    this._playerAnimFrame = null;
    this.hoveredWaypoint = null;

    this._dragging = false;
    this._dragMoved = false;
    this._dragStart = null;
    this._dragOriginCenter = null;

    this._touchMode = null;
    this._touchMoved = false;
    this._touchDragStart = null;
    this._touchDragOriginCenter = null;
    this._pinchStartDist = null;
    this._pinchStartScale = null;
    this._pinchWorldAtMid = null;

    this.onEmptyRightClick = null;
    this.onEmptyClick = null;
    this.onEmptyTap = null;
    this.onPinClick = null;
    this.onViewChange = null;
    this._viewAnimation = null;

    this._boundVisibilityHandler = () => {
      if (document.hidden) {
        if (this._playerAnimFrame) { cancelAnimationFrame(this._playerAnimFrame); this._playerAnimFrame = null; }
      } else {
        this._ensurePlayerAnimationLoop();
      }
    };
    document.addEventListener("visibilitychange", this._boundVisibilityHandler);

    this._bind();
    this._resize();
    this._resizeRaf = null;
    new ResizeObserver(() => {
      // Coalesce rapid-fire observations (mobile browser chrome show/hide,
      // sidebar drawer transitions, etc.) into at most one resize per frame,
      // and never act on a transient zero-size reading - both used to cause
      // the canvas to visibly flash/shrink mid-transition.
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this._cachedRect = null;
        this._resize();
      });
    }).observe(container);
    this._raf = requestAnimationFrame(() => this.draw());
    document.fonts?.ready.then(() => this.draw());
  }

  setDimensionColor(color) {
    this.dimensionColor = color;
    this.readout.style.color = color;
    this.draw();
  }

  setDefaultScale(scale) {
    this.defaultScale = scale;
  }

  /**
   * Keep the "same place" when crossing overworld <-> nether: 1 nether block
   * equals 8 overworld blocks, so coordinates divide/multiply by 8 and the
   * zoom flips the same way so the visible world area stays the same.
   */
  convertView(fromDim, toDim) {
    let positionFactor = 1;
    if (fromDim === "overworld" && toDim === "nether") positionFactor = 1 / OVERWORLD_NETHER_RATIO;
    else if (fromDim === "nether" && toDim === "overworld") positionFactor = OVERWORLD_NETHER_RATIO;
    else return;
    this.centerX *= positionFactor;
    this.centerZ *= positionFactor;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale / positionFactor));
    this.draw();
    this.onViewChange?.();
  }

  setWaypoints(waypoints) {
    this.waypoints = waypoints;
    this.draw();
  }

  setSelectedWaypoint(wp) {
    this.selectedWaypoint = wp;
    this.draw();
  }

  setPlayers(players) {
    this.players = players;
    const now = performance.now();
    const incomingIds = new Set();

    for (const player of players) {
      incomingIds.add(player.id);

      if (!this.playerHeadCache.has(player.username)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => this.draw();
        img.src = `https://mc-heads.net/avatar/${encodeURIComponent(player.username)}/64`;
        this.playerHeadCache.set(player.username, img);
      }

      const prev = this.playerAnimations.get(player.id);
      if (!prev) {
        this.playerAnimations.set(player.id, {
          username: player.username,
          afk: player.afk,
          fromX: player.x,
          fromZ: player.z,
          toX: player.x,
          toZ: player.z,
          startTime: now,
          duration: 0,
        });
        continue;
      }

      const t = prev.duration > 0 ? Math.min(1, (now - prev.startTime) / prev.duration) : 1;
      const eased = easeOutCubic(t);
      const currentX = prev.fromX + (prev.toX - prev.fromX) * eased;
      const currentZ = prev.fromZ + (prev.toZ - prev.fromZ) * eased;

      this.playerAnimations.set(player.id, {
        username: player.username,
        afk: player.afk,
        fromX: currentX,
        fromZ: currentZ,
        toX: player.x,
        toZ: player.z,
        startTime: now,
        duration: PLAYER_ANIM_DURATION_MS,
      });
    }

    for (const id of [...this.playerAnimations.keys()]) {
      if (!incomingIds.has(id)) this.playerAnimations.delete(id);
    }

    const activeUsernames = new Set(players.map((p) => p.username));
    if (this.playerHeadCache.size > 100) {
      for (const key of this.playerHeadCache.keys()) {
        if (!activeUsernames.has(key) && this.playerHeadCache.size > 50) {
          this.playerHeadCache.delete(key);
        }
      }
    }

    this._ensurePlayerAnimationLoop();
    this.draw();
  }

  _currentPlayerPositions() {
    const now = performance.now();
    const positions = [];
    for (const anim of this.playerAnimations.values()) {
      const t = anim.duration > 0 ? Math.min(1, (now - anim.startTime) / anim.duration) : 1;
      const eased = easeOutCubic(t);
      positions.push({
        username: anim.username,
        afk: anim.afk, // <-- ADD THIS
        x: anim.fromX + (anim.toX - anim.fromX) * eased,
        z: anim.fromZ + (anim.toZ - anim.fromZ) * eased,
      });
    }
    return positions;
  }

  _ensurePlayerAnimationLoop() {
    if (this._playerAnimFrame) return;
    const step = () => {
      this.draw();
      const now = performance.now();
      const stillAnimating = [...this.playerAnimations.values()].some((a) => now - a.startTime < a.duration);
      this._playerAnimFrame = stillAnimating ? requestAnimationFrame(step) : null;
    };
    this._playerAnimFrame = requestAnimationFrame(step);
  }

  recenter() {
    cancelAnimationFrame(this._viewAnimation);
    const startX = this.centerX;
    const startZ = this.centerZ;
    const startScale = this.scale;
    const startedAt = performance.now();
    const duration = 500;
    const step = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = easeInOutCubic(progress);
      this.centerX = startX * (1 - eased);
      this.centerZ = startZ * (1 - eased);
      this.scale = startScale + (this.defaultScale - startScale) * eased;
      this.draw();
      this.onViewChange?.();
      if (progress < 1) this._viewAnimation = requestAnimationFrame(step);
    };
    this._viewAnimation = requestAnimationFrame(step);
  }

  jumpTo(x, z) {
    cancelAnimationFrame(this._viewAnimation);
    const startX = this.centerX;
    const startZ = this.centerZ;
    const startedAt = performance.now();
    const duration = 500;
    const step = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = easeInOutCubic(progress);
      this.centerX = startX + (x - startX) * eased;
      this.centerZ = startZ + (z - startZ) * eased;
      this.draw();
      this.onViewChange?.();
      if (progress < 1) this._viewAnimation = requestAnimationFrame(step);
    };
    this._viewAnimation = requestAnimationFrame(step);
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    // A transient 0×0 reading happens on some mobile browsers mid-transition
    // (address bar hiding/showing, sidebar drawer animating). Acting on it
    // would collapse the canvas to a 1px stub and "pop" back on the next
    // real reading - visible as the map briefly shrinking. Just skip it and
    // keep whatever we last drew at a valid size.
    if (rect.width < 2 || rect.height < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    // Setting canvas.width/height clears the canvas even when unchanged, so
    // skip it when nothing actually moved (avoids needless clear+redraw
    // churn while the ResizeObserver fires for unrelated reflows).
    const sizeChanged = this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight;
    if (sizeChanged) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
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
      cancelAnimationFrame(this._viewAnimation);
      this._dragging = true;
      this._dragMoved = false;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._dragOriginCenter = { x: this.centerX, z: this.centerZ };
      c.classList.add("dragging");
    });

    this._mouseRafPending = false;
    this._lastMouseEvent = null;
    this._cachedRect = null;
    this._cachedRectTime = 0;

    window.addEventListener("mousemove", (e) => {
      this._lastMouseEvent = e;
      if (!this._mouseRafPending) {
        this._mouseRafPending = true;
        requestAnimationFrame(() => {
          this._mouseRafPending = false;
          const ev = this._lastMouseEvent;
          if (!ev) return;
          if (this._dragging) {
            const dx = ev.clientX - this._dragStart.x;
            const dy = ev.clientY - this._dragStart.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._dragMoved = true;
            this.centerX = this._dragOriginCenter.x - dx / this.scale;
            this.centerZ = this._dragOriginCenter.z - dy / this.scale;
          }

          const now = performance.now();
          if (!this._cachedRect || now - this._cachedRectTime > 100) {
            this._cachedRect = c.getBoundingClientRect();
            this._cachedRectTime = now;
          }
          const rect = this._cachedRect;
          if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
            const sx = ev.clientX - rect.left;
            const sy = ev.clientY - rect.top;
            const w = this.screenToWorld(sx, sy);
            const hoveredWaypoint = this._hitTestPin(sx, sy);
            if (hoveredWaypoint !== this.hoveredWaypoint) {
              this.hoveredWaypoint = hoveredWaypoint;
            }
            this.readout.hidden = false;
            this.readout.textContent = `x ${Math.round(w.x)}, z ${Math.round(w.z)}`;
          } else {
            if (this.hoveredWaypoint) {
              this.hoveredWaypoint = null;
            }
            this.readout.hidden = true;
          }
          this.draw();
          this.onViewChange?.();
        });
      }
    });

    window.addEventListener("mouseup", () => {
      this._dragging = false;
      c.classList.remove("dragging");
    });

    c.addEventListener("mouseleave", () => {
      if (this.hoveredWaypoint) {
        this.hoveredWaypoint = null;
        this.draw();
      }
      this.readout.hidden = true;
    });

    c.addEventListener("click", (e) => {
      if (this._dragMoved) return;
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
        cancelAnimationFrame(this._viewAnimation);
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

    c.addEventListener(
      "touchstart",
      (e) => {
        cancelAnimationFrame(this._viewAnimation);
        if (e.touches.length === 1) {
          const t = e.touches[0];
          this._touchMode = "pan";
          this._touchMoved = false;
          this._touchDragStart = { x: t.clientX, y: t.clientY };
          this._touchDragOriginCenter = { x: this.centerX, z: this.centerZ };
        } else if (e.touches.length === 2) {
          this._touchMode = "pinch";
          this._touchMoved = true;
          const [t1, t2] = e.touches;
          this._pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          this._pinchStartScale = this.scale;
          const rect = c.getBoundingClientRect();
          const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
          const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
          this._pinchWorldAtMid = this.screenToWorld(midX, midY);
        }
      },
      { passive: true },
    );

    c.addEventListener(
      "touchmove",
      (e) => {
        if (this._touchMode === "pinch" && e.touches.length === 2) {
          e.preventDefault();
          const [t1, t2] = e.touches;
          const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          if (this._pinchStartDist) {
            const factor = dist / this._pinchStartDist;
            this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this._pinchStartScale * factor));
          }
          const rect = c.getBoundingClientRect();
          const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
          const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
          const afterWorld = this.screenToWorld(midX, midY);
          this.centerX += this._pinchWorldAtMid.x - afterWorld.x;
          this.centerZ += this._pinchWorldAtMid.z - afterWorld.z;
          this.draw();
          this.onViewChange?.();
        } else if (this._touchMode === "pan" && e.touches.length === 1) {
          e.preventDefault();
          const t = e.touches[0];
          const dx = t.clientX - this._touchDragStart.x;
          const dy = t.clientY - this._touchDragStart.y;
          if (Math.abs(dx) > TOUCH_TAP_MOVE_THRESHOLD || Math.abs(dy) > TOUCH_TAP_MOVE_THRESHOLD) {
            this._touchMoved = true;
          }
          this.centerX = this._touchDragOriginCenter.x - dx / this.scale;
          this.centerZ = this._touchDragOriginCenter.z - dy / this.scale;
          const rect = c.getBoundingClientRect();
          const sx = t.clientX - rect.left;
          const sy = t.clientY - rect.top;
          const w = this.screenToWorld(sx, sy);
          this.readout.hidden = false;
          this.readout.textContent = `x ${Math.round(w.x)}, z ${Math.round(w.z)}`;
          this.draw();
          this.onViewChange?.();
        }
      },
      { passive: false },
    );

    c.addEventListener(
      "touchend",
      (e) => {
        this.readout.hidden = true;
        if (e.touches.length === 0) {
          if (this._touchMode === "pan" && !this._touchMoved) {
            e.preventDefault();
            const t = e.changedTouches[0];
            const rect = c.getBoundingClientRect();
            const sx = t.clientX - rect.left;
            const sy = t.clientY - rect.top;
            const hit = this._hitTestPin(sx, sy, true);
            if (hit) {
              this.onPinClick?.(hit);
            } else {
              const w = this.screenToWorld(sx, sy);
              if (this.onEmptyTap) this.onEmptyTap(Math.round(w.x), Math.round(w.z));
              else this.onEmptyClick?.();
            }
          }
          this._touchMode = null;
          this._touchMoved = false;
          this._pinchStartDist = null;
        } else if (e.touches.length === 1) {
          const t = e.touches[0];
          this._touchMode = "pan";
          this._touchMoved = true;
          this._touchDragStart = { x: t.clientX, y: t.clientY };
          this._touchDragOriginCenter = { x: this.centerX, z: this.centerZ };
          this._pinchStartDist = null;
        }
      },
      { passive: false },
    );

    c.addEventListener("touchcancel", () => {
      this._touchMode = null;
      this._touchMoved = false;
      this._pinchStartDist = null;
      this.readout.hidden = true;
    });
  }

  zoomBy(factor) {
    cancelAnimationFrame(this._viewAnimation);
    // anchor the zoom on the viewport center (which keeps centerX/Z put)
    const startScale = this.scale;
    const targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * factor));
    if (targetScale === startScale) return;
    const startedAt = performance.now();
    const duration = 220;
    const step = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = easeOutCubic(progress);
      this.scale = startScale + (targetScale - startScale) * eased;
      this.draw();
      this.onViewChange?.();
      if (progress < 1) this._viewAnimation = requestAnimationFrame(step);
    };
    this._viewAnimation = requestAnimationFrame(step);
  }

  _hitTestPin(sx, sy, isTouch = false) {
    const radius = isTouch ? PIN_HIT_RADIUS_TOUCH : PIN_HIT_RADIUS;
    for (let i = this.waypoints.length - 1; i >= 0; i--) {
      const wp = this.waypoints[i];
      const p = this.worldToScreen(wp.x, wp.z);
      const d = Math.hypot(p.x - sx, p.y - PIN_ICON_HEIGHT / 2 - sy);
      if (d <= radius) return wp;
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
      ctx.strokeStyle = isOrigin ? this.dimensionColor : "rgba(255, 255, 255, 0.12)";
      ctx.globalAlpha = isOrigin ? 0.55 : 1;
      ctx.lineWidth = isOrigin ? 1.5 : 1;
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (x % spacing === 0) {
        ctx.fillStyle = isOrigin ? this.dimensionColor : "rgba(200, 196, 224, 0.6)";
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
      ctx.strokeStyle = isOrigin ? this.dimensionColor : "rgba(255, 255, 255, 0.12)";
      ctx.globalAlpha = isOrigin ? 0.55 : 1;
      ctx.lineWidth = isOrigin ? 1.5 : 1;
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(w, sy + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = isOrigin ? this.dimensionColor : "rgba(200, 196, 224, 0.6)";
      ctx.globalAlpha = isOrigin ? 0.85 : 1;
      ctx.fillText(`z ${z}`, 4, sy - 4 < 10 ? sy + 14 : sy - 4);
      ctx.globalAlpha = 1;
    }

    // waypoint pins
    for (const wp of this.waypoints) {
      const p = this.worldToScreen(wp.x, wp.z);
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;

      const color = wp.color || this.dimensionColor;
      const icon = "\uf3c5";
      const isSelected = this.selectedWaypoint && String(this.selectedWaypoint.id) === String(wp.id);
      const fontSize = isSelected ? 30 : 24;
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `900 ${fontSize}px 'Font Awesome 6 Free'`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.strokeStyle = "rgba(10, 10, 15, 0.9)";
      ctx.lineWidth = 2;
      ctx.strokeText(icon, p.x, p.y);
      ctx.fillText(icon, p.x, p.y);
      ctx.restore();
    }

    if (this.hoveredWaypoint) {
      const p = this.worldToScreen(this.hoveredWaypoint.x, this.hoveredWaypoint.z);
      const labelY = p.y + 8;
      ctx.save();
      ctx.font = "12px 'Manrope', system-ui, sans-serif";
      const labelWidth = ctx.measureText(this.hoveredWaypoint.name).width;
      const paddingX = 7;
      const paddingY = 4;
      const labelX = p.x - labelWidth / 2 - paddingX;
      ctx.fillStyle = "rgba(10, 10, 15, 0.88)";
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, labelWidth + paddingX * 2, 20, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(232, 230, 240, 0.9)";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(this.hoveredWaypoint.name, labelX + paddingX, labelY + paddingY);
      ctx.restore();
    }

    // live player markers
    const HEAD_SIZE = 24;
    for (const player of this._currentPlayerPositions()) {
      const p = this.worldToScreen(player.x, player.z);
      if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;

      const img = this.playerHeadCache.get(player.username);
      const left = p.x - HEAD_SIZE / 2;
      const top = p.y - HEAD_SIZE / 2;
      ctx.save();
      if (player.afk) ctx.globalAlpha = 0.5;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, left, top, HEAD_SIZE, HEAD_SIZE);
      } else {
        ctx.fillStyle = "#4ade80";
        ctx.fillRect(left, top, HEAD_SIZE, HEAD_SIZE);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(left + 0.5, top + 0.5, HEAD_SIZE - 1, HEAD_SIZE - 1);
      ctx.restore();

      const label = player.afk ? `${player.username} (AFK)` : player.username;

      const HEAD_RADIUS = HEAD_SIZE / 2;
      ctx.save();
      ctx.font = "11px 'Manrope', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.strokeStyle = "rgba(10, 10, 15, 0.9)";
      ctx.lineWidth = 3;
      ctx.strokeText(label, p.x, p.y + HEAD_RADIUS + 4);
      ctx.fillStyle = "rgba(232, 230, 240, 0.95)";
      ctx.fillText(label, p.x, p.y + HEAD_RADIUS + 4);
      ctx.restore();
    }
  }
}
