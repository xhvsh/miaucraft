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

// ---------- system-message filter ----------

let showJoinLeave = settings.showJoinLeaveSystemMessages;

function isJoinLeaveSystemMessage(m) {
  return m?.kind === "system" && /joined the (game|server)|left the (game|server)/i.test(m.message || "");
}

function isServerOnlineMessage(m) {
  return m?.kind === "system" && /server online|started|booted/i.test(m.message || "");
}

function isServerOfflineMessage(m) {
  return m?.kind === "system" && /offline/i.test(m.message || "");
}

function isHiddenSystemMessage(m) {
  return isJoinLeaveSystemMessage(m) || isServerOnlineMessage(m) || isServerOfflineMessage(m);
}

function isHiddenMessage(m) {
  return !showJoinLeave && isHiddenSystemMessage(m);
}

function visibleMessages() {
  return showJoinLeave ? messages : messages.filter((m) => !isHiddenMessage(m));
}

// ---------- auth ----------

function isAuthed() {
  return Auth.isLoggedIn();
}

function renderAuthState() {
  const authed = isAuthed();
  // The chat UI (online players, server pill, composer) is always on the page;
  // only the message feed needs auth, so a signed-out user still gets a live,
  // tappable room instead of a dead gate card.
  $("#chatCard").hidden = false;
  $("#chatSide").hidden = false;
  if (authed) {
    if (!listLoaded) {
      $("#chatSkeleton").hidden = false;
      $("#chatEmpty").hidden = true;
      loadChat();
    }
  } else {
    chatUnsub?.();
    chatUnsub = null;
    messages = [];
    seenIds.clear();
    listLoaded = false;
    serverOnline = null;
    $("#chatSkeleton").hidden = true;
    $("#chatEmpty").hidden = false;
    $("#chatEmpty").querySelector("span").textContent = "Sign in to view and send chat.";
  }
  updateComposer();
  maybeFocusComposer();
}

async function loadChat() {
  try {
    messages = await listChatMessages(200);
    seenIds.clear();
    for (const m of messages) seenIds.add(m.id);
    listLoaded = true;
    $("#chatEmpty").querySelector("span").textContent = "No messages yet.";
    renderAll();
  } catch (err) {
    console.error(err);
    listLoaded = true;
    $("#chatSkeleton").hidden = true;
    $("#chatEmpty").hidden = false;
    $("#chatEmpty").querySelector("span").textContent = "Could not load chat.";
  }

  chatUnsub = subscribeChatMessages((payload) => {
    if (payload?.eventType === "INSERT" && payload.new) {
      const row = payload.new;
      if (row.kind === "system") {
        if (isServerOfflineMessage(row)) setServerOnline(false);
        else if (isServerOnlineMessage(row)) setServerOnline(true);
      }
      appendMessage(row);
    }
  });
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

function setServerOnline(online) {
  const pill = $("#chatStatusPill");
  // Always render the pill, even when it already holds this value: seeding the
  // state from a system row used to leave it stuck hidden on first paint.
  pill.hidden = false;
  pill.className = "badge " + (online ? "badge-online" : "badge-offline");
  pill.textContent = online ? "Server online" : "Server offline";
  if (serverOnline !== online) {
    serverOnline = online;
    updateComposer();
  }
}

// The server pill is page-wide, not auth-gated: it boots once and keeps
// polling/realtime even if the user signs out.
let statusStarted = false;
async function startStatusPill() {
  if (statusStarted) return;
  statusStarted = true;
  try {
    setServerOnline(!!(await getServerStatus()));
  } catch (err) {
    console.error(err);
    setServerOnline(false);
  }
  startStatusTicker();
  statusUnsub = subscribeServerStatus((payload) => {
    if (payload?.new && noteServerStatus(payload.new)) setServerOnline(true);
  });
}

// ---------- composer ----------

function updateComposer() {
  const authed = isAuthed();
  const online = serverOnline === true;
  // Never disable the box: a signed-out user can still type, and submitting
  // opens the sign-in modal instead of silently dropping text. The placeholder
  // explains the two states.
  $("#chatInput").disabled = false;
  $("#chatSend").disabled = false;
  $("#chatInput").placeholder = authed
    ? online
      ? "Say something to the server..."
      : "Server offline - your message stays on the web chat"
    : "Sign in to send messages";
}

// Autofocus the composer on desktop only - on touch screens the keyboard would
// pop open the moment the page loads, which is why mobile stays unfocused.
function maybeFocusComposer() {
  if (window.matchMedia("(min-width: 861px)").matches && !$("#chatInput").disabled) {
    $("#chatInput").focus();
  }
}

function updateCount() {
  const count = $("#chatInput").value.length;
  const el = $("#chatCount");
  el.textContent = `${count}/${CHAT_MESSAGE_MAX}`;
  el.classList.toggle("chat-count--warn", count >= Math.floor(CHAT_MESSAGE_MAX * 0.85));
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
  const authorEl = document.createElement("span");
  authorEl.className = isWeb ? "chat-author chat-author--web" : "chat-author";
  authorEl.textContent = author + ":";
  const textEl = document.createElement("span");
  textEl.className = "chat-text";
  textEl.textContent = m.message;
  if (isWeb) {
    // "[web] " keeps its space after the tag, and an explicit " " between the
    // author span and the text keeps "name: message" reading naturally; the
    // row is block-flow so they reflow and wrap as one string of text.
    const prefixEl = document.createElement("span");
    prefixEl.className = "chat-prefix";
    prefixEl.textContent = "[web] ";
    row.append(prefixEl, authorEl, " ", textEl);
  } else {
    row.append(authorEl, " ", textEl);
  }
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
    // Hidden rows have no DOM node, so the number of nodes to drop is the
    // count of *visible* rows among the ones being trimmed, not `over`
    // itself. Dropping `over` nodes instead would remove visible messages
    // that are still in `messages`, desyncing the two.
    const trimmed = messages.splice(0, over);
    const list = $("#chatMessages");
    for (const m of trimmed) {
      if (!isHiddenMessage(m)) list.querySelector(".chat-msg")?.remove();
    }
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
  countEl.textContent = sorted.length > 0 ? `${sorted.length} online` : "";
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
    row.querySelector(".players-username").addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.href = `/profile?user=${encodeURIComponent(p.username)}`;
    });
    row.addEventListener("click", () => {
      window.location.href = `/profile?user=${encodeURIComponent(p.username)}`;
    });
    frag.appendChild(row);
  }
  list.appendChild(frag);
}

// The online table is page-wide too: boot it once so it stays live whether or
// not the visitor is signed in.
let onlineStarted = false;
function startOnlinePlayers() {
  if (onlineStarted) return;
  onlineStarted = true;
  subscribePlayers(debounceRefreshPlayers);
  refreshOnlinePlayers();
}

renderAuthState();
Auth.onAuthChange(() => renderAuthState());
startStatusPill();
startOnlinePlayers();

const joinLeaveToggle = $("#chatJoinLeaveToggle");
joinLeaveToggle.checked = showJoinLeave;
joinLeaveToggle.addEventListener("change", (e) => {
  showJoinLeave = e.target.checked;
  settings.showJoinLeaveSystemMessages = showJoinLeave;
  saveSettings();
  if (listLoaded) renderAll();
});

/* Mobile on-screen keyboard. Android resizes the layout viewport for the
   keyboard, so the 100dvh flex chain in chat.css re-flows and the composer
   rises above the keys on its own. iOS keeps the layout viewport full-size
   and overlays the keyboard, so #chatCard is pinned to the leftover
   visual-viewport height and .page-kb-open flips the room to full-bleed
   (online strip hidden) - the composer never slides under the keys. */
function setupMobileKeyboard() {
  const vv = window.visualViewport;
  const card = $("#chatCard");
  const list = $("#chatMessages");
  const mq = window.matchMedia("(max-width: 780px)");
  if (!vv || !card) return;

  let lastW = -1;
  let lastH = -1;
  let closedH = window.innerHeight;
  let kbEverOpen = false;

  function reset() {
    document.body.classList.remove("page-kb-open");
    card.style.height = "";
    card.style.flex = "";
  }

  function bottomedOut() {
    return list.scrollHeight > list.clientHeight &&
      list.scrollHeight - list.scrollTop - list.clientHeight < 8;
  }

  function apply() {
    const w = Math.round(vv.width);
    const h = Math.round(vv.height);
    const changed = w !== lastW || h !== lastH;
    lastW = w;
    lastH = h;

    const covered = window.innerHeight - (Math.round(vv.offsetTop) + h);
    const noChrome = covered < 80;
    if (noChrome) closedH = window.innerHeight;
    const kbOpen = !noChrome && closedH - h > 100;
    const active = mq.matches && !card.hidden;

    // Follow the bottom whenever the viewport or layout changes, whether the
    // keyboard is open, closed, or this is just a window resize.
    const follow = changed && bottomedOut();

    if (!active) {
      if (follow) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
      reset();
      return;
    }

    if (!kbOpen) {
      // Keyboard went away (or the layout viewport resized instead - Android
      // style), so the CSS flex flow sizes the card again.
      if (follow) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
      if (kbEverOpen) {
        kbEverOpen = false;
        reset();
      }
      return;
    }

    kbEverOpen = true;
    document.body.classList.add("page-kb-open");
    // Keep re-computing while the keyboard animates: a second measurement is
    // not skipped just because w/h matched the previous frame.
    const top = card.getBoundingClientRect().top + window.scrollY;
    const avail = Math.max(160, Math.round(window.scrollY + vv.offsetTop + vv.height - top));
    const keepList = follow ? null : list.scrollTop;
    card.style.height = `${avail}px`;
    card.style.flex = "0 0 auto";
    requestAnimationFrame(() => {
      if (card.hidden) return;
      if (follow) list.scrollTop = list.scrollHeight;
      else if (list.scrollTop !== keepList) list.scrollTop = keepList;
    });
  }

  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  if (mq.addEventListener) mq.addEventListener("change", apply);
  else mq.addListener(apply);
  requestAnimationFrame(apply);
  setTimeout(apply, 150);
}
setupMobileKeyboard();
