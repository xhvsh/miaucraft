import * as Auth from "../lib/auth.js";
import { Grid } from "../lib/grid.js";
import { listWaypoints, createWaypoint, updateWaypoint, deleteWaypoint, listCategories, categoryIconClass, sanitizeIconClass, loadCollaboratorRoles, forceCollaboratorRole, listCollaborators, addCollaborator, removeCollaborator, transferOwnership, listGalleryImages, addGalleryImage, deleteGalleryImage, uploadGalleryImage, validateGalleryFile, updateGalleryCaption } from "../lib/waypoints.js";
import { listLivePositions, subscribeLivePositions, subscribePlayers, getServerStatus, subscribeServerStatus } from "../lib/live.js";
import { supabase } from "../lib/supabaseClient.js";
import { settings, saveSettings, formatCoordsForCopy, formatCoordsForDisplay } from "../lib/settings.js";
import { toast, confirmAction, closeOnBackdropClick, copyTextToClipboard, escapeHtml, sanitizeColor, debounce } from "../lib/ui.js";
import { buildWaypointCard, buildCategoryFilter, buildUserFilter, categoryBadgeHtml, visibilityBadgeHtml, galleryTileHtml } from "../lib/waypoint-ui.js";
import { openGalleryViewer, openSingleImage } from "../lib/gallery-viewer.js";
import { initNav, openAuthModal } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

const DIM_COLORS = { overworld: "#6bbf8a", nether: "#e2685f", end: "#d9c775" };
const DIM_LABELS = { overworld: "Overworld", nether: "Nether", end: "End" };
// 1 nether block = 8 overworld blocks, so the overworld map zooms out 8x so
// the same place looks the same size in both dimensions.
const NETHER_BASE_SCALE = 0.5;
const DIM_DEFAULT_SCALE = {
  overworld: NETHER_BASE_SCALE / 8,
  nether: NETHER_BASE_SCALE,
  end: NETHER_BASE_SCALE,
};
function waypointImage(wp) {
  if (wp?.display_image_url) return { src: wp.display_image_url, alt: `${wp.name} display image` };
  return null;
}
const STATUS_STALE_MS = 30000;

await initNav("map");

const dimTabs = $("#dimTabs");
const gridPanelEl = $("#gridPanel");
const mapWorkspaceEl = $(".map-workspace");
const sidebarEl = $("#sidebar");
const sidebarTitle = $("#sidebarTitle");
const waypointCountEl = $("#waypointCount");
const waypointCountPillEl = $("#waypointCountPill");
const waypointListEl = $("#waypointList");
const waypointListEmptyEl = $("#waypointListEmpty");
const waypointSearchEl = $("#waypointSearch");
const categoryFilterRowEl = $("#categoryFilterRow");
const userFilterRowEl = $("#userFilterRow");
const pinTooltip = $("#pinTooltip");
const sidebarToggleBtn = $("#sidebarToggleBtn");
const sidebarCloseBtn = $("#sidebarCloseBtn");
const sidebarScrim = $("#sidebarScrim");
const addWaypointBtn = $("#addWaypointBtn");
const waypointModal = $("#waypointModal");
const imageLightbox = $("#imageLightbox");

let currentDim = "overworld";
let currentWaypoints = [];
let categories = [];
let categoryFilter = null;
let authorFilter = null;
let openTooltipWaypoint = null;
let tooltipPointerStartedInside = false;
let editingWaypoint = null;
let detailWaypoint = null;
let galleryImages = [];
let detailCollabs = [];
let collabMode = "add";
let livePositions = [];
let lastServerStatus = null;

const mobileMediaQuery = window.matchMedia("(max-width: 860px)");

const grid = new Grid($("#gridContainer"), { dimensionColor: DIM_COLORS.overworld, defaultScale: DIM_DEFAULT_SCALE.overworld });

grid.onEmptyRightClick = (x, z) => {
  if (!Auth.can("addWaypoint")) {
    openAuthModal("login");
    return;
  }
  openWaypointForm({ dimension: currentDim, x, z });
};
grid.onPinClick = (wp) => {
  grid.setSelectedWaypoint(wp);
  showTooltip(wp);
};
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
  const pins = livePositions
    .filter((p) => p.dimension === currentDim && p.players?.online !== false)
    .map((p) => ({ id: p.player_id, username: p.players?.username ?? "Player", x: p.x, z: p.z, afk: p.players?.afk ?? false }));
  grid.setPlayers(pins);
}

subscribeLivePositions((payload) => {
  if (payload && payload.new && payload.eventType !== "DELETE") {
    const np = payload.new;
    const idx = livePositions.findIndex((p) => p.player_id === np.player_id);
    if (idx !== -1) {
      Object.assign(livePositions[idx], np);
      renderLivePins();
      return;
    }
  }
  clearTimeout(refreshLivePositions._debounce);
  refreshLivePositions._debounce = setTimeout(refreshLivePositions, 300);
});
refreshLivePositions();

