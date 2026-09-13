import * as Auth from "../lib/auth.js";
import { listCategories, listLogs } from "../lib/waypoints.js";
import { formatCoordsForDisplay } from "../lib/settings.js";
import { escapeHtml, formatRelativeTime } from "../lib/ui.js";
import { initNav } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);
const DIM_COLORS = { overworld: "#6bbf8a", nether: "#e2685f", end: "#d9c775" };
const DIM_LABELS = { overworld: "Overworld", nether: "Nether", end: "End" };
const LOG_ACTION_LABELS = { create: "created", update: "edited", delete: "deleted" };
const LOG_ACTION_ICONS = { create: "fa-plus", update: "fa-pen", delete: "fa-trash" };
const LOGS_PER_PAGE = 20;

let allLogs = [];
let deletedWaypointIds = new Set();
let logsCurrentPage = 1;
let categories = [];

await initNav("logs");

const loggedIn = Auth.isLoggedIn();
$("#logsSignedOut").hidden = loggedIn;
$("#logsBody").hidden = !loggedIn;

if (loggedIn) {
  loadLogs();
}

Auth.onAuthChange((state) => {
  const nowLoggedIn = Auth.isLoggedIn();
  $("#logsSignedOut").hidden = nowLoggedIn;
  $("#logsBody").hidden = !nowLoggedIn;
  if (nowLoggedIn && allLogs.length === 0) loadLogs();
});

// ---------- helpers ----------

function formatWaypointDate(value) {
  if (!value) return "on an unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "on an unknown date";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function categoryById(id) {
  return categories.find((c) => c.id === id) || null;
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
    return formatCoordsForDisplay(snapshot.x, hasY ? snapshot.y : null, snapshot.z);
  }
  if (key === "created_at") return snapshot.created_at ? formatWaypointDate(snapshot.created_at) : "None";
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
  if (isUpdate) fields = fields.filter((f) => f.key !== "created_by_username" && f.key !== "created_at");

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
      row.innerHTML = `<span class="log-detail-label">${escapeHtml(field.label)}</span><span class="log-detail-value">${escapeHtml(formatLogDetailValue(field.key, snapshot))}</span>`;
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
        if (log.entity_type === "waypoint") recreateWaypointFromLog(log);
        else recreateCategoryFromLog(log);
      });
      actions.appendChild(btn);
      inner.appendChild(actions);
    }
  }
  return wrap;
}

function recreateCategoryFromLog(log) {
  const snapshot = log.changes;
  if (!snapshot) return;
  const params = new URLSearchParams({ tab: "categories" });
  if (snapshot.name) params.set("name", snapshot.name);
  if (snapshot.color) params.set("color", snapshot.color);
  if (snapshot.icon) params.set("icon", snapshot.icon);
  window.location.href = `/admin?${params.toString()}`;
}

function recreateWaypointFromLog(log) {
  const snapshot = log.changes;
  if (!snapshot) return;
  const dimension = snapshot.dimension || log.dimension || "overworld";
  const params = new URLSearchParams({ dim: dimension, restore: "1", name: snapshot.name || "", x: snapshot.x, z: snapshot.z });
  if (snapshot.y !== null && snapshot.y !== undefined) params.set("y", snapshot.y);
  if (snapshot.color) params.set("color", snapshot.color);
  if (snapshot.description) params.set("desc", snapshot.description);
  if (snapshot.category_id) params.set("cat", snapshot.category_id);
  window.location.href = `/?${params.toString()}`;
}

// ---------- load & render ----------

async function loadLogs() {
  $("#logsLoading").hidden = false;
  $("#logsEmpty").hidden = true;
  $("#logsList").innerHTML = "";
  try {
    [allLogs] = await Promise.all([listLogs(), loadCategories()]);
    deletedWaypointIds = new Set(allLogs.filter((l) => l.entity_type === "waypoint" && l.action === "delete").map((l) => l.entity_id));
    populateLogUserFilter();
    renderLogs();
  } catch (err) {
    $("#logsList").innerHTML = `<div class="logs-error">Could not load logs: ${escapeHtml(err.message || "unknown error")}</div>`;
  } finally {
    $("#logsLoading").hidden = true;
  }
}

async function loadCategories() {
  try {
    const cats = await listCategories();
    categories = cats;
  } catch {
    categories = [];
  }
}

