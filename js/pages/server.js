import * as Auth from "../lib/auth.js";
import { getServerInfo } from "../lib/waypoints.js";
import { listPlayers, subscribePlayers, listLivePositions, subscribeLivePositions, getServerStatus, subscribeServerStatus, listTpsSeries, createStatusStaleChecker } from "../lib/live.js";
import { SERVER_VERSION } from "../lib/config.js";
import { escapeHtml, formatRelativeTime, formatAbsoluteTime, formatUptime, isResetArtifact, copyTextToClipboard } from "../lib/ui.js";
import { initNav } from "../lib/nav.js";
import { renderTpsChart } from "../lib/tps-chart.js";

const $ = (sel) => document.querySelector(sel);

const DIM_COLORS = { overworld: "#6bbf8a", nether: "#e2685f", end: "#d9c775" };
const DIM_LABELS = { overworld: "Overworld", nether: "Nether", end: "End" };

await initNav("server");

$("#serverVersion").textContent = SERVER_VERSION;

let lastServerStatus = null;
let lastPlayers = [];
let lastDims = new Map();
let tickTimer = null;
let serverLoaded = false;
let playersLoaded = false;
let tpsHours = 1;
let tpsPoints = [];
let tpsRequestId = 0;

const isStatusStale = createStatusStaleChecker();

function getTpsClass(tps) {
  if (tps >= 18) return "tps-good";
  if (tps >= 15) return "tps-warn";
  return "tps-bad";
}

function renderServerStatus(status) {
  const offline = isStatusStale(status);
  $("#serverOfflineNotice").hidden = !offline;
  if (offline) {
    $("#serverTps").textContent = "-";
    $("#serverTps").classList.remove("tps-good", "tps-warn", "tps-bad");
    $("#serverUptime").textContent = "-";
    $("#serverDays").textContent = "-";
    $("#serverOfflineNotice").innerHTML = status?.updated_at ? `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Server is offline - last online ${escapeHtml(formatRelativeTime(status.updated_at))}` : `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Server is offline`;
    return;
  }
  const tps = status.tps_1m != null ? status.tps_1m.toFixed(1) : "-";
  $("#serverTps").textContent = tps;
  $("#serverTps").classList.remove("tps-good", "tps-warn", "tps-bad");
  if (status.tps_1m != null) $("#serverTps").classList.add(getTpsClass(status.tps_1m));
  $("#serverUptime").textContent = status.started_at ? formatUptime(Date.now() - new Date(status.started_at).getTime()) : "-";
  $("#serverDays").textContent = status.days != null ? status.days : "-";
}

function setServerConnectionField(id, text, shouldBlur) {
  const el = $("#" + id);
  el.textContent = text;
  el.classList.toggle("ip-blur", shouldBlur);
  el.classList.remove("is-revealed");
}

function tpsChartColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name, fb) => s.getPropertyValue(name).trim() || fb;
  return {
    good: v("--tps-good", "#6bbf8a"),
    warn: v("--tps-warn", "#d4a05a"),
    bad: v("--tps-bad", "#e2685f"),
    textDim: v("--text-dim", "#9aa1ab"),
    border: v("--border", "rgba(255,255,255,0.12)"),
    bg: v("--surface-3", "#151b26"),
  };
}

async function loadTpsChart() {
  const requestId = ++tpsRequestId;
  const wrap = $("#tpsChartWrap");
  const empty = $("#tpsChartEmpty");
  const canvas = $("#tpsChart");
  if (wrap) wrap.hidden = false;
  try {
    const points = await listTpsSeries(tpsHours);
    if (requestId !== tpsRequestId) return;
    tpsPoints = points;
    if (!points || points.length < 2) {
      empty.textContent = tpsHours >= 24
        ? "Not enough TPS history for the last day yet - it fills in as the server runs."
        : "Not enough TPS history yet - it fills in as the server runs.";
      empty.hidden = false;
      renderTpsChart(canvas, [], { rangeHours: tpsHours, colors: tpsChartColors() });
    } else {
      empty.hidden = true;
      renderTpsChart(canvas, points, { rangeHours: tpsHours, colors: tpsChartColors() });
    }
  } catch (err) {
    if (requestId !== tpsRequestId) return;
    console.error(err);
    empty.textContent = "Could not load TPS history.";
    empty.hidden = false;
  }
}