subscribePlayers((payload) => {
  if (!payload || !payload.new) return;
  const np = payload.new;
  let changed = false;
  for (const p of livePositions) {
    if (p.player_id === np.id && p.players) {
      let dirty = false;
      if ("afk" in np && p.players.afk !== np.afk) { p.players.afk = np.afk; dirty = true; }
      if ("online" in np && p.players.online !== np.online) { p.players.online = np.online; dirty = true; }
      if (dirty) changed = true;
    }
  }
  if (changed) renderLivePins();
});

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

// ---------- realtime waypoint sync ----------
// Keep the map, sidebar and open detail view in sync with any waypoint,
// collaborator or gallery change, so users never need to refresh the page.

let waypointSyncTimer = null;
let collabSyncTimer = null;
let gallerySyncTimer = null;
let waypointQueryOk = true;

function refreshOpenDetail() {
  if (!detailWaypoint) return;
  if (!waypointQueryOk) return;
  const fresh = currentWaypoints.find((w) => String(w.id) === String(detailWaypoint.id));
  if (fresh) {
    openWaypointDetail(fresh);
  } else {
    closeWaypointDetail();
  }
}

function refreshOpenTooltip() {
  if (pinTooltip.hidden || !openTooltipWaypoint) return;
  if (!waypointQueryOk) return;
  const fresh = currentWaypoints.find((w) => String(w.id) === String(openTooltipWaypoint.id));
  if (fresh) {
    showTooltip(fresh);
  } else {
    hideTooltip();
  }
}

function queueWaypointSync() {
  clearTimeout(waypointSyncTimer);
  waypointSyncTimer = setTimeout(async () => {
    await loadWaypointsForDim(currentDim);
    refreshCollabCache();
    refreshOpenDetail();
    refreshOpenTooltip();
  }, 250);
}

function queueCollabSync() {
  clearTimeout(collabSyncTimer);
  collabSyncTimer = setTimeout(async () => {
    await refreshCollabCache();
    await loadWaypointsForDim(currentDim);
    refreshOpenDetail();
    refreshOpenTooltip();
  }, 250);
}

function queueGallerySync(waypointId) {
  if (!waypointId) return;
  galleryCache.delete(String(waypointId));
  clearTimeout(gallerySyncTimer);
  gallerySyncTimer = setTimeout(() => {
    if (detailWaypoint && String(detailWaypoint.id) === String(waypointId)) loadGallery(waypointId);
  }, 250);
}

supabase
  .channel("waypoint-changes")
  .on("postgres_changes", { event: "*", schema: "public", table: "waypoints" }, queueWaypointSync)
  .on("postgres_changes", { event: "*", schema: "public", table: "waypoint_collaborators" }, queueCollabSync)
  .on("postgres_changes", { event: "*", schema: "public", table: "waypoint_gallery" }, (payload) => queueGallerySync(payload.new?.waypoint_id ?? payload.old?.waypoint_id))
  .subscribe();

function schedulePeriodicResync() {
  return setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (waypointSyncTimer || collabSyncTimer) return;
    queueWaypointSync();
  }, 20000);
}
schedulePeriodicResync();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  clearTimeout(waypointSyncTimer);
  waypointSyncTimer = null;
  queueWaypointSync();
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

function waypointAuthor(wp) {
  return wp.owner_username || wp.created_by_username || "";
}

