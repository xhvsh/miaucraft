import * as Auth from "../lib/auth.js";
import {
  BRIDGE_COMMANDS,
  fetchStatus,
  fetchEventsPage,
  fetchConsole,
  fetchCommandsPage,
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
let eventsCurrentPage = 1;
let eventsTotal = 0;
let commandsCurrentPage = 1;
let commandsTotal = 0;
let unsubs = [];
/** Panel name -> last load failed. Drives the retry banner. */
const failures = new Set();
/** Table -> realtime channel state. A dead subscription is otherwise invisible. */
const channelStates = new Map();
const LIVE_TABLES = ["bridge_status", "bridge_events", "bridge_console", "bridge_commands"];
/** The category filter is rebuilt from the data, so it needs its controller. */
let categorySelect = null;

// Realtime health also gates the polling fallback: while any channel is not
// SUBSCRIBED the page refreshes itself on a timer instead of going quiet.
let debouncedRefresh = null;
let pollTimer = null;
const POLL_MS = 30_000;

/** Whether each list has rendered real data once; until then a skeleton shows. */
const loaded = { events: false, console: false, commands: false };

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
 * Reassesses whether live updates are connected, starts/stops the polling
 * fallback and repaints the banner. A subscription to a table missing from the
 * supabase_realtime publication reports SUBSCRIBED but never delivers, so the
 * only honest signal is the channel state itself.
 */
function recomputeRealtime() {
  const states = LIVE_TABLES.map((t) => channelStates.get(t));
  const settled = states.every((s) => s !== undefined);
  const down = settled && LIVE_TABLES.some((t, i) => states[i] !== "SUBSCRIBED");
  if (down) {
    failures.add("live updates");
    if (!pollTimer && debouncedRefresh) {
      pollTimer = setInterval(() => debouncedRefresh(), POLL_MS);
    }
  } else {
    failures.delete("live updates");
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  renderLoadState();
}

function onChannelStatus(state, table) {
  channelStates.set(table, state);
  recomputeRealtime();
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
  $("#bridgeLoadError").hidden = failed.length === 0;
  if (!failed.length) return;
  if (failed.includes("live updates")) {
    $("#bridgeLoadErrorText").textContent =
      "Live updates are not connected, so the page polls every 30 seconds instead. New data still arrives, just up to half a minute later.";
  } else {
    $("#bridgeLoadErrorText").textContent =
      `Could not reach the database for: ${failed.join(", ")}. A paused Supabase project can take a minute to wake up - use Retry.`;
  }
  if (failures.has("status") && !status) {
    setStatusBadge("warn", "Unreachable");
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

/** Locks the action buttons while the server can't possibly run them. */
function updateActionsDisabled() {
  const live = !!status && !!status.online && Date.now() - new Date(status.updated_at).getTime() <= 90_000;
  const hint = $("#bridgeActionsHint");
  for (const btn of $("#bridgeActions").querySelectorAll("[data-run]")) {
    btn.disabled = !live;
  }
  hint.hidden = live;
  if (live) return;
  hint.textContent = !status
    ? "No status yet - the actions unlock once the server has reported in."
    : !status.online
      ? "The server is offline, so actions are paused."
      : "The last status report is older than 90 seconds - actions are paused until the server reports in again.";
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

  debouncedRefresh = debounce(refreshAll, 400);
  setupRealtime();
}

/**
 * Subscribes to the four live feeds. Split from boot so back/forward cache
 * restores (which fire pagehide but keep the page alive) can re-attach.
 */
function setupRealtime() {
  teardownRealtime();
  unsubs.push(subscribeStatus(() => debouncedRefresh(), onChannelStatus));
  unsubs.push(subscribeEvents(() => refreshEvents(), onChannelStatus));
  unsubs.push(subscribeConsole(() => debouncedRefresh(), onChannelStatus));
  unsubs.push(subscribeCommands((payload) => {
    if (payload.eventType === "UPDATE" && payload.new?.status === "failed") {
      toast(`${payload.new.command} failed: ${payload.new.error || "no detail"}`, "error", 7000);
    }
    refreshCommands();
  }, onChannelStatus));
  recomputeRealtime();
}

function teardownRealtime() {
  for (const off of unsubs) {
    try {
      off();
    } catch {}
  }
  unsubs = [];
}

// The page is cached wholesale on back/forward navigation, so pagehide tears
// the subscriptions down and pageshow puts them back - otherwise a restored
// page silently stopped updating.
window.addEventListener("pagehide", teardownRealtime);
window.addEventListener("pageshow", (e) => {
  if (e.persisted && booted) setupRealtime();
});

// ---------- tabs ----------

function showTab(tab) {
  for (const btn of $("#bridgeTabs").querySelectorAll(".tab")) {
    const active = btn.dataset.tab === tab;
    btn.dataset.active = String(active);
    btn.setAttribute("aria-selected", String(active));
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
  $("#eventLevel").addEventListener("change", () => {
    eventsCurrentPage = 1;
    refreshEvents();
  });
  $("#eventCategory").addEventListener("change", () => {
    eventsCurrentPage = 1;
    refreshEvents();
  });
  $("#eventsFirstPageBtn").addEventListener("click", () => goToEventsPage(1));
  $("#eventsPrevPageBtn").addEventListener("click", () => goToEventsPage(eventsCurrentPage - 1));
  $("#eventsNextPageBtn").addEventListener("click", () => goToEventsPage(eventsCurrentPage + 1));
  $("#eventsLastPageBtn").addEventListener("click", () => goToEventsPage(Number($("#eventsPageInput").max) || 1));
  $("#eventsPageInput").addEventListener("change", () => {
    const page = Math.round(Number($("#eventsPageInput").value));
    goToEventsPage(Number.isFinite(page) && page > 0 ? page : 1);
  });
  $("#consoleLevel").addEventListener("change", refreshConsole);
  $("#copyConsoleBtn").addEventListener("click", onCopyConsole);
  $("#commandsFirstPageBtn").addEventListener("click", () => goToCommandsPage(1));
  $("#commandsPrevPageBtn").addEventListener("click", () => goToCommandsPage(commandsCurrentPage - 1));
  $("#commandsNextPageBtn").addEventListener("click", () => goToCommandsPage(commandsCurrentPage + 1));
  $("#commandsLastPageBtn").addEventListener("click", () => goToCommandsPage(Number($("#commandsPageInput").max) || 1));
  $("#commandsPageInput").addEventListener("change", () => {
    const page = Math.round(Number($("#commandsPageInput").value));
    goToCommandsPage(Number.isFinite(page) && page > 0 ? page : 1);
  });
  createSelect($("#eventLevelSelect"));
  createSelect($("#consoleLevelSelect"));
  categorySelect = createSelect($("#eventCategorySelect"));
  if (categorySelect) {
    categorySelect.setOptions([], { placeholder: "All categories" });
  }
  $("#bridgeRetryBtn").addEventListener("click", () => {
    failures.clear();
    setupRealtime();
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
    updateActionsDisabled();
    return;
  }
  renderStatus();
}

function renderStatus() {
  for (const id of ["statVersion", "statUptime", "statQueued", "statConfig"]) {
    $("#" + id).classList.remove("is-skeleton");
  }

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
    $("#sinksTableBody").innerHTML = SINK_SKELETON;
    $("#sinksUpdated").textContent = "-";
    updateActionsDisabled();
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

  $("#sinksTableBody").innerHTML = tables.length
    ? tables
        .map(([table, s]) => {
          const err = s?.last_error;
          return `<tr>
            <td><code>${escapeHtml(table)}</code></td>
            <td>${Number(s?.pending) || 0}</td>
            <td>${Number(s?.dropped) || 0}</td>
            <td>${err ? `<span class="bridge-error-text">${escapeHtml(err)}</span>` : `<span class="bridge-ok">ok</span>`}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="users-table-empty">No sink data yet.</td></tr>`;

  updateActionsDisabled();
}

const SINK_SKELETON = `
  <tr class="users-table-sk-row">
    <td><span class="skeleton sk-line" style="width:72%"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line" style="width:58%"></span></td>
  </tr>
  <tr class="users-table-sk-row">
    <td><span class="skeleton sk-line" style="width:64%"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line" style="width:52%"></span></td>
  </tr>
  <tr class="users-table-sk-row">
    <td><span class="skeleton sk-line" style="width:76%"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line" style="width:60%"></span></td>
  </tr>
  <tr class="users-table-sk-row">
    <td><span class="skeleton sk-line" style="width:58%"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line" style="width:48%"></span></td>
  </tr>
  <tr class="users-table-sk-row">
    <td><span class="skeleton sk-line" style="width:68%"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line tiny"></span></td>
    <td><span class="skeleton sk-line" style="width:55%"></span></td>
  </tr>`;

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
  let count = 0;
  try {
    ({ rows, count } = await fetchEventsPage({ level: level || null, category: category || null, page: eventsCurrentPage, perPage: 20 }));
    noteResult("events", null);
  } catch (err) {
    noteResult("events", err);
    return;
  }
  if (!loaded.events) {
    loaded.events = true;
    $("#eventsSkeleton").hidden = true;
  }
  syncCategoryFilter(rows);
  eventsTotal = count ?? 0;
  $("#eventsEmpty").hidden = count > 0;
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
  renderEventsPagination();
}

function renderEventsPagination() {
  const totalPages = Math.max(1, Math.ceil(eventsTotal / 20));
  eventsCurrentPage = Math.min(Math.max(1, eventsCurrentPage), totalPages);
  $("#eventsPagination").hidden = totalPages <= 1;
  $("#eventsPageInput").value = eventsCurrentPage;
  $("#eventsPageInput").max = totalPages;
  $("#eventsPageTotal").textContent = totalPages;
  $("#eventsFirstPageBtn").disabled = eventsCurrentPage <= 1;
  $("#eventsPrevPageBtn").disabled = eventsCurrentPage <= 1;
  $("#eventsNextPageBtn").disabled = eventsCurrentPage >= totalPages;
  $("#eventsLastPageBtn").disabled = eventsCurrentPage >= totalPages;
}

function goToEventsPage(page) {
  eventsCurrentPage = Math.max(1, Math.round(page) || 1);
  refreshEvents();
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
    rows = await fetchConsole({ level: level || null, limit: 150 });
    noteResult("console", null);
  } catch (err) {
    noteResult("console", err);
    return;
  }
  if (!loaded.console) {
    loaded.console = true;
    $("#consoleSkeleton").hidden = true;
  }
  consoleRows = rows;
  const pre = $("#consoleOutput");
  $("#consoleEmpty").hidden = rows.length > 0;
  pre.hidden = rows.length === 0;
  if (rows.length) {
    pre.textContent = rows.map((r) => `[${new Date(r.created_at).toLocaleTimeString()}] ${r.level.toUpperCase().padEnd(5)} ${r.message}`).join("\n");
    pre.scrollTop = pre.scrollHeight;
  }
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
      <div class="setting-row bridge-action" data-command="${escapeHtml(c.id)}">
        <div class="setting-row-text">
          <span class="setting-row-label"><i class="fa-solid ${c.icon}" aria-hidden="true"></i>${escapeHtml(c.label)}</span>
          <span class="setting-row-desc">${escapeHtml(c.hint)}</span>
        </div>
        <button class="btn ${c.danger ? "btn-danger" : "btn-ghost"} btn-sm" type="button" data-run="${escapeHtml(c.id)}">Run</button>
      </div>`,
  ).join("");

  $("#bridgeActions").addEventListener("click", onRunAction);
  updateActionsDisabled();
}

async function onRunAction(e) {
  const btn = e.target.closest("[data-run]");
  if (!btn || btn.disabled) return;
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
    updateActionsDisabled();
  }
}

async function refreshCommands() {
  let rows = [];
  let count = 0;
  try {
    ({ rows, count } = await fetchCommandsPage({ page: commandsCurrentPage, perPage: 20 }));
    noteResult("commands", null);
  } catch (err) {
    noteResult("commands", err);
    return;
  }
  if (!loaded.commands) {
    loaded.commands = true;
    $("#commandsSkeleton").hidden = true;
  }
  commandsTotal = count ?? 0;
  $("#commandsEmpty").hidden = count > 0;
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
  renderCommandsPagination();
}

function renderCommandsPagination() {
  const totalPages = Math.max(1, Math.ceil(commandsTotal / 20));
  commandsCurrentPage = Math.min(Math.max(1, commandsCurrentPage), totalPages);
  $("#commandsPagination").hidden = totalPages <= 1;
  $("#commandsPageInput").value = commandsCurrentPage;
  $("#commandsPageInput").max = totalPages;
  $("#commandsPageTotal").textContent = totalPages;
  $("#commandsFirstPageBtn").disabled = commandsCurrentPage <= 1;
  $("#commandsPrevPageBtn").disabled = commandsCurrentPage <= 1;
  $("#commandsNextPageBtn").disabled = commandsCurrentPage >= totalPages;
  $("#commandsLastPageBtn").disabled = commandsCurrentPage >= totalPages;
}

function goToCommandsPage(page) {
  commandsCurrentPage = Math.max(1, Math.round(page) || 1);
  refreshCommands();
}

refreshAccess();
Auth.onAuthChange(() => refreshAccess());