import * as Auth from "../lib/auth.js";
import {
  BRIDGE_COMMANDS,
  fetchStatus,
  fetchEvents,
  fetchConsole,
  fetchCommands,
  requestCommand,
  subscribeStatus,
  subscribeEvents,
  subscribeConsole,
  subscribeCommands,
} from "../lib/bridge.js";
import { escapeHtml, toast, confirmAction, copyTextToClipboard, formatRelativeTime, formatUptime, debounce, createSelect } from "../lib/ui.js";
import { initNav } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

await initNav("bridge");

let booted = false;
let status = null;
let consoleRows = [];
let unsubs = [];
/** Panel name -> last load failed. Drives the retry banner. */
const failures = new Set();
/** Table -> realtime channel state. A dead subscription is otherwise invisible. */
const channelStates = new Map();
const LIVE_TABLES = ["bridge_status", "bridge_events", "bridge_console", "bridge_commands"];
/** The category filter is rebuilt from the data, so it needs its controller. */
let categorySelect = null;

/**
 * One badge for the whole page, using the site's own .badge vocabulary the way
 * chat/profile/server pages do: a base class plus one state modifier.
 */
function setStatusBadge(state, text) {
  const badge = $("#bridgeStatusBadge");
  badge.className = state ? `badge badge-${state}` : "badge";
  badge.textContent = text;
}

/**
 * Reports whether the page is actually live, rather than leaving it to be
 * inferred from whether anything happens to change.
 */
function onChannelStatus(status, table) {
  channelStates.set(table, status);
  const down = LIVE_TABLES.filter((t) => {
    const s = channelStates.get(t);
    return s && s !== "SUBSCRIBED";
  });
  if (down.length) {
    failures.add("live updates");
  } else {
    failures.delete("live updates");
  }
  renderLoadState();
}

/**
 * Says what is broken instead of rendering nothing.
 *
 * Every panel used to swallow its own error into console.error, so a stalled
 * or failed request left the page silently empty with the pill stuck on
 * "Connecting" and no indication that anything had gone wrong.
 */
function renderLoadState() {
  const failed = [...failures];
  renderLiveState();
  $("#bridgeLoadError").hidden = failed.length === 0;
  if (!failed.length) return;
  if (failed.includes("live updates")) {
    $("#bridgeLoadErrorText").textContent =
      "Live updates are not connected, so this page will not refresh on its own. The data shown is still valid - reload to refresh it.";
  } else {
    $("#bridgeLoadErrorText").textContent =
      `Could not reach the database for: ${failed.join(", ")}. A paused Supabase project can take a minute to wake up - use Retry.`;
  }
  if (failures.has("status") && !status) {
    setStatusBadge("warn", "Unreachable");
  }
}

/** Confirms out loud that realtime is connected, rather than leaving it implied. */
function renderLiveState() {
  const states = LIVE_TABLES.map((t) => channelStates.get(t));
  if (states.some((s) => s === undefined)) return; // channels not settled yet
  if (!states.every((s) => s === "SUBSCRIBED")) {
    failures.add("live updates");
  } else {
    failures.delete("live updates");
  }
}

/** Records one panel's outcome, then repaints the banner. */
function noteResult(name, err) {
  if (err) {
    failures.add(name);
    console.error(`bridge ${name}`, err);
  } else {
    failures.delete(name);
  }
  renderLoadState();
}

function refreshAccess() {
  const loggedIn = Auth.isLoggedIn();
  const allowed = loggedIn && Auth.can("manageBridge");
  $("#bridgeSignedOut").hidden = loggedIn;
  $("#bridgeNoAccess").hidden = loggedIn ? allowed : true;
  $("#bridgeBody").hidden = !allowed;
  if (allowed) boot();
}

function boot() {
  if (booted) return;
  booted = true;
  setupTabs();
  renderActions();
  showTab("status");
  refreshAll();

  // A debounce keeps a busy console (a restart writes a burst of lines) from
  // turning into a request per line.
  const debounced = debounce(refreshAll, 400);
  unsubs.push(subscribeStatus(() => debounced(), onChannelStatus));
  unsubs.push(subscribeEvents(() => refreshEvents(), onChannelStatus));
  unsubs.push(subscribeConsole(() => debounced(), onChannelStatus));
  unsubs.push(subscribeCommands((payload) => {
    if (payload.eventType === "UPDATE" && payload.new?.status === "failed") {
      toast(`${payload.new.command} failed: ${payload.new.error || "no detail"}`, "error", 7000);
    }
    refreshCommands();
  }, onChannelStatus));
}

window.addEventListener("pagehide", () => {
  for (const off of unsubs) {
    try {
      off();
    } catch {}
  }
  unsubs = [];
});

// ---------- tabs ----------