function renderUserFilterRow() {
  userFilterRowEl.innerHTML = "";
  const authors = [...new Set(currentWaypoints.map(waypointAuthor).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (authorFilter !== null && !authors.includes(authorFilter)) {
    authorFilter = null;
  }
  if (authors.length < 2) {
    userFilterRowEl.hidden = true;
    return;
  }
  userFilterRowEl.hidden = false;

  userFilterRowEl.appendChild(
    buildUserFilter({
      users: authors.map((name) => ({ value: name, label: name })),
      selected: authorFilter ?? "",
      onChange: (value) => {
        authorFilter = value === "" ? null : value;
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
  const cleanColor = sanitizeColor(color);
  const iconStyle = isNone ? "" : ` style="background:color-mix(in srgb, ${cleanColor} 18%, transparent);color:${cleanColor}"`;
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
function focusCategoryPickerSelected() {
  const selected = categoryPickerMenu.querySelector('.category-picker-option[aria-selected="true"]');
  (selected || categoryPickerMenu.querySelector(".category-picker-option"))?.focus();
}
function openCategoryPickerMenu() {
  categoryPickerMenu.hidden = false;
  categoryPickerTrigger.setAttribute("aria-expanded", "true");
  focusCategoryPickerSelected();
}
categoryPickerTrigger.addEventListener("click", () => (categoryPickerMenu.hidden ? openCategoryPickerMenu() : closeCategoryPickerMenu()));
document.addEventListener("click", (e) => {
  if (categoryPickerMenu.hidden || categoryPicker.contains(e.target)) return;
  closeCategoryPickerMenu();
});
categoryPickerMenu.addEventListener("keydown", (e) => {
  const opts = Array.from(categoryPickerMenu.querySelectorAll(".category-picker-option"));
  if (opts.length === 0) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCategoryPickerMenu();
      categoryPickerTrigger.focus();
    }
    return;
  }
  const idx = opts.indexOf(document.activeElement);
  let next = -1;
  if (e.key === "ArrowDown") next = idx === -1 ? 0 : (idx + 1) % opts.length;
  else if (e.key === "ArrowUp") next = idx === -1 ? opts.length - 1 : (idx - 1 + opts.length) % opts.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = opts.length - 1;
  if (next !== -1) {
    e.preventDefault();
    opts[next].focus();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    closeCategoryPickerMenu();
    categoryPickerTrigger.focus();
  }
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
  const prevDim = currentDim;
  currentDim = dim;
  gridPanelEl.dataset.dim = dim;
  restartDimTransition();
  for (const btn of dimTabs.querySelectorAll(".dim-tab")) {
    const on = btn.dataset.dim === dim;
    btn.dataset.active = String(on);
    btn.setAttribute("aria-selected", String(on));
  }
  hideTooltip();
  closeSidebarDrawer();
  grid.setDimensionColor(DIM_COLORS[dim]);
  grid.setDefaultScale(DIM_DEFAULT_SCALE[dim]);
  grid.convertView(prevDim, dim);
  sidebarTitle.textContent = DIM_LABELS[dim];
  renderLivePins();
  return loadWaypointsForDim(dim);
}

function restartDimTransition() {
  mapWorkspaceEl.classList.remove("dim-switching");
  void mapWorkspaceEl.offsetWidth; // force reflow so the animation restarts
  mapWorkspaceEl.classList.add("dim-switching");
}

let waypointsLoaded = false;
async function loadWaypointsForDim(dim) {
  if (!waypointsLoaded) $("#waypointSkeleton").hidden = false;
  waypointQueryOk = false;
  try {
    currentWaypoints = await listWaypoints(dim);
    waypointQueryOk = true;
  } catch (err) {
    console.error(err);
    currentWaypoints = [];
  }
  waypointsLoaded = true;
  $("#waypointSkeleton").hidden = true;
  renderUserFilterRow();
  updateMapWaypoints();
  renderSidebar();
}

function matchesCategoryFilter(wp) {
  if (categoryFilter === null) return true;
  if (categoryFilter === "__none__") return !wp.category_id;
  return wp.category_id === categoryFilter;
}

function matchesAuthorFilter(wp) {
  if (authorFilter === null) return true;
  return waypointAuthor(wp) === authorFilter;
}

function updateMapWaypoints() {
  const forMap = settings.hideFilteredWaypoints
    ? currentWaypoints.filter((wp) => matchesCategoryFilter(wp) && matchesAuthorFilter(wp))
    : currentWaypoints;
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
        matchesAuthorFilter(wp) &&
        [wp.name, wp.description, wp.created_by_username, wp.owner_username, wp.x, wp.y, wp.z]
          .filter((v) => v !== null && v !== undefined)
          .join(" ")
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));

  const isFiltered = Boolean(query) || categoryFilter !== null || authorFilter !== null;
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
  const img = waypointImage(wp);
  const actions = [{ action: "jump", label: "Jump to", icon: "fa-location-crosshairs" }, { action: "view", label: "Details", icon: "fa-circle-info" }];
  const card = buildWaypointCard(wp, {
    category: categoryById(wp.category_id),
    coordsText: formatCoordsForDisplay(wp.x, wp.y ?? null, wp.z),
    conversionText: conversionText(wp),
    author: `by ${(wp.owner_username || wp.created_by_username) ?? "unknown"}`,
    image: img,
    actions,
  });
  card.dataset.wpId = wp.id;

  card.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    copyTextToClipboard(formatCoordsForCopy(wp.x, wp.y ?? null, wp.z), e.currentTarget);
  });
  card.querySelector('[data-action="image"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (img) openWaypointGallery(wp, img.src, img.alt);
  });
  card.querySelector('[data-action="jump"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    grid.setSelectedWaypoint(wp);
    grid.jumpTo(wp.x, wp.z);
    showTooltip(wp);
    if (mobileMediaQuery.matches) closeSidebarDrawer();
  });
  card.querySelector('[data-action="view"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideTooltip();
    openWaypointDetail(wp);
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
  const img = waypointImage(wp);
  const actions = [{ action: "view", label: "Details", icon: "fa-circle-info" }];
  if (Auth.canEditWaypoint(wp)) {
    actions.push({ action: "edit", label: "Edit", icon: "fa-pen" });
  }
  if (Auth.canDeleteWaypoint(wp)) {
    actions.push({ action: "delete", label: "Delete", icon: "fa-trash", variant: "danger", iconOnly: true });
  }
  const card = buildWaypointCard(wp, {
    variant: "compact",
    category: categoryById(wp.category_id),
    coordsText: formatCoordsForDisplay(wp.x, wp.y ?? null, wp.z),
    conversionText: conversionText(wp),
    author: `by ${(wp.owner_username || wp.created_by_username) ?? "unknown"} · ${formatWaypointDate(wp.created_at)}`,
    image: img,
    actions,
  });

  card.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => copyTextToClipboard(formatCoordsForCopy(wp.x, wp.y ?? null, wp.z), e.currentTarget));
  card.querySelector('[data-action="image"]')?.addEventListener("click", () => img && openWaypointGallery(wp, img.src, img.alt));
  card.querySelector('[data-action="view"]')?.addEventListener("click", () => {
    hideTooltip();
    openWaypointDetail(wp);
  });
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
  const w = mapWorkspaceEl.clientWidth;
  const h = mapWorkspaceEl.clientHeight;
  // Always center the tooltip on the waypoint, directly above it. It may
  // overflow the map edges (map-main / grid-panel clip it); we never clamp it
  // back inside the viewport, that's what made it slide away from the pin.
  let left = p.x - tw / 2;
  let top = p.y - th - 40;
  // ...but keep the always-on controls usable: dim tabs up top (~64px) and the
  // zoom/center cluster in the bottom-right corner (~62x150px).
  const toolbarH = 64;
  const controlsW = 62;
  const controlsH = 150;
  top = Math.max(top, toolbarH);
  if (left + tw > w - controlsW && top + th > h - controlsH) {
    top = Math.max(toolbarH, h - controlsH - th - 12);
  }
  pinTooltip.style.left = `${left}px`;
  pinTooltip.style.top = `${top}px`;
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
  grid.setSelectedWaypoint(null);
}

