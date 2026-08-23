import * as Auth from "./auth.js";
import { Grid } from "./grid.js";
import { listWaypoints, createWaypoint, updateWaypoint, deleteWaypoint, getServerInfo, listCategories, createCategory, updateCategory, deleteCategory, listLogs } from "./waypoints.js";
import { listPlayers, subscribePlayers, listLivePositions, subscribeLivePositions, getServerStatus, subscribeServerStatus, listWhitelist, subscribeWhitelist, requestWhitelistAdd, requestWhitelistRemove, listPendingWhitelistCommands, subscribeWhitelistCommands, cancelWhitelistCommand, listPlayerStats, listStatKeys, listDistanceLeaderboard, getPlayerByUsername, setLiveTracking } from "./live.js";

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

// Custom confirm/alert dialog, replacing native confirm()/alert() popups.
function showConfirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", danger = true, alertOnly = false } = {}) {
  return new Promise((resolve) => {
    const modal = $("#confirmModal");
    const confirmBtn = $("#confirmModalConfirmBtn");
    const cancelBtn = $("#confirmModalCancelBtn");

    $("#confirmModalTitle").textContent = title;
    $("#confirmModalMessage").textContent = message;
    confirmBtn.textContent = alertOnly ? "OK" : confirmLabel;
    confirmBtn.className = `btn ${danger && !alertOnly ? "btn-danger" : "btn-primary"}`;
    cancelBtn.hidden = alertOnly;

    modal.hidden = false;

    function cleanup(result) {
      modal.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKeydown);
      modal.removeEventListener("mousedown", onBackdrop);
      resolve(result);
    }
    function onConfirm() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    function onKeydown(e) {
      if (e.key === "Escape") cleanup(false);
      else if (e.key === "Enter" && alertOnly) cleanup(true);
    }
    function onBackdrop(e) {
      if (e.target === modal) cleanup(false);
    }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKeydown);
    modal.addEventListener("mousedown", onBackdrop);
    confirmBtn.focus();
  });
}

function confirmAction(message, opts = {}) {
  return showConfirmDialog({ message, ...opts });
}

const toastContainer = document.createElement("div");
toastContainer.className = "toast-container";
toastContainer.setAttribute("aria-live", "polite");
document.body.appendChild(toastContainer);

function toast(message, type = "success", duration = type === "error" ? 5000 : 3200) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  const icon = type === "error" ? "fa-circle-exclamation" : type === "info" ? "fa-circle-info" : "fa-circle-check";
  el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast-visible"));

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove("toast-visible");
    el.classList.add("toast-leaving");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  };
  const timer = setTimeout(dismiss, duration);
  el.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });
  return el;
}

const dimTabs = $("#dimTabs");
const dimSelect = $("#dimSelect");
const dimSelectWrap = $("#dimSelectWrap");
const dimSelectCategoriesOption = $("#dimSelectCategories");
const dimSelectWhitelistOption = $("#dimSelectWhitelist");
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
const changePasswordModal = $("#changePasswordModal");
const waypointModal = $("#waypointModal");

const categoriesTab = dimTabs.querySelector('[data-dim="categories"]');
const categoriesTabPanel = $("#categoriesTabPanel");
const categoriesListEl = $("#categoriesList");

const playersListEl = $("#playersList");
const playersEmptyEl = $("#playersEmpty");

const whitelistTab = dimTabs.querySelector('[data-dim="whitelist"]');
const whitelistTabPanel = $("#whitelistTabPanel");
const whitelistListEl = $("#whitelistList");
const whitelistEmptyEl = $("#whitelistEmpty");

const settingsTabPanel = $("#settingsTabPanel");
const settingHideFilteredEl = $("#settingHideFiltered");
const settingCopyFormatEl = $("#settingCopyFormat");
const settingShowConversionEl = $("#settingShowConversion");
const settingDisableLiveTrackingEl = $("#settingDisableLiveTracking");
const settingLiveTrackingErrorHintEl = $("#settingLiveTrackingErrorHint");

const logsTab = dimTabs.querySelector('[data-dim="logs"]');
const dimSelectLogsOption = $("#dimSelectLogs");
const logsTabPanel = $("#logsTabPanel");
const logsListEl = $("#logsList");
const logsEmptyEl = $("#logsEmpty");
const logsLoadingEl = $("#logsLoading");
const logSearchEl = $("#logSearch");
const logsFiltersToggleBtn = $("#logsFiltersToggle");
const logsFiltersPanel = $("#logsFiltersPanel");
const logsFiltersDot = $("#logsFiltersDot");
const logEntityFilterEl = $("#logEntityFilter");
const logUserFilterEl = $("#logUserFilter");
const logActionFilterEl = $("#logActionFilter");
const logDimensionFilterEl = $("#logDimensionFilter");
const logsPaginationEl = $("#logsPagination");
const logsFirstPageBtn = $("#logsFirstPageBtn");
const logsPrevPageBtn = $("#logsPrevPageBtn");
const logsNextPageBtn = $("#logsNextPageBtn");
const logsLastPageBtn = $("#logsLastPageBtn");
const logsPageInputEl = $("#logsPageInput");
const logsPageTotalEl = $("#logsPageTotal");

const leaderboardsTabPanel = $("#leaderboardsTabPanel");
const leaderboardStatChipsEl = $("#leaderboardStatChips");
const leaderboardCustomInputEl = $("#leaderboardCustomInput");
const leaderboardStatTitleEl = $("#leaderboardStatTitle");
const statPickerEl = $("#statPicker");
const statPickerMenuEl = $("#statPickerMenu");
const leaderboardListEl = $("#leaderboardList");
const leaderboardEmptyEl = $("#leaderboardEmpty");
const leaderboardLoadingEl = $("#leaderboardLoading");

const imageLightbox = $("#imageLightbox");
const imageLightboxImg = $("#imageLightboxImg");

const sidebarToggleBtn = $("#sidebarToggleBtn");
const sidebarCloseBtn = $("#sidebarCloseBtn");
const sidebarScrim = $("#sidebarScrim");

// ---------------------------------------------------------------------------
// Settings (persisted to localStorage)
// ---------------------------------------------------------------------------

const SETTINGS_STORAGE_KEY = "miaucraft-settings";
const DEFAULT_SETTINGS = {
  hideFilteredWaypoints: true,
  copyFormat: "labeled",
  showDimensionConversion: false,
};

const COORD_COPY_FORMATS = {
  labeled: (x, y, z) => `x ${x}${y !== null ? `, y ${y}` : ""}, z ${z}`,
  comma: (x, y, z) => `${x}${y !== null ? `, ${y}` : ""}, ${z}`,
  space: (x, y, z) => `${x}${y !== null ? ` ${y}` : ""} ${z}`,
  slash: (x, y, z) => `${x}${y !== null ? ` / ${y}` : ""} / ${z}`,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private browsing, disabled, etc) - ignore
  }
}

function formatCoordsForCopy(x, y, z) {
  const formatter = COORD_COPY_FORMATS[settings.copyFormat] || COORD_COPY_FORMATS.labeled;
  return formatter(x, y !== null && y !== undefined ? y : null, z);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let settings = loadSettings();
let currentDim = "overworld";
let currentWaypoints = [];
let openTooltipWaypoint = null;
let tooltipPointerStartedInside = false;
let categories = [];
let categoryFilter = null; // null = all, "__none__" = uncategorized, or a category id
let editingCategory = null;
const grid = new Grid($("#gridContainer"), { dimensionColor: DIM_COLORS.overworld });

let livePositions = [];

async function refreshLivePositions() {
  try {
    livePositions = await listLivePositions();
  } catch (err) {
    console.error(err);
    livePositions = [];
  }
  renderLivePins();
}

function renderLivePins() {
  if (!["overworld", "nether", "end"].includes(currentDim)) return;
  if (isStatusStale(lastServerStatus)) {
    grid.setPlayers([]);
    return;
  }
  const pins = livePositions.filter((p) => p.dimension === currentDim).map((p) => ({ id: p.player_id, username: p.players?.username ?? "Player", x: p.x, z: p.z, afk: p.players?.afk ?? false }));
  grid.setPlayers(pins);
}

subscribeLivePositions(() => {
  clearTimeout(refreshLivePositions._debounce);
  refreshLivePositions._debounce = setTimeout(refreshLivePositions, 300);
});
refreshLivePositions();

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
grid.onEmptyTap = (x, z) => {
  hideTooltip();
  if (currentDim === "server") return;
  if (Auth.can("addWaypoint")) {
    openWaypointForm({ dimension: currentDim, x, z });
  }
};
grid.onViewChange = () => {
  if (openTooltipWaypoint && !pinTooltip.hidden) positionTooltip(openTooltipWaypoint);
};

// ---------------------------------------------------------------------------
// Auth-driven UI
// ---------------------------------------------------------------------------

const settingsAuthOnlyEl = $("#settingsAuthOnly");
const settingsLoginFooterEl = $("#settingsLoginFooter");

function updateSettingsAuthVisibility() {
  const loggedIn = Auth.isLoggedIn();
  settingsAuthOnlyEl.hidden = !loggedIn;
  settingsLoginFooterEl.hidden = loggedIn;
}

Auth.onAuthChange((state) => {
  renderAuthArea();
  categoriesTab.hidden = !Auth.can("manageCategories");
  if (!Auth.can("manageCategories") && currentDim === "categories") {
    switchDimension("overworld");
  }
  logsTab.hidden = !state.session;
  if (!state.session && currentDim === "logs") {
    switchDimension("overworld");
  }
  whitelistTab.hidden = !Auth.can("manageWhitelist");
  if (!Auth.can("manageWhitelist") && currentDim === "whitelist") {
    switchDimension("overworld");
  }
  dimSelectCategoriesOption.hidden = !Auth.can("manageCategories");
  dimSelectLogsOption.hidden = !state.session;
  dimSelectWhitelistOption.hidden = !Auth.can("manageWhitelist");
  refreshLiveTrackingSetting();
  renderDiscordSetting();
  updateSettingsAuthVisibility();
  if (currentDim === "server") loadServerPanel();
  loadCurrentView();
});

Auth.onAuthError((message) => {
  toast(message, "error");
});

Auth.onPasswordRecovery(() => {
  toast("Set a new password to finish resetting it.", "info");
  openChangePasswordModal();
});

function renderAuthArea() {
  authArea.innerHTML = "";
  const state = Auth.getState();
  if (state.session && state.profile) {
    const identity = document.createElement("div");
    identity.className = "auth-identity";
    const avatar = document.createElement("img");
    avatar.className = "auth-avatar";
    avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(state.profile.username)}/200`;
    avatar.alt = "";
    avatar.width = 28;
    avatar.height = 28;
    avatar.addEventListener("error", () => avatar.remove());
    const status = document.createElement("span");
    status.className = "auth-status";
    status.innerHTML = `<span class="auth-username">${escapeHtml(state.profile.username)}</span> · <span class="role-badge">${state.profile.role}</span>`;
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "btn btn-signout";
    logoutBtn.type = "button";
    logoutBtn.title = "Sign out";
    logoutBtn.innerHTML = `<i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i><span class="btn-signout-label">Sign out</span>`;
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

const DEFAULT_CATEGORY_ICON_CLASS = "fa-solid fa-hashtag";

// The icon field now accepts a full Font Awesome class string, e.g.
// "fa-solid fa-hashtag" or "fa-brands fa-fort-awesome". Users can type it
// with or without the "fa-" prefixes and with or without the style token;
// missing pieces get filled in sensibly.
function sanitizeIconClass(raw) {
  const tokens = (raw || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean)
    .map((t) => (t.startsWith("fa-") ? t : `fa-${t}`));

  if (tokens.length === 0) return DEFAULT_CATEGORY_ICON_CLASS;
  if (tokens.length === 1) return `fa-solid ${tokens[0]}`;
  return tokens.join(" ");
}

// Categories saved before this field accepted full class strings only have
// a bare icon name stored (e.g. "wheat-awn"). Resolve either format to a
// ready-to-use class string.
function categoryIconClass(rawIcon) {
  const value = (rawIcon || "").trim();
  if (!value) return DEFAULT_CATEGORY_ICON_CLASS;
  if (value.includes("fa-")) return sanitizeIconClass(value);
  return `fa-solid fa-${value.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
}

function updateCategoryIconPreview() {
  const iconClass = sanitizeIconClass($("#catIcon").value);
  const color = $("#catColor").value;
  $("#catIconPreviewGlyph").className = iconClass;
  $("#catIconPreview").style.setProperty("--preview-color", color);
}

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
  allChip.innerHTML = '<i class="fa-solid fa-layer-group" aria-hidden="true"></i><span>All</span>';
  allChip.dataset.active = String(categoryFilter === null);
  allChip.addEventListener("click", () => {
    categoryFilter = null;
    renderCategoryFilterRow();
    renderSidebar();
    updateMapWaypoints();
  });
  categoryFilterRowEl.appendChild(allChip);

  for (const cat of categories) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip";
    chip.style.setProperty("--chip-color", cat.color);
    chip.dataset.active = String(categoryFilter === cat.id);
    const icon = document.createElement("i");
    icon.className = categoryIconClass(cat.icon);
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = cat.name;
    chip.append(icon, label);
    chip.addEventListener("click", () => {
      categoryFilter = categoryFilter === cat.id ? null : cat.id;
      renderCategoryFilterRow();
      renderSidebar();
      updateMapWaypoints();
    });
    categoryFilterRowEl.appendChild(chip);
  }

  const noneChip = document.createElement("button");
  noneChip.type = "button";
  noneChip.className = "category-chip category-chip--none";
  noneChip.innerHTML = '<i class="fa-solid fa-ban" aria-hidden="true"></i><span>Uncategorized</span>';
  noneChip.dataset.active = String(categoryFilter === "__none__");
  noneChip.addEventListener("click", () => {
    categoryFilter = categoryFilter === "__none__" ? null : "__none__";
    renderCategoryFilterRow();
    renderSidebar();
    updateMapWaypoints();
  });
  categoryFilterRowEl.appendChild(noneChip);
}