function showTab(tab) {
  for (const btn of $("#bridgeTabs").querySelectorAll(".tab")) {
    btn.dataset.active = String(btn.dataset.tab === tab);
  }
  $("#bridgeStatusPanel").hidden = tab !== "status";
  $("#bridgeEventsPanel").hidden = tab !== "events";
  $("#bridgeConsolePanel").hidden = tab !== "console";
  $("#bridgeCommandsPanel").hidden = tab !== "commands";
  if (tab === "events") refreshEvents();
  if (tab === "console") refreshConsole();
  if (tab === "commands") refreshCommands();
}

function setupTabs() {
  $("#bridgeTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || btn.hidden) return;
    showTab(btn.dataset.tab);
  });
  $("#eventLevel").addEventListener("change", refreshEvents);
  $("#consoleLevel").addEventListener("change", refreshConsole);
  $("#copyConsoleBtn").addEventListener("click", onCopyConsole);
  createSelect($("#eventLevelSelect"));
  createSelect($("#consoleLevelSelect"));
  categorySelect = createSelect($("#eventCategorySelect"));
  if (categorySelect) {
    categorySelect.setOptions([], { placeholder: "All categories" });
  }
  $("#bridgeRetryBtn").addEventListener("click", () => {
    failures.clear();
    renderLoadState();
    refreshAll();
  });
}

// ---------- status ----------

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshEvents(), refreshConsole(), refreshCommands()]);
}

async function refreshStatus() {
  try {
    status = await fetchStatus();
    noteResult("status", null);
  } catch (err) {
    noteResult("status", err);
    return;
  }
  renderStatus();
}

function renderStatus() {
  if (!status) {
    setStatusBadge(null, "No data");
    $("#statVersion").textContent = "-";
    $("#statUptime").textContent = "-";
    $("#statStarted").textContent = "the server has not reported since the migration ran";
    $("#statQueued").textContent = "-";
    $("#statQueuedSub").textContent = "across all sinks";
    $("#statConfig").textContent = "-";
    $("#statServer").textContent = "-";
    $("#statInstance").textContent = "-";
    $("#sinksTableBody").innerHTML = "";
    $("#sinksUpdated").textContent = "-";
    return;
  }

  const online = !!status.online;
  const age = Date.now() - new Date(status.updated_at).getTime();
  const stale = age > 90_000;
  setStatusBadge(
    !online ? "offline" : stale ? "warn" : "online",
    !online ? "Offline" : stale ? `Last seen ${formatRelativeTime(status.updated_at)}` : "Online",
  );

  $("#statVersion").textContent = status.plugin_version || "-";
  $("#statInstance").textContent = status.instance_id ? `instance ${status.instance_id.slice(0, 8)}` : "-";
  $("#statUptime").textContent = online && status.started_at ? formatUptime(Date.now() - new Date(status.started_at).getTime()) : "-";
  $("#statStarted").textContent = status.started_at ? `since ${formatRelativeTime(status.started_at)}` : "-";
  $("#statConfig").textContent = status.remote_config_version ? `v${status.remote_config_version}` : "not loaded";
  $("#statServer").textContent = status.server_version || "-";

  const sinks = status.sinks || {};
  const tables = Object.entries(sinks);
  const queued = tables.reduce((sum, [, s]) => sum + (Number(s?.pending) || 0), 0);
  const failing = tables.filter(([, s]) => s?.last_error).length;
  $("#statQueued").textContent = String(queued);
  $("#statQueuedSub").textContent = failing ? `${failing} sink(s) reporting errors` : "across all sinks, none failing";
  $("#sinksUpdated").textContent = `updated ${formatRelativeTime(status.updated_at)}`;

  $("#sinksTableBody").innerHTML = tables
    .map(([table, s]) => {
      const err = s?.last_error;
      return `<tr>
        <td><code>${escapeHtml(table)}</code></td>
        <td>${Number(s?.pending) || 0}</td>
        <td>${Number(s?.dropped) || 0}</td>
        <td>${err ? `<span class="bridge-error-text">${escapeHtml(err)}</span>` : `<span class="bridge-ok">ok</span>`}</td>
      </tr>`;
    })
    .join("");
}

// ---------- events ----------

/** Maps an event level onto the site's badge state vocabulary. */
function levelBadge(level) {
  const cls = level === "error" ? "badge-danger" : level === "warn" ? "badge-warn" : "";
  return `<span class="badge${cls ? ` ${cls}` : ""}">${escapeHtml(level)}</span>`;
}

/** Maps a command status onto the site's badge state vocabulary. */
function statusBadge(status) {
  const cls = { done: "badge-online", failed: "badge-danger", pending: "badge-warn" }[status] || "";
  return `<span class="badge${cls ? ` ${cls}` : ""}">${escapeHtml(status)}</span>`;
}