document.addEventListener("pointerdown", (e) => {
  tooltipPointerStartedInside = pinTooltip.contains(e.target);
});
document.addEventListener("click", (e) => {
  if (!pinTooltip.hidden && !tooltipPointerStartedInside && !pinTooltip.contains(e.target) && !e.target.closest(".grid-canvas, .waypoint-card")) hideTooltip();
  tooltipPointerStartedInside = false;
});

// The lightbox itself is the shared gallery viewer (js/lib/gallery-viewer.js);
// openWaypointGallery decides whether it opens with one image or with the
// waypoint's whole gallery so the user can page through everything.
document.addEventListener(
  "error",
  (e) => {
    const el = e.target;
    if (el.tagName !== "IMG") return;
    if (el.classList.contains("waypoint-card-image") || el.classList.contains("waypoint-detail-image") || el.closest(".waypoint-gallery-tile")) el.hidden = true;
  },
  true,
);

// ---------- waypoint detail view (info + gallery + collaborators) ----------

const waypointDetailModal = $("#waypointDetailModal");

function openWaypointDetail(wp) {
  detailWaypoint = wp;
  galleryImages = [];
  detailCollabs = [];

  const color = sanitizeColor(wp.color || "#9683e0");
  const dot = $("#waypointDetailDot");
  dot.style.background = color;
  dot.style.color = color;
  $("#waypointDetailName").textContent = wp.name;

  $("#waypointDetailMeta").innerHTML = [
    visibilityBadgeHtml(wp.visibility),
    categoryBadgeHtml(categoryById(wp.category_id)),
    wp.created_by_username ? `<span class="waypoint-card-author">by ${escapeHtml(wp.created_by_username)} · ${formatWaypointDate(wp.created_at)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  const descEl = $("#waypointDetailDesc");
  if (wp.description) {
    descEl.hidden = false;
    descEl.textContent = wp.description;
  } else {
    descEl.hidden = true;
  }

  const detailImg = $("#waypointDetailImage");
  const dimg = waypointImage(wp);
  detailImg.hidden = !dimg;
  if (dimg) {
    detailImg.src = dimg.src;
    detailImg.alt = dimg.alt;
  }

  const coordsEl = $("#waypointDetailCoords");
  coordsEl.innerHTML = "";
  const coordsSpan = document.createElement("span");
  coordsSpan.textContent = formatCoordsForDisplay(wp.x, wp.y ?? null, wp.z);
  coordsEl.appendChild(coordsSpan);
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "icon-btn";
  copyBtn.style.cssText = "width:22px;height:22px;font-size:10px";
  copyBtn.title = "Copy coordinates";
  copyBtn.setAttribute("aria-label", "Copy coordinates");
  copyBtn.innerHTML = '<i class="fa-solid fa-copy" aria-hidden="true"></i>';
  copyBtn.addEventListener("click", () => copyTextToClipboard(formatCoordsForCopy(wp.x, wp.y ?? null, wp.z), copyBtn));
  coordsEl.appendChild(copyBtn);

  const convEl = $("#waypointDetailConversion");
  const conv = conversionText(wp);
  convEl.hidden = !conv;
  if (conv) convEl.textContent = conv;

  renderDetailActions();
  waypointDetailModal.hidden = false;
  loadGallery(wp.id);
  loadCollaborators(wp.id);
}

function closeWaypointDetail() {
  waypointDetailModal.hidden = true;
  detailWaypoint = null;
  galleryImages = [];
  detailCollabs = [];
  closePersonSearch();
}
$("#waypointDetailClose").addEventListener("click", closeWaypointDetail);
closeOnBackdropClick(waypointDetailModal, closeWaypointDetail);
document.addEventListener("keydown", (e) => {
  // the gallery viewer sits above this modal and handles its own Escape
  if (e.key === "Escape" && !waypointDetailModal.hidden && imageLightbox.hidden) closeWaypointDetail();
});
$("#waypointDetailImage").addEventListener("click", () => {
  const el = $("#waypointDetailImage");
  if (el.hidden || !el.src || !detailWaypoint) return;
  // the display image is one of the gallery shots, so open the whole gallery
  // (with credits) positioned on it
  openWaypointGallery(detailWaypoint, el.src, el.alt);
});

function renderDetailActions() {
  const el = $("#waypointDetailActions");
  el.innerHTML = "";
  const wp = detailWaypoint;
  if (!wp) return;
  const defs = [
    {
      label: "Jump to",
      icon: "fa-location-crosshairs",
      onClick: (e) => {
        e.stopPropagation();
        grid.setSelectedWaypoint(wp);
        grid.jumpTo(wp.x, wp.z);
        showTooltip(wp);
        closeWaypointDetail();
      },
    },
  ];
  if (Auth.canEditWaypoint(wp)) {
    defs.push({
      label: "Edit",
      icon: "fa-pen",
      onClick: () => {
        closeWaypointDetail();
        openWaypointForm(wp);
      },
    });
  }
  if (Auth.canTransferWaypoint(wp)) {
    defs.push({
      label: "Transfer ownership",
      icon: "fa-arrow-right-arrow-left",
      onClick: () => {
        collabMode = "transfer";
        openPersonSearch("Search for the new owner");
      },
    });
  }
  if (Auth.canDeleteWaypoint(wp)) {
    defs.push({
      label: "Delete",
      icon: "fa-trash",
      danger: true,
      iconOnly: true,
      onClick: () => {
        closeWaypointDetail();
        handleDelete(wp);
      },
    });
  }
  for (const def of defs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-sm ${def.danger ? "btn-danger" : "btn-ghost"}${def.iconOnly ? " waypoint-card-action-end" : ""}`;
    if (def.iconOnly) btn.setAttribute("aria-label", def.label);
    btn.title = def.label;
    btn.innerHTML = `<i class="fa-solid ${def.icon}" aria-hidden="true"></i>${def.iconOnly ? "" : escapeHtml(def.label)}`;
    btn.addEventListener("click", def.onClick);
    el.appendChild(btn);
  }
}