function buildCategoryBadge(categoryId) {
  const cat = categoryById(categoryId);
  if (!cat) return null;
  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.style.setProperty("--badge-color", cat.color);
  const icon = document.createElement("i");
  icon.className = categoryIconClass(cat.icon);
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = cat.name;
  badge.append(icon, label);
  return badge;
}

const categoryPicker = $("#categoryPicker");
const categoryPickerTrigger = $("#categoryPickerTrigger");
const categoryPickerContent = $("#categoryPickerTriggerContent");
const categoryPickerMenu = $("#categoryPickerMenu");
const wpCategoryInput = $("#wpCategory");

function categoryPickerOptionContent(name, iconClass, color, isNone) {
  const iconSpan = document.createElement("span");
  iconSpan.className = isNone ? "category-picker-icon category-picker-icon--none" : "category-picker-icon";
  if (!isNone) iconSpan.style.setProperty("--picker-color", color);
  const i = document.createElement("i");
  i.className = isNone ? "fa-solid fa-ban" : iconClass;
  i.setAttribute("aria-hidden", "true");
  iconSpan.appendChild(i);
  const label = document.createElement("span");
  label.className = "category-picker-label";
  label.textContent = name;
  return [iconSpan, label];
}

function setCategoryPickerValue(id, name, icon, color) {
  wpCategoryInput.value = id;
  categoryPickerContent.innerHTML = "";
  categoryPickerContent.append(...categoryPickerOptionContent(name, icon, color, !id));
  for (const opt of categoryPickerMenu.querySelectorAll(".category-picker-option")) {
    opt.setAttribute("aria-selected", String(opt.dataset.value === id));
  }
}

function closeCategoryPickerMenu() {
  categoryPickerMenu.hidden = true;
  categoryPickerTrigger.setAttribute("aria-expanded", "false");
}

function openCategoryPickerMenu() {
  categoryPickerMenu.hidden = false;
  categoryPickerTrigger.setAttribute("aria-expanded", "true");
}

categoryPickerTrigger.addEventListener("click", () => {
  if (categoryPickerMenu.hidden) openCategoryPickerMenu();
  else closeCategoryPickerMenu();
});

document.addEventListener("click", (e) => {
  if (categoryPickerMenu.hidden) return;
  if (categoryPicker.contains(e.target)) return;
  closeCategoryPickerMenu();
});

categoryPickerTrigger.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCategoryPickerMenu();
});

function populateCategorySelect() {
  const previousValue = wpCategoryInput.value;
  categoryPickerMenu.innerHTML = "";

  const buildOption = (id, name, icon, color, isNone) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-picker-option";
    btn.dataset.value = id;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", "false");
    btn.append(...categoryPickerOptionContent(name, icon, color, isNone));
    const check = document.createElement("i");
    check.className = "fa-solid fa-check category-picker-option-check";
    check.setAttribute("aria-hidden", "true");
    btn.appendChild(check);
    btn.addEventListener("click", () => {
      setCategoryPickerValue(id, name, icon, color);
      closeCategoryPickerMenu();
    });
    categoryPickerMenu.appendChild(btn);
  };

  buildOption("", "No category", null, null, true);
  for (const cat of categories) {
    buildOption(cat.id, cat.name, categoryIconClass(cat.icon), cat.color, false);
  }

  const validValue = categories.some((c) => c.id === previousValue) ? previousValue : "";
  const match = categories.find((c) => c.id === validValue);
  setCategoryPickerValue(validValue, match ? match.name : "No category", match ? categoryIconClass(match.icon) : null, match ? match.color : null);
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

    const iconWrap = document.createElement("span");
    iconWrap.className = "category-item-icon";
    iconWrap.style.setProperty("--item-color", cat.color);
    iconWrap.innerHTML = `<i class="${categoryIconClass(cat.icon)}" aria-hidden="true"></i>`;

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
    item.append(iconWrap, name, actions);
    categoriesListEl.appendChild(item);
  }
}

function startEditCategory(cat) {
  editingCategory = cat;
  $("#catId").value = cat.id;
  $("#catName").value = cat.name;
  $("#catColor").value = cat.color;
  $("#catIcon").value = categoryIconClass(cat.icon);
  updateCategoryIconPreview();
  $("#catSubmitBtn").textContent = "Save changes";
  $("#catCancelEditBtn").hidden = false;
  $("#catName").focus();
}

function resetCategoryForm() {
  editingCategory = null;
  $("#categoryForm").reset();
  $("#catId").value = "";
  $("#catColor").value = "#a78bfa";
  $("#catIcon").value = "";
  updateCategoryIconPreview();
  $("#catSubmitBtn").textContent = "Add category";
  $("#catCancelEditBtn").hidden = true;
}

async function handleDeleteCategory(cat) {
  const ok = await confirmAction(`Delete category "${cat.name}"? Waypoints using it will become uncategorized.`, {
    title: "Delete category?",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await deleteCategory(cat.id);
    if (editingCategory && editingCategory.id === cat.id) resetCategoryForm();
    if (categoryFilter === cat.id) categoryFilter = null;
    await loadCategories();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    toast(err.message || "Could not delete category.", "error");
  }
}

$("#categoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#catName").value.trim();
  const color = $("#catColor").value;
  const icon = sanitizeIconClass($("#catIcon").value);
  if (!name) return;
  try {
    if (editingCategory) {
      await updateCategory(editingCategory.id, { name, color, icon }, editingCategory);
    } else {
      await createCategory({ name, color, icon });
    }
    resetCategoryForm();
    await loadCategories();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    toast(err.message || "Could not save category.", "error");
  }
});

$("#catCancelEditBtn").addEventListener("click", resetCategoryForm);
$("#catIcon").addEventListener("input", updateCategoryIconPreview);
$("#catColor").addEventListener("input", updateCategoryIconPreview);

// ---------------------------------------------------------------------------
// Dimension tabs
// ---------------------------------------------------------------------------

dimTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".dim-tab");
  if (!btn) return;
  switchDimension(btn.dataset.dim);
});

dimSelect.addEventListener("change", () => {
  switchDimension(dimSelect.value);
});

function switchDimension(dim) {
  const previousDim = currentDim;
  currentDim = dim;
  for (const btn of dimTabs.querySelectorAll(".dim-tab")) {
    btn.dataset.active = String(btn.dataset.dim === dim);
  }
  dimSelect.value = dim;
  dimSelectWrap.dataset.dim = dim;

  hideTooltip();
  closeSidebarDrawer();
  if (previousDim === "categories" && dim !== "categories") {
    resetCategoryForm();
  }

  if (dim === "server" || dim === "categories" || dim === "settings" || dim === "logs" || dim === "whitelist" || dim === "leaderboards") {
  gridPanel.hidden = true;
  sidebarEl.hidden = true;
  sidebarToggleBtn.hidden = true;
  serverPanel.hidden = dim !== "server";
  categoriesTabPanel.hidden = dim !== "categories";
  settingsTabPanel.hidden = dim !== "settings";
  logsTabPanel.hidden = dim !== "logs";
  whitelistTabPanel.hidden = dim !== "whitelist";
  leaderboardsTabPanel.hidden = dim !== "leaderboards";
  if (dim === "server") loadServerPanel();
  else {
    stopServerTicker();
    if (dim === "categories") loadCategories();
    else if (dim === "logs") loadLogs();
    else if (dim === "whitelist") loadWhitelistPanel();
    else if (dim === "leaderboards") loadLeaderboardsTab();
    else updateSettingsUI();
  }
  return;
}

  stopServerTicker();
  gridPanel.hidden = false;
  sidebarEl.hidden = false;
  serverPanel.hidden = true;
  categoriesTabPanel.hidden = true;
  settingsTabPanel.hidden = true;
  logsTabPanel.hidden = true;
  whitelistTabPanel.hidden = true;
  leaderboardsTabPanel.hidden = true;
  sidebarToggleBtn.hidden = false;
  grid.setDimensionColor(DIM_COLORS[dim]);
  sidebarTitle.textContent = DIM_LABELS[dim];
  loadWaypointsForDim(dim);
  renderLivePins();
}

