import * as Auth from "../lib/auth.js";
import { initNav, openAuthModal } from "../lib/nav.js";
import { listChatMessages, subscribeChatMessages, sendWebMessage, CHAT_MESSAGE_MAX } from "../lib/chat.js";
import { getServerStatus, subscribeServerStatus, listPlayers, subscribePlayers } from "../lib/live.js";
import { settings, saveSettings } from "../lib/settings.js";
import { escapeHtml, formatAbsoluteTime, toast } from "../lib/ui.js";

const $ = (sel) => document.querySelector(sel);
const STATUS_REPOLL_MS = 5000;
const MAX_MESSAGES = 500;
const SEND_COOLDOWN_MS = 1200;

await initNav("chat");

let chatUnsub = null;
let statusUnsub = null;
let statusTimer = null;
let messages = [];
const seenIds = new Set();
let listLoaded = false;
let serverOnline = null; // null = unknown; sending is never blocked, only relaying depends on the server
let lastSendAt = 0;

let onlinePlayers = [];
let onlinePlayersFingerprint = null;
let playersRequestId = 0;

// ---------- join/leave message filter ----------

let showJoinLeave = settings.showJoinLeaveSystemMessages;

function isJoinLeaveSystemMessage(m) {
  return m?.kind === "system" && /joined the (game|server)|left the (game|server)/i.test(m.message || "");
}

function isHiddenMessage(m) {
  return !showJoinLeave && isJoinLeaveSystemMessage(m);
}

function visibleMessages() {
  return showJoinLeave ? messages : messages.filter((m) => !isHiddenMessage(m));
}

// ---------- auth gate ----------

function isAuthed() {
  return Auth.isLoggedIn();
}

function renderAuthState() {
  const authed = isAuthed();
  $("#chatGate").hidden = authed;
  $("#chatCard").hidden = !authed;
  $("#chatSide").hidden = !authed;
  document.querySelector(".chat-layout").classList.toggle("chat-layout--gate", !authed);
  if (authed) {
    if (!listLoaded) loadChat();
  } else {
    teardown();
  }
  updateComposer();
}

async function loadChat() {
  try {
    messages = await listChatMessages(200);
    seenIds.clear();
    for (const m of messages) seenIds.add(m.id);
    listLoaded = true;
    $("#chatEmpty").querySelector("span").textContent = "No messages yet.";
    seedServerState();
    renderAll();
  } catch (err) {
    console.error(err);
    listLoaded = true;
    $("#chatSkeleton").hidden = true;
    $("#chatEmpty").hidden = false;
    $("#chatEmpty").querySelector("span").textContent = "Could not load chat.";
  }

  try {
    const status = await getServerStatus();
    setServerOnline(serverOnline ?? (status ? true : false));
  } catch (err) {
    console.error(err);
    setServerOnline(false);
  }

  startStatusTicker();

  chatUnsub = subscribeChatMessages((payload) => {
    if (payload?.eventType === "INSERT" && payload.new) {
      const row = payload.new;
      if (row.kind === "system") {
        if (/offline/i.test(row.message)) setServerOnline(false);
        else if (/server online|started|booted/i.test(row.message)) setServerOnline(true);
      }
      appendMessage(row);
    }
  });

  statusUnsub = subscribeServerStatus((payload) => {
    if (payload?.new && noteServerStatus(payload.new)) setServerOnline(true);
  });

  subscribePlayers(debounceRefreshPlayers);
  refreshOnlinePlayers();
}

function teardown() {
  chatUnsub?.();
  chatUnsub = null;
  statusUnsub?.();
  statusUnsub = null;
  stopStatusTicker();
  messages = [];
  seenIds.clear();
  listLoaded = false;
  serverOnline = null;
  $("#chatStatusPill").hidden = true;
  $("#chatSkeleton").hidden = true;
  $("#chatEmpty").hidden = false;
  $("#chatEmpty").querySelector("span").textContent = "Sign in to view and send chat.";
}

// ---------- server online/offline ----------
//
// The pill is driven by the plugin's authoritative "Server online"/"Server
// offline" system chat rows, with a heartbeat-silence fallback for hard crashes.
// Silence is measured with the client's monotonic clock since the last *new*
// status row - never by comparing Date.now() to the server's watermark - so a
// skewed client clock can't leave the badge stuck on "Server online".

let lastStatusAt = 0;
let lastStatusArrival = 0;
const statusDeltas = [];
let statusMedian = 0;

function staleAfterMs() {
  return statusMedian > 0
    ? Math.max(10000, Math.min(60000, Math.round(statusMedian * 2.2)))
    : 30000;
}

/** Records a status row. Returns true when it's a NEWER row than the last one
 *  seen this session - i.e. the server is demonstrably alive right now. */