// ---------- gallery ----------

// waypoint_id -> its gallery rows, so every image belonging to a waypoint
// (card image, tooltip image, display shot, gallery tile) opens the same full
// viewer without refetching
const galleryCache = new Map();

// Opens the viewer with the waypoint's whole gallery, positioned on the image
// that was clicked. Falls back to a plain single-image lightbox when the
// waypoint has no gallery rows (or the clicked URL is not one of them).
async function openWaypointGallery(wp, startUrl, startAlt = "") {
  if (!wp) return;
  let images = galleryCache.get(String(wp.id));
  if (!images) {
    try {
      images = await listGalleryImages(wp.id);
    } catch (err) {
      console.error(err);
      images = [];
    }
    galleryCache.set(String(wp.id), images);
  }
  const idx = startUrl ? images.findIndex((image) => image.url === startUrl) : -1;
  if (!images.length || idx === -1) {
    openSingleImage(startUrl, startAlt);
    return;
  }
  openGalleryViewer(images, idx);
}

async function loadGallery(waypointId) {
  try {
    galleryImages = await listGalleryImages(waypointId);
  } catch (err) {
    console.error(err);
    galleryImages = [];
  }
  galleryCache.set(String(waypointId), galleryImages);
  renderGallery();
}

function renderGallery() {
  const wp = detailWaypoint;
  const el = $("#waypointGallery");
  el.innerHTML = "";
  if (!wp) return;
  const canEdit = Auth.canEditWaypoint(wp);
  $("#waypointGalleryAddBtn").hidden = !canEdit;
  $("#waypointGalleryCount").textContent = String(galleryImages.length);
  $("#waypointGalleryEmpty").hidden = galleryImages.length > 0;
  if (!galleryImages.length) return;
  const frag = document.createDocumentFragment();
  const currentImages = galleryImages;
  for (const image of currentImages) {
    const index = currentImages.indexOf(image);
    frag.appendChild(
      galleryTileHtml(image, {
        canEdit,
        onEditCaption: handleEditCaption,
        canDelete: canEdit,
        onDelete: handleGalleryDelete,
        canSetDisplay: canEdit,
        isDisplay: wp.display_image_url != null && image.url === wp.display_image_url,
        onSetDisplay: handleSetDisplayImage,
        onOpen: () => openGalleryViewer(currentImages, index),
      }),
    );
  }
  el.appendChild(frag);
}

async function handleSetDisplayImage(image) {
  const wp = detailWaypoint;
  if (!wp) return;
  const next = wp.display_image_url === image.url ? null : image.url;
  try {
    await updateWaypoint(wp.id, { display_image_url: next });
    detailWaypoint = { ...wp, display_image_url: next };
    renderGallery();
    applyWaypointDisplayImage();
    toast(next ? "Display image set." : "Display image cleared.");
  } catch (err) {
    toast(err.message || "Could not set display image.", "error");
  }
}

function applyWaypointDisplayImage() {
  const wp = detailWaypoint;
  if (!wp) return;
  const img = waypointImage(wp);
  for (const cardEl of [...document.querySelectorAll(`#waypointList [data-wp-id="${wp.id}"]`)]) {
    const prev = cardEl.querySelector(".waypoint-card-image");
    if (img) {
      if (prev) {
        prev.src = img.src;
        prev.alt = img.alt;
      } else {
        const el = document.createElement("img");
        el.className = "waypoint-card-image";
        el.src = img.src;
        el.alt = img.alt;
        el.loading = "lazy";
        el.title = "Click to enlarge";
        el.dataset.action = "image";
        el.addEventListener("click", () => openWaypointGallery(wp, img.src, img.alt));
        const anchor = cardEl.querySelector(".waypoint-card-desc") || cardEl.querySelector(".waypoint-card-top");
        anchor?.insertAdjacentElement("afterend", el);
      }
    } else if (prev) {
      prev.remove();
    }
  }
  if (openTooltipWaypoint?.id === wp.id) {
    showTooltip({ ...openTooltipWaypoint, display_image_url: wp.display_image_url });
  }
  const detailImg = $("#waypointDetailImage");
  detailImg.hidden = !img;
  if (img) {
    detailImg.src = img.src;
    detailImg.alt = img.alt;
  }
}

async function handleGalleryDelete(image) {
  if (!detailWaypoint) return;
  const ok = await confirmAction(`Delete this screenshot${image.caption ? ` "${image.caption}"` : ""}?`, { title: "Delete screenshot?", confirmLabel: "Delete" });
  if (!ok) return;
  try {
    await deleteGalleryImage(image);
    if (detailWaypoint.display_image_url === image.url) {
      detailWaypoint = { ...detailWaypoint, display_image_url: null };
      renderGallery();
      applyWaypointDisplayImage();
    } else {
      await loadGallery(detailWaypoint.id);
    }
    toast("Screenshot removed.");
  } catch (err) {
    toast(err.message || "Could not delete screenshot.", "error");
  }
}

async function handleEditCaption(image) {
  if (!detailWaypoint || !Auth.canEditWaypoint(detailWaypoint)) return;
  const input = window.prompt("Caption for this screenshot:", image.caption || "");
  if (input === null) return;
  const caption = input.trim();
  if (caption === (image.caption || "").trim()) return;
  try {
    await updateGalleryCaption(image.id, caption === "" ? null : caption);
    image.caption = caption === "" ? null : caption;
    galleryCache.set(String(detailWaypoint.id), galleryImages);
    renderGallery();
    toast("Caption saved.");
  } catch (err) {
    toast(err.message || "Could not save caption.", "error");
  }
}

$("#waypointGalleryAddBtn").addEventListener("click", () => {
  if (!detailWaypoint || !Auth.canEditWaypoint(detailWaypoint)) return;
  $("#wpGalleryFileInput").click();
});

$("#wpGalleryFileInput").addEventListener("change", async (e) => {
  const input = e.currentTarget;
  const files = [...(input.files ?? [])];
  input.value = "";
  const wp = detailWaypoint;
  if (!files.length || !wp || !Auth.canEditWaypoint(wp)) return;
  const state = Auth.getState();
  let added = 0;
  for (const file of files) {
    const invalid = validateGalleryFile(file);
    if (invalid) {
      toast(invalid, "error");
      continue;
    }
    try {
      const url = await uploadGalleryImage(file, wp.id, state.session.user.id);
      await addGalleryImage({ waypointId: wp.id, url, caption: null, uploadedBy: state.session.user.id, uploadedByUsername: state.profile.username });
      added += 1;
    } catch (err) {
      toast(err.message || "Could not upload screenshot.", "error");
    }
  }
  if (added) {
    toast(added === 1 ? "Screenshot added." : `${added} screenshots added.`);
    await loadGallery(wp.id);
  }
});

// ---------- collaborators ----------

async function loadCollaborators(waypointId) {
  try {
    detailCollabs = await listCollaborators(waypointId);
  } catch (err) {
    console.error(err);
    detailCollabs = [];
  }
  renderCollaborators();
}

function mcHeadAvatar(username) {
  return `<img class="waypoint-collab-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(username || "Steve")}/64" alt="" width="26" height="26" loading="lazy" />`;
}

function renderCollaborators() {
  const wp = detailWaypoint;
  const el = $("#waypointCollaborators");
  el.innerHTML = "";
  if (!wp) return;
  const isOwner = Auth.canManageWaypointUsers(wp);
  $("#waypointCollabAddBtn").hidden = !isOwner;
  $("#waypointCollabCount").textContent = String(detailCollabs.length + 1);
  $("#waypointCollabEmpty").hidden = detailCollabs.length > 0;
  const frag = document.createDocumentFragment();
  frag.appendChild(buildCreatorRow(wp));
  for (const c of detailCollabs) frag.appendChild(buildCollabRow(c, isOwner));
  el.appendChild(frag);
}

function buildCreatorRow(wp) {
  const row = document.createElement("div");
  row.className = "waypoint-collab-row waypoint-collab-row--creator";
  row.innerHTML = `
    ${mcHeadAvatar(wp.owner_username || wp.created_by_username)}
    <span class="waypoint-collab-name">${escapeHtml(wp.owner_username || wp.created_by_username || "Unknown")}</span>
    <span class="waypoint-collab-tag"><i class="fa-solid fa-crown" aria-hidden="true"></i>Owner</span>
  `;
  return row;
}

function buildCollabRow(c, isOwner) {
  const row = document.createElement("div");
  row.className = "waypoint-collab-row";
  row.innerHTML = `
    ${mcHeadAvatar(c.username)}
    <span class="waypoint-collab-name">${escapeHtml(c.username || "Unknown")}</span>
    ${isOwner ? `<button type="button" class="waypoint-collab-remove icon-btn icon-btn--danger" aria-label="Remove collaborator"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ""}
  `;
  row.querySelector(".waypoint-collab-remove")?.addEventListener("click", async () => {
    const ok = await confirmAction(`Remove ${c.username ?? "this user"} from collaborators?`, { title: "Remove collaborator?", confirmLabel: "Remove" });
    if (!ok) return;
    try {
      await removeCollaborator(detailWaypoint.id, c.user_id);
      const uid = Auth.getState().session?.user?.id;
      if (c.user_id === uid) forceCollaboratorRole(detailWaypoint.id, null);
      toast("Collaborator removed.");
      await loadCollaborators(detailWaypoint.id);
      await refreshCollabCache();
    } catch (err) {
      toast(err.message || "Could not remove collaborator.", "error");
    }
  });
  return row;
}

function refreshCollabCache() {
  const state = Auth.getState();
  return loadCollaboratorRoles(state.session?.user?.id);
}

// ---------- user search (invite collaborator / transfer ownership) ----------

function openPersonSearch(placeholder) {
  $("#waypointPersonSearch").value = "";
  $("#waypointPersonSearch").placeholder = placeholder;
  $("#waypointCollabSearchWrap").hidden = false;
  runPersonSearch("", 100);
  $("#waypointPersonSearch").focus();
}

function closePersonSearch() {
  $("#waypointCollabSearchWrap").hidden = true;
  $("#waypointPersonResults").innerHTML = "";
}

function runPersonSearch(query, limit) {
  const results = $("#waypointPersonResults");
  Auth.searchProfilesByUsername(query, limit)
    .then((users) => renderPersonResults(users))
    .catch((err) => {
      console.error(err);
      results.innerHTML = "";
    });
}

$("#waypointCollabAddBtn").addEventListener("click", () => {
  if (!detailWaypoint || !Auth.canManageWaypointUsers(detailWaypoint)) return;
  collabMode = "add";
  openPersonSearch("Search a username to invite");
});

$("#waypointPersonSearch").addEventListener(
  "input",
  debounce(() => {
    const q = $("#waypointPersonSearch").value.trim();
    runPersonSearch(q);
  }, 150),
);

function renderPersonResults(users) {
  const el = $("#waypointPersonResults");
  el.innerHTML = "";
  const wp = detailWaypoint;
  if (!wp) return;
  const ownerId = wp.owner_id;
  const uid = Auth.getState().session?.user?.id;
  const existing = new Set(detailCollabs.map((c) => c.user_id));
  let addedAny = false;
  for (const u of users) {
    if (u.id === ownerId || u.id === uid) continue;
    if (collabMode !== "transfer" && existing.has(u.id)) continue;
    addedAny = true;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "waypoint-person-result";
    const avatar = document.createElement("img");
    avatar.className = "waypoint-person-avatar";
    avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(u.username)}/64`;
    avatar.alt = "";
    avatar.width = 22;
    avatar.height = 22;
    avatar.loading = "lazy";
    const span = document.createElement("span");
    span.textContent = u.username;
    btn.appendChild(avatar);
    btn.appendChild(span);
    btn.addEventListener("click", () => {
      if (collabMode === "transfer") confirmTransfer(u);
      else inviteCollab(u);
    });
    el.appendChild(btn);
  }
  if (!addedAny) {
    el.innerHTML = '<div class="waypoint-person-empty">No new users found.</div>';
  }
}

async function inviteCollab(user) {
  const wp = detailWaypoint;
  if (!wp) return;
  try {
    const state = Auth.getState();
    await addCollaborator({ waypointId: wp.id, userId: user.id, username: user.username, role: "collaborator", addedBy: state.session.user.id });
    toast(`${user.username} can now see this waypoint.`);
    closePersonSearch();
    await loadCollaborators(wp.id);
    await refreshCollabCache();
  } catch (err) {
    toast(err.message || "Could not add collaborator.", "error");
  }
}

async function confirmTransfer(user) {
  const wp = detailWaypoint;
  if (!wp) return;
  const ok = await confirmAction(`Transfer "${wp.name}" to ${user.username}? You will stay on as an editor.`, { title: "Transfer ownership?", confirmLabel: "Transfer" });
  if (!ok) return;
  try {
    await transferOwnership(wp.id, user.id, user.username);
    toast(`Ownership transferred to ${user.username}.`);
    closePersonSearch();
    await refreshCollabCache();
    await loadWaypointsForDim(currentDim);
    const updated = currentWaypoints.find((w) => String(w.id) === String(wp.id));
    if (updated) openWaypointDetail(updated);
  } catch (err) {
    console.error("Transfer failed:", err);
    toast("Could not transfer ownership.", "error");
  }
}

// ---------- mobile sidebar drawer ----------

function openSidebarDrawer() {
  clearTimeout(scrimHideTimer);
  sidebarEl.dataset.open = "true";
  sidebarScrim.hidden = false;
  sidebarScrim.dataset.open = "true";
  sidebarToggleBtn.setAttribute("aria-expanded", "true");
}
let scrimHideTimer = null;
function closeSidebarDrawer() {
  sidebarEl.dataset.open = "false";
  sidebarScrim.dataset.open = "false";
  sidebarToggleBtn.setAttribute("aria-expanded", "false");
  clearTimeout(scrimHideTimer);
  scrimHideTimer = setTimeout(() => {
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

const visibilityPicker = $("#visibilityPicker");

function setVisibilityValue(val) {
  $("#wpVisibility").value = val;
  for (const btn of visibilityPicker.querySelectorAll(".visibility-picker-option")) {
    btn.dataset.active = String(btn.dataset.visibility === val);
  }
}

visibilityPicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".visibility-picker-option");
  if (!btn) return;
  setVisibilityValue(btn.dataset.visibility);
});

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
  wpCategoryInput.value = seed.category_id ?? "";
  populateCategorySelect();
  closeCategoryPickerMenu();
  $("#wpColor").value = seed.color ?? "#9683e0";
  updateColorValue();
  setVisibilityValue(seed.visibility || "public");
  document.querySelector(".visibility-picker-field").hidden = editingWaypoint ? !Auth.canManageWaypoint(editingWaypoint) : false;
  $("#wpDeleteBtn").hidden = !editingWaypoint || !Auth.canDeleteWaypoint(editingWaypoint);
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
  if (!editingWaypoint || !Auth.canDeleteWaypoint(editingWaypoint)) return;
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
  const rawDesc = $("#wpDescription").value.trim();
  const payload = {
    name: $("#wpName").value.trim(),
    description: rawDesc === "" ? null : rawDesc,
    x: Math.round(Number(xRaw)) || 0,
    y: yRaw === "" ? null : Math.round(Number(yRaw)),
    z: Math.round(Number(zRaw)) || 0,
    category_id: categoryRaw === "" ? null : categoryRaw,
    color: $("#wpColor").value,
  };
  const state = Auth.getState();
  if (!editingWaypoint) {
    payload.owner_id = state.session.user.id;
    payload.owner_username = state.profile.username;
    payload.visibility = $("#wpVisibility").value;
  } else if (Auth.canManageWaypoint(editingWaypoint)) {
    payload.visibility = $("#wpVisibility").value;
  }
  try {
    if (editingWaypoint) {
      if (!Auth.canEditWaypoint(editingWaypoint)) throw new Error("You cannot edit this waypoint.");
      await updateWaypoint(editingWaypoint.id, payload, editingWaypoint);
    } else {
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

Auth.onAuthChange((state) => {
  addWaypointBtn.hidden = !Auth.can("addWaypoint");
  const uid = state.session?.user?.id;
  if (uid) {
    loadCollaboratorRoles(uid)
      .catch((err) => console.error(err))
      .finally(() => {
        if (Auth.isLoggedIn()) renderSidebar();
      });
  } else {
    renderSidebar();
  }
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

async function consumeJumpParams() {
  const params = new URLSearchParams(window.location.search);
  const dim = params.get("dim");
  if (!dim || !DIM_COLORS[dim]) return;

  if (params.get("restore") === "1") {
    window.history.replaceState({}, "", "/");
    await switchDimension(dim);
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
    return;
  }

  const wpId = params.get("wp");
  window.history.replaceState({}, "", "/");
  await switchDimension(dim);
  if (!wpId) return;
  const wp = currentWaypoints.find((w) => String(w.id) === wpId);
  if (wp) {
    grid.setSelectedWaypoint(wp);
    grid.jumpTo(wp.x, wp.z);
    showTooltip(wp);
    openWaypointDetail(wp);
  }
}

// ---------- init ----------

await loadCategories();
switchDimension("overworld");
consumeSharedAccessCodeLink();
await consumeJumpParams();