function drawTpsChart() {
  renderTpsChart($("#tpsChart"), tpsPoints, { rangeHours: tpsHours, colors: tpsChartColors() });
}

document.querySelectorAll(".tps-range-btn").forEach((button) => {
  button.addEventListener("click", () => {
    tpsHours = Number(button.dataset.hours);
    document.querySelectorAll(".tps-range-btn").forEach((b) => b.classList.toggle("is-active", b === button));
    loadTpsChart();
  });
});

let tpsResizePending = false;
if (typeof ResizeObserver !== "undefined" && document.getElementById("tpsChart")) {
  new ResizeObserver(() => {
    if (tpsResizePending || tpsPoints.length < 2) return;
    tpsResizePending = true;
    requestAnimationFrame(() => {
      tpsResizePending = false;
      drawTpsChart();
    });
  }).observe(document.getElementById("tpsChart"));
}

document.addEventListener("click", (e) => {
  const value = e.target.closest(".server-field-value.ip-blur");
  if (value && !value.classList.contains("is-revealed")) value.classList.add("is-revealed");
});

async function loadServerPanel() {
  await Promise.allSettled([refreshServerStatus(), refreshServerConnectionFields()]);

  for (const button of document.querySelectorAll(".server-copy")) {
    button.hidden = !Auth.isLoggedIn();
    const source = $("#" + button.dataset.copySource).textContent;
    button.disabled = !source || source === "unavailable";
  }

  if (!serverLoaded) {
    serverLoaded = true;
    document.querySelectorAll(".is-skeleton").forEach((el) => el.classList.remove("is-skeleton"));
  }

  loadPlayersPanel();
  loadTpsChart();
  if (document.visibilityState === "visible") startTpsTicker();
  startServerTicker();
}

let tpsTickTimer = null;
function startTpsTicker() {
  if (tpsTickTimer) return;
  tpsTickTimer = setInterval(() => {
    if (document.visibilityState === "visible") loadTpsChart();
  }, 60000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") startTpsTicker();
});

async function refreshServerStatus() {
  try {
    lastServerStatus = await getServerStatus();
    renderServerStatus(lastServerStatus);
  } catch (err) {
    console.error(err);
    lastServerStatus = null;
    renderServerStatus(null);
  }
}

async function refreshServerConnectionFields() {
  if (!Auth.isLoggedIn()) {
    setServerConnectionField("serverHostname", "Log in to view", false);
    setServerConnectionField("serverIp", "Log in to view", false);
    return;
  }
  try {
    const info = await getServerInfo();
    setServerConnectionField("serverHostname", info.hostname || "Not set", Boolean(info.hostname));
    setServerConnectionField("serverIp", info.ip || "Not set", Boolean(info.ip));
  } catch (err) {
    console.error(err);
    setServerConnectionField("serverHostname", "unavailable", false);
    setServerConnectionField("serverIp", "unavailable", false);
  }
}

subscribeServerStatus((payload) => {
  lastServerStatus = payload.new;
  renderServerStatus(lastServerStatus);
});

function startServerTicker() {
  stopServerTicker();
  tickTimer = setTimeout(tick, nextTickDelay());
}
function stopServerTicker() {
  clearTimeout(tickTimer);
  tickTimer = null;
}
function tick() {
  renderServerStatus(lastServerStatus);
  renderPlayersList(lastPlayers);
  tickTimer = setTimeout(tick, nextTickDelay());
}
function nextTickDelay() {
  let delay = 60000;
  for (const p of lastPlayers) {
    if (p.online) continue;
    if (isResetArtifact(p.last_seen)) continue;
    const ageSec = (Date.now() - new Date(p.last_seen).getTime()) / 1000;
    if (ageSec < 60) delay = Math.min(delay, 1000);
    else if (ageSec < 3600) delay = Math.min(delay, 60000);
    else if (ageSec < 86400) delay = Math.min(delay, 3600000);
    else delay = Math.min(delay, 86400000);
  }
  return delay;
}