function populateLogUserFilter() {
  const el = $("#logUserFilter");
  const current = el.value;
  const users = new Map();
  for (const log of allLogs) if (log.user_id && log.username) users.set(log.user_id, log.username);
  const sorted = [...users.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  el.innerHTML = '<option value="">All users</option>' + sorted.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
  if (sorted.some(([id]) => id === current)) el.value = current;
}

function renderLogs() {
  const search = $("#logSearch").value.trim().toLowerCase();
  const entityFilter = $("#logEntityFilter").value;
  const userFilter = $("#logUserFilter").value;
  const actionFilter = $("#logActionFilter").value;
  const dimFilter = $("#logDimensionFilter").value;

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

  const listEl = $("#logsList");
  listEl.innerHTML = "";
  $("#logsEmpty").hidden = filtered.length !== 0;

  const frag = document.createDocumentFragment();
  for (const log of pageItems) frag.appendChild(buildLogEntry(log));
  listEl.appendChild(frag);

  renderLogsPagination(totalPages, filtered.length);
}

function renderLogsPagination(totalPages, totalCount) {
  $("#logsPagination").hidden = totalCount === 0;
  $("#logsPageInput").value = logsCurrentPage;
  $("#logsPageInput").max = totalPages;
  $("#logsPageTotal").textContent = totalPages;
  $("#logsFirstPageBtn").disabled = logsCurrentPage <= 1;
  $("#logsPrevPageBtn").disabled = logsCurrentPage <= 1;
  $("#logsNextPageBtn").disabled = logsCurrentPage >= totalPages;
  $("#logsLastPageBtn").disabled = logsCurrentPage >= totalPages;
}

function goToLogsPage(page) {
  logsCurrentPage = page;
  renderLogs();
}

$("#logsFirstPageBtn").addEventListener("click", () => goToLogsPage(1));
$("#logsPrevPageBtn").addEventListener("click", () => goToLogsPage(logsCurrentPage - 1));
$("#logsNextPageBtn").addEventListener("click", () => goToLogsPage(logsCurrentPage + 1));
$("#logsLastPageBtn").addEventListener("click", () => goToLogsPage(Number($("#logsPageInput").max) || 1));
$("#logsPageInput").addEventListener("change", () => {
  const page = Math.round(Number($("#logsPageInput").value));
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
    const dimBadge = log.dimension ? ` <span class="log-entry-dim" style="--dim-badge-color:${dimColor || "var(--text-muted)"}">${escapeHtml(DIM_LABELS[log.dimension] || log.dimension)}</span>` : "";
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
    if (waypointExists && log.dimension) {
      jumpBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        window.location.href = `/?dim=${encodeURIComponent(log.dimension)}&wp=${encodeURIComponent(log.entity_id)}`;
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

// ---------- filters ----------

function updateLogDimensionFilterVisibility() {
  const hide = $("#logEntityFilter").value === "category" || $("#logEntityFilter").value === "whitelist";
  $("#logDimensionFilterWrap").hidden = hide;
  if (hide && $("#logDimensionFilter").value) $("#logDimensionFilter").value = "";
}

function updateLogsFiltersDot() {
  const active = Boolean($("#logEntityFilter").value || $("#logUserFilter").value || $("#logActionFilter").value || $("#logDimensionFilter").value);
  $("#logsFiltersDot").hidden = !active;
}

function applyLogFilterChange() {
  logsCurrentPage = 1;
  updateLogsFiltersDot();
  renderLogs();
}

$("#logsFiltersToggle").addEventListener("click", () => {
  const panel = $("#logsFiltersPanel");
  const willOpen = !panel.classList.contains("is-open");
  panel.classList.toggle("is-open", willOpen);
});

let logFilterDebounce = null;
$("#logSearch").addEventListener("input", () => {
  clearTimeout(logFilterDebounce);
  logFilterDebounce = setTimeout(() => {
    logsCurrentPage = 1;
    renderLogs();
  }, 150);
});
$("#logEntityFilter").addEventListener("change", () => {
  updateLogDimensionFilterVisibility();
  applyLogFilterChange();
});
$("#logUserFilter").addEventListener("change", applyLogFilterChange);
$("#logActionFilter").addEventListener("change", applyLogFilterChange);
$("#logDimensionFilter").addEventListener("change", applyLogFilterChange);