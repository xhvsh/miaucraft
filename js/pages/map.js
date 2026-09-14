import * as Auth from "../lib/auth.js";
import { Grid } from "../lib/grid.js";
import { listWaypoints, createWaypoint, updateWaypoint, deleteWaypoint, listCategories, categoryIconClass, sanitizeIconClass } from "../lib/waypoints.js";
import { listLivePositions, subscribeLivePositions, getServerStatus, subscribeServerStatus } from "../lib/live.js";
import { settings, saveSettings, formatCoordsForCopy, formatCoordsForDisplay } from "../lib/settings.js";
import { toast, confirmAction, closeOnBackdropClick, copyTextToClipboard, escapeHtml, debounce } from "../lib/ui.js";
import { buildWaypointCard, buildCategoryFilter } from "../lib/waypoint-ui.js";
import { initNav, openAuthModal } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

const DIM_COLORS = { overworld: "#6bbf8a", nether: "#e2685f", end: "#d9c775" };
const DIM_LABELS = { overworld: "Overworld", nether: "Nether", end: "End" };
const SPECIAL_WAYPOINT_IMAGES = { "Blehh Cat": "/img/blehh-map.png" };
const STATUS_STALE_MS = 30000;

await initNav("map");

const dimTabs = $("#dimTabs");
const sidebarEl = $("#sidebar");
const sidebarTitle = $("#sidebarTitle");
const waypointCountEl = $("#waypointCount");
const waypointCountPillEl = $("#waypointCountPill");
const waypointListEl = $("#waypointList");
const waypointListEmptyEl = $("#waypointListEmpty");
const waypointSearchEl = $("#waypointSearch");
const categoryFilterRowEl = $("#categoryFilterRow");
const pinTooltip = $("#pinTooltip");
const sidebarToggleBtn = $("#sidebarToggleBtn");
const sidebarCloseBtn = $("#sidebarCloseBtn");
const sidebarScrim = $("#sidebarScrim");
const addWaypointBtn = $("#addWaypointBtn");
const waypointModal = $("#waypointModal");
const imageLightbox = $("#imageLightbox");
const imageLightboxImg = $("#imageLightboxImg");

let currentDim = "overworld";
let currentWaypoints = [];
let categories = [];
let categoryFilter = null;
let openTooltipWaypoint = null;
let tooltipPointerStartedInside = false;
let editingWaypoint = null;
let livePositions = [];
let lastServerStatus = null;

const mobileMediaQuery = window.matchMedia("(max-width: 860px)");

const grid = new Grid($("#gridContainer"), { dimensionColor: DIM_COLORS.overworld });

grid.onEmptyRightClick = (x, z) => {
  if (!Auth.can("addWaypoint")) {
    openAuthModal("login");
    return;
  }
  openWaypointForm({ dimension: currentDim, x, z });
};
grid.onPinClick = (wp) => showTooltip(wp);
grid.onEmptyClick = hideTooltip;
grid.onEmptyTap = (x, z) => {
  hideTooltip();
};
grid.onViewChange = () => {
  if (openTooltipWaypoint && !pinTooltip.hidden) positionTooltip(openTooltipWaypoint);
};

$("#zoomInBtn").addEventListener("click", () => grid.zoomBy(1.4));
$("#zoomOutBtn").addEventListener("click", () => grid.zoomBy(1 / 1.4));
$("#recenterBtn").addEventListener("click", () => grid.recenter());

// ---------- live player pins ----------

async function refreshLivePositions() {
  try {
    livePositions = await listLivePositions();
  } catch (err) {
    console.error(err);
    livePositions = [];
  }
  renderLivePins();
}

function isStatusStale(status) {
  if (!status || !status.updated_at) return true;
  return Date.now() - new Date(status.updated_at).getTime() > STATUS_STALE_MS;
}

