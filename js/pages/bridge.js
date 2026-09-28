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
import { escapeHtml, toast, confirmAction, copyTextToClipboard, formatRelativeTime, formatUptime, debounce } from "../lib/ui.js";
import { initNav } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

await initNav("bridge");

let booted = false;
let status = null;
let consoleRows = [];
let unsubs = [];

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
  unsubs.push(subscribeStatus(() => debounced()));
  unsubs.push(subscribeEvents(() => refreshEvents()));
  unsubs.push(subscribeConsole(() => debounced()));
  unsubs.push(subscribeCommands((payload) => {
    if (payload.eventType === "UPDATE" && payload.new?.status === "failed") {
      toast(`${payload.new.command} failed: ${payload.new.error || "no detail"}`, "error", 7000);
    }
    refreshCommands();
  }));
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
  $("#eventCategory").addEventListener("change", refreshEvents);
  $("#consoleLevel").addEventListener("change", refreshConsole);
  $("#copyConsoleBtn").addEventListener("click", onCopyConsole);
}

// ---------- status ----------

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshEvents(), refreshConsole(), refreshCommands()]);
}

async function refreshStatus() {
  try {
    status = await fetchStatus();
  } catch (err) {
    console.error("bridge status", err);
    return;
  }
  renderStatus();
}

function renderStatus() {
  const pill = $("#bridgeLivePill");
  if (!status) {
    pill.dataset.state = "unknown";
    $("#bridgeLiveText").textContent = "No status yet";
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
  pill.dataset.state = online ? "online" : "offline";
  const age = Date.now() - new Date(status.updated_at).getTime();
  const stale = age > 90_000;
  if (online && stale) {
    pill.dataset.state = "stale";
  }
  $("#bridgeLiveText").textContent = stale
    ? `Last seen ${formatRelativeTime(status.updated_at)}`
    : online
      ? "Online"
      : "Offline";

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

async function refreshEvents() {
  const level = $("#eventLevel").value;
  const category = $("#eventCategory").value;
  let rows = [];
  try {
    rows = await fetchEvents({ level: level || null, category: category || null, limit: 200 });
  } catch (err) {
    console.error("bridge events", err);
    return;
  }
  syncCategoryFilter(rows);
  $("#eventsEmpty").hidden = rows.length > 0;
  $("#eventsList").innerHTML = rows
    .map((e) => {
      const details = e.details && Object.keys(e.details).length ? `<pre class="bridge-event-details">${escapeHtml(JSON.stringify(e.details, null, 2))}</pre>` : "";
      return `<article class="bridge-event" data-level="${escapeHtml(e.level)}">
        <div class="bridge-event-head">
          <span class="bridge-badge" data-level="${escapeHtml(e.level)}">${escapeHtml(e.level)}</span>
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
  const select = $("#eventCategory");
  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const current = select.value;
  const wanted = ["", ...categories].join("|");
  if (select.dataset.signature === wanted) return;
  select.dataset.signature = wanted;
  select.innerHTML =
    `<option value="">All categories</option>` +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value = categories.includes(current) ? current : "";
}

// ---------- console ----------

async function refreshConsole() {
  const level = $("#consoleLevel").value;
  let rows = [];
  try {
    rows = await fetchConsole({ level: level || null, limit: 400 });
  } catch (err) {
    console.error("bridge console", err);
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
  } catch (err) {
    console.error("bridge commands", err);
    return;
  }
  $("#commandsEmpty").hidden = rows.length > 0;
  $("#commandsList").innerHTML = rows
    .map((c) => {
      const result = c.result ? `<pre class="bridge-command-output">${escapeHtml(c.result)}</pre>` : "";
      const error = c.error ? `<p class="bridge-error-text">${escapeHtml(c.error)}</p>` : "";
      return `<article class="bridge-command-row" data-status="${escapeHtml(c.status)}">
        <div class="bridge-command-head">
          <span class="bridge-badge" data-status="${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
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