let playersRequestId = 0;
async function loadPlayersPanel() {
  const requestId = ++playersRequestId;
  if (!playersLoaded) {
    $("#playersSkeleton").hidden = false;
    $("#playersEmpty").hidden = true;
  }
  try {
    const players = await listPlayers();
    if (requestId !== playersRequestId) return;
    playersLoaded = true;
    $("#playersSkeleton").hidden = true;
    lastPlayers = players;
    let livePositions = [];
    try {
      livePositions = await listLivePositions();
    } catch (err) {
      console.error(err);
      livePositions = [];
    }
    if (requestId !== playersRequestId) return;
    lastDims = new Map(livePositions.map((p) => [p.player_id, p.dimension]));
    renderPlayersList(lastPlayers);
  } catch (err) {
    if (requestId !== playersRequestId) return;
    playersLoaded = true;
    $("#playersSkeleton").hidden = true;
    console.error(err);
    lastPlayers = [];
    lastDims = new Map();
    $("#playersList").innerHTML = "";
    $("#playersEmpty").hidden = false;
    $("#playersEmpty").querySelector("span").textContent = "Could not load players.";
    $("#playersOnlineCount").textContent = "";
    $("#playersOnlineCount").classList.remove("has-online");
  }
}

let playersRenderPending = false;
function schedulePlayersRender() {
  if (playersRenderPending || !playersLoaded) return;
  playersRenderPending = true;
  requestAnimationFrame(() => {
    playersRenderPending = false;
    renderPlayersList(lastPlayers);
  });
}

function applyPlayersPayload(payload) {
  if (!payload?.new) return;
  const np = payload.new;
  const idx = lastPlayers.findIndex((p) => p.id === np.id);
  if (payload.eventType === "DELETE") {
    lastPlayers = lastPlayers.filter((p) => p.id !== np.id);
  } else if (idx === -1) {
    lastPlayers = lastPlayers.concat(np);
  } else {
    lastPlayers = [...lastPlayers];
    lastPlayers[idx] = { ...lastPlayers[idx], ...np };
  }
  schedulePlayersRender();
}

function debounceRefreshPlayers() {
  clearTimeout(debounceRefreshPlayers._debounce);
  debounceRefreshPlayers._debounce = setTimeout(loadPlayersPanel, 300);
}

subscribeLivePositions((payload) => {
  if (payload && payload.new && payload.eventType !== "DELETE") {
    const np = payload.new;
    const dims = new Map(lastDims);
    dims.set(np.player_id, np.dimension);
    lastDims = dims;
    schedulePlayersRender();
    return;
  }
  debounceRefreshPlayers();
});

function sortPlayers(players) {
  const online = players.filter((p) => p.online).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
  const offline = players
    .filter((p) => !p.online)
    .sort((a, b) => {
      const aReset = isResetArtifact(a.last_seen);
      const bReset = isResetArtifact(b.last_seen);
      if (aReset !== bReset) return aReset ? 1 : -1;
      if (aReset && bReset) return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
      return new Date(b.last_seen) - new Date(a.last_seen);
    });
  return [...online, ...offline];
}

