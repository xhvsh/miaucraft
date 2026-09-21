// TPS history chart renderer. Pure canvas + DOM, no dependencies, driven by
// the site's existing color tokens so it always matches the theme.

const TPS_MAX = 20;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function hexToRgba(color, alpha) {
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,.*)?\)$/.exec(color);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  return color;
}

function bandOf(tps, good, warn, bad) {
  if (tps >= 18) return good;
  if (tps >= 15) return warn;
  return bad;
}

function strokeSmoothPath(ctx, pts, px, py) {
  if (pts.length < 3) {
    ctx.moveTo(px(pts[0].t), py(pts[0].tps));
    ctx.lineTo(px(pts[pts.length - 1].t), py(pts[pts.length - 1].tps));
    return;
  }
  ctx.moveTo(px(pts[0].t), py(pts[0].tps));
  for (let i = 1; i < pts.length - 1; i++) {
    const cx = (px(pts[i].t) + px(pts[i + 1].t)) / 2;
    const cy = (py(pts[i].tps) + py(pts[i + 1].tps)) / 2;
    ctx.quadraticCurveTo(px(pts[i].t), py(pts[i].tps), cx, cy);
  }
  ctx.lineTo(px(pts[pts.length - 1].t), py(pts[pts.length - 1].tps));
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Split a time series into contiguous segments, breaking on gaps larger than
// ~2x the typical bucket interval (e.g. server downtime with no samples).
function splitSegments(points) {
  const dts = [];
  for (let i = 1; i < points.length; i++) dts.push(points[i].t - points[i - 1].t);
  dts.sort((a, b) => a - b);
  const med = dts.length ? dts[Math.floor(dts.length / 2)] : 0;
  const gapMs = Math.max(2 * med, 60000);

  const segments = [];
  let cur = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - points[i - 1].t > gapMs) {
      segments.push(cur);
      cur = [];
    }
    cur.push(points[i]);
  }
  segments.push(cur);
  return segments.filter((s) => s.length >= 1);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{t:number, tps:number}>} points epoch-ms buckets ascending
 * @param {object} opts { colors:{good,warn,bad,textDim,border,bg}, rangeHours, now }
 */
export function renderTpsChart(canvas, points, opts = {}) {
  attachChartPointer(canvas);
  if (canvas.__tpsPoints !== points) canvas.__tpsHover = null;
  canvas.__tpsPoints = points;
  canvas.__tpsOpts = opts;
  drawTpsChart(canvas);
}