function renderLivePins() {
  if (isStatusStale(lastServerStatus)) {
    grid.setPlayers([]);
    return;
  }
  const pins = livePositions.filter((p) => p.dimension === currentDim).map((p) => ({ id: p.player_id, username: p.players?.username ?? "Player", x: p.x, z: p.z, afk: p.players?.afk ?? false }));
  grid.setPlayers(pins);
}

subscribeLivePositions((payload) => {
  clearTimeout(refreshLivePositions._debounce);
  refreshLivePositions._debounce = setTimeout(() => {
    if (payload && payload.new && payload.eventType !== "DELETE") {
      const np = payload.new;
      const idx = livePositions.findIndex((p) => p.player_id === np.player_id);
      if (idx !== -1) Object.assign(livePositions[idx], np);
      else livePositions.push(np);
    } else {
      refreshLivePositions();
      return;
    }
    renderLivePins();
  }, 300);
});
refreshLivePositions();

getServerStatus()
  .then((s) => {
    lastServerStatus = s;
    renderLivePins();
  })
  .catch(() => {});
subscribeServerStatus((payload) => {
  lastServerStatus = payload.new;
  renderLivePins();
});

// ---------- categories ----------

async function loadCategories() {
  try {
    categories = await listCategories();
  } catch (err) {
    console.error(err);
    categories = [];
  }
  renderCategoryFilterRow();
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

  categoryFilterRowEl.appendChild(
    buildCategoryFilter({
      categories,
      selected: categoryFilter ?? "",
      includeUncategorized: true,
      onChange: (value) => {
        categoryFilter = value === "" ? null : value === "__none__" ? "__none__" : value;
        renderSidebar();
        updateMapWaypoints();
      },
    }),
  );
}

// category picker inside the waypoint form
const categoryPicker = $("#categoryPicker");
const categoryPickerTrigger = $("#categoryPickerTrigger");
const categoryPickerContent = $("#categoryPickerTriggerContent");
const categoryPickerMenu = $("#categoryPickerMenu");
const wpCategoryInput = $("#wpCategory");

function pickerOptionInner(name, iconClass, color, isNone) {
  const iconStyle = isNone ? "" : ` style="background:color-mix(in srgb, ${escapeHtml(color)} 18%, transparent);color:${escapeHtml(color)}"`;
  return `<span class="category-picker-icon${isNone ? " category-picker-icon--none" : ""}"${iconStyle}><i class="${isNone ? "fa-solid fa-ban" : escapeHtml(iconClass)}" aria-hidden="true"></i></span><span class="category-picker-label">${escapeHtml(name)}</span>`;
}

function setCategoryPickerValue(id, name, icon, color) {
  wpCategoryInput.value = id;
  categoryPickerContent.innerHTML = pickerOptionInner(name, icon, color, !id);
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
categoryPickerTrigger.addEventListener("click", () => (categoryPickerMenu.hidden ? openCategoryPickerMenu() : closeCategoryPickerMenu()));
document.addEventListener("click", (e) => {
  if (categoryPickerMenu.hidden || categoryPicker.contains(e.target)) return;
  closeCategoryPickerMenu();
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
    btn.innerHTML = pickerOptionInner(name, icon, color, isNone);
    btn.addEventListener("click", () => {
      setCategoryPickerValue(id, name, icon, color);
      closeCategoryPickerMenu();
    });
    categoryPickerMenu.appendChild(btn);
  };

  buildOption("", "No category", null, null, true);
  for (const cat of categories) buildOption(cat.id, cat.name, categoryIconClass(cat.icon), cat.color, false);

  const validValue = categories.some((c) => c.id === previousValue) ? previousValue : "";
  const match = categories.find((c) => c.id === validValue);
  setCategoryPickerValue(validValue, match ? match.name : "No category", match ? categoryIconClass(match.icon) : null, match ? match.color : null);
}

// ---------- dimension switching ----------

dimTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".dim-tab");
  if (!btn) return;
  switchDimension(btn.dataset.dim);
});

function switchDimension(dim) {
  currentDim = dim;
  for (const btn of dimTabs.querySelectorAll(".dim-tab")) btn.dataset.active = String(btn.dataset.dim === dim);
  hideTooltip();
  closeSidebarDrawer();
  grid.setDimensionColor(DIM_COLORS[dim]);
  sidebarTitle.textContent = DIM_LABELS[dim];
  loadWaypointsForDim(dim);
  renderLivePins();
}

let waypointsLoaded = false;
async function loadWaypointsForDim(dim) {
  if (!waypointsLoaded) $("#waypointSkeleton").hidden = false;
  try {
    currentWaypoints = await listWaypoints(dim);
  } catch (err) {
    console.error(err);
    currentWaypoints = [];
  }
  waypointsLoaded = true;
  $("#waypointSkeleton").hidden = true;
  updateMapWaypoints();
  renderSidebar();
}

function matchesCategoryFilter(wp) {
  if (categoryFilter === null) return true;
  if (categoryFilter === "__none__") return !wp.category_id;
  return wp.category_id === categoryFilter;
}

function updateMapWaypoints() {
  const forMap = settings.hideFilteredWaypoints ? currentWaypoints.filter(matchesCategoryFilter) : currentWaypoints;
  grid.setWaypoints(forMap);
}

// ---------- sidebar list ----------

waypointSearchEl.addEventListener("input", debounce(() => renderSidebar(), 150));

function renderSidebar() {
  const query = waypointSearchEl.value.trim().toLowerCase();
  const visible = currentWaypoints
    .filter(
      (wp) =>
        matchesCategoryFilter(wp) &&
        [wp.name, wp.description, wp.created_by_username, wp.x, wp.y, wp.z]
          .filter((v) => v !== null && v !== undefined)
          .join(" ")
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));

  const isFiltered = Boolean(query) || categoryFilter !== null;
  waypointCountEl.textContent = isFiltered ? `${visible.length}/${currentWaypoints.length}` : String(currentWaypoints.length);
  waypointCountPillEl.textContent = String(currentWaypoints.length);
  waypointCountPillEl.dataset.zero = String(currentWaypoints.length === 0);

  waypointListEl.innerHTML = "";
  waypointListEmptyEl.hidden = visible.length > 0;
  if (visible.length === 0) {
    waypointListEmptyEl.querySelector("span").textContent = isFiltered ? "No waypoints match this search or filter." : Auth.can("addWaypoint") ? "No waypoints yet. Tap + or right-click the map." : "No waypoints here yet.";
    return;
  }
  const frag = document.createDocumentFragment();
  for (const wp of visible) frag.appendChild(buildWaypointListItem(wp));
  waypointListEl.appendChild(frag);
}

function conversionText(wp) {
  if (!settings.showDimensionConversion) return "";
  if (wp.dimension !== "overworld" && wp.dimension !== "nether") return "";
  const nether = wp.dimension === "overworld";
  const label = nether ? "Nether" : "Overworld";
  const x = nether ? Math.round(wp.x / 8) : wp.x * 8;
  const z = nether ? Math.round(wp.z / 8) : wp.z * 8;
  return `${label}: ${formatCoordsForDisplay(x, null, z)}`;
}

function buildWaypointListItem(wp) {
  const special = SPECIAL_WAYPOINT_IMAGES[wp.name];
  const actions = [{ action: "jump", label: "Jump to", icon: "fa-location-crosshairs" }];
  if (Auth.canEditWaypoint(wp)) {
    actions.push({ action: "edit", label: "Edit", icon: "fa-pen" });
    actions.push({ action: "delete", label: "Delete", icon: "fa-trash", variant: "danger" });
  }
  const card = buildWaypointCard(wp, {
    category: categoryById(wp.category_id),
    coordsText: formatCoordsForDisplay(wp.x, wp.y ?? null, wp.z),
    conversionText: conversionText(wp),
    author: `by ${wp.created_by_username ?? "unknown"}`,
    image: special ? { src: special, alt: `${wp.name} reference image` } : null,
    actions,
  });

  card.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    copyTextToClipboard(formatCoordsForCopy(wp.x, wp.y ?? null, wp.z), e.currentTarget);
  });
  card.querySelector('[data-action="image"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageLightbox(special, `${wp.name} reference image`);
  });
  card.querySelector('[data-action="jump"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    grid.jumpTo(wp.x, wp.z);
    showTooltip(wp);
    if (mobileMediaQuery.matches) closeSidebarDrawer();
  });
  card.querySelector('[data-action="edit"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openWaypointForm(wp);
  });
  card.querySelector('[data-action="delete"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDelete(wp);
  });
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

// ---------- tooltip ----------

function showTooltip(wp) {
  openTooltipWaypoint = wp;
  const special = SPECIAL_WAYPOINT_IMAGES[wp.name];
  const actions = [];
  if (Auth.canEditWaypoint(wp)) {
    actions.push({ action: "edit", label: "Edit", icon: "fa-pen" });
    actions.push({ action: "delete", label: "Delete", icon: "fa-trash", variant: "danger" });
  }
  const card = buildWaypointCard(wp, {
    variant: "compact",
    category: categoryById(wp.category_id),
    coordsText: formatCoordsForDisplay(wp.x, wp.y ?? null, wp.z),
    conversionText: conversionText(wp),
    author: `by ${wp.created_by_username ?? "unknown"} · ${formatWaypointDate(wp.created_at)}`,
    image: special ? { src: special, alt: `${wp.name} reference image` } : null,
    actions,
  });

  card.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => copyTextToClipboard(formatCoordsForCopy(wp.x, wp.y ?? null, wp.z), e.currentTarget));
  card.querySelector('[data-action="image"]')?.addEventListener("click", () => openImageLightbox(special, `${wp.name} reference image`));
  card.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
    hideTooltip();
    openWaypointForm(wp);
  });
  card.querySelector('[data-action="delete"]')?.addEventListener("click", () => handleDelete(wp));

  pinTooltip.innerHTML = "";
  pinTooltip.appendChild(card);
  pinTooltip.hidden = false;
  positionTooltip(wp);
}

function positionTooltip(wp) {
  const p = grid.worldToScreen(wp.x, wp.z);
  const tw = pinTooltip.offsetWidth;
  const th = pinTooltip.offsetHeight;
  pinTooltip.style.left = `${p.x - tw / 2}px`;
  pinTooltip.style.top = `${p.y - th - 40}px`;
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
  if (!pinTooltip.hidden && !tooltipPointerStartedInside && !pinTooltip.contains(e.target) && !e.target.closest(".grid-canvas, .waypoint-card")) hideTooltip();
  tooltipPointerStartedInside = false;
});

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

// ---------- mobile sidebar drawer ----------

function openSidebarDrawer() {
  sidebarEl.dataset.open = "true";
  sidebarScrim.hidden = false;
  sidebarScrim.dataset.open = "true";
  sidebarToggleBtn.setAttribute("aria-expanded", "true");
}
function closeSidebarDrawer() {
  sidebarEl.dataset.open = "false";
  sidebarScrim.dataset.open = "false";
  sidebarToggleBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => {
    if (sidebarScrim.dataset.open === "false") sidebarScrim.hidden = true;
  }, 300);
}
function toggleSidebarDrawer() {
  if (sidebarEl.dataset.open === "true") closeSidebarDrawer();
  else openSidebarDrawer();
}
sidebarToggleBtn.addEventListener("click", toggleSidebarDrawer);
sidebarCloseBtn.addEventListener("click", closeSidebarDrawer);
sidebarScrim.addEventListener("click", closeSidebarDrawer);

// ---------- waypoint form ----------