async function refreshEvents() {
  const level = $("#eventLevel").value;
  const category = $("#eventCategory").value;
  let rows = [];
  try {
    rows = await fetchEvents({ level: level || null, category: category || null, limit: 200 });
    noteResult("events", null);
  } catch (err) {
    noteResult("events", err);
    return;
  }
  syncCategoryFilter(rows);
  $("#eventsEmpty").hidden = rows.length > 0;
  $("#eventsList").innerHTML = rows
    .map((e) => {
      const details = e.details && Object.keys(e.details).length ? `<pre class="bridge-event-details">${escapeHtml(JSON.stringify(e.details, null, 2))}</pre>` : "";
      return `<article class="bridge-event" data-level="${escapeHtml(e.level)}">
        <div class="bridge-event-head">
          ${levelBadge(e.level)}
          <code class="bridge-event-code">${escapeHtml(e.event)}</code>
          <span class="bridge-subtle">${escapeHtml(formatRelativeTime(e.created_at))}</span>
        </div>
        <p class="bridge-event-message">${escapeHtml(e.message)}</p>
        ${details}
      </article>`;
    })
    .join("");
}

function syncCategoryFilter(rows) {
  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const signature = categories.join("|");
  if ($("#eventCategory").dataset.signature === signature) return;
  $("#eventCategory").dataset.signature = signature;
  categorySelect?.setOptions(categories.map((c) => ({ value: c, label: c })), { placeholder: "All categories" });
}

// ---------- console ----------

async function refreshConsole() {
  const level = $("#consoleLevel").value;
  let rows = [];
  try {
    rows = await fetchConsole({ level: level || null, limit: 400 });
    noteResult("console", null);
  } catch (err) {
    noteResult("console", err);
    return;
  }
  consoleRows = rows;
  const pre = $("#consoleOutput");
  $("#consoleEmpty").hidden = rows.length > 0;
  pre.hidden = rows.length === 0;
  pre.textContent = rows.map((r) => `[${new Date(r.created_at).toLocaleTimeString()}] ${r.level.toUpperCase().padEnd(5)} ${r.message}`).join("\n");
  pre.scrollTop = pre.scrollHeight;
}

function onCopyConsole() {
  if (!consoleRows.length) {
    toast("Nothing to copy yet.", "info");
    return;
  }
  copyTextToClipboard(
    consoleRows.map((r) => `[${new Date(r.created_at).toLocaleString()}] ${r.level.toUpperCase()} ${r.message}`).join("\n"),
    $("#copyConsoleBtn"),
  );
}

// ---------- commands ----------

function renderActions() {
  $("#bridgeActions").innerHTML = BRIDGE_COMMANDS.map(
    (c) => `
      <div class="bridge-action" data-command="${escapeHtml(c.id)}">
        <div class="bridge-action-text">
          <span class="bridge-action-label"><i class="fa-solid ${c.icon}" aria-hidden="true"></i>${escapeHtml(c.label)}</span>
          <span class="bridge-action-hint">${escapeHtml(c.hint)}</span>
        </div>
        <button class="btn ${c.danger ? "btn-danger" : "btn-ghost"} btn-sm" type="button" data-run="${escapeHtml(c.id)}">Run</button>
      </div>`,
  ).join("");

  $("#bridgeActions").addEventListener("click", onRunAction);
}

async function onRunAction(e) {
  const btn = e.target.closest("[data-run]");
  if (!btn) return;
  const id = btn.dataset.run;
  const meta = BRIDGE_COMMANDS.find((c) => c.id === id);
  if (!meta) return;

  const warning = meta.danger
    ? `${meta.label} will restart the server once the jar is swapped.`
    : `${meta.label} on the live server.`;

  const ok = await confirmAction(warning, {
    title: "Run on the live server?",
    confirmLabel: meta.label,
    danger: !!meta.danger,
  });
  if (!ok) return;

  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>`;
  try {
    await requestCommand(id);
    toast(`Queued ${meta.label}. The server picks it up within a few seconds.`, "success");
  } catch (err) {
    toast(err.message || "Could not queue that action.", "error", 7000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function refreshCommands() {
  let rows = [];
  try {
    rows = await fetchCommands(40);
    noteResult("commands", null);
  } catch (err) {
    noteResult("commands", err);
    return;
  }
  $("#commandsEmpty").hidden = rows.length > 0;
  $("#commandsList").innerHTML = rows
    .map((c) => {
      const result = c.result ? `<pre class="bridge-command-output">${escapeHtml(c.result)}</pre>` : "";
      const error = c.error ? `<p class="bridge-error-text">${escapeHtml(c.error)}</p>` : "";
      return `<article class="bridge-command-row" data-status="${escapeHtml(c.status)}">
        <div class="bridge-command-head">
          ${statusBadge(c.status)}
          <code>${escapeHtml(c.command)}</code>
          <span class="bridge-subtle">${escapeHtml(formatRelativeTime(c.requested_at))}</span>
          ${c.requested_by_username ? `<span class="bridge-subtle">by ${escapeHtml(c.requested_by_username)}</span>` : ""}
        </div>
        ${error}
        ${result}
      </article>`;
    })
    .join("");
}

refreshAccess();
Auth.onAuthChange(() => refreshAccess());