function drawTpsChart(canvas) {
  const points = canvas.__tpsPoints ?? [];
  const colors = (canvas.__tpsOpts ?? {}).colors ?? {};
  const good = colors.good ?? "#6bbf8a";
  const warn = colors.warn ?? "#d4a05a";
  const bad = colors.bad ?? "#e2685f";
  const textDim = colors.textDim ?? "#9aa1ab";
  const border = colors.border ?? "rgba(255,255,255,0.12)";
  const bg = colors.bg ?? "#151b26";
  const rangeHours = (canvas.__tpsOpts ?? {}).rangeHours ?? 1;

  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!points || points.length < 2) return;

  const PAD_L = 30;
  const PAD_R = 10;
  const PAD_T = 22;
  const PAD_B = 20;
  const W = cssW - PAD_L - PAD_R;
  const H = cssH - PAD_T - PAD_B;
  if (W <= 0 || H <= 0) return;

  const now = (canvas.__tpsOpts ?? {}).now ?? Date.now();
  const rangeMs = rangeHours * 3600e3;
  const t0 = now - rangeMs;

  const px = (ms) => PAD_L + (clamp(ms - t0, 0, rangeMs) / rangeMs) * W;
  const py = (tps) => PAD_T + (1 - clamp(tps, 0, TPS_MAX) / TPS_MAX) * H;

  // value-band shading (faint horizontal hints, same bands as the TPS number)
  const zones = [
    { from: 0, to: 15, color: hexToRgba(bad, 0.045) },
    { from: 15, to: 18, color: hexToRgba(warn, 0.045) },
    { from: 18, to: 20, color: hexToRgba(good, 0.04) },
  ];
  for (const z of zones) {
    ctx.fillStyle = z.color;
    ctx.fillRect(PAD_L, py(z.to), W, py(z.from) - py(z.to));
  }

  // gridlines + y labels
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.fillStyle = textDim;
  ctx.font = "10px Manrope, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tps of [20, 15, 10, 5, 0]) {
    const y = Math.round(py(tps)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(PAD_L + W, y);
    ctx.stroke();
    ctx.fillText(String(tps), PAD_L - 6, y);
  }

  // x-axis baseline slightly stronger
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, Math.round(py(0)) + 0.5);
  ctx.lineTo(PAD_L + W, Math.round(py(0)) + 0.5);
  ctx.stroke();

  // time labels with collision avoidance
  const numTicks = rangeHours >= 24 ? 7 : 5;
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = textDim;
  let lastLabelEnd = -Infinity;
  for (let i = 0; i <= numTicks; i++) {
    const frac = i / numTicks;
    const target = t0 + frac * rangeMs;
    let closestT = points[0].t;
    let bd = Infinity;
    for (const p of points) {
      const dd = Math.abs(p.t - target);
      if (dd < bd) {
        bd = dd;
        closestT = p.t;
      }
    }
    const x = Math.max(PAD_L, Math.min(PAD_L + W, PAD_L + frac * W));
    const d = new Date(closestT);
    const label = rangeHours >= 24 ? `${wdFmt.format(d)} ${timeFmt.format(d)}` : timeFmt.format(d);
    const w = ctx.measureText(label).width;
    if (x - 4 < lastLabelEnd) continue;
    ctx.fillText(label, Math.max(PAD_L, x), PAD_T + H + 5);
    lastLabelEnd = Math.min(PAD_L + W, x + w);
  }

  const segments = splitSegments(points);

  // banded smooth line, split into runs per color AND per segment
  ctx.lineWidth = 1.75;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  let runs = [];
  for (const seg of segments) {
    let run = [seg[0]];
    for (let i = 1; i < seg.length; i++) {
      if (bandOf(seg[i].tps, good, warn, bad) !== bandOf(seg[i - 1].tps, good, warn, bad)) {
        runs.push(run);
        run = [];
      }
      run.push(seg[i]);
    }
    runs.push(run);
  }
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.length < 2) continue;
    const color = bandOf(run[run.length - 1].tps, good, warn, bad);
    ctx.strokeStyle = color;
    ctx.beginPath();
    strokeSmoothPath(ctx, run, px, py);
    ctx.stroke();
  }

  // last-value pulse dot + label
  const last = points[points.length - 1];
  const lx = px(last.t);
  const ly = py(last.tps);
  const lineColor = bandOf(last.tps, good, warn, bad);
  ctx.save();
  ctx.fillStyle = hexToRgba(lineColor, 0.3);
  ctx.beginPath();
  ctx.arc(lx, ly, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = lineColor;
  ctx.font = "700 10px Manrope, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${last.tps.toFixed(1)}`, Math.min(PAD_L + W - 30, lx + 9), PAD_T + 2);

  // average line + label
  let sum = 0;
  for (const p of points) sum += p.tps;
  const avg = sum / points.length;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = hexToRgba(textDim, 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, py(avg));
  ctx.lineTo(PAD_L + W, py(avg));
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = textDim;
  ctx.font = "500 10px Manrope, sans-serif";
  ctx.fillText(`avg ${avg.toFixed(1)}`, PAD_L + 2, PAD_T + 2);

  // hover crosshair + tooltip
  const hover = canvas.__tpsHover;
  if (hover && hover.point) {
    ctx.save();
    ctx.strokeStyle = hexToRgba(textDim, 0.55);
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hover.x + 0.5, PAD_T);
    ctx.lineTo(hover.x + 0.5, PAD_T + H);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    const dFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const timeText = dFmt.format(new Date(hover.point.t));
    const tpsText = `${hover.point.tps.toFixed(1)} TPS`;
    ctx.font = "10px Manrope, sans-serif";
    const tw = ctx.measureText(timeText).width;
    const vw = ctx.measureText(tpsText).width;
    const bw = Math.max(tw, vw) + 16;
    const bh = 26;
    let bx = hover.x + 10;
    if (bx + bw > PAD_L + W) bx = hover.x - bw - 10;
    let by = hover.y - bh - 8;
    if (by < PAD_T) by = hover.y + 10;
    if (by + bh > PAD_T + H + PAD_B) by = PAD_T + H - bh;

    roundRectPath(ctx, bx, by, bw, bh, 6);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = textDim;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(timeText, bx + 8, by + 5);
    ctx.fillStyle = bandOf(hover.point.tps, good, warn, bad);
    ctx.font = "700 10px Manrope, sans-serif";
    ctx.fillText(tpsText, bx + 8, by + 14);
    ctx.restore();
  }

  canvas.__tpsLayout = { points, t0, rangeMs, px, py, W, H, PAD_L, PAD_T, colors, lineColor };
}

function attachChartPointer(canvas) {
  if (canvas.__tpsPointerAttached) return;
  canvas.__tpsPointerAttached = true;

  const scheduleDraw = () => {
    if (canvas.__tpsDrawPending) return;
    canvas.__tpsDrawPending = true;
    requestAnimationFrame(() => {
      canvas.__tpsDrawPending = false;
      drawTpsChart(canvas);
    });
  };

  canvas.addEventListener("pointermove", (e) => {
    const layout = canvas.__tpsLayout;
    if (!layout || layout.points.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < layout.PAD_L - 4 || mx > layout.PAD_L + layout.W + 4 || my < layout.PAD_T - 4 || my > layout.PAD_T + layout.H + 4) {
      if (canvas.__tpsHover) {
        canvas.__tpsHover = null;
        scheduleDraw();
      }
      return;
    }
    const frac = (mx - layout.PAD_L) / layout.W;
    const target = layout.t0 + frac * layout.rangeMs;
    let best = layout.points[0];
    let bd = Infinity;
    for (const p of layout.points) {
      const dd = Math.abs(p.t - target);
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    const x = layout.px(best.t);
    if (!canvas.__tpsHover || canvas.__tpsHover.point !== best) {
      canvas.__tpsHover = { x, y: layout.py(best.tps), point: best };
      scheduleDraw();
    }
  });

  canvas.addEventListener("pointerleave", () => {
    if (canvas.__tpsHover) {
      canvas.__tpsHover = null;
      scheduleDraw();
    }
  });
}

export { TPS_MAX };