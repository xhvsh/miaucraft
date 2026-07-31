import * as Auth from "./auth.js";
import { Grid } from "./grid.js";
import {
  listWaypoints,
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  getServerInfo,
  setServerInfo,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
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
const categoryFilterRowEl = $("#categoryFilterRow");
const serverPanel = $("#serverPanel");
const pinTooltip = $("#pinTooltip");

const authModal = $("#authModal");
const waypointModal = $("#waypointModal");

const categoriesBtn = $("#categoriesBtn");
const categoriesPanel = $("#categoriesPanel");
const categoriesListEl = $("#categoriesList");

const sidebarToggleBtn = $("#sidebarToggleBtn");
const sidebarCloseBtn = $("#sidebarCloseBtn");
const sidebarScrim = $("#sidebarScrim");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentDim = "overworld";
let currentWaypoints = [];
let openTooltipWaypoint = null;
let tooltipPointerStartedInside = false;
let categories = [];
let categoryFilter = null; // null = all, "__none__" = uncategorized, or a category id
let editingCategory = null;
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
  categoriesBtn.hidden = !Auth.can("manageCategories");
  if (!Auth.can("manageCategories")) closeCategoriesPanel();
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
// Categories
// ---------------------------------------------------------------------------

async function loadCategories() {
  try {
    categories = await listCategories();
  } catch (err) {
    console.error(err);
    categories = [];
  }
  renderCategoryFilterRow();
  renderCategoriesList();
  populateCategorySelect();
  renderSidebar();
}

function categoryById(id) {
  return categories.find((c) => c.id === id) || null;
}

function renderCategoryFilterRow() {
  categoryFilterRowEl.innerHTML = "";
  if (categories.length === 0) {
    categoryFilterRowEl.hidden = true;
    return;
  }
  categoryFilterRowEl.hidden = false;

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "category-chip";
  allChip.textContent = "All";
  allChip.dataset.active = String(categoryFilter === null);
  allChip.addEventListener("click", () => {
    categoryFilter = null;
    renderCategoryFilterRow();
    renderSidebar();
  });
  categoryFilterRowEl.appendChild(allChip);

  for (const cat of categories) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip";
    chip.style.setProperty("--chip-color", cat.color);
    chip.dataset.active = String(categoryFilter === cat.id);
    chip.textContent = cat.name;
    chip.addEventListener("click", () => {
      categoryFilter = categoryFilter === cat.id ? null : cat.id;
      renderCategoryFilterRow();
      renderSidebar();
    });
    categoryFilterRowEl.appendChild(chip);
  }

  const noneChip = document.createElement("button");
  noneChip.type = "button";
  noneChip.className = "category-chip category-chip--none";
  noneChip.textContent = "Uncategorized";
  noneChip.dataset.active = String(categoryFilter === "__none__");
  noneChip.addEventListener("click", () => {
    categoryFilter = categoryFilter === "__none__" ? null : "__none__";
    renderCategoryFilterRow();
    renderSidebar();
  });
  categoryFilterRowEl.appendChild(noneChip);
}

function buildCategoryBadge(categoryId) {
  const cat = categoryById(categoryId);
  if (!cat) return null;
  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.style.setProperty("--badge-color", cat.color);
  badge.textContent = cat.name;
  return badge;
}

function populateCategorySelect() {
  const select = $("#wpCategory");
  const previousValue = select.value;
  select.innerHTML = '<option value="">No category</option>';
  for (const cat of categories) {
    const option = document.createElement("option");
    option.value = cat.id;
    option.textContent = cat.name;
    select.appendChild(option);
  }
  if (categories.some((c) => c.id === previousValue)) {
    select.value = previousValue;
  }
}

function renderCategoriesList() {
  categoriesListEl.innerHTML = "";
  if (categories.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state category-empty";
    empty.textContent = "No categories yet. Add one below.";
    categoriesListEl.appendChild(empty);
    return;
  }

  for (const cat of categories) {
    const item = document.createElement("div");
    item.className = "category-item";

    const swatch = document.createElement("span");
    swatch.className = "category-swatch";
    swatch.style.background = cat.color;

    const name = document.createElement("span");
    name.className = "category-item-name";
    name.textContent = cat.name;

    const actions = document.createElement("div");
    actions.className = "category-item-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn category-item-btn";
    editBtn.title = "Edit category";
    editBtn.setAttribute("aria-label", "Edit category");
    editBtn.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
    editBtn.addEventListener("click", () => startEditCategory(cat));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn category-item-btn category-item-btn--danger";
    deleteBtn.title = "Delete category";
    deleteBtn.setAttribute("aria-label", "Delete category");
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
    deleteBtn.addEventListener("click", () => handleDeleteCategory(cat));

    actions.append(editBtn, deleteBtn);
    item.append(swatch, name, actions);
    categoriesListEl.appendChild(item);
  }
}

function startEditCategory(cat) {
  editingCategory = cat;
  $("#catId").value = cat.id;
  $("#catName").value = cat.name;
  $("#catColor").value = cat.color;
  $("#catSubmitBtn").textContent = "Save changes";
  $("#catCancelEditBtn").hidden = false;
  $("#categoryMsg").textContent = "";
  $("#catName").focus();
}

function resetCategoryForm() {
  editingCategory = null;
  $("#categoryForm").reset();
  $("#catId").value = "";
  $("#catColor").value = "#a78bfa";
  $("#catSubmitBtn").textContent = "Add category";
  $("#catCancelEditBtn").hidden = true;
  $("#categoryMsg").textContent = "";
}

async function handleDeleteCategory(cat) {
  if (!confirm(`Delete category "${cat.name}"? Waypoints using it will become uncategorized.`)) return;
  try {
    await deleteCategory(cat.id);
    if (editingCategory && editingCategory.id === cat.id) resetCategoryForm();
    if (categoryFilter === cat.id) categoryFilter = null;
    await loadCategories();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    $("#categoryMsg").textContent = err.message || "Could not delete category.";
  }
}

$("#categoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#categoryMsg");
  msg.textContent = "";
  const name = $("#catName").value.trim();
  const color = $("#catColor").value;
  if (!name) return;
  try {
    if (editingCategory) {
      await updateCategory(editingCategory.id, { name, color });
    } else {
      await createCategory({ name, color });
    }
    resetCategoryForm();
    await loadCategories();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    msg.textContent = err.message || "Could not save category.";
  }
});

$("#catCancelEditBtn").addEventListener("click", resetCategoryForm);

function openCategoriesPanel() {
  categoriesPanel.hidden = false;
  categoriesBtn.setAttribute("aria-expanded", "true");
}

function closeCategoriesPanel() {
  categoriesPanel.hidden = true;
  categoriesBtn.setAttribute("aria-expanded", "false");
  resetCategoryForm();
}

categoriesBtn.addEventListener("click", () => {
  if (categoriesPanel.hidden) openCategoriesPanel();
  else closeCategoriesPanel();
});

$("#categoriesPanelClose").addEventListener("click", closeCategoriesPanel);

document.addEventListener("click", (e) => {
  if (categoriesPanel.hidden) return;
  if (categoriesPanel.contains(e.target) || categoriesBtn.contains(e.target)) return;
  closeCategoriesPanel();
});

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
  closeSidebarDrawer();

  if (dim === "server") {
    gridPanel.hidden = true;
    sidebarEl.hidden = true;
    serverPanel.hidden = false;
    sidebarToggleBtn.hidden = true;
    loadServerPanel();
    return;
  }

  gridPanel.hidden = false;
  sidebarEl.hidden = false;
  serverPanel.hidden = true;
  sidebarToggleBtn.hidden = false;
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
  const matchesCategory = (wp) => {
    if (categoryFilter === null) return true;
    if (categoryFilter === "__none__") return !wp.category_id;
    return wp.category_id === categoryFilter;
  };
  const visibleWaypoints = currentWaypoints.filter(
    (wp) =>
      matchesCategory(wp) &&
      [wp.name, wp.description, wp.created_by_username, wp.x, wp.y, wp.z]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
  const isFiltered = Boolean(query) || categoryFilter !== null;
  waypointCountEl.textContent = isFiltered ? `${visibleWaypoints.length}/${currentWaypoints.length}` : String(currentWaypoints.length);
  waypointListEl.innerHTML = "";

  if (visibleWaypoints.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = isFiltered
      ? "No waypoints match this search or filter."
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
  swatch.innerHTML = wp.name.toLowerCase().includes("spawn")
    ? '<i class="fa-solid fa-house" aria-hidden="true"></i>'
    : '<i class="fa-solid fa-location-dot" aria-hidden="true"></i>';
  const name = document.createElement("span");
  name.className = "waypoint-name";
  name.textContent = wp.name;
  top.append(swatch, name);
  const badge = buildCategoryBadge(wp.category_id);
  if (badge) top.appendChild(badge);
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
    if (mobileMediaQuery.matches) closeSidebarDrawer();
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
  const badge = buildCategoryBadge(wp.category_id);
  if (badge) pinTooltip.appendChild(badge);
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

document.addEventListener("pointerdown", (e) => {
  tooltipPointerStartedInside = pinTooltip.contains(e.target);
});

document.addEventListener("click", (e) => {
  if (
    !pinTooltip.hidden &&
    !tooltipPointerStartedInside &&
    !pinTooltip.contains(e.target) &&
    !e.target.closest(".grid-canvas, .waypoint-card")
  ) {
    hideTooltip();
  }
  tooltipPointerStartedInside = false;
});

// ---------------------------------------------------------------------------
// Mobile sidebar drawer
// ---------------------------------------------------------------------------

function openSidebarDrawer() {
  sidebarEl.classList.add("sidebar--open");
  sidebarScrim.hidden = false;
  sidebarToggleBtn.setAttribute("aria-expanded", "true");
}

function closeSidebarDrawer() {
  sidebarEl.classList.remove("sidebar--open");
  sidebarScrim.hidden = true;
  sidebarToggleBtn.setAttribute("aria-expanded", "false");
}

function toggleSidebarDrawer() {
  if (sidebarEl.classList.contains("sidebar--open")) closeSidebarDrawer();
  else openSidebarDrawer();
}

sidebarToggleBtn.addEventListener("click", toggleSidebarDrawer);
sidebarCloseBtn.addEventListener("click", closeSidebarDrawer);
sidebarScrim.addEventListener("click", closeSidebarDrawer);

const mobileMediaQuery = window.matchMedia("(max-width: 760px)");
mobileMediaQuery.addEventListener("change", (e) => {
  if (!e.matches) closeSidebarDrawer();
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
  authModal.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    input.type = "password";
    button.innerHTML = '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
    button.setAttribute("aria-label", "Show password");
    button.setAttribute("aria-pressed", "false");
  });
  $("#loginMsg").textContent = "";
  $("#registerMsg").textContent = "";
}

function closeOnBackdropClick(backdrop, close) {
  let pointerStartedOnBackdrop = false;

  backdrop.addEventListener("pointerdown", (e) => {
    pointerStartedOnBackdrop = e.target === backdrop;
  });

  backdrop.addEventListener("click", (e) => {
    if (pointerStartedOnBackdrop && e.target === backdrop) close();
    pointerStartedOnBackdrop = false;
  });
}

closeOnBackdropClick(authModal, closeAuthModal);

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

authModal.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.innerHTML = showing
      ? '<i class="fa-solid fa-eye" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
    button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    button.setAttribute("aria-pressed", String(!showing));
  });
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
  populateCategorySelect();
  $("#wpCategory").value = seed.category_id ?? "";
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
closeOnBackdropClick(waypointModal, closeWaypointForm);

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
  const categoryRaw = $("#wpCategory").value;
  const payload = {
    name: $("#wpName").value.trim(),
    description: $("#wpDescription").value.trim() || null,
    x: Math.round(Number($("#wpX").value)),
    y: yRaw === "" ? null : Math.round(Number(yRaw)),
    z: Math.round(Number($("#wpZ").value)),
    category_id: categoryRaw === "" ? null : categoryRaw,
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
loadCategories();
Auth.init();