function noteServerStatus(status) {
  if (!status || !status.updated_at) return false;
  const t = new Date(status.updated_at).getTime();
  if (!Number.isFinite(t)) return false;
  if (lastStatusAt > 0 && t > lastStatusAt) {
    const delta = t - lastStatusAt;
    if (delta > 0 && delta < 600000) {
      statusDeltas.push(delta);
      if (statusDeltas.length > 5) statusDeltas.splice(0, statusDeltas.length - 5);
      const sorted = [...statusDeltas].sort((a, b) => a - b);
      statusMedian = sorted[Math.floor(sorted.length / 2)];
    }
    lastStatusAt = t;
    lastStatusArrival = performance.now();
    return true;
  }
  if (lastStatusAt === 0) {
    lastStatusAt = t;
    lastStatusArrival = performance.now();
  }
  return false;
}

function startStatusTicker() {
  stopStatusTicker();
  statusTimer = setInterval(pollServerStatus, STATUS_REPOLL_MS);
}

function stopStatusTicker() {
  if (statusTimer !== null) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

async function pollServerStatus() {
  try {
    if (noteServerStatus(await getServerStatus())) setServerOnline(true);
  } catch (err) {
    console.error(err);
  }
  if (lastStatusArrival > 0 && performance.now() - lastStatusArrival > staleAfterMs()) {
    setServerOnline(false);
  }
}

/** Initial pill from the latest system online/offline message in the log. */
function seedServerState() {
  serverOnline = null;
  for (const m of messages) {
    if (m.kind !== "system" || !m.message) continue;
    if (/server online|started|booted/i.test(m.message)) serverOnline = true;
    else if (/offline/i.test(m.message)) serverOnline = false;
  }
}

function setServerOnline(online) {
  if (serverOnline === online) return;
  serverOnline = online;

  const pill = $("#chatStatusPill");
  pill.hidden = false;
  pill.className = "badge " + (online ? "badge-online" : "badge-offline");
  pill.textContent = online ? "Server online" : "Server offline";

  updateComposer();
}

// ---------- composer ----------

function updateComposer() {
  const authed = isAuthed();
  const online = serverOnline === true;
  const canSend = authed;
  $("#chatInput").disabled = !canSend;
  $("#chatSend").disabled = !canSend;
  $("#chatInput").placeholder = authed
    ? online
      ? "Say something to the server..."
      : "Server offline - your message stays on the web chat"
    : "Sign in to send messages";
}

function updateCount() {
  $("#chatCount").textContent = `${$("#chatInput").value.length}/${CHAT_MESSAGE_MAX}`;
}

$("#chatComposer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  if (!isAuthed()) {
    openAuthModal("login");
    return;
  }
  if (Date.now() - lastSendAt < SEND_COOLDOWN_MS) {
    toast("Slow down - one message at a time.", "error");
    return;
  }
  const state = Auth.getState();
  const userId = state?.session?.user?.id ?? null;
  const username = state?.profile?.username ?? null;
  if (!username) {
    toast("Your account isn't linked to a username yet.", "error");
    return;
  }
  lastSendAt = Date.now();
  try {
    await sendWebMessage({ userId, username, message: text });
    input.value = "";
    updateCount();
    input.focus();
  } catch (err) {
    toast(err.message || "Couldn't send the message.", "error");
  }
});

$("#chatInput").addEventListener("input", updateCount);

$("#chatSignInBtn").addEventListener("click", () => openAuthModal("login"));

// ---------- message list ----------

function buildRow(m) {
  const row = document.createElement("div");
  row.title = formatAbsoluteTime(m.created_at);
  if (m.kind === "system") {
    row.className = "chat-msg chat-msg-system";
    const joined = / joined the (game|server)/i.test(m.message);
    const left = / left the (game|server)/i.test(m.message);
    const offline = /offline/i.test(m.message);
    let cls = "online";
    if (offline) {
      cls = "offline";
    } else if (joined) {
      cls = "join";
    } else if (left) {
      cls = "left";
    }
    row.classList.add(cls);
    row.textContent = m.message;
    return row;
  }
  row.className = "chat-msg";
  const isWeb = m.kind === "web";
  const author = m.username || "?";
  const suffix = author + ": " + m.message;
  if (isWeb) {
    const b = document.createElement("span");
    b.className = "chat-prefix";
    b.textContent = "[web] ";
    row.appendChild(b);
  }
  row.appendChild(document.createTextNode(suffix));
  return row;
}