async function loadCurrentView() {
  if (currentDim === "server") {
    loadServerPanel();
  } else if (currentDim === "categories") {
    loadCategories();
  } else if (currentDim === "logs") {
    loadLogs();
  } else if (currentDim === "whitelist") {
    loadWhitelistPanel();
  } else if (currentDim === "settings") {
    updateSettingsUI();
  } else if (currentDim === "leaderboards") {
    loadLeaderboardsTab();
  } else {
    loadWaypointsForDim(currentDim);
  }
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function updateSettingsUI() {
  settingHideFilteredEl.checked = settings.hideFilteredWaypoints;
  settingCopyFormatEl.value = settings.copyFormat;
  settingShowConversionEl.checked = settings.showDimensionConversion;
}

settingHideFilteredEl.addEventListener("change", () => {
  settings.hideFilteredWaypoints = settingHideFilteredEl.checked;
  saveSettings();
  updateMapWaypoints();
});

settingCopyFormatEl.addEventListener("change", () => {
  settings.copyFormat = settingCopyFormatEl.value;
  saveSettings();
  renderSidebar();
  if (openTooltipWaypoint) showTooltip(openTooltipWaypoint);
});

settingShowConversionEl.addEventListener("change", () => {
  settings.showDimensionConversion = settingShowConversionEl.checked;
  saveSettings();
  renderSidebar();
  if (openTooltipWaypoint) showTooltip(openTooltipWaypoint);
});

// Unlike the settings above, this one is NOT part of `settings`/localStorage -
// it's a real per-account column (players.live_tracking_enabled), so it has
// to reflect whatever the database says, on whichever device/browser the
// player logs in from.
//
// profiles.id (state.profile.id) is the auth user id, not players.id - the
// only link between the two is the username - so we resolve the actual
// player row once here and hang onto its id for the change handler below.
let liveTrackingPlayerId = null;

async function refreshLiveTrackingSetting() {
  const state = Auth.getState();
  liveTrackingPlayerId = null;
  settingLiveTrackingErrorHintEl.hidden = true;
  if (!state.session || !state.profile) {
    settingDisableLiveTrackingEl.checked = false;
    settingDisableLiveTrackingEl.disabled = true;
    return;
  }

  try {
    const player = await getPlayerByUsername(state.profile.username);
    if (!player) {
      settingDisableLiveTrackingEl.checked = false;
      settingDisableLiveTrackingEl.disabled = true;
      settingLiveTrackingErrorHintEl.textContent = `No player row found for username "${state.profile.username}".`;
      settingLiveTrackingErrorHintEl.hidden = false;
      return;
    }
    liveTrackingPlayerId = player.id;
    settingDisableLiveTrackingEl.checked = !player.live_tracking_enabled;
    settingDisableLiveTrackingEl.disabled = false;
  } catch (err) {
    console.error(err);
    settingDisableLiveTrackingEl.disabled = true;
    settingLiveTrackingErrorHintEl.textContent = err.message || "Could not load this setting.";
    settingLiveTrackingErrorHintEl.hidden = false;
    toast(err.message || "Could not load live tracking setting.", "error");
  }
}

settingDisableLiveTrackingEl.addEventListener("change", async () => {
  if (!liveTrackingPlayerId) {
    // Shouldn't be reachable (checkbox is disabled whenever this is unset),
    // but if it happens, don't fail silently - revert and say why.
    settingDisableLiveTrackingEl.checked = !settingDisableLiveTrackingEl.checked;
    toast("Could not update live tracking - your player row wasn't found.", "error");
    return;
  }

  const wantsDisabled = settingDisableLiveTrackingEl.checked;
  settingDisableLiveTrackingEl.disabled = true;
  try {
    await setLiveTracking(liveTrackingPlayerId, !wantsDisabled);
  } catch (err) {
    console.error(err);
    settingDisableLiveTrackingEl.checked = !wantsDisabled; // revert on failure
    settingLiveTrackingErrorHintEl.textContent = err.message || "Could not update live tracking.";
    settingLiveTrackingErrorHintEl.hidden = false;
    toast(err.message || "Could not update live tracking.", "error");
  } finally {
    settingDisableLiveTrackingEl.disabled = false;
  }
});

async function loadWaypointsForDim(dim) {
  try {
    currentWaypoints = await listWaypoints(dim);
  } catch (err) {
    console.error(err);
    currentWaypoints = [];
  }
  updateMapWaypoints();
  renderSidebar();
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function matchesCategoryFilter(wp) {
  if (categoryFilter === null) return true;
  if (categoryFilter === "__none__") return !wp.category_id;
  return wp.category_id === categoryFilter;
}

function updateMapWaypoints() {
  const waypointsForMap = settings.hideFilteredWaypoints ? currentWaypoints.filter(matchesCategoryFilter) : currentWaypoints;
  grid.setWaypoints(waypointsForMap);
}

function renderSidebar() {
  const query = waypointSearchEl.value.trim().toLowerCase();
  const matchesCategory = matchesCategoryFilter;
  const visibleWaypoints = currentWaypoints
    .filter(
      (wp) =>
        matchesCategory(wp) &&
        [wp.name, wp.description, wp.created_by_username, wp.x, wp.y, wp.z]
          .filter((value) => value !== null && value !== undefined)
          .join(" ")
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const isFiltered = Boolean(query) || categoryFilter !== null;
  waypointCountEl.textContent = isFiltered ? `${visibleWaypoints.length}/${currentWaypoints.length}` : String(currentWaypoints.length);
  waypointListEl.innerHTML = "";

  if (visibleWaypoints.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = isFiltered ? "No waypoints match this search or filter." : Auth.can("addWaypoint") ? "No waypoints yet. Right-click the grid to add one." : "No waypoints here yet.";
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
  swatch.innerHTML = '<i class="fa-solid fa-location-dot" aria-hidden="true"></i>';
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

  appendSpecialWaypointImage(card, wp);

  const coords = document.createElement("div");
  coords.className = "waypoint-coords";
  const coordsText = document.createElement("span");
  coordsText.className = "coords-text";
  coordsText.textContent = formatWaypointCoords(wp);
  const copyBtn = buildCopyCoordsButton(() => formatCoordsForCopy(wp.x, wp.y !== null && wp.y !== undefined ? wp.y : null, wp.z));
  coords.append(coordsText, copyBtn);
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
  const ok = await confirmAction(`Delete "${wp.name}"?`, { title: "Delete waypoint?", confirmLabel: "Delete" });
  if (!ok) return;
  try {
    await deleteWaypoint(wp.id);
    hideTooltip();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    toast(err.message || "Could not delete waypoint.", "error");
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
  appendSpecialWaypointImage(pinTooltip, wp);
  const coords = document.createElement("p");
  coords.className = "pin-coords";
  const coordsText = document.createElement("span");
  coordsText.className = "coords-text";
  coordsText.textContent = formatWaypointCoords(wp);
  const coordsCopyBtn = buildCopyCoordsButton(() => formatCoordsForCopy(wp.x, wp.y !== null && wp.y !== undefined ? wp.y : null, wp.z));
  coords.append(coordsText, coordsCopyBtn);
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
  const p = grid.worldToScreen(wp.x, wp.z);
  const tw = pinTooltip.offsetWidth;
  const th = pinTooltip.offsetHeight;
  // The marker icon is drawn above its coordinate point (~24px tall) with a
  // soft glow on top of that, so the gap has to clear the whole icon, not
  // just its tip, or the tooltip ends up covering the waypoint it describes.
  const gap = 40;

  // Always anchor centered above the pin's tip, connected by a CSS arrow
  // (see .pin-tooltip::after). This keeps the tooltip glued to the actual
  // waypoint at all times instead of jumping to a different side/corner
  // when it would run past a screen edge - it may run past the edge, and
  // that's fine, since staying attached to the pin matters more.
  const left = p.x - tw / 2;
  const top = p.y - th - gap;

  pinTooltip.style.left = `${left}px`;
  pinTooltip.style.top = `${top}px`;
}

function formatWaypointCoords(wp) {
  return formatCoordsForCopy(wp.x, wp.y !== null && wp.y !== undefined ? wp.y : null, wp.z);
}

function buildCopyCoordsButton(getText) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "coords-copy-btn";
  btn.title = "Copy coordinates";
  btn.setAttribute("aria-label", "Copy coordinates");
  btn.innerHTML = '<i class="fa-solid fa-copy" aria-hidden="true"></i>';
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyTextToClipboard(getText(), btn);
  });
  return btn;
}

async function copyTextToClipboard(text, btn) {
  const icon = btn.querySelector("i");
  try {
    await navigator.clipboard.writeText(text);
    icon.className = "fa-solid fa-check";
    btn.classList.add("copied");
  } catch {
    icon.className = "fa-solid fa-xmark";
  }
  window.setTimeout(() => {
    icon.className = "fa-solid fa-copy";
    btn.classList.remove("copied");
  }, 1200);
}

function appendDimensionConversion(container, wp, className) {
  if (!settings.showDimensionConversion) return;
  if (wp.dimension !== "overworld" && wp.dimension !== "nether") return;
  const converted = document.createElement(className.includes("pin-") ? "p" : "div");
  converted.className = `${className} coords-conversion-text`;
  let label, dimension, x, z;
  if (wp.dimension === "nether") {
    dimension = "overworld";
    label = "Overworld";
    x = wp.x * 8;
    z = wp.z * 8;
  } else {
    dimension = "nether";
    label = "Nether";
    x = Math.round(wp.x / 8);
    z = Math.round(wp.z / 8);
  }
  converted.dataset.dimension = dimension;
  converted.textContent = `${label}: ${formatCoordsForCopy(x, null, z)}`;
  container.appendChild(converted);
}

// A tiny opt-in hook for one-off waypoints that have their own reference image.
// Add more entries here (exact waypoint name -> image path) as needed.
const SPECIAL_WAYPOINT_IMAGES = {
  "Blehh Cat": "/img/blehh-map.png",
};

function appendSpecialWaypointImage(container, wp) {
  const src = SPECIAL_WAYPOINT_IMAGES[wp.name];
  if (!src) return;
  const img = document.createElement("img");
  img.className = "waypoint-special-image";
  img.src = src;
  img.alt = `${wp.name} reference image`;
  img.loading = "lazy";
  img.title = "Click to enlarge";
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageLightbox(src, img.alt);
  });
  container.appendChild(img);
}

function openImageLightbox(src, alt) {
  imageLightboxImg.src = src;
  imageLightboxImg.alt = alt;
  imageLightbox.hidden = false;
}

function closeImageLightbox() {
  imageLightbox.hidden = true;
  imageLightboxImg.src = "";
}

closeOnBackdropClick(imageLightbox, closeImageLightbox);
imageLightboxImg.addEventListener("click", closeImageLightbox);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !imageLightbox.hidden) closeImageLightbox();
});

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
  if (!pinTooltip.hidden && !tooltipPointerStartedInside && !pinTooltip.contains(e.target) && !e.target.closest(".grid-canvas, .waypoint-card")) {
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
  if (Auth.isLoggedIn()) return;
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
  $("#registerCodeLabel").textContent = DEFAULT_REGISTER_CODE_LABEL;
  $("#registerCode").disabled = false;
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

// ---------------------------------------------------------------------------
// Change password modal
// ---------------------------------------------------------------------------

function openChangePasswordModal() {
  changePasswordModal.hidden = false;
}
function closeChangePasswordModal() {
  changePasswordModal.hidden = true;
  $("#changePasswordForm").reset();
  changePasswordModal.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    input.type = "password";
    button.innerHTML = '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
    button.setAttribute("aria-label", "Show password");
    button.setAttribute("aria-pressed", "false");
  });
}
closeOnBackdropClick(changePasswordModal, closeChangePasswordModal);

