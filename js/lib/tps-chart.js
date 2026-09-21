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
  if (color.startsWith("rgba(")) return color;
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  return color;
}

function bandOf(tps, good, warn, bad) {
  if (tps >= 18) return good;
  if (tps >= 15) return warn;
  return bad;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{t:number, tps:number}>} points epoch-ms buckets ascending
 * @param {object} opts { colors:{good,warn,bad,textDim,border,accent}, rangeHours, now }
 */
export function renderTpsChart(canvas, points, opts = {}) {
  const colors = opts.colors ?? {};
  const good = colors.good ?? "#6bbf8a";
  const warn = colors.warn ?? "#d4a05a";
  const bad = colors.bad ?? "#e2685f";
  const textDim = colors.textDim ?? "#9aa1ab";
  const border = colors.border ?? "rgba(255,255,255,0.12)";
  const rangeHours = opts.rangeHours ?? 1;

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
  const PAD_R = 8;
  const PAD_T = 18;
  const PAD_B = 18;
  const W = cssW - PAD_L - PAD_R;
  const H = cssH - PAD_T - PAD_B;
  if (W <= 0 || H <= 0) return;

  const now = opts.now ?? Date.now();
  const rangeMs = rangeHours * 3600e3;
  const t0 = now - rangeMs;

  const px = (ms) => PAD_L + (clamp(ms - t0, 0, rangeMs) / rangeMs) * W;
  const py = (tps) => PAD_T + (1 - clamp(tps, 0, TPS_MAX) / TPS_MAX) * H;

  // value-band shading (same bands/coloring as the TPS number)
  const zones = [
    { from: 0, to: 15, color: hexToRgba(bad, 0.05) },
    { from: 15, to: 18, color: hexToRgba(warn, 0.05) },
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

  // time labels
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const ticks = 5;
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const x = PAD_L + frac * W;
    const xPts = points.map((p) => p.t);
    const closestT = xPts.reduce((a, b) => Math.abs(b - t0 - frac * rangeMs) < Math.abs(a - t0 - frac * rangeMs) ? b : a);
    ctx.fillText(timeFmt.format(new Date(closestT)), Math.max(PAD_L, Math.min(PAD_L + W, x)), PAD_T + H + 4);
  }

  // area fill under the curve
  const fill = points[points.length - 1].tps;
  ctx.beginPath();
  ctx.moveTo(px(points[0].t), PAD_T + H);
  for (const p of points) ctx.lineTo(px(p.t), py(p.tps));
  ctx.lineTo(px(points[points.length - 1].t), PAD_T + H);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(bandOf(fill, good, warn, bad), fill >= 15 ? 0.06 : 0.05);
  ctx.fill();

  // banded line (segments per color run, same coloring as the TPS number)
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  let runColor = null;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const color = bandOf(cur.tps, good, warn, bad);
    if (color !== runColor) {
      if (runColor !== null) ctx.stroke();
      runColor = color;
      ctx.beginPath();
      ctx.moveTo(px(prev.t), py(prev.tps));
    } else {
      ctx.lineTo(px(prev.t), py(prev.tps));
    }
    ctx.strokeStyle = color;
    ctx.lineTo(px(cur.t), py(cur.tps));
  }
  if (runColor !== null) ctx.stroke();

  // average line + label
  let sum = 0;
  for (const p of points) sum += p.tps;
  const avg = sum / points.length;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = hexToRgba(textDim, 0.8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, py(avg));
  ctx.lineTo(PAD_L + W, py(avg));
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = textDim;
  ctx.font = "10px Manrope, sans-serif";
  ctx.fillText(`avg ${avg.toFixed(1)}`, PAD_L + 2, 3);
}

export { TPS_MAX };