function renderPlayersList(players) {
  const sorted = sortPlayers(players);
  $("#playersList").innerHTML = "";
  $("#playersEmpty").hidden = sorted.length > 0;
  $("#playersEmpty").querySelector("span").textContent = "No players have joined yet.";

  const onlineCount = players.filter((p) => p.online).length;
  const onlineEl = $("#playersOnlineCount");
  onlineEl.textContent = `${onlineCount} online`;
  onlineEl.classList.toggle("has-online", onlineCount > 0);

  const frag = document.createDocumentFragment();
  for (const p of sorted) {
    const row = document.createElement("div");
    row.className = "players-row";
    const usernameAttr = escapeHtml(p.username);
    let afkBadge = "";
    if (p.online && p.afk) {
      const tip = p.last_moved ? ` data-tooltip="AFK for ${escapeHtml(formatUptime(Date.now() - new Date(p.last_moved).getTime()))}"` : "";
      afkBadge = `<span class="badge badge-afk"${tip} data-tip-key="${usernameAttr}:afk">AFK</span>`;
    }
    let tooltipAttr = "";
    if (!p.online) {
      const lastSeenText = isResetArtifact(p.last_seen) ? "Last seen a long time ago" : `Last seen ${formatRelativeTime(p.last_seen)} (${formatAbsoluteTime(p.last_seen)})`;
      tooltipAttr = ` data-tooltip="${escapeHtml(lastSeenText)}" data-tip-key="${usernameAttr}:offline"`;
    }
    const statusBadge = `<span class="badge ${p.online ? "badge-online" : "badge-offline"}"${tooltipAttr}>${p.online ? "Online" : "Offline"}</span>`;
    const dimKey = p.online ? lastDims.get(p.id) : null;
    const dimColor = dimKey ? DIM_COLORS[dimKey] : null;
    const dimDot = dimColor
      ? `<span class="players-dim-dot" style="--dim-badge-color:${dimColor}" data-tooltip="${escapeHtml(DIM_LABELS[dimKey] || dimKey)}" data-tip-key="${usernameAttr}:dim" role="img" aria-label="In ${escapeHtml(DIM_LABELS[dimKey] || dimKey)}"></span>`
      : `<span class="players-dim-dot is-inline-placeholder" aria-hidden="true"></span>`;
    row.innerHTML = `
      ${dimDot}
      <img class="players-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(p.username)}/64" alt="" width="32" height="32" loading="lazy" />
      <button class="players-username" type="button" data-username="${usernameAttr}">${escapeHtml(p.username)}</button>
      <span class="players-row-badges">${afkBadge}${statusBadge}</span>
    `;
    row.querySelector(".players-username").addEventListener("click", () => {
      window.location.href = `/profile?user=${encodeURIComponent(p.username)}`;
    });
    frag.appendChild(row);
  }
  $("#playersList").appendChild(frag);
  refreshTip();
}

// ---------- player-row tooltip (JS-driven, survives re-renders) ----------
const tipEl = document.createElement("div");
tipEl.className = "player-tip";
tipEl.hidden = true;
document.body.appendChild(tipEl);

// desktop (fine pointer + hover) shows tips instantly on hover and hides
// instantly on leave; touch devices pin a tip by tapping the badge and
// dismiss it by tapping anywhere else
const CAN_HOVER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// badges toggle their tooltip on a tap on small screens / non-hover pointers,
// so mobile users never have to hold a badge to read its tooltip
const compactScreen = window.matchMedia("(max-width: 860px)");
function allowTapToggle() {
  return !CAN_HOVER || compactScreen.matches;
}

let activeTipKey = null;
let tipPinned = false;
let tipAnchorRect = null;
let tipContainer = null;

// last known pointer position, so a mid-hover re-render can tell whether the
// pointer is still parked on a badge (keep the tip up) vs really leaving
let lastPointerPos = null;
window.addEventListener("pointermove", (e) => {
  lastPointerPos = { x: e.clientX, y: e.clientY };
}, { passive: true });

function tipAnchor(key) {
  return document.querySelector(`[data-tip-key="${CSS.escape(key)}"]`);
}

function showTip(key) {
  const anchor = tipAnchor(key);
  if (!anchor) return hideTip();
  activeTipKey = key;
  tipEl.textContent = anchor.dataset.tooltip || "";
  tipEl.hidden = false;
  tipAnchorRect = anchor.getBoundingClientRect();
  tipContainer = anchor.closest(".card") || null;
  positionTip();
}

function positionTip() {
  if (!tipAnchorRect) return;
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const margin = 8;
  const box = tipContainer ? tipContainer.getBoundingClientRect() : null;
  let left = tipAnchorRect.left + tipAnchorRect.width / 2 - tw / 2;
  if (box) left = Math.max(box.left + margin, Math.min(left, box.right - tw - margin));
  else left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
  let top = tipAnchorRect.top - th - margin;
  if (box) {
    const minTop = box.top + margin;
    const maxTop = box.bottom - th - margin;
    if (top < minTop) top = tipAnchorRect.bottom + margin;
    top = Math.max(minTop, Math.min(top, maxTop));
  } else {
    if (top < margin) top = tipAnchorRect.bottom + margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
  }
  tipEl.style.left = left + "px";
  tipEl.style.top = top + "px";
}

function hideTip() {
  tipEl.hidden = true;
  activeTipKey = null;
  tipAnchorRect = null;
  tipContainer = null;
}