$("#changePasswordBtn").addEventListener("click", openChangePasswordModal);

$("#changePasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const newPassword = $("#newPassword").value;
  const repeat = $("#newPasswordRepeat").value;
  if (newPassword !== repeat) {
    toast("Passwords don't match.", "error");
    return;
  }
  try {
    await Auth.updatePassword(newPassword);
    closeChangePasswordModal();
    toast("Password updated.");
  } catch (err) {
    toast(err.message || "Could not update password.", "error");
  }
});

// ---------------------------------------------------------------------------
// Delete account
// ---------------------------------------------------------------------------

$("#deleteAccountBtn").addEventListener("click", async () => {
  const confirmed = await confirmAction(
    "This permanently deletes your account and everything tied to it. This can't be undone.",
    { title: "Delete your account?", confirmLabel: "Delete account" }
  );
  if (!confirmed) return;
  try {
    await Auth.deleteAccount();
    toast("Account deleted.");
  } catch (err) {
    toast(err.message || "Could not delete account.", "error");
  }
});

waypointSearchEl.addEventListener("input", renderSidebar);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    waypointSearchEl.focus();
    waypointSearchEl.select();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!authModal.hidden) closeAuthModal();
  if (!changePasswordModal.hidden) closeChangePasswordModal();
  if (!pinTooltip.hidden) hideTooltip();
});

function setAuthTab(tab) {
  for (const btn of authModal.querySelectorAll(".modal-tab")) {
    btn.dataset.active = String(btn.dataset.authtab === tab);
  }
  $("#loginForm").hidden = tab !== "login";
  $("#registerForm").hidden = tab !== "register";
  const isLogin = tab === "login";
  $(".auth-modal-header h2").textContent = isLogin ? "Welcome back" : "Create your account";
  $(".auth-modal-header p").textContent = isLogin ? "Sign in to manage server waypoints." : "Use an access code to join Miaucraft.";
}

authModal.querySelectorAll(".modal-tab").forEach((btn) => {
  btn.addEventListener("click", () => setAuthTab(btn.dataset.authtab));
});

// ---------------------------------------------------------------------------
// Shared access-code links: /c/MIAU-xxxx-xxxx-xxxx
// ---------------------------------------------------------------------------

const DEFAULT_REGISTER_CODE_LABEL = "Access code (contact xhvsh if you need one)";

function consumeSharedAccessCodeLink() {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
  if (!match) return;
  const code = decodeURIComponent(match[1]);
  window.history.replaceState({}, "", "/");

  const unsubscribe = Auth.onAuthChange((state) => {
    if (!state.ready) return;
    unsubscribe();
    if (Auth.isLoggedIn()) return;
    openAuthModal("register");
    $("#registerCode").value = code;
    $("#registerCode").disabled = true;
    $("#registerCodeLabel").textContent = "Code loaded from link";
  });
}

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.innerHTML = showing ? '<i class="fa-solid fa-eye" aria-hidden="true"></i>' : '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
    button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    button.setAttribute("aria-pressed", String(!showing));
  });
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await Auth.login($("#loginUsername").value.trim(), $("#loginPassword").value);
    closeAuthModal();
  } catch (err) {
    toast(err.message || "Could not sign in.", "error");
  }
});

$("#discordLoginBtn").addEventListener("click", async () => {
  try {
    await Auth.loginWithDiscord();
  } catch (err) {
    toast(err.message || "Could not start Discord sign-in.", "error");
  }
});

// ---------------------------------------------------------------------------
// Settings — Discord linking
// ---------------------------------------------------------------------------

const settingDiscordActionEl = $("#settingDiscordAction");