function renderAll() {
  const list = $("#chatMessages");
  for (let i = list.children.length - 1; i >= 0; i--) {
    if (list.children[i].classList.contains("chat-msg")) list.children[i].remove();
  }
  if (!listLoaded) {
    $("#chatSkeleton").hidden = false;
    return;
  }
  $("#chatSkeleton").hidden = true;
  const visible = visibleMessages();
  $("#chatEmpty").hidden = visible.length > 0;
  const frag = document.createDocumentFragment();
  for (const m of visible) frag.appendChild(buildRow(m));
  list.appendChild(frag);
  scrollToBottom();
}

function insertSortedElement(row) {
  const t = new Date(row.created_at).getTime();
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (new Date(messages[mid].created_at).getTime() <= t) lo = mid + 1;
    else hi = mid;
  }
  messages.splice(lo, 0, row);
  // Hidden rows stay in `messages` (ordering + dedupe) but produce no DOM node,
  // so the DOM insertion index is the count of *visible* rows before this one.
  if (!isHiddenMessage(row)) {
    let domIndex = 0;
    for (let i = 0; i < lo; i++) if (!isHiddenMessage(messages[i])) domIndex++;
    const list = $("#chatMessages");
    // #chatSkeleton / #chatEmpty are also children, so address rows via their
    // index among the actual messages to keep DOM order aligned with `messages`.
    list.insertBefore(buildRow(row), list.querySelectorAll(".chat-msg")[domIndex] ?? null);
  }
  const over = messages.length - MAX_MESSAGES;
  if (over > 0) {
    messages.splice(0, over);
    const list = $("#chatMessages");
    for (let i = 0; i < over; i++) list.querySelector(".chat-msg")?.remove();
  }
}

function appendMessage(row) {
  if (!row || !row.id || seenIds.has(row.id)) return;
  seenIds.add(row.id);
  const nearBottom = isNearBottom();
  insertSortedElement(row);
  $("#chatSkeleton").hidden = true;
  $("#chatEmpty").hidden = visibleMessages().length > 0;
  if (nearBottom) scrollToBottom();
}

function isNearBottom() {
  const list = $("#chatMessages");
  return list.scrollHeight - list.scrollTop - list.clientHeight < 96;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
  });
}

// ---------- online players ----------

async function refreshOnlinePlayers() {
  const requestId = ++playersRequestId;
  try {
    const players = await listPlayers();
    if (requestId !== playersRequestId) return;
    onlinePlayers = players.filter((p) => p.online);
    $("#onlineSkeleton").hidden = true;
    renderOnlinePlayers();
  } catch (err) {
    if (requestId !== playersRequestId) return;
    console.error(err);
    onlinePlayers = [];
    $("#onlineSkeleton").hidden = true;
    renderOnlinePlayers();
    $("#onlineEmpty").querySelector("span").textContent = "Could not load players.";
    $("#onlineCount").textContent = "-";
  }
}

function debounceRefreshPlayers() {
  clearTimeout(debounceRefreshPlayers._t);
  debounceRefreshPlayers._t = setTimeout(refreshOnlinePlayers, 300);
}

function renderOnlinePlayers() {
  const sorted = [...onlinePlayers].sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
  const fp = sorted.map((p) => `${p.id}:${p.username}`).join("\n");
  if (fp === onlinePlayersFingerprint) return;
  onlinePlayersFingerprint = fp;

  const countEl = $("#onlineCount");
  countEl.textContent = `${sorted.length} online`;
  countEl.classList.toggle("has-online", sorted.length > 0);

  const list = $("#onlinePlayersList");
  for (let i = list.children.length - 1; i >= 0; i--) {
    if (list.children[i].classList.contains("players-row")) list.children[i].remove();
  }
  $("#onlineEmpty").hidden = sorted.length > 0;
  $("#onlineEmpty").querySelector("span").textContent = "No players online.";

  const frag = document.createDocumentFragment();
  for (const p of sorted) {
    const row = document.createElement("div");
    row.className = "players-row";
    row.innerHTML = `
      <img class="players-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(p.username)}/32" alt="" width="24" height="24" loading="lazy" />
      <button class="players-username" type="button">${escapeHtml(p.username)}</button>
    `;
    row.querySelector(".players-username").addEventListener("click", () => {
      window.location.href = `/profile?user=${encodeURIComponent(p.username)}`;
    });
    frag.appendChild(row);
  }
  list.appendChild(frag);
}

renderAuthState();
Auth.onAuthChange(() => renderAuthState());

const joinLeaveToggle = $("#chatJoinLeaveToggle");
joinLeaveToggle.checked = showJoinLeave;
joinLeaveToggle.addEventListener("change", (e) => {
  showJoinLeave = e.target.checked;
  settings.showJoinLeaveSystemMessages = showJoinLeave;
  saveSettings();
  if (listLoaded) renderAll();
});