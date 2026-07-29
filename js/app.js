import * as Auth from "./auth.js";
import { Grid } from "./grid.js";
import {
  listWaypoints,
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  getServerInfo,
  setServerInfo,
} from "./waypoints.js";

const DIM_COLORS = {
  overworld: "#4ade80",
  nether: "#f87171",
  end: "#f2df8a",
};
const DIM_LABELS = { overworld: "Overworld", nether: "Nether", end: "End" };

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

const dimTabs = $("#dimTabs");
const authArea = $("#authArea");
const gridPanel = $("#gridPanel");
const sidebarEl = document.querySelector(".sidebar");
const sidebarTitle = $("#sidebarTitle");
const waypointCountEl = $("#waypointCount");
const waypointListEl = $("#waypointList");
const waypointSearchEl = $("#waypointSearch");
const serverPanel = $("#serverPanel");
const pinTooltip = $("#pinTooltip");

const authModal = $("#authModal");
const waypointModal = $("#waypointModal");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentDim = "overworld";
let currentWaypoints = [];
let openTooltipWaypoint = null;
const grid = new Grid($("#gridContainer"), { dimensionColor: DIM_COLORS.overworld });

grid.onEmptyRightClick = (x, z) => {
  if (currentDim === "server") return;
  if (!Auth.can("addWaypoint")) {
    openAuthModal("login");
    return;
  }
  openWaypointForm({ dimension: currentDim, x, z });
};

grid.onPinClick = (wp) => {
  showTooltip(wp);
};

grid.onEmptyClick = hideTooltip;
grid.onViewChange = () => {
  if (openTooltipWaypoint && !pinTooltip.hidden) positionTooltip(openTooltipWaypoint);
};

// ---------------------------------------------------------------------------
// Auth-driven UI
// ---------------------------------------------------------------------------

Auth.onAuthChange((state) => {
  renderAuthArea();
  const serverTab = dimTabs.querySelector('[data-dim="server"]');
  serverTab.hidden = !state.session;
  if (!state.session && currentDim === "server") {
    switchDimension("overworld");
  }
  loadCurrentView();
});

function renderAuthArea() {
  authArea.innerHTML = "";
  const state = Auth.getState();
  if (state.session && state.profile) {
    const identity = document.createElement("div");
    identity.className = "auth-identity";
    const avatar = document.createElement("img");
    avatar.className = "auth-avatar";
    avatar.src = `https://skinmc.net/api/v1/face/username/${encodeURIComponent(state.profile.username)}/200`;
    avatar.alt = "";
    avatar.width = 28;
    avatar.height = 28;
    avatar.addEventListener("error", () => avatar.remove());
    const status = document.createElement("span");
    status.className = "auth-status";
    status.innerHTML = `${escapeHtml(state.profile.username)} · <span class="role-badge">${state.profile.role}</span>`;
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "btn btn-signout";
    logoutBtn.textContent = "Sign out";
    logoutBtn.addEventListener("click", async () => {
      await Auth.logout();
    });
    identity.append(avatar, status);
    authArea.append(identity, logoutBtn);
  } else {
    const status = document.createElement("span");
    status.className = "auth-status";
    status.textContent = "guest";
    const signInBtn = document.createElement("button");
    signInBtn.className = "btn btn-ghost";
    signInBtn.id = "signInBtn";
    signInBtn.textContent = "Sign in";
    signInBtn.addEventListener("click", () => openAuthModal("login"));
    authArea.append(status, signInBtn);
  }
}

// ---------------------------------------------------------------------------
// Dimension tabs
// ---------------------------------------------------------------------------

dimTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".dim-tab");
  if (!btn) return;
  switchDimension(btn.dataset.dim);
});

function switchDimension(dim) {
  currentDim = dim;
  for (const btn of dimTabs.querySelectorAll(".dim-tab")) {
    btn.dataset.active = String(btn.dataset.dim === dim);
  }

  hideTooltip();

  if (dim === "server") {
    gridPanel.hidden = true;
    sidebarEl.hidden = true;
    serverPanel.hidden = false;
    loadServerPanel();
    return;
  }

  gridPanel.hidden = false;
  sidebarEl.hidden = false;
  serverPanel.hidden = true;
  grid.setDimensionColor(DIM_COLORS[dim]);
  sidebarTitle.textContent = DIM_LABELS[dim];
  loadWaypointsForDim(dim);
}

async function loadCurrentView() {
  if (currentDim === "server") {
    loadServerPanel();
  } else {
    loadWaypointsForDim(currentDim);
  }
}