function renderDiscordSetting() {
  settingDiscordActionEl.innerHTML = "";
  if (!Auth.isLoggedIn()) {
    const hint = document.createElement("span");
    hint.className = "settings-row-hint";
    hint.textContent = "Log in to link";
    settingDiscordActionEl.appendChild(hint);
    return;
  }

  const identity = Auth.discordIdentity();
  if (!identity) {
    const linkBtn = document.createElement("button");
    linkBtn.className = "btn btn-discord";
    linkBtn.type = "button";
    linkBtn.innerHTML = `<i class="fa-brands fa-discord" aria-hidden="true"></i> Link Discord`;
    linkBtn.addEventListener("click", async () => {
      linkBtn.disabled = true;
      try {
        await Auth.linkDiscord();
      } catch (err) {
        toast(err.message || "Could not link Discord.", "error");
        linkBtn.disabled = false;
      }
    });
    settingDiscordActionEl.appendChild(linkBtn);
    return;
  }

  const data = identity.identity_data || {};
  const discordUsername = (data.user_name || data.name || data.full_name || "Unknown").replace(/#0$/, "");
  const discordId = data.provider_id || data.sub || identity.id || "?";

  const wrap = document.createElement("div");
  wrap.className = "discord-linked";

  const label = document.createElement("span");
  label.className = "discord-linked-label";

  const nameSpan = document.createElement("span");
  nameSpan.className = "discord-linked-name";
  nameSpan.textContent = discordUsername;

  const idSpan = document.createElement("span");
  idSpan.className = "discord-linked-id";
  idSpan.textContent = `{${discordId}}`;

  label.innerHTML = `<i class="fa-brands fa-discord" aria-hidden="true"></i> `;
  label.append(nameSpan, " ", idSpan);

  const unlinkBtn = document.createElement("button");
  unlinkBtn.className = "btn btn-danger";
  unlinkBtn.type = "button";
  unlinkBtn.textContent = "Unlink";
  unlinkBtn.addEventListener("click", async () => {
    const confirmed = await confirmAction("Unlink your Discord account? You'll need your username and password to sign in.", {
      confirmLabel: "Unlink",
    });
    if (!confirmed) return;
    unlinkBtn.disabled = true;
    try {
      await Auth.unlinkDiscord();
      toast("Discord account unlinked.");
      renderDiscordSetting();
    } catch (err) {
      toast(err.message || "Could not unlink Discord.", "error");
      unlinkBtn.disabled = false;
    }
  });

  wrap.append(label, unlinkBtn);
  settingDiscordActionEl.appendChild(wrap);
}

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#registerUsername").value.trim();
  const password = $("#registerPassword").value;
  const repeat = $("#registerPasswordRepeat").value;
  const code = $("#registerCode").value.trim();

  if (password !== repeat) {
    toast("Passwords don't match.", "error");
    return;
  }

  try {
    await Auth.register(username, password, code);
    closeAuthModal();
  } catch (err) {
    toast(err.message || "Registration failed.", "error");
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
  $("#wpId").value = seed.id ?? "";
  $("#wpName").value = seed.name ?? "";
  $("#wpDescription").value = seed.description ?? "";
  const wpXEl = $("#wpX");
  const wpZEl = $("#wpZ");
  if (editingWaypoint) {
    wpXEl.placeholder = "";
    wpXEl.value = seed.x ?? 0;
    wpZEl.placeholder = "";
    wpZEl.value = seed.z ?? 0;
  } else {
    wpXEl.value = "";
    wpZEl.value = "";
    wpXEl.placeholder = String(Math.round(seed.x ?? 0));
    wpZEl.placeholder = String(Math.round(seed.z ?? 0));
  }
  $("#wpY").value = seed.y ?? "";
  $("#wpCategory").value = seed.category_id ?? "";
  populateCategorySelect();
  closeCategoryPickerMenu();
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
  closeCategoryPickerMenu();
}

$("#waypointModalClose").addEventListener("click", closeWaypointForm);
closeOnBackdropClick(waypointModal, closeWaypointForm);

function updateNetherPreview() {
  const preview = $("#netherPreview");
  if (!settings.showDimensionConversion || (currentDim !== "nether" && currentDim !== "overworld")) {
    preview.hidden = true;
    return;
  }
  if (currentDim !== "nether" && currentDim !== "overworld") {
    preview.hidden = true;
    return;
  }
  const xEl = $("#wpX");
  const zEl = $("#wpZ");
  const x = Number(xEl.value.trim() === "" ? xEl.placeholder : xEl.value) || 0;
  const z = Number(zEl.value.trim() === "" ? zEl.placeholder : zEl.value) || 0;
  preview.hidden = false;
  if (currentDim === "nether") {
    preview.className = "nether-preview nether-preview--overworld";
    preview.textContent = `Overworld: ${formatCoordsForCopy(x * 8, null, z * 8)}`;
  } else {
    preview.className = "nether-preview nether-preview--nether";
    preview.textContent = `Nether: ${formatCoordsForCopy(Math.round(x / 8), null, Math.round(z / 8))}`;
  }
}

$("#wpX").addEventListener("input", updateNetherPreview);
$("#wpZ").addEventListener("input", updateNetherPreview);
$("#wpColor").addEventListener("input", updateColorValue);

function updateColorValue() {
  $("#wpColorValue").textContent = $("#wpColor").value.toUpperCase();
}

$("#wpDeleteBtn").addEventListener("click", async () => {
  if (!editingWaypoint || !Auth.canEditWaypoint(editingWaypoint)) return;
  const ok = await confirmAction(`Delete "${editingWaypoint.name}"?`, { title: "Delete waypoint?", confirmLabel: "Delete" });
  if (!ok) return;
  try {
    await deleteWaypoint(editingWaypoint.id);
    closeWaypointForm();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    toast(err.message || "Could not delete waypoint.", "error");
  }
});

$("#waypointForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const yRaw = $("#wpY").value;
  const categoryRaw = $("#wpCategory").value;
  const xEl = $("#wpX");
  const zEl = $("#wpZ");
  const xRaw = xEl.value.trim() === "" ? xEl.placeholder : xEl.value;
  const zRaw = zEl.value.trim() === "" ? zEl.placeholder : zEl.value;
  const payload = {
    name: $("#wpName").value.trim(),
    description: $("#wpDescription").value.trim() || null,
    x: Math.round(Number(xRaw)) || 0,
    y: yRaw === "" ? null : Math.round(Number(yRaw)),
    z: Math.round(Number(zRaw)) || 0,
    category_id: categoryRaw === "" ? null : categoryRaw,
    color: $("#wpColor").value,
  };

  try {
    if (editingWaypoint) {
      if (!Auth.canEditWaypoint(editingWaypoint)) throw new Error("You cannot edit this waypoint.");
      await updateWaypoint(editingWaypoint.id, payload, editingWaypoint);
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
    toast(err.message || "Could not save waypoint.", "error");
  }
});

// ---------------------------------------------------------------------------
// Leaderboards (public - no auth required)
// ---------------------------------------------------------------------------

const PRESET_STATS = [
  // aggregateCm: true sums every "*_CM" stat (WALK_ONE_CM, SPRINT_ONE_CM,
  // AVIATE_ONE_CM, BOAT_ONE_CM, etc.) via the distance_leaderboard RPC,
  // instead of pointing at one specific movement-type stat key.
  { id: "distance_traveled", label: "Distance Traveled", aggregateCm: true, format: "distance" },
  { id: "jumps", label: "Jumps", keys: ["JUMP"], format: "count" },
  { id: "mob_kills", label: "Mob Kills", keys: ["MOB_KILLS_TOTAL", "MOB_KILLS"], format: "count" },
  { id: "time_played", label: "Time Played", keys: ["PLAY_ONE_MINUTE", "TIME_PLAYED"], format: "time" },
  { id: "player_deaths", label: "Deaths", keys: ["DEATHS"], format: "count" },
  { id: "shulker_boxes_opened", label: "Shulker Boxes Opened", keys: ["SHULKER_BOX_OPENED"], format: "count" },
  { id: "crafting_table_interactions", label: "Crafting Table Interactions", keys: ["CRAFTING_TABLE_INTERACTION"], format: "count" },
  { id: "blocks_mined", label: "Blocks Mined", keys: ["BLOCKS_MINED_TOTAL"], format: "count" },
];

// Bukkit/Minecraft statistic key -> human-readable name, matching the
// vanilla stat menu naming as closely as practical.
const CM_DISTANCE_LABELS = {
  WALK: "Walked", SPRINT: "Sprinted", CROUCH: "Crouched", FLY: "Flown", AVIATE: "Flown (Elytra)",
  CLIMB: "Climbed", FALL: "Fallen", SWIM: "Swum", DIVE: "Dove", BOAT: "Boated",
  HORSE: "Ridden (Horse)", MINECART: "Ridden (Minecart)", PIG: "Ridden (Pig)", STRIDER: "Ridden (Strider)",
  WALK_ON_WATER: "Walked on Water", WALK_UNDER_WATER: "Walked Underwater",
};
const STAT_PREFIX_LABELS = {
  KILL_ENTITY: "Kills", ENTITY_KILLED_BY: "Killed By", MINE_BLOCK: "Mined", USE_ITEM: "Used",
  BREAK_ITEM: "Broken", CRAFT_ITEM: "Crafted", DROP: "Dropped", PICKUP: "Picked Up",
};
const STAT_NAME_OVERRIDES = {
  PLAY_ONE_MINUTE: "Time Played", TIME_PLAYED: "Time Played", CHEST_OPENED: "Chests Opened",
  BLOCKS_MINED_TOTAL: "Blocks Mined", LEAVE_GAME: "Times Left Game",
  TALKED_TO_VILLAGER: "Talked to Villager", DROP_COUNT: "Items Dropped",
  MOB_KILLS_TOTAL: "Mob Kills", MOB_KILLS: "Mob Kills", TOTAL_WORLD_TIME: "Time in World",
  TRADED_WITH_VILLAGER: "Villager Trades", DAMAGE_DEALT: "Damage Dealt", DAMAGE_TAKEN: "Damage Taken",
  SNEAK_TIME: "Time Sneaking", TIME_SINCE_REST: "Time Since Rest", TIME_SINCE_DEATH: "Time Since Death",
  JUMP: "Jumps", DEATHS: "Deaths", PLAYER_KILLS: "Player Kills", FISH_CAUGHT: "Fish Caught",
  ANIMALS_BRED: "Animals Bred", BELL_RING: "Bells Rung", CAKE_SLICES_EATEN: "Cake Slices Eaten",
  ENCHANT_ITEM: "Items Enchanted", FLOWER_POTTED: "Flowers Potted", RAID_TRIGGER: "Raids Triggered",
  RAID_WIN: "Raids Won", RECORD_PLAYED: "Records Played", SLEEP_IN_BED: "Times Slept",
};

// Some raw stat_key rows have inconsistent whitespace around "_"/":" (e.g.
// "MINE_BLOCK: CACTUS_FLOWER" vs "MINE_BLOCK:CACTUS_FLOWER"), and some newer
// entity/item names come through mashed together with no separator at all
// (e.g. "FireworkRocket", "HappyGhast"). Inserting a boundary at every
// lower->upper letter transition before splitting on /[_\s]+/ handles both:
// underscore/space runs collapse to one gap, and camelCase joins get one too
// - so the same stat always renders as one consistently-spaced label.
function titleCaseStatKey(str) {
  return str
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getStatDisplayName(key) {
  if (!key) return "";
  const trimmedKey = key.trim();
  if (STAT_NAME_OVERRIDES[trimmedKey]) return STAT_NAME_OVERRIDES[trimmedKey];
  if (trimmedKey.endsWith("_ONE_CM")) {
    const base = trimmedKey.slice(0, -"_ONE_CM".length);
    // Known movement types already read as verbs ("Walked", "Sprinted"), so
    // "Distance Walked" is correct as-is. Anything not in that table is a
    // mount/vehicle name (e.g. a newly-added mob like Happy Ghast), which
    // reads as a noun - "Distance by Happy Ghast" - not "Distance Happy Ghast".
    if (CM_DISTANCE_LABELS[base]) return `Distance ${CM_DISTANCE_LABELS[base]}`;
    return `Distance by ${titleCaseStatKey(base)}`;
  }
  if (trimmedKey.includes(":")) {
    // Trim each side of the ":" too, so a stray space after the colon on
    // some rows doesn't leak into the suffix and break titleCaseStatKey's
    // capitalization (that stray leading space was the actual cause of
    // "Used: Beef" vs "Used:Beef"-looking inconsistencies).
    const [prefix, suffix] = trimmedKey.split(":").map((p) => p.trim());
    const label = STAT_PREFIX_LABELS[prefix] || titleCaseStatKey(prefix);
    // No colon in the final label - "Broken Diamond Sword", not
    // "Broken: Diamond Sword".
    return `${label} ${titleCaseStatKey(suffix)}`;
  }
  return titleCaseStatKey(trimmedKey);
}

// Extra search terms for items whose common Minecraft nickname doesn't
// appear anywhere in the raw stat key - e.g. cooked beef is universally
// called "steak" in-game/community slang, so searching "steak" should still
// surface "Used: Cooked Beef". Add more entries here as needed; `match` is
// checked as a substring against the raw (uppercased) stat key.
const STAT_ALIAS_TERMS = [
  { match: "COOKED_BEEF", terms: ["steak"] },
  { match: "COOKED_PORKCHOP", terms: ["cooked pork"] },
  { match: "ENCHANTED_GOLDEN_APPLE", terms: ["notch apple", "gapple", "napple"] },
  { match: "GOLDEN_APPLE", terms: ["gapple"] },
  { match: "EXPERIENCE_BOTTLE", terms: ["xp bottle", "xp"] },
  { match: "ENDER_PEARL", terms: ["pearl"] },
  { match: "NETHER_STAR", terms: ["star"] },
];

let activeLeaderboardStatId = PRESET_STATS[0].id;
let statKeysLoaded = false;
let allStatKeys = []; // [{ key, name }], populated once from listStatKeys()
let leaderboardCustomDebounce = null;
let statPickerHighlighted = -1;

function loadLeaderboardsTab() {
  renderLeaderboardChips();
  selectLeaderboardStat(activeLeaderboardStatId);
}

function renderLeaderboardChips() {
  leaderboardStatChipsEl.innerHTML = "";
  for (const stat of PRESET_STATS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "leaderboard-chip";
    chip.dataset.active = String(activeLeaderboardStatId === stat.id);
    chip.innerHTML = `<span>${stat.label}</span>`;
    chip.addEventListener("click", () => selectLeaderboardStat(stat.id));
    leaderboardStatChipsEl.appendChild(chip);
  }
  // The "Custom" option is the always-visible search chip (#statPicker)
  // rather than a discrete pill here - just keep its active styling in sync.
  statPickerEl.dataset.active = String(activeLeaderboardStatId === "custom");
}

async function selectLeaderboardStat(id) {
  activeLeaderboardStatId = id;
  renderLeaderboardChips();

  if (id === "custom") {
    await ensureStatKeysLoaded();
    const key = leaderboardCustomInputEl.value.trim();
    if (key) {
      leaderboardStatTitleEl.textContent = getStatDisplayName(key);
      loadLeaderboard(() => listPlayerStats([key], 10), "count");
    } else {
      leaderboardStatTitleEl.textContent = "";
      leaderboardListEl.innerHTML = "";
      leaderboardEmptyEl.hidden = true;
    }
    return;
  }

  closeStatPicker();
  const preset = PRESET_STATS.find((s) => s.id === id);
  if (preset) {
    leaderboardStatTitleEl.textContent = "";
    if (preset.aggregateCm) {
      loadLeaderboard(() => listDistanceLeaderboard(10), preset.format);
    } else {
      loadLeaderboard(() => listPlayerStats(preset.keys, 10), preset.format);
    }
  }
}

async function ensureStatKeysLoaded() {
  if (statKeysLoaded) return;
  try {
    const keys = await listStatKeys();
    allStatKeys = keys.map((k) => {
      const rawKey = k.stat_key.trim();
      const name = getStatDisplayName(rawKey);
      // Search blob includes the friendly name, the raw key (separators
      // collapsed to single spaces), and any known slang aliases (e.g.
      // "steak" for COOKED_BEEF) - they don't share vocabulary, e.g. USE_ITEM
      // maps to the label "Used", so "used: diamond leggings" alone doesn't
      // contain "item" and wouldn't match someone searching "use item".
      const aliasTerms = STAT_ALIAS_TERMS.filter((a) => rawKey.toUpperCase().includes(a.match)).flatMap((a) => a.terms);
      const rawWords = rawKey.replace(/[_:\s]+/g, " ").trim();
      const search = `${name} ${rawWords} ${aliasTerms.join(" ")}`.toLowerCase();
      // A whitespace-stripped copy too, so typing "cactusflower" (no space)
      // still matches a name like "Cactus Flower", and so rows with a stray
      // space after ":" or "_" (see titleCaseStatKey above) can't produce a
      // search blob that differs from an otherwise-identical row.
      const searchCompact = search.replace(/[^a-z0-9]/g, "");
      return { key: k.stat_key, name, search, searchCompact };
    });
    allStatKeys.sort((a, b) => a.name.localeCompare(b.name));
    statKeysLoaded = true;
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Custom stat picker (replaces a native <input list> + <datalist>, which
// silently caps out and stops matching once there are hundreds/thousands of
// options - we now have 1000+ stat keys after adding item stats).
// ---------------------------------------------------------------------------

const STAT_PICKER_RENDER_LIMIT = 50;

function highlightMatch(text, tokens) {
  if (!tokens.length) return escapeHtml(text);
  // Highlight every position where any single token matches, not just one
  // exact phrase - matches the AND-of-tokens search logic above.
  const ranges = [];
  const lower = text.toLowerCase();
  for (const t of tokens) {
    let from = 0;
    let idx;
    while ((idx = lower.indexOf(t, from)) !== -1) {
      ranges.push([idx, idx + t.length]);
      from = idx + t.length;
    }
  }
  if (ranges.length === 0) return escapeHtml(text);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let result = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    result += escapeHtml(text.slice(cursor, start));
    result += `<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }
  result += escapeHtml(text.slice(cursor));
  return result;
}

function renderStatPickerOptions(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const matches =
    tokens.length === 0
      ? allStatKeys
      : allStatKeys.filter((s) => tokens.every((t) => s.search.includes(t) || s.searchCompact.includes(t.replace(/[^a-z0-9]/g, ""))));

  statPickerMenuEl.innerHTML = "";
  statPickerHighlighted = -1;

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "stat-picker-empty";
    empty.textContent = statKeysLoaded ? "No matching statistic." : "Loading statistics...";
    statPickerMenuEl.appendChild(empty);
    return;
  }

  const shown = matches.slice(0, STAT_PICKER_RENDER_LIMIT);
  shown.forEach((s, idx) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "stat-picker-option";
    opt.setAttribute("role", "option");
    opt.dataset.index = String(idx);
    opt.dataset.key = s.key;
    opt.innerHTML = highlightMatch(s.name, tokens);
    // mousedown (not click) fires before the input's blur, so the menu
    // doesn't close itself before the selection is registered.
    opt.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectStatKey(s.key, s.name);
    });
    statPickerMenuEl.appendChild(opt);
  });

  if (matches.length > STAT_PICKER_RENDER_LIMIT) {
    const more = document.createElement("div");
    more.className = "stat-picker-more";
    more.textContent = `+${matches.length - STAT_PICKER_RENDER_LIMIT} more - keep typing to narrow down`;
    statPickerMenuEl.appendChild(more);
  }
}

function statPickerOptionEls() {
  return Array.from(statPickerMenuEl.querySelectorAll(".stat-picker-option"));
}

function updateStatPickerHighlight() {
  const options = statPickerOptionEls();
  options.forEach((opt, idx) => {
    const active = idx === statPickerHighlighted;
    opt.dataset.highlighted = String(active);
    if (active) opt.scrollIntoView({ block: "nearest" });
  });
}

function openStatPicker() {
  statPickerMenuEl.hidden = false;
  leaderboardCustomInputEl.setAttribute("aria-expanded", "true");
}

function closeStatPicker() {
  statPickerMenuEl.hidden = true;
  leaderboardCustomInputEl.setAttribute("aria-expanded", "false");
  statPickerHighlighted = -1;
}

function selectStatKey(key, name) {
  leaderboardCustomInputEl.value = key;
  closeStatPicker();
  leaderboardStatTitleEl.textContent = name;
  loadLeaderboard(() => listPlayerStats([key], 10), "count");
}

leaderboardCustomInputEl.addEventListener("focus", async () => {
  // Focusing the search chip *is* choosing "Custom" - it's no longer a
  // separate pill you have to click first.
  if (activeLeaderboardStatId !== "custom") {
    activeLeaderboardStatId = "custom";
    renderLeaderboardChips();
    leaderboardStatTitleEl.textContent = leaderboardCustomInputEl.value.trim() ? getStatDisplayName(leaderboardCustomInputEl.value.trim()) : "";
  }
  await ensureStatKeysLoaded();
  renderStatPickerOptions(leaderboardCustomInputEl.value);
  openStatPicker();
});

// Clicking anywhere in the chip (icon, padding) focuses the input, so the
// whole bar acts as the control, not just the text itself.
statPickerEl.addEventListener("click", (e) => {
  if (e.target !== leaderboardCustomInputEl) leaderboardCustomInputEl.focus();
});

leaderboardCustomInputEl.addEventListener("input", () => {
  renderStatPickerOptions(leaderboardCustomInputEl.value);
  openStatPicker();

  clearTimeout(leaderboardCustomDebounce);
  leaderboardCustomDebounce = setTimeout(() => {
    const key = leaderboardCustomInputEl.value.trim();
    if (!key) {
      leaderboardStatTitleEl.textContent = "";
      leaderboardListEl.innerHTML = "";
      leaderboardEmptyEl.hidden = true;
      return;
    }
    leaderboardStatTitleEl.textContent = getStatDisplayName(key);
    loadLeaderboard(() => listPlayerStats([key], 10), "count");
  }, 250);
});

leaderboardCustomInputEl.addEventListener("keydown", (e) => {
  if (statPickerMenuEl.hidden) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      renderStatPickerOptions(leaderboardCustomInputEl.value);
      openStatPicker();
    }
    return;
  }

  const options = statPickerOptionEls();
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (options.length === 0) return;
    statPickerHighlighted = Math.min(statPickerHighlighted + 1, options.length - 1);
    updateStatPickerHighlight();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (options.length === 0) return;
    statPickerHighlighted = Math.max(statPickerHighlighted - 1, 0);
    updateStatPickerHighlight();
  } else if (e.key === "Enter") {
    if (statPickerHighlighted >= 0 && options[statPickerHighlighted]) {
      e.preventDefault();
      const opt = options[statPickerHighlighted];
      const match = allStatKeys.find((s) => s.key === opt.dataset.key);
      selectStatKey(opt.dataset.key, match ? match.name : opt.dataset.key);
    }
  } else if (e.key === "Escape") {
    closeStatPicker();
  }
});

document.addEventListener("click", (e) => {
  if (statPickerEl.contains(e.target)) return;
  closeStatPicker();
});

async function loadLeaderboard(fetchRows, format) {
  leaderboardLoadingEl.hidden = false;
  leaderboardEmptyEl.hidden = true;
  leaderboardListEl.innerHTML = "";
  let rows = [];
  try {
    rows = await fetchRows();
  } catch (err) {
    console.error(err);
    rows = [];
  }
  leaderboardLoadingEl.hidden = true;
  leaderboardEmptyEl.hidden = rows.length > 0;
  rows.forEach((row, index) => {
    leaderboardListEl.appendChild(buildLeaderboardRow(row, index + 1, format));
  });
}

function buildLeaderboardRow(row, rank, format) {
  const item = document.createElement("div");
  item.className = "leaderboard-row";
  item.dataset.rank = rank <= 3 ? String(rank) : "other";
  const username = row.players?.username ?? "Unknown";
  item.innerHTML = `
    <span class="leaderboard-rank">${rank}</span>
    <img class="leaderboard-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(username)}/64" alt="" width="28" height="28" />
    <span class="leaderboard-username">${escapeHtml(username)}</span>
    <span class="leaderboard-value">${escapeHtml(formatStatValue(format, row.stat_value))}</span>
  `;
  return item;
}

function formatStatValue(format, value) {
  const n = Number(value) || 0;
  switch (format) {
    case "distance":
      return `${(n / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} blocks`;
    case "time": {
      const totalSeconds = n / 20;
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }
    case "damage":
      return `${(n / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} HP`;
    case "count":
    default:
      return n.toLocaleString();
  }
}

// ---------------------------------------------------------------------------
// Server panel
// ---------------------------------------------------------------------------

const STATUS_STALE_MS = 30000; // 3x the plugin's default 10s report interval
let lastServerStatus = null;
let lastPlayers = [];
let tickTimer = null;

function setServerConnectionField(id, text, shouldBlur) {
  const el = $("#" + id);
  el.textContent = text;
  el.classList.toggle("ip-blur", shouldBlur);
  el.classList.remove("is-revealed"); // always re-blur on a fresh load/reload
}

document.addEventListener("click", (e) => {
  const value = e.target.closest(".server-field-value.ip-blur");
  if (value) value.classList.toggle("is-revealed");
});

async function loadServerPanel() {
  try {
    lastServerStatus = await getServerStatus();
    renderServerStatus(lastServerStatus);
  } catch (err) {
    console.error(err);
    lastServerStatus = null;
    renderServerStatus(null);
  }

  if (Auth.isLoggedIn()) {
    try {
      const info = await getServerInfo();
      setServerConnectionField("serverHostname", info.hostname || "Not set", Boolean(info.hostname));
      setServerConnectionField("serverIp", info.ip || "Not set", Boolean(info.ip));
    } catch (err) {
      console.error(err);
      setServerConnectionField("serverHostname", "unavailable", false);
      setServerConnectionField("serverIp", "unavailable", false);
    }
  } else {
    setServerConnectionField("serverHostname", "Log in to view", false);
    setServerConnectionField("serverIp", "Log in to view", false);
  }

  for (const button of document.querySelectorAll(".server-copy")) {
    button.hidden = !Auth.isLoggedIn();
    button.disabled = !$("#" + button.dataset.copySource).textContent || $("#" + button.dataset.copySource).textContent === "unavailable";
  }

  loadPlayersPanel();
  startServerTicker();
}

function isStatusStale(status) {
  if (!status || !status.updated_at) return true;
  return Date.now() - new Date(status.updated_at).getTime() > STATUS_STALE_MS;
}

function getTpsClass(tps) {
  if (tps >= 18) return "tps-good";
  if (tps >= 15) return "tps-warn";
  return "tps-bad";
}

function renderServerStatus(status) {
  const offline = isStatusStale(status);
  $("#serverOfflineNotice").hidden = !offline;

  if (offline) {
    $("#serverTps").textContent = "—";
    $("#serverTps").classList.remove("tps-good", "tps-warn", "tps-bad");
    $("#serverUptime").textContent = "—";
    $("#serverDays").textContent = "—";
    $("#serverOfflineNotice").innerHTML = status?.updated_at ? `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Server is offline - last online ${formatRelativeTime(status.updated_at)}` : `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Server is offline`;
    renderLivePins();
    return;
  }

  const tps = status.tps_1m != null ? status.tps_1m.toFixed(1) : "—";
  $("#serverTps").textContent = tps;
  $("#serverTps").classList.remove("tps-good", "tps-warn", "tps-bad");
  if (status.tps_1m != null) {
    $("#serverTps").classList.add(getTpsClass(status.tps_1m));
  }

  if (status.started_at) {
    const ms = Date.now() - new Date(status.started_at).getTime();
    $("#serverUptime").textContent = formatUptime(ms);
  } else {
    $("#serverUptime").textContent = "—";
  }
  $("#serverDays").textContent = status.days != null ? status.days : "—";
  renderLivePins();
}

function formatUptime(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

subscribeServerStatus((payload) => {
  lastServerStatus = payload.new;
  if (currentDim === "server") renderServerStatus(lastServerStatus);
});

// Keeps "last seen"/uptime/offline text current without needing a refresh.
// Re-checks on a self-adjusting delay: fast (1s) while anything shown is
// under a minute old, backing off to a minute/hour/day once it's older, so
// there's no busy-polling once nothing visible is about to change text.
function startServerTicker() {
  stopServerTicker();
  tickTimer = setTimeout(tick, nextTickDelay());
}

function stopServerTicker() {
  clearTimeout(tickTimer);
  tickTimer = null;
}

function tick() {
  if (currentDim !== "server") return;
  renderServerStatus(lastServerStatus);
  renderPlayersList(lastPlayers);
  tickTimer = setTimeout(tick, nextTickDelay());
}

function nextTickDelay() {
  let delay = 60000; // default: recheck every minute (covers uptime ticking)
  for (const p of lastPlayers) {
    if (p.online) continue;
    if (isResetArtifact(p.last_seen)) continue; // unknown/fake timestamp - doesn't need fast polling
    const ageSec = (Date.now() - new Date(p.last_seen).getTime()) / 1000;
    if (ageSec < 60) delay = Math.min(delay, 1000);
    else if (ageSec < 3600) delay = Math.min(delay, 60000);
    else if (ageSec < 86400) delay = Math.min(delay, 3600000);
    else delay = Math.min(delay, 86400000);
  }
  return delay;
}

// ---------------------------------------------------------------------------
// Players list (shown inside the Server panel)
// ---------------------------------------------------------------------------

let playersRequestId = 0;

async function loadPlayersPanel() {
  const requestId = ++playersRequestId;
  try {
    const players = await listPlayers();
    if (requestId !== playersRequestId) return; // a newer request already started
    lastPlayers = players;
    renderPlayersList(lastPlayers);
  } catch (err) {
    if (requestId !== playersRequestId) return;
    console.error(err);
    lastPlayers = [];
    playersListEl.innerHTML = "";
    playersEmptyEl.hidden = false;
    playersEmptyEl.textContent = "Could not load players.";
  }
}

// A server update on 2026-08-20 reset every player's first_seen/last_seen to
// the moment of the update itself, so those timestamps carry no real
// information. Treat anything within +/-5min of that instant as "unknown"
// rather than showing a (misleadingly recent-looking) fake last-seen time.
const RESET_ARTIFACT_TIME = new Date("2026-08-20T19:37:58.589292Z").getTime();
const RESET_ARTIFACT_WINDOW_MS = 5 * 60 * 1000;

function isResetArtifact(value) {
  if (!value) return false;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return false;
  return Math.abs(t - RESET_ARTIFACT_TIME) <= RESET_ARTIFACT_WINDOW_MS;
}

function sortPlayers(players) {
  const online = players.filter((p) => p.online).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
  const offline = players
    .filter((p) => !p.online)
    .sort((a, b) => {
      // Players whose last_seen is a reset artifact have an unknown real
      // last-seen time - sort them after everyone with a genuine timestamp,
      // rather than letting the fake (recent-looking) reset time place them
      // near the top.
      const aReset = isResetArtifact(a.last_seen);
      const bReset = isResetArtifact(b.last_seen);
      if (aReset !== bReset) return aReset ? 1 : -1;
      if (aReset && bReset) return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
      return new Date(b.last_seen) - new Date(a.last_seen);
    });
  return [...online, ...offline];
}

function formatAbsoluteTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function renderPlayersList(players) {
  const sorted = sortPlayers(players);
  const dimByPlayerId = new Map(livePositions.map((p) => [p.player_id, p.dimension]));
  playersListEl.innerHTML = "";
  playersEmptyEl.hidden = sorted.length > 0;
  playersEmptyEl.textContent = "No players have joined yet.";
  for (const p of sorted) {
    const row = document.createElement("div");
    row.className = "players-row";

    const dim = p.online ? dimByPlayerId.get(p.id) : null;
    const dimBadge = dim ? `<span class="players-dim-badge" style="--dim-badge-color: ${DIM_COLORS[dim] || "var(--text-muted)"}">${escapeHtml(DIM_LABELS[dim] || dim)}</span>` : "";

    let afkBadge = "";
    if (p.online && p.afk) {
      const afkTooltipAttr = p.last_moved ? ` data-tooltip="AFK for ${escapeHtml(formatUptime(Date.now() - new Date(p.last_moved).getTime()))}"` : "";
      afkBadge = `<span class="players-badge afk"${afkTooltipAttr}>AFK</span>`;
    }

    const badgeText = p.online ? "Online" : "Offline";
    let tooltipAttr = "";
    if (!p.online) {
      const lastSeenText = isResetArtifact(p.last_seen) ? "Last seen a long time ago" : `Last seen ${formatRelativeTime(p.last_seen)} (${formatAbsoluteTime(p.last_seen)})`;
      tooltipAttr = ` data-tooltip="${escapeHtml(lastSeenText)}"`;
    }

    row.innerHTML = `
      <img class="players-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(p.username)}/64" alt="" width="32" height="32" />
      <span class="players-username">${escapeHtml(p.username)}</span>
      ${dimBadge}
      ${afkBadge}
      <span class="players-badge ${p.online ? "online" : "offline"}"${tooltipAttr}>${badgeText}</span>
    `;
    playersListEl.appendChild(row);
  }
}

// Tap-to-toggle the offline badge's timestamp tooltip on touch devices
// (desktop gets it for free via :hover in CSS).
playersListEl.addEventListener("click", (e) => {
  const badge = e.target.closest(".players-badge.offline, .players-badge.afk");
  document.querySelectorAll(".players-badge.show-tooltip").forEach((el) => {
    if (el !== badge) el.classList.remove("show-tooltip");
  });
  if (badge) badge.classList.toggle("show-tooltip");
});

subscribePlayers(async () => {
  if (currentDim === "server") loadPlayersPanel();
});

// ---------------------------------------------------------------------------
// Whitelist panel (owner-only; RLS enforces this server-side too). Reads a
// read-only mirror of the server's real whitelist; add/remove go through a
// request queue the plugin executes as real /whitelist commands.
// ---------------------------------------------------------------------------

async function loadWhitelistPanel() {
  if (!Auth.can("manageWhitelist")) return;
  try {
    const [entries, pending] = await Promise.all([listWhitelist(), listPendingWhitelistCommands()]);
    renderWhitelist(entries, pending);
  } catch (err) {
    console.error(err);
    whitelistListEl.innerHTML = "";
    whitelistEmptyEl.hidden = false;
    whitelistEmptyEl.textContent = "Could not load whitelist.";
  }
}

function renderWhitelist(entries, pending) {
  whitelistListEl.innerHTML = "";
  whitelistEmptyEl.hidden = entries.length + pending.length > 0;

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "whitelist-row";
    row.innerHTML = `
      <img class="whitelist-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(entry.username)}/64" alt="" width="24" height="24" />
      <span class="whitelist-username">${escapeHtml(entry.username)}</span>
      <button class="whitelist-remove-btn" type="button" data-username="${escapeHtml(entry.username)}" title="Remove" aria-label="Remove ${escapeHtml(entry.username)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    `;
    whitelistListEl.appendChild(row);
  }

  for (const cmd of pending) {
    const row = document.createElement("div");
    row.className = "whitelist-row whitelist-row--pending";
    row.innerHTML = `
      <img class="whitelist-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(cmd.username)}/64" alt="" width="24" height="24" />
      <span class="whitelist-username">${escapeHtml(cmd.username)}</span>
      <button class="whitelist-cancel-btn" type="button" data-command-id="${cmd.id}" title="Cancel request" aria-label="Cancel request for ${escapeHtml(cmd.username)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    `;
    whitelistListEl.appendChild(row);
  }
}

subscribeWhitelist(() => {
  if (currentDim === "whitelist") loadWhitelistPanel();
});

subscribeWhitelistCommands((payload) => {
  if (payload.eventType === "UPDATE" && payload.new.status === "failed") {
    const verb = payload.new.action === "remove" ? "remove" : "add";
    toast(`Could not ${verb} "${payload.new.username}" - the command failed on the server.`, "error");
  }
  if (currentDim === "whitelist") loadWhitelistPanel();
});

$("#whitelistForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#whitelistUsername");
  const username = input.value.trim();
  if (!username) return;
  try {
    await requestWhitelistAdd(username);
    input.value = "";
    toast("Requested - applies within a few seconds.", "success");
    loadWhitelistPanel();
  } catch (err) {
    toast(err.message || "Could not request add.", "error");
  }
});

whitelistListEl.addEventListener("click", async (e) => {
  const removeBtn = e.target.closest(".whitelist-remove-btn");
  const cancelBtn = e.target.closest(".whitelist-cancel-btn");

  if (removeBtn) {
    const ok = await confirmAction(`Remove "${removeBtn.dataset.username}" from the whitelist?`);
    if (!ok) return;
    try {
      await requestWhitelistRemove(removeBtn.dataset.username);
      toast("Requested - applies within a few seconds.", "success");
      loadWhitelistPanel();
    } catch (err) {
      toast(err.message || "Could not request removal.", "error");
    }
    return;
  }

  if (cancelBtn) {
    const ok = await confirmAction("Cancel this pending request?");
    if (!ok) return;
    try {
      await cancelWhitelistCommand(cancelBtn.dataset.commandId);
      toast("Request canceled.", "success");
      loadWhitelistPanel();
    } catch (err) {
      toast(err.message || "Could not cancel request.", "error");
    }
  }
});

document.querySelectorAll(".server-copy").forEach((button) => {
  button.addEventListener("click", () => {
    const value = $("#" + button.dataset.copySource).textContent;
    copyTextToClipboard(value, button);
  });
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

let allLogs = [];
let deletedWaypointIds = new Set();

const LOG_ACTION_LABELS = { create: "created", update: "edited", delete: "deleted" };
const LOG_ACTION_ICONS = { create: "fa-plus", update: "fa-pen", delete: "fa-trash" };
function formatRelativeTime(value) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const divisions = [
    { amount: 60, unit: "seconds" },
    { amount: 60, unit: "minutes" },
    { amount: 24, unit: "hours" },
    { amount: 7, unit: "days" },
    { amount: 4.34524, unit: "weeks" },
    { amount: 12, unit: "months" },
    { amount: Infinity, unit: "years" },
  ];
  let duration = (date.getTime() - Date.now()) / 1000;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "unknown time";
}

function formatLogFieldValue(field, value) {
  if (value === null || value === undefined || value === "") return "None";
  if (field === "category_id") return categoryById(value)?.name || "Unknown category";
  if (field === "dimension") return DIM_LABELS[value] || value;
  return String(value);
}

const LOG_DETAIL_FIELDS = {
  waypoint: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "dimension", label: "Dimension" },
    { key: "coords", label: "Coordinates" },
    { key: "color", label: "Color" },
    { key: "category_id", label: "Category" },
    { key: "created_by_username", label: "Created by" },
    { key: "created_at", label: "Created at" },
  ],
  category: [
    { key: "name", label: "Name" },
    { key: "color", label: "Color" },
    { key: "icon", label: "Icon" },
    { key: "created_at", label: "Created at" },
  ],
};

function formatLogDetailValue(key, snapshot) {
  if (!snapshot) return "None";
  if (key === "coords") {
    if (snapshot.x === undefined) return "None";
    const hasY = snapshot.y !== null && snapshot.y !== undefined;
    return formatCoordsForCopy(snapshot.x, hasY ? snapshot.y : null, snapshot.z);
  }
  if (key === "created_at") {
    return snapshot.created_at ? formatWaypointDate(snapshot.created_at) : "None";
  }
  return formatLogFieldValue(key, snapshot[key]);
}

function buildLogDetailsPanel(log) {
  const wrap = document.createElement("div");
  wrap.className = "log-entry-details";

  const inner = document.createElement("div");
  inner.className = "log-entry-details-inner";
  wrap.appendChild(inner);

  const isUpdate = log.action === "update" && log.changes && log.changes.before && log.changes.after;
  const snapshot = isUpdate ? null : log.changes;
  let fields = LOG_DETAIL_FIELDS[log.entity_type] || [];
  if (isUpdate) {
    fields = fields.filter((field) => field.key !== "created_by_username" && field.key !== "created_at");
  }

  const table = document.createElement("div");
  table.className = "log-detail-table";

  for (const field of fields) {
    const row = document.createElement("div");
    row.className = "log-detail-row";
    if (isUpdate) {
      const beforeVal = formatLogDetailValue(field.key, log.changes.before);
      const afterVal = formatLogDetailValue(field.key, log.changes.after);
      const changed = beforeVal !== afterVal;
      const valueHtml = changed ? `<span class="log-detail-value-before">${escapeHtml(beforeVal)}</span> <i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${escapeHtml(afterVal)}` : escapeHtml(afterVal);
      row.innerHTML = `<span class="log-detail-label">${escapeHtml(field.label)}</span><span class="log-detail-value${changed ? " log-detail-value--changed" : ""}">${valueHtml}</span>`;
    } else {
      const val = formatLogDetailValue(field.key, snapshot);
      row.innerHTML = `<span class="log-detail-label">${escapeHtml(field.label)}</span><span class="log-detail-value">${escapeHtml(val)}</span>`;
    }
    table.appendChild(row);
  }

  inner.appendChild(table);

  if (log.action === "delete" && log.changes) {
    const canRestore = log.entity_type === "waypoint" ? Auth.can("addWaypoint") : Auth.can("manageCategories");
    if (canRestore) {
      const actions = document.createElement("div");
      actions.className = "log-detail-actions";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost log-detail-restore-btn";
      btn.textContent = log.entity_type === "waypoint" ? "Recreate this waypoint" : "Recreate this category";
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (log.entity_type === "waypoint") {
          recreateWaypointFromLog(log);
        } else {
          recreateCategoryFromLog(log);
        }
      });
      actions.appendChild(btn);
      inner.appendChild(actions);
    }
  }

  return wrap;
}

async function recreateCategoryFromLog(log) {
  const snapshot = log.changes;
  if (!snapshot) return;
  switchDimension("categories");
  resetCategoryForm();
  $("#catName").value = snapshot.name || "";
  $("#catColor").value = snapshot.color || "#a78bfa";
  $("#catIcon").value = categoryIconClass(snapshot.icon) || "";
  updateCategoryIconPreview();
  $("#catName").focus();
}

// Instead of recreating the waypoint outright, jump to where it was and open the
// "Add waypoint" form pre-filled with its old data, ready to review/edit before saving.
async function recreateWaypointFromLog(log) {
  const snapshot = log.changes;
  if (!snapshot) return;
  const dimension = snapshot.dimension || log.dimension || currentDim;
  switchDimension(dimension);
  await loadWaypointsForDim(dimension);
  grid.jumpTo(snapshot.x, snapshot.z);
  if (mobileMediaQuery.matches) closeSidebarDrawer();
  openWaypointForm({
    name: snapshot.name,
    description: snapshot.description ?? "",
    x: snapshot.x,
    y: snapshot.y ?? null,
    z: snapshot.z,
    category_id: snapshot.category_id ?? null,
    color: snapshot.color,
  });
}

async function loadLogs() {
  logsLoadingEl.hidden = false;
  logsEmptyEl.hidden = true;
  logsListEl.innerHTML = "";
  try {
    allLogs = await listLogs();
    deletedWaypointIds = new Set(allLogs.filter((l) => l.entity_type === "waypoint" && l.action === "delete").map((l) => l.entity_id));
    populateLogUserFilter();
    renderLogs();
  } catch (err) {
    logsListEl.innerHTML = `<div class="logs-error">Could not load logs: ${escapeHtml(err.message || "unknown error")}</div>`;
  } finally {
    logsLoadingEl.hidden = true;
  }
}

function populateLogUserFilter() {
  const current = logUserFilterEl.value;
  const users = new Map();
  for (const log of allLogs) {
    if (log.user_id && log.username) users.set(log.user_id, log.username);
  }
  const sorted = [...users.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  logUserFilterEl.innerHTML = '<option value="">All users</option>' + sorted.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
  if (sorted.some(([id]) => id === current)) logUserFilterEl.value = current;
}

function renderLogs() {
  const search = logSearchEl.value.trim().toLowerCase();
  const entityFilter = logEntityFilterEl.value;
  const userFilter = logUserFilterEl.value;
  const actionFilter = logActionFilterEl.value;
  const dimFilter = logDimensionFilterEl.value;

  const filtered = allLogs.filter((log) => {
    if (entityFilter && log.entity_type !== entityFilter) return false;
    if (userFilter && log.user_id !== userFilter) return false;
    if (actionFilter && log.action !== actionFilter) return false;
    if (dimFilter && log.dimension !== dimFilter) return false;
    if (search) {
      const haystack = `${log.entity_name || ""} ${log.username || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / LOGS_PER_PAGE));
  logsCurrentPage = Math.min(Math.max(1, logsCurrentPage), totalPages);
  const pageItems = filtered.slice((logsCurrentPage - 1) * LOGS_PER_PAGE, logsCurrentPage * LOGS_PER_PAGE);

  logsListEl.innerHTML = "";
  logsEmptyEl.hidden = filtered.length !== 0;

  const frag = document.createDocumentFragment();
  for (const log of pageItems) {
    frag.appendChild(buildLogEntry(log));
  }
  logsListEl.appendChild(frag);

  renderLogsPagination(totalPages, filtered.length);
}

const LOGS_PER_PAGE = 20;
let logsCurrentPage = 1;

function renderLogsPagination(totalPages, totalCount) {
  logsPaginationEl.hidden = totalCount === 0;
  logsPageInputEl.value = logsCurrentPage;
  logsPageInputEl.max = totalPages;
  logsPageTotalEl.textContent = totalPages;
  logsFirstPageBtn.disabled = logsCurrentPage <= 1;
  logsPrevPageBtn.disabled = logsCurrentPage <= 1;
  logsNextPageBtn.disabled = logsCurrentPage >= totalPages;
  logsLastPageBtn.disabled = logsCurrentPage >= totalPages;
}

function goToLogsPage(page) {
  logsCurrentPage = page;
  renderLogs();
}

logsFirstPageBtn.addEventListener("click", () => goToLogsPage(1));
logsPrevPageBtn.addEventListener("click", () => goToLogsPage(logsCurrentPage - 1));
logsNextPageBtn.addEventListener("click", () => goToLogsPage(logsCurrentPage + 1));
logsLastPageBtn.addEventListener("click", () => goToLogsPage(Number(logsPageInputEl.max) || 1));
logsPageInputEl.addEventListener("change", () => {
  const page = Math.round(Number(logsPageInputEl.value));
  goToLogsPage(Number.isFinite(page) && page > 0 ? page : 1);
});

function buildLogEntry(log) {
  const item = document.createElement("div");
  item.className = `log-entry log-entry--${log.action}`;

  const icon = document.createElement("span");
  icon.className = "log-entry-icon";
  icon.innerHTML = `<i class="fa-solid ${LOG_ACTION_ICONS[log.action] || "fa-circle"}" aria-hidden="true"></i>`;

  const body = document.createElement("div");
  body.className = "log-entry-body";

  const summary = document.createElement("div");
  summary.className = "log-entry-summary";
  if (log.entity_type === "whitelist") {
    const verb = log.action === "delete" ? "removed" : "added";
    const prep = log.action === "delete" ? "from" : "to";
    summary.innerHTML = `<span class="log-entry-user">${escapeHtml(log.username || "Unknown user")}</span> ${verb} <span class="log-entry-user">${escapeHtml(log.entity_name || "unknown")}</span> ${prep} the whitelist`;
  } else {
    const actionLabel = LOG_ACTION_LABELS[log.action] || log.action;
    const entityLabel = log.entity_type === "waypoint" ? "waypoint" : "category";
    const dimColor = log.dimension ? DIM_COLORS[log.dimension] : null;
    const dimBadge = log.dimension ? ` <span class="log-entry-dim" style="--dim-badge-color: ${dimColor || "var(--text-muted)"}">${escapeHtml(DIM_LABELS[log.dimension] || log.dimension)}</span>` : "";
    summary.innerHTML = `<span class="log-entry-user">${escapeHtml(log.username || "Unknown user")}</span> ${actionLabel} ${entityLabel} <span class="log-entry-name">"${escapeHtml(log.entity_name || "Unnamed")}"</span>${dimBadge}`;
  }

  const meta = document.createElement("div");
  meta.className = "log-entry-meta";
  meta.textContent = `${formatWaypointDate(log.created_at)} (${formatRelativeTime(log.created_at)})`;
  meta.title = formatWaypointDate(log.created_at);

  body.append(summary, meta);

  const entryActions = document.createElement("div");
  entryActions.className = "log-entry-actions";

  if (log.entity_type === "waypoint" && log.entity_id) {
    const waypointExists = !deletedWaypointIds.has(log.entity_id);
    const jumpBtn = document.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.className = "log-entry-jump-btn";
    jumpBtn.innerHTML = `<i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> Jump to waypoint`;
    if (waypointExists) {
      jumpBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        jumpToLogWaypoint(log);
      });
    } else {
      jumpBtn.disabled = true;
      jumpBtn.title = "This waypoint doesn't exist anymore.";
    }
    entryActions.appendChild(jumpBtn);
  }

  if (log.entity_type !== "whitelist") {
    const detailsPanel = buildLogDetailsPanel(log);
    const detailsToggleBtn = document.createElement("button");
    detailsToggleBtn.type = "button";
    detailsToggleBtn.className = "log-entry-details-toggle";
    detailsToggleBtn.innerHTML = `<i class="fa-solid fa-chevron-down" aria-hidden="true"></i> Details`;
    detailsToggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = !detailsPanel.classList.contains("is-open");
      detailsPanel.classList.toggle("is-open", willOpen);
      detailsToggleBtn.classList.toggle("is-open", willOpen);
    });
    entryActions.appendChild(detailsToggleBtn);
    body.appendChild(entryActions);
    body.appendChild(detailsPanel);
  } else {
    body.appendChild(entryActions);
  }

  item.append(icon, body);
  return item;
}

async function jumpToLogWaypoint(log) {
  if (!log.dimension || !log.entity_id) return;
  switchDimension(log.dimension);
  await loadWaypointsForDim(log.dimension);
  const wp = currentWaypoints.find((w) => w.id === log.entity_id);
  if (!wp) return;
  grid.jumpTo(wp.x, wp.z);
  showTooltip(wp);
  if (mobileMediaQuery.matches) closeSidebarDrawer();
}

function updateLogDimensionFilterVisibility() {
  const hideDimension = logEntityFilterEl.value === "category" || logEntityFilterEl.value === "whitelist";
  logDimensionFilterEl.hidden = hideDimension;
  if (hideDimension && logDimensionFilterEl.value) {
    logDimensionFilterEl.value = "";
  }
}

function updateLogsFiltersDot() {
  const active = Boolean(logEntityFilterEl.value || logUserFilterEl.value || logActionFilterEl.value || logDimensionFilterEl.value);
  logsFiltersDot.hidden = !active;
}

function applyLogFilterChange() {
  logsCurrentPage = 1;
  updateLogsFiltersDot();
  renderLogs();
}

logsFiltersToggleBtn.addEventListener("click", () => {
  const willOpen = !logsFiltersPanel.classList.contains("is-open");
  logsFiltersPanel.classList.toggle("is-open", willOpen);
  logsFiltersToggleBtn.setAttribute("aria-expanded", String(willOpen));
  logsFiltersToggleBtn.classList.toggle("is-active", willOpen);
});

let logFilterDebounce = null;
logSearchEl.addEventListener("input", () => {
  window.clearTimeout(logFilterDebounce);
  logFilterDebounce = window.setTimeout(() => {
    logsCurrentPage = 1;
    renderLogs();
  }, 150);
});
logEntityFilterEl.addEventListener("change", () => {
  updateLogDimensionFilterVisibility();
  applyLogFilterChange();
});
logUserFilterEl.addEventListener("change", applyLogFilterChange);
logActionFilterEl.addEventListener("change", applyLogFilterChange);
logDimensionFilterEl.addEventListener("change", applyLogFilterChange);

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

consumeSharedAccessCodeLink();
renderAuthArea();
switchDimension("overworld");
loadCategories();
Auth.init();