// after re-renders keep an open tooltip anchored to the fresh element without
// re-centering it (content only re-measures when the anchor actually moves)
function refreshTip() {
  // rows are rebuilt on ticks / live-position updates, which fires a pointerout
  // that hides the tip mid-hover - if the pointer is still parked on a badge,
  // bring it straight back so it feels continuous
  if (CAN_HOVER && tipEl.hidden && lastPointerPos) {
    const at = document.elementFromPoint(lastPointerPos.x, lastPointerPos.y);
    const over = at ? at.closest("[data-tooltip]") : null;
    if (over) {
      showTip(over.dataset.tipKey);
      return;
    }
  }
  if (tipEl.hidden || !activeTipKey) return;
  const anchor = tipAnchor(activeTipKey);
  if (!anchor) return hideTip();
  const text = anchor.dataset.tooltip || "";
  if (tipEl.textContent !== text) tipEl.textContent = text;
  const rect = anchor.getBoundingClientRect();
  if (!tipAnchorRect || Math.hypot(rect.left - tipAnchorRect.left, rect.top - tipAnchorRect.top) > 2) {
    tipAnchorRect = rect;
    positionTip();
  }
}

function closePinnedTip() {
  if (!tipPinned) return;
  tipPinned = false;
  hideTip();
}

// desktop: hovering a badge shows the tip immediately, leaving (without
// landing on another badge) hides it immediately too
$("#playersList").addEventListener("pointerover", (e) => {
  if (!CAN_HOVER) return;
  const over = e.target.closest("[data-tooltip]");
  if (!over) return;
  showTip(over.dataset.tipKey);
});

$("#playersList").addEventListener("pointerout", (e) => {
  if (!CAN_HOVER) return;
  if (tipPinned) return;
  const related = e.relatedTarget instanceof HTMLElement ? e.relatedTarget.closest("[data-tooltip]") : null;
  if (related) return;
  hideTip();
});

// tap-to-toggle: on touch / small screens a tap pins its tip, tapping it again
// or anywhere else closes it. Desktop clicks don't pin so tips can't get stuck.
// Taps are resolved from the finger-down point (lastDownTipKey): on touch the
// synthetic click target can drift off a tiny badge (e.g. the 10px dim dot),
// which otherwise reads as a tap on empty space and kills the pinned tip
// instead of switching it to the badge the user actually meant to tap.
let lastDownTipKey = null;
let lastDownTime = 0;
function recentDownTipKey() {
  return Date.now() - lastDownTime < 500 ? lastDownTipKey : null;
}
$("#playersList").addEventListener("pointerdown", (e) => {
  const at = e.target instanceof HTMLElement ? e.target.closest("[data-tooltip]") : null;
  lastDownTipKey = at ? at.dataset.tipKey : null;
  lastDownTime = Date.now();
}, { passive: true });

$("#playersList").addEventListener("click", (e) => {
  if (!allowTapToggle()) return;
  const tipTarget = e.target.closest("[data-tooltip]");
  const key = tipTarget ? tipTarget.dataset.tipKey : recentDownTipKey();
  if (!key) return closePinnedTip();
  if (tipPinned && activeTipKey === key) closePinnedTip();
  else {
    tipPinned = true;
    showTip(key);
  }
});

document.addEventListener("click", (e) => {
  if (!tipPinned) return;
  const hit = e.target instanceof HTMLElement ? e.target.closest("[data-tooltip]") : null;
  if (!hit && !recentDownTipKey()) closePinnedTip();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePinnedTip();
});

document.addEventListener("scroll", () => {
  if (tipEl.hidden || !tipAnchorRect) return;
  refreshTip();
}, { passive: true, capture: true });

document.querySelectorAll(".server-copy").forEach((button) => {
  button.addEventListener("click", () => {
    const value = $("#" + button.dataset.copySource).textContent;
    copyTextToClipboard(value, button);
  });
});

subscribePlayers((payload) => {
  if (!playersLoaded) {
    debounceRefreshPlayers();
    return;
  }
  if (payload && payload.new) applyPlayersPayload(payload);
  else debounceRefreshPlayers();
});

// Auth is already initialized by initNav(); this fires immediately since
// state.ready is already true, and again on future sign-in/out.
Auth.onAuthChange(() => loadServerPanel());