function openWaypointForm(seed) {
  if (seed.id && !Auth.canEditWaypoint(seed)) return;
  editingWaypoint = seed.id ? seed : null;
  $("#waypointModalTitle").textContent = editingWaypoint ? "Edit waypoint" : "Add waypoint";
  $("#wpId").value = seed.id ?? "";
  $("#wpName").value = seed.name ?? "";
  $("#wpDescription").value = seed.description ?? "";
  const wpXEl = $("#wpX"),
    wpZEl = $("#wpZ");
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
  if (!seed.category_id) wpCategoryInput.value = "";
  populateCategorySelect();
  if (seed.category_id) {
    const cat = categoryById(seed.category_id);
    if (cat) setCategoryPickerValue(cat.id, cat.name, categoryIconClass(cat.icon), cat.color);
  }
  closeCategoryPickerMenu();
  $("#wpColor").value = seed.color ?? "#9683e0";
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
  const xEl = $("#wpX"),
    zEl = $("#wpZ");
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
  const xEl = $("#wpX"),
    zEl = $("#wpZ");
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
      await createWaypoint({ ...payload, dimension: currentDim, created_by: state.session.user.id, created_by_username: state.profile.username });
    }
    closeWaypointForm();
    await loadWaypointsForDim(currentDim);
  } catch (err) {
    toast(err.message || "Could not save waypoint.", "error");
  }
});

addWaypointBtn.addEventListener("click", () => {
  if (!Auth.can("addWaypoint")) {
    openAuthModal("login");
    return;
  }
  const center = { x: Math.round(grid.centerX), z: Math.round(grid.centerZ) };
  openWaypointForm({ dimension: currentDim, x: center.x, z: center.z });
});

// ---------- auth-driven UI ----------

Auth.onAuthChange(() => {
  addWaypointBtn.hidden = !Auth.can("addWaypoint");
  renderSidebar();
});

// ---------- access-code share link (/c/:code -> rewritten to this page) ----------

function consumeSharedAccessCodeLink() {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
  if (!match) return;
  const code = decodeURIComponent(match[1]);
  window.history.replaceState({}, "", "/");

  const applyCode = (state) => {
    if (state.ready && unsubscribe) unsubscribe();
    if (!state.ready) return;
    if (Auth.isLoggedIn()) return;
    openAuthModal("register");
    const codeInput = document.getElementById("registerCode");
    if (!codeInput) return;
    codeInput.value = code;
    codeInput.disabled = true;
    document.getElementById("registerCodeLabel").textContent = "Code loaded from link";
  };

  let unsubscribe;
  unsubscribe = Auth.onAuthChange(applyCode);
}

// ---------- deep-link jump (from profile page "Jump to") ----------

function consumeJumpParams() {
  const params = new URLSearchParams(window.location.search);
  const dim = params.get("dim");
  if (!dim || !DIM_COLORS[dim]) return;

  if (params.get("restore") === "1") {
  window.history.replaceState({}, "", "/");
    switchDimension(dim);
    setTimeout(() => {
      openWaypointForm({
        dimension: dim,
        name: params.get("name") || "",
        description: params.get("desc") || "",
        x: Number(params.get("x")) || 0,
        y: params.has("y") ? Number(params.get("y")) : null,
        z: Number(params.get("z")) || 0,
        category_id: params.get("cat") || null,
        color: params.get("color") || "#9683e0",
      });
    }, 300);
    return;
  }

  const wpId = params.get("wp");
  window.history.replaceState({}, "", "/");
  switchDimension(dim);
  if (!wpId) return;
  const tryJump = () => {
    const wp = currentWaypoints.find((w) => String(w.id) === wpId);
    if (wp) {
      grid.jumpTo(wp.x, wp.z);
      showTooltip(wp);
    }
  };
  setTimeout(tryJump, 400);
}

// ---------- init ----------

await loadCategories();
switchDimension("overworld");
consumeSharedAccessCodeLink();
consumeJumpParams();