async function loadWaypointsForDim(dim) {
  try {
    currentWaypoints = await listWaypoints(dim);
  } catch (err) {
    console.error(err);
    currentWaypoints = [];
  }
  grid.setWaypoints(currentWaypoints);
  renderSidebar();
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function renderSidebar() {
  const query = waypointSearchEl.value.trim().toLowerCase();
  const visibleWaypoints = currentWaypoints.filter((wp) =>
    [wp.name, wp.description, wp.created_by_username, wp.x, wp.y, wp.z]
      .filter((value) => value !== null && value !== undefined)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
  waypointCountEl.textContent = query ? `${visibleWaypoints.length}/${currentWaypoints.length}` : String(currentWaypoints.length);
  waypointListEl.innerHTML = "";

  if (visibleWaypoints.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = query
      ? "No waypoints match this search."
      : Auth.can("addWaypoint")
      ? "No waypoints yet. Right-click the grid to add one."
      : "No waypoints here yet.";
    waypointListEl.appendChild(empty);
    return;
  }

  for (const wp of visibleWaypoints) {
    waypointListEl.appendChild(buildWaypointCard(wp));
  }
}

function buildWaypointCard(wp) {
  const card = document.createElement("div");
  card.className = "waypoint-card";
  card.dataset.dimension = wp.dimension;

  const top = document.createElement("div");
  top.className = "waypoint-card-top";
  const swatch = document.createElement("span");
  swatch.className = "waypoint-swatch";
  swatch.style.background = wp.color;
  swatch.style.color = wp.color;
  const name = document.createElement("span");
  name.className = "waypoint-name";
  name.textContent = wp.name;
  top.append(swatch, name);
  card.appendChild(top);

  if (wp.description) {
    const desc = document.createElement("div");
    desc.className = "waypoint-desc";
    desc.textContent = wp.description;
    card.appendChild(desc);
  }

  const coords = document.createElement("div");
  coords.className = "waypoint-coords";
  coords.textContent = formatWaypointCoords(wp);
  card.appendChild(coords);
  appendDimensionConversion(card, wp, "waypoint-coords-conversion");

  const meta = document.createElement("div");
  meta.className = "waypoint-meta";
  const metaInfo = document.createElement("div");
  metaInfo.className = "waypoint-meta-info";
  const by = document.createElement("span");
  by.className = "waypoint-by";
  by.textContent = `Added by ${wp.created_by_username ?? "unknown"}`;
  const date = document.createElement("span");
  date.className = "waypoint-date";
  date.textContent = `Added ${formatWaypointDate(wp.created_at)}`;
  metaInfo.append(by, date);
  meta.appendChild(metaInfo);

  const actions = document.createElement("div");
  actions.className = "waypoint-actions";
  const jumpBtn = document.createElement("button");
  jumpBtn.className = "btn btn-ghost";
  jumpBtn.textContent = "Jump to";
  jumpBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    grid.jumpTo(wp.x, wp.z);
    showTooltip(wp);
  });
  actions.appendChild(jumpBtn);

  if (Auth.canEditWaypoint(wp)) {
    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-ghost";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openWaypointForm(wp);
    });
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      handleDelete(wp);
    });
    actions.append(editBtn, delBtn);
  }
  card.appendChild(meta);
  card.appendChild(actions);
  card.addEventListener("click", () => showTooltip(wp));
  return card;
}

async function handleDelete(wp) {
  if (!confirm(`Delete "${wp.name}"?`)) return;
  try {
    await deleteWaypoint(wp.id);
    hideTooltip();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    alert(err.message || "Could not delete waypoint.");
  }
}

// ---------------------------------------------------------------------------
// Pin tooltip (view-only)
// ---------------------------------------------------------------------------

function showTooltip(wp) {
  openTooltipWaypoint = wp;
  pinTooltip.innerHTML = "";
  pinTooltip.dataset.dimension = wp.dimension;

  const h = document.createElement("h4");
  h.textContent = wp.name;
  pinTooltip.appendChild(h);
  if (wp.description) {
    const desc = document.createElement("p");
    desc.className = "pin-description";
    desc.textContent = wp.description;
    pinTooltip.appendChild(desc);
  }
  const coords = document.createElement("p");
  coords.className = "pin-coords";
  coords.textContent = formatWaypointCoords(wp);
  pinTooltip.appendChild(coords);
  appendDimensionConversion(pinTooltip, wp, "pin-coords pin-coords-conversion");
  const by = document.createElement("p");
  by.className = "pin-by";
  by.textContent = `Added by ${wp.created_by_username ?? "unknown"}`;
  const date = document.createElement("p");
  date.className = "pin-date";
  date.textContent = `Added ${formatWaypointDate(wp.created_at)}`;
  pinTooltip.append(by, date);

  if (Auth.canEditWaypoint(wp)) {
    const actions = document.createElement("div");
    actions.className = "pin-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-ghost";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      hideTooltip();
      openWaypointForm(wp);
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => handleDelete(wp));
    actions.append(editBtn, deleteBtn);
    pinTooltip.appendChild(actions);
  }

  pinTooltip.hidden = false;
  positionTooltip(wp);
}

function positionTooltip(wp) {
  const rect = $("#gridContainer").getBoundingClientRect();
  const p = grid.worldToScreen(wp.x, wp.z);
  const left = Math.min(p.x + 16, rect.width - pinTooltip.offsetWidth - 8);
  const top = Math.min(p.y + 16, rect.height - pinTooltip.offsetHeight - 8);
  pinTooltip.style.left = `${Math.max(8, left)}px`;
  pinTooltip.style.top = `${Math.max(8, top)}px`;
}

function formatWaypointCoords(wp) {
  return `x ${wp.x}${wp.y !== null && wp.y !== undefined ? `, y ${wp.y}` : ""}, z ${wp.z}`;
}

function appendDimensionConversion(container, wp, className) {
  if (wp.dimension !== "overworld" && wp.dimension !== "nether") return;
  const converted = document.createElement(className.includes("pin-") ? "p" : "div");
  converted.className = className;
  if (wp.dimension === "nether") {
    converted.dataset.dimension = "overworld";
    converted.textContent = `Overworld: x ${wp.x * 8}, z ${wp.z * 8}`;
  } else {
    converted.dataset.dimension = "nether";
    converted.textContent = `Nether: x ${Math.round(wp.x / 8)}, z ${Math.round(wp.z / 8)}`;
  }
  container.appendChild(converted);
}

function formatWaypointDate(value) {
  if (!value) return "on an unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "on an unknown date";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function hideTooltip() {
  pinTooltip.hidden = true;
  openTooltipWaypoint = null;
}

document.addEventListener("click", (e) => {
  if (!pinTooltip.hidden && !pinTooltip.contains(e.target) && !e.target.closest(".grid-canvas, .waypoint-card")) {
    hideTooltip();
  }
});

// ---------------------------------------------------------------------------
// Grid zoom controls
// ---------------------------------------------------------------------------

$("#zoomInBtn").addEventListener("click", () => grid.zoomBy(1.4));
$("#zoomOutBtn").addEventListener("click", () => grid.zoomBy(1 / 1.4));
$("#recenterBtn").addEventListener("click", () => grid.recenter());

// ---------------------------------------------------------------------------
// Auth modal
// ---------------------------------------------------------------------------

function openAuthModal(tab) {
  setAuthTab(tab);
  authModal.hidden = false;
}
function closeAuthModal() {
  authModal.hidden = true;
  $("#loginForm").reset();
  $("#registerForm").reset();
  $("#loginMsg").textContent = "";
  $("#registerMsg").textContent = "";
}

authModal.addEventListener("click", (e) => {
  if (e.target === authModal) closeAuthModal();
});

waypointSearchEl.addEventListener("input", renderSidebar);

function setAuthTab(tab) {
  for (const btn of authModal.querySelectorAll(".modal-tab")) {
    btn.dataset.active = String(btn.dataset.authtab === tab);
  }
  $("#loginForm").hidden = tab !== "login";
  $("#registerForm").hidden = tab !== "register";
  const isLogin = tab === "login";
  $(".auth-modal-header h2").textContent = isLogin ? "Welcome back" : "Create your account";
  $(".auth-modal-header p").textContent = isLogin
    ? "Sign in to manage server waypoints."
    : "Use an access code to join Miaucraft.";
}

authModal.querySelectorAll(".modal-tab").forEach((btn) => {
  btn.addEventListener("click", () => setAuthTab(btn.dataset.authtab));
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#loginMsg");
  msg.textContent = "";
  msg.className = "form-msg";
  try {
    await Auth.login($("#loginUsername").value.trim(), $("#loginPassword").value);
    closeAuthModal();
  } catch (err) {
    msg.textContent = err.message || "Could not sign in.";
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#registerMsg");
  msg.textContent = "";
  msg.className = "form-msg";

  const username = $("#registerUsername").value.trim();
  const password = $("#registerPassword").value;
  const repeat = $("#registerPasswordRepeat").value;
  const code = $("#registerCode").value.trim();

  if (password !== repeat) {
    msg.textContent = "Passwords don't match.";
    return;
  }

  try {
    await Auth.register(username, password, code);
    closeAuthModal();
  } catch (err) {
    msg.textContent = err.message || "Registration failed.";
  }
});

// ---------------------------------------------------------------------------
// Waypoint modal
// ---------------------------------------------------------------------------

let editingWaypoint = null;

function openWaypointForm(seed) {
  if (seed.id && !Auth.canEditWaypoint(seed)) return;
  editingWaypoint = seed.id ? seed : null;
  $("#waypointModalTitle").textContent = editingWaypoint ? "Edit waypoint" : "Add waypoint";
  $("#waypointMsg").textContent = "";
  $("#wpId").value = seed.id ?? "";
  $("#wpName").value = seed.name ?? "";
  $("#wpDescription").value = seed.description ?? "";
  $("#wpX").value = seed.x ?? 0;
  $("#wpY").value = seed.y ?? "";
  $("#wpZ").value = seed.z ?? 0;
  $("#wpColor").value = seed.color ?? "#a78bfa";
  updateColorValue();
  $("#wpDeleteBtn").hidden = !editingWaypoint || !Auth.canEditWaypoint(editingWaypoint);
  updateNetherPreview();
  waypointModal.hidden = false;
  $("#wpName").focus();
}

function closeWaypointForm() {
  waypointModal.hidden = true;
  editingWaypoint = null;
}

$("#waypointModalClose").addEventListener("click", closeWaypointForm);
waypointModal.addEventListener("click", (e) => {
  if (e.target === waypointModal) closeWaypointForm();
});

function updateNetherPreview() {
  const preview = $("#netherPreview");
  if (currentDim !== "nether") {
    preview.hidden = true;
    return;
  }
  const x = Number($("#wpX").value) || 0;
  const z = Number($("#wpZ").value) || 0;
  preview.hidden = false;
  preview.textContent = `overworld: x ${x * 8}, z ${z * 8}`;
}

$("#wpX").addEventListener("input", updateNetherPreview);
$("#wpZ").addEventListener("input", updateNetherPreview);
$("#wpColor").addEventListener("input", updateColorValue);

function updateColorValue() {
  $("#wpColorValue").textContent = $("#wpColor").value.toUpperCase();
}

$("#wpDeleteBtn").addEventListener("click", async () => {
  if (!editingWaypoint || !Auth.canEditWaypoint(editingWaypoint)) return;
  if (!confirm(`Delete "${editingWaypoint.name}"?`)) return;
  try {
    await deleteWaypoint(editingWaypoint.id);
    closeWaypointForm();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    $("#waypointMsg").textContent = err.message || "Could not delete waypoint.";
  }
});

$("#waypointForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#waypointMsg");
  msg.textContent = "";

  const yRaw = $("#wpY").value;
  const payload = {
    name: $("#wpName").value.trim(),
    description: $("#wpDescription").value.trim() || null,
    x: Math.round(Number($("#wpX").value)),
    y: yRaw === "" ? null : Math.round(Number(yRaw)),
    z: Math.round(Number($("#wpZ").value)),
    color: $("#wpColor").value,
  };

  try {
    if (editingWaypoint) {
      if (!Auth.canEditWaypoint(editingWaypoint)) throw new Error("You cannot edit this waypoint.");
      await updateWaypoint(editingWaypoint.id, payload);
    } else {
      const state = Auth.getState();
      await createWaypoint({
        ...payload,
        dimension: currentDim,
        created_by: state.session.user.id,
        created_by_username: state.profile.username,
      });
    }
    closeWaypointForm();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    msg.textContent = err.message || "Could not save waypoint.";
  }
});

// ---------------------------------------------------------------------------
// Server panel
// ---------------------------------------------------------------------------

async function loadServerPanel() {
  try {
    const info = await getServerInfo();
    $("#serverHostname").textContent = info.hostname || "—";
    $("#serverIp").textContent = info.ip || "—";
    $("#serverHostnameInput").value = info.hostname || "";
    $("#serverIpInput").value = info.ip || "";
  } catch (err) {
    console.error(err);
    $("#serverHostname").textContent = "unavailable";
    $("#serverIp").textContent = "unavailable";
  }

  const editSection = $("#serverEdit");
  editSection.hidden = !Auth.can("editServerInfo");
  for (const button of document.querySelectorAll(".server-copy")) {
    button.hidden = !Auth.isLoggedIn();
    button.disabled = !$("#" + button.dataset.copySource).textContent || $("#" + button.dataset.copySource).textContent === "unavailable";
  }
}

document.querySelectorAll(".server-copy").forEach((button) => {
  button.addEventListener("click", async () => {
    const value = $("#" + button.dataset.copySource).textContent;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1500);
    } catch {
      button.textContent = "Failed";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1500);
    }
  });
});

$("#serverSaveBtn").addEventListener("click", async () => {
  const msg = $("#serverSaveMsg");
  msg.textContent = "";
  msg.className = "form-msg";
  try {
    await setServerInfo("hostname", $("#serverHostnameInput").value.trim());
    await setServerInfo("ip", $("#serverIpInput").value.trim());
    msg.textContent = "Saved.";
    msg.className = "form-msg success";
    await loadServerPanel();
  } catch (err) {
    msg.textContent = err.message || "Could not save.";
  }
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

renderAuthArea();
switchDimension("overworld");
Auth.init();
