import { getPlayerProfile, getAllPlayerStats, getTop3Summary, getAchievementsCatalog, getAchievementCriteriaCatalog, getPlayerAchievements, getPlayerAchievementCriteria } from "../lib/live.js";
import { listWaypointsByUsername, listCategories, categoryIconClass } from "../lib/waypoints.js";
import { getStatDisplayName, formatStatValue, titleCaseStatKey, STAT_PREFIX_LABELS } from "../lib/statPresets.js";
import { formatCoordsForCopy, formatCoordsForDisplay } from "../lib/settings.js";
import { escapeHtml, copyTextToClipboard } from "../lib/ui.js";
import { buildWaypointCard, buildCategoryFilter, buildDimensionFilter } from "../lib/waypoint-ui.js";
import { initNav } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

await initNav("profile");

const DIM_LABELS = { overworld: "Overworld", nether: "Nether", end: "End" };
const DIM_COLORS = { overworld: "#6bbf8a", nether: "#e2685f", end: "#d9c775" };

const PLAYTIME_KEYS = ["PLAY_ONE_MINUTE", "TIME_PLAYED"];
const MOB_PREFIXES = new Set(["KILL_ENTITY", "ENTITY_KILLED_BY"]);
const ITEM_COLUMNS = ["MINE_BLOCK", "USE_ITEM", "BREAK_ITEM", "CRAFT_ITEM", "DROP", "PICKUP"];
const MOB_COLUMNS = ["KILL_ENTITY", "ENTITY_KILLED_BY"];

function formatAbsoluteTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatRelativeTime(value) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const divisions = [
    [60, "seconds"],
    [60, "minutes"],
    [24, "hours"],
    [7, "days"],
    [4.34524, "weeks"],
    [12, "months"],
    [Infinity, "years"],
  ];
  let duration = (date.getTime() - Date.now()) / 1000;
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) return rtf.format(Math.round(duration), unit);
    duration /= amount;
  }
  return "unknown time";
}

const RESET_ARTIFACT_TIME = new Date("2026-08-20T19:37:58.589292Z").getTime();
const RESET_ARTIFACT_WINDOW_MS = 5 * 60 * 1000;
function isResetArtifact(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return Math.abs(time - RESET_ARTIFACT_TIME) <= RESET_ARTIFACT_WINDOW_MS;
}

let currentUsername = null;

async function openProfile(username) {
  let player;
  try {
    player = await getPlayerProfile(username);
  } catch (err) {
    console.error(err);
    showNotFound();
    return;
  }
  if (!player) {
    showNotFound();
    return;
  }

  $("#profileLoading").hidden = true;
  $("#profileNotFound").hidden = true;
  $("#profileContent").hidden = false;
  document.title = `${player.username} - Miaucraft`;

  setActiveMainTab("stats");
  renderHeader(player);
  renderStats(player);
  renderTopBadges(player);
  renderTopCategoriesTab(player);
  renderWaypoints(player.username);
  renderAchievements(player);
}

function showNotFound() {
  $("#profileLoading").hidden = true;
  $("#profileContent").hidden = true;
  $("#profileNotFound").hidden = false;
}

function renderHeader(player) {
  currentUsername = player.username;
  $("#profileUsername").textContent = player.username;
  $("#profileSkin").src = `https://mc-heads.net/body/${encodeURIComponent(player.username)}/right`;
  $("#profileSkin").alt = `${player.username}'s skin`;

  const badge = $("#profileOnlineBadge");
  badge.textContent = player.online ? "Online" : "Offline";
  badge.classList.remove("badge-online", "badge-offline");
  badge.classList.add(player.online ? "badge-online" : "badge-offline");

  const lastSeen = $("#profileLastSeen");
  if (player.online) lastSeen.textContent = "Currently online";
  else if (isResetArtifact(player.last_seen)) lastSeen.textContent = "Last seen a long time ago";
  else if (player.last_seen) lastSeen.textContent = `Last seen ${formatRelativeTime(player.last_seen)} (${formatAbsoluteTime(player.last_seen)})`;
  else lastSeen.textContent = "Last seen unknown";

  $("#profileTrackingDisabled").hidden = player.live_tracking_enabled !== false;
}

$("#profileShareBtn").addEventListener("click", async () => {
  if (!currentUsername) return;
  const shareBtn = $("#profileShareBtn");
  const icon = shareBtn.querySelector("i");
  const url = `${window.location.origin}/profile?user=${encodeURIComponent(currentUsername)}`;
  try {
    await navigator.clipboard.writeText(url);
    icon.className = "fa-solid fa-check";
    shareBtn.classList.add("copied");
    setTimeout(() => {
      icon.className = "fa-solid fa-link";
      shareBtn.classList.remove("copied");
    }, 1500);
  } catch (err) {
    console.error(err);
    window.prompt("Copy this link:", url);
  }
});

$("#profileAchievementsBadge").addEventListener("click", () => setActiveMainTab("achievements"));

$("#profileMainTabs").addEventListener("click", (event) => {
  const button = event.target.closest(".profile-main-tab");
  if (!button) return;
  setActiveMainTab(button.dataset.tab);
});

function setActiveMainTab(tab) {
  for (const button of $("#profileMainTabs").querySelectorAll(".profile-main-tab")) {
    button.dataset.active = String(button.dataset.tab === tab);
  }
  $("#profileStatsPanel").hidden = tab !== "stats";
  $("#profileWaypointsPanel").hidden = tab !== "waypoints";
  $("#profileTopCategoriesPanel").hidden = tab !== "topcategories";
  $("#profileAchievementsPanel").hidden = tab !== "achievements";
}

function guessStatFormat(key) {
  const normalized = key.trim();
  if (normalized.endsWith("_ONE_CM")) return "distance";
  if (PLAYTIME_KEYS.includes(normalized) || normalized.includes("TIME")) return "time";
  if (normalized.includes("DAMAGE")) return "damage";
  return "count";
}

function categorizeStats(stats) {
  const general = [];
  const itemGroups = new Map();
  const mobGroups = new Map();

  for (const row of stats) {
    const key = row.stat_key.trim();
    if (PLAYTIME_KEYS.includes(key)) continue;
    if (!key.includes(":")) {
      general.push(row);
      continue;
    }
    const [rawPrefix, rawSuffix] = key.split(":");
    const prefix = rawPrefix.trim().toUpperCase();
    const suffix = rawSuffix.trim();
    if (!suffix) continue;
    const isMob = MOB_PREFIXES.has(prefix);
    const groups = isMob ? mobGroups : itemGroups;
    const columns = isMob ? MOB_COLUMNS : ITEM_COLUMNS;
    if (!columns.includes(prefix)) continue;
    if (!groups.has(suffix)) groups.set(suffix, { suffix, label: titleCaseStatKey(suffix), values: {} });
    groups.get(suffix).values[prefix] = Number(row.stat_value) || 0;
  }
  return { general, itemGroups, mobGroups };
}

let statsCache = { general: [], itemGroups: new Map(), mobGroups: new Map() };
let statSort = { key: null, dir: null };
let activeStatTab = "general";
let statSearchBound = false;
let statTabsBound = false;

async function renderStats(player) {
  let stats = [];
  try {
    stats = await getAllPlayerStats(player.id);
  } catch (err) {
    console.error(err);
  }

  const playtimeRow = stats.find((row) => PLAYTIME_KEYS.includes(row.stat_key.trim()));
  const playtimeEl = $("#profilePlaytime");
  playtimeEl.hidden = !playtimeRow;
  if (playtimeRow) playtimeEl.querySelector(".profile-playtime-value").textContent = formatStatValue("time", playtimeRow.stat_value);

  statsCache = categorizeStats(stats);
  activeStatTab = "general";
  statSort = { key: null, dir: null };
  $("#profileStatSearch").value = "";
  for (const button of $("#profileStatTabs").querySelectorAll(".profile-stat-tab")) {
    button.dataset.active = String(button.dataset.tab === "general");
  }
  renderActiveStatTab();

  if (!statSearchBound) {
    statSearchBound = true;
    $("#profileStatSearch").addEventListener("input", applyStatSearch);
  }
  if (!statTabsBound) {
    statTabsBound = true;
    $("#profileStatTabs").addEventListener("click", (event) => {
      const button = event.target.closest(".profile-stat-tab");
      if (!button) return;
      activeStatTab = button.dataset.tab;
      statSort = { key: null, dir: null };
      for (const other of $("#profileStatTabs").querySelectorAll(".profile-stat-tab")) other.dataset.active = String(other === button);
      renderActiveStatTab();
    });
  }
}

function renderActiveStatTab() {
  const listEl = $("#profileStatsGrid");
  listEl.innerHTML = "";
  let count = 0;
  if (activeStatTab === "general") count = renderGeneralTable(listEl, statsCache.general);
  else if (activeStatTab === "item") count = renderStatsTable(listEl, statsCache.itemGroups, ITEM_COLUMNS);
  else count = renderStatsTable(listEl, statsCache.mobGroups, MOB_COLUMNS);
  $("#profileStatsEmpty").hidden = count > 0;
  applyStatSearch();
}

function getSortArrow(key) {
  if (statSort.key !== key) return "";
  return statSort.dir === "asc" ? " ▲" : " ▼";
}

// General tab uses the exact same table look as Items/Mobs - one "Stat" +
// "Value" column pair - instead of the old two-column flex rows, so all
// three tabs read as the same component.
function renderGeneralTable(listEl, rows) {
  if (!rows.length) return 0;
  const sorted = [...rows];
  if (statSort.key === "__label") {
    sorted.sort((a, b) => {
      const cmp = getStatDisplayName(a.stat_key).localeCompare(getStatDisplayName(b.stat_key), undefined, { sensitivity: "base" });
      return statSort.dir === "asc" ? cmp : -cmp;
    });
  } else if (statSort.key === "VALUE") {
    sorted.sort((a, b) => (statSort.dir === "asc" ? Number(a.stat_value) - Number(b.stat_value) : Number(b.stat_value) - Number(a.stat_value)));
  } else {
    sorted.sort((a, b) => Number(b.stat_value) - Number(a.stat_value));
  }

  const table = document.createElement("table");
  table.className = "profile-stat-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th class="profile-stat-table-sortable" data-sort-key="__label">Stat${getSortArrow("__label")}</th><th class="profile-stat-table-sortable" data-sort-key="VALUE">Value${getSortArrow("VALUE")}</th></tr>`;
  thead.addEventListener("click", (event) => {
    const th = event.target.closest(".profile-stat-table-sortable");
    if (!th) return;
    const key = th.dataset.sortKey;
    if (statSort.key === key) statSort.dir = statSort.dir === "desc" ? "asc" : "desc";
    else {
      statSort.key = key;
      statSort.dir = "desc";
    }
    renderActiveStatTab();
  });
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of sorted) {
    const label = getStatDisplayName(row.stat_key);
    const format = guessStatFormat(row.stat_key);
    const tr = document.createElement("tr");
    tr.dataset.search = label.toLowerCase();
    tr.innerHTML = `<td>${escapeHtml(label)}</td><td>${escapeHtml(formatStatValue(format, row.stat_value))}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  listEl.appendChild(table);
  return sorted.length;
}

function compareStatRows(a, b, key, dir) {
  if (key === "__label") {
    const cmp = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  }
  const va = a.values[key],
    vb = b.values[key];
  const aMissing = va === undefined,
    bMissing = vb === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === "asc" ? va - vb : vb - va;
}

function sumValues(row, columns) {
  return columns.reduce((sum, prefix) => sum + (row.values[prefix] || 0), 0);
}

function renderStatsTable(listEl, groupMap, columns) {
  const rows = [...groupMap.values()].filter((row) => row.label);
  if (!rows.length) return 0;

  if (statSort.key && (statSort.key === "__label" || columns.includes(statSort.key))) {
    rows.sort((a, b) => compareStatRows(a, b, statSort.key, statSort.dir));
  } else {
    rows.sort((a, b) => sumValues(b, columns) - sumValues(a, columns));
  }

  const table = document.createElement("table");
  table.className = "profile-stat-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th class="profile-stat-table-sortable" data-sort-key="__label">Item${getSortArrow("__label")}</th>${columns.map((prefix) => `<th class="profile-stat-table-sortable" data-sort-key="${escapeHtml(prefix)}">${escapeHtml(STAT_PREFIX_LABELS[prefix] || titleCaseStatKey(prefix))}${getSortArrow(prefix)}</th>`).join("")}</tr>`;
  thead.addEventListener("click", (event) => {
    const th = event.target.closest(".profile-stat-table-sortable");
    if (!th) return;
    const key = th.dataset.sortKey;
    if (statSort.key === key) statSort.dir = statSort.dir === "desc" ? "asc" : "desc";
    else {
      statSort.key = key;
      statSort.dir = "desc";
    }
    renderActiveStatTab();
  });
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const presentColumns = columns.filter((prefix) => row.values[prefix] !== undefined);
    const searchText = [row.label, ...presentColumns.map((prefix) => STAT_PREFIX_LABELS[prefix] || "")].join(" ").toLowerCase();
    const tr = document.createElement("tr");
    tr.dataset.search = searchText;
    tr.innerHTML = `<td><span>${escapeHtml(row.label)}</span></td>${columns.map((prefix) => `<td>${row.values[prefix] === undefined ? "-" : row.values[prefix].toLocaleString()}</td>`).join("")}`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  listEl.appendChild(table);
  return rows.length;
}

function applyStatSearch() {
  const query = $("#profileStatSearch").value.trim().toLowerCase();
  const rows = [...$("#profileStatsGrid").querySelectorAll("[data-search]")];
  let visibleCount = 0;
  for (const row of rows) {
    const match = !query || row.dataset.search.includes(query);
    row.hidden = !match;
    if (match) visibleCount++;
  }
  const noMatchEl = $("#profileStatsNoMatch");
  noMatchEl.hidden = !query || visibleCount > 0 || rows.length === 0;
  if (!noMatchEl.hidden) noMatchEl.querySelector("span").textContent = `No stats match "${query}".`;
}

// ---------- top leaderboards (categories the player is top 1 / 2 / 3 in) ----------

let topEntriesCache = [];
let topTierFilter = "all";

const RANK_CLASSES = { 1: "is-gold", 2: "is-silver", 3: "is-bronze" };
const RANK_ICONS = { 1: "fa-crown", 2: "fa-medal", 3: "fa-medal" };
const RANK_LABELS = { 1: "Top 1", 2: "Top 2", 3: "Top 3" };

async function renderTopBadges(player) {
  const wrap = $("#profileTopBadges");
  const data = await getTop3DataFor(player);
  const top1Count = data.filter((e) => e.rank === 1).length;

  if (!top1Count) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = `<button type="button" class="profile-badge-pill is-gold" data-rank="1"><i class="fa-solid fa-crown" aria-hidden="true"></i> Top 1 &middot; ${top1Count}</button>`;
  wrap.querySelector("button").addEventListener("click", () => {
    setActiveMainTab("topcategories");
    setTopTierFilter("all");
  });
}

async function getTop3DataFor(player) {
  let summaryRow = null;
  try {
    const summary = await getTop3Summary();
    summaryRow = summary.find((row) => row.username?.toLowerCase() === player.username.toLowerCase()) ?? null;
  } catch (err) {
    console.error(err);
  }
  if (!summaryRow) return [];

  const entries = [];
  for (const rank of [1, 2, 3]) {
    const col = summaryRow[`top${rank}`];
    if (col) {
      for (const key of col.split(",").map((k) => k.trim()).filter(Boolean)) {
        entries.push({ key, rank });
      }
    }
  }
  return entries;
}

let topSearchBound = false;
let topTierBound = false;

async function renderTopCategoriesTab(player) {
  topEntriesCache = await getTop3DataFor(player);
  topTierFilter = "all";
  $("#profileTopSearch").value = "";
  setActiveTopTierTab("all");
  applyTopCategoriesFilter();

  if (!topSearchBound) {
    topSearchBound = true;
    $("#profileTopSearch").addEventListener("input", applyTopCategoriesFilter);
  }
  if (!topTierBound) {
    topTierBound = true;
    $("#profileTopTierTabs").addEventListener("click", (event) => {
      const btn = event.target.closest(".profile-top-tier-tab");
      if (!btn) return;
      setTopTierFilter(btn.dataset.tier);
    });
  }
}

function setTopTierFilter(tier) {
  topTierFilter = tier;
  setActiveTopTierTab(tier);
  applyTopCategoriesFilter();
}

function setActiveTopTierTab(tier) {
  for (const btn of $("#profileTopTierTabs").querySelectorAll(".profile-top-tier-tab")) {
    btn.dataset.active = String(btn.dataset.tier === tier);
  }
}

function applyTopCategoriesFilter() {
  const query = $("#profileTopSearch").value.trim().toLowerCase();
  const listEl = $("#profileTopCategoriesList");
  const emptyEl = $("#profileTopCategoriesEmpty");
  listEl.innerHTML = "";

  let filtered = topEntriesCache;
  if (topTierFilter !== "all") {
    const rank = Number(topTierFilter);
    filtered = filtered.filter((e) => e.rank === rank);
  }
  if (query) filtered = filtered.filter((e) => getStatDisplayName(e.key).toLowerCase().includes(query));

  emptyEl.hidden = topEntriesCache.length > 0;
  if (topEntriesCache.length > 0) emptyEl.querySelector("span").textContent = filtered.length ? "" : `No leaderboards match "${query}".`;
  if (topEntriesCache.length > 0 && !filtered.length) emptyEl.hidden = false;

  for (const rank of [1, 2, 3]) {
    const entries = filtered.filter((e) => e.rank === rank);
    if (!entries.length) continue;

    const label = document.createElement("div");
    label.className = `profile-top-section-label ${RANK_CLASSES[rank]}`;
    label.dataset.rank = rank;
    label.innerHTML = `<i class="fa-solid ${RANK_ICONS[rank]}" aria-hidden="true"></i> ${RANK_LABELS[rank]} &middot; ${entries.length}`;
    listEl.appendChild(label);

    for (const { key } of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `profile-top-item ${RANK_CLASSES[rank]}`;
      item.dataset.rank = rank;
      item.innerHTML = `
        <span class="profile-top-item-icon"><i class="fa-solid ${RANK_ICONS[rank]}" aria-hidden="true"></i></span>
        <span class="profile-top-item-body">
          <span class="profile-top-item-title">${escapeHtml(getStatDisplayName(key))}</span>
          <span class="profile-top-item-link">View leaderboard <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
        </span>
      `;
      item.addEventListener("click", () => {
        window.location.href = `/leaderboards?lb=${encodeURIComponent(key)}`;
      });
      listEl.appendChild(item);
    }
  }
}

// ---------- achievements ----------

let achievementsCatalogPromise = null;
function loadAchievementsCatalog() {
  if (!achievementsCatalogPromise) {
    achievementsCatalogPromise = Promise.all([getAchievementsCatalog(), getAchievementCriteriaCatalog()]).catch((err) => {
      achievementsCatalogPromise = null;
      throw err;
    });
  }
  return achievementsCatalogPromise;
}

function formatCriterionLabel(criterionKey) {
  const stripped = criterionKey.includes(":") ? criterionKey.split(":").pop() : criterionKey;
  return titleCaseStatKey(stripped);
}

function achievementFrameIcon(frame) {
  switch ((frame || "").toUpperCase()) {
    case "CHALLENGE":
      return "fa-crown";
    case "GOAL":
      return "fa-flag-checkered";
    default:
      return "fa-star";
  }
}

let achievementEntriesCache = { completed: [], incomplete: [] };
let achievementCriteriaCache = new Map();
let achievementDoneCriteriaCache = new Set();
let achievementsFilterTab = "all";
let achievementsBound = false;

async function renderAchievements(player) {
  const badgeEl = $("#profileAchievementsBadge");
  const emptyEl = $("#profileAchievementsEmpty");

  badgeEl.classList.remove("achievements-complete");
  badgeEl.innerHTML = `<i class="fa-solid fa-medal" aria-hidden="true"></i> 0/0 achievements`;
  $("#profileAchievementsList").innerHTML = "";
  emptyEl.hidden = true;

  let catalog = [],
    criteriaCatalog = [],
    playerAchievements = [],
    playerCriteria = [];
  try {
    const [[catalogResult, criteriaResult], achievementsResult, criteriaResultForPlayer] = await Promise.all([loadAchievementsCatalog(), getPlayerAchievements(player.id), getPlayerAchievementCriteria(player.id)]);
    catalog = catalogResult;
    criteriaCatalog = criteriaResult;
    playerAchievements = achievementsResult;
    playerCriteria = criteriaResultForPlayer;
  } catch (err) {
    console.error(err);
  }

  if (!catalog.length) {
    emptyEl.hidden = false;
    return;
  }

  const progressByKey = new Map(playerAchievements.map((row) => [row.achievement_key, row]));
  achievementCriteriaCache = new Map();
  for (const row of criteriaCatalog) {
    if (!achievementCriteriaCache.has(row.achievement_key)) achievementCriteriaCache.set(row.achievement_key, []);
    achievementCriteriaCache.get(row.achievement_key).push(row.criterion_key);
  }
  achievementDoneCriteriaCache = new Set(playerCriteria.filter((row) => row.done).map((row) => `${row.achievement_key}|${row.criterion_key}`));

  const completedCount = catalog.filter((a) => progressByKey.get(a.key)?.completed).length;
  const totalCount = catalog.length;
  const isComplete = totalCount > 0 && completedCount === totalCount;
  badgeEl.innerHTML = `<i class="fa-solid fa-medal" aria-hidden="true"></i> ${completedCount}/${totalCount} achievements`;
  badgeEl.classList.toggle("achievements-complete", isComplete);

  const completedEntries = [],
    incompleteEntries = [];
  for (const achievement of catalog) {
    const progress = progressByKey.get(achievement.key);
    const entry = { achievement, progress };
    if (progress?.completed) completedEntries.push(entry);
    else incompleteEntries.push(entry);
  }
  completedEntries.sort((a, b) => {
    const ta = a.progress?.completed_at ? new Date(a.progress.completed_at).getTime() : 0;
    const tb = b.progress?.completed_at ? new Date(b.progress.completed_at).getTime() : 0;
    return tb - ta;
  });
  incompleteEntries.sort((a, b) => {
    const totalA = a.achievement.total_criteria || 1;
    const totalB = b.achievement.total_criteria || 1;
    const pa = (a.progress?.criteria_done || 0) / totalA;
    const pb = (b.progress?.criteria_done || 0) / totalB;
    if (pb !== pa) return pb - pa;
    return (a.achievement.title || "").localeCompare(b.achievement.title || "");
  });

  achievementEntriesCache = { completed: completedEntries, incomplete: incompleteEntries };
  $("#profileAchievementsSearch").value = "";
  achievementsFilterTab = "all";
  for (const btn of $("#profileAchievementsTabs").querySelectorAll(".tab")) btn.dataset.active = String(btn.dataset.tab === "all");
  applyAchievementsFilter();

  if (!achievementsBound) {
    achievementsBound = true;
    $("#profileAchievementsSearch").addEventListener("input", applyAchievementsFilter);
    $("#profileAchievementsTabs").addEventListener("click", (event) => {
      const btn = event.target.closest(".tab");
      if (!btn) return;
      achievementsFilterTab = btn.dataset.tab;
      for (const other of $("#profileAchievementsTabs").querySelectorAll(".tab")) other.dataset.active = String(other === btn);
      applyAchievementsFilter();
    });
  }
}

function applyAchievementsFilter() {
  const query = $("#profileAchievementsSearch").value.trim().toLowerCase();
  const matchesQuery = (entry) => !query || entry.achievement.title.toLowerCase().includes(query) || (entry.achievement.description || "").toLowerCase().includes(query);

  const showCompleted = achievementsFilterTab !== "progress";
  const showIncomplete = achievementsFilterTab !== "completed";

  const completed = showCompleted ? achievementEntriesCache.completed.filter(matchesQuery) : [];
  const incomplete = showIncomplete ? achievementEntriesCache.incomplete.filter(matchesQuery) : [];

  const listEl = $("#profileAchievementsList");
  listEl.innerHTML = "";
  if (completed.length) listEl.appendChild(renderAchievementsGroup("Completed", completed, true));
  if (incomplete.length) listEl.appendChild(renderAchievementsGroup("In Progress", incomplete, false));

  const totalCatalog = achievementEntriesCache.completed.length + achievementEntriesCache.incomplete.length;
  $("#profileAchievementsEmpty").hidden = totalCatalog === 0 || completed.length + incomplete.length > 0;
  if (!$("#profileAchievementsEmpty").hidden && query) $("#profileAchievementsEmpty").querySelector("span").textContent = `No achievements match "${query}".`;
}

function renderAchievementsGroup(title, entries, isCompletedGroup) {
  const group = document.createElement("div");
  group.className = "achievements-group";
  const heading = document.createElement("div");
  heading.className = "achievements-group-title";
  heading.innerHTML = `<span>${escapeHtml(title)}</span><span class="achievements-group-count">${entries.length}</span>`;
  const cards = document.createElement("div");
  cards.className = "achievements-group-cards";
  for (const entry of entries) cards.appendChild(renderAchievementCard(entry, isCompletedGroup));
  group.append(heading, cards);
  return group;
}

function renderAchievementCard(entry, isCompletedGroup) {
  const { achievement, progress } = entry;
  const total = achievement.total_criteria || 1;
  const done = progress?.criteria_done || 0;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const canExpand = !isCompletedGroup && total > 1;

  const card = document.createElement("div");
  card.className = "achievement-card" + (isCompletedGroup ? " achievement-card-done" : "");
  const frameClass = `achievement-frame-${(achievement.frame || "task").toLowerCase()}`;
  const iconClass = isCompletedGroup ? "fa-trophy" : achievementFrameIcon(achievement.frame);

  card.innerHTML = `
    <div class="achievement-card-icon ${frameClass}"><i class="fa-solid ${iconClass}" aria-hidden="true"></i></div>
    <div class="achievement-card-body">
      <div class="achievement-card-title">${escapeHtml(achievement.title)}</div>
      ${achievement.description ? `<div class="achievement-card-desc">${escapeHtml(achievement.description)}</div>` : ""}
      ${
        !isCompletedGroup
          ? `<button type="button" class="achievement-progress-btn" ${canExpand ? "" : "disabled"}>
              <div class="achievement-progress-track"><div class="achievement-progress-fill" style="width:${percent}%"></div></div>
              <span class="achievement-progress-count">${done}/${total}</span>
              ${canExpand ? `<i class="fa-solid fa-chevron-down achievement-progress-chevron" aria-hidden="true"></i>` : ""}
            </button>
            ${canExpand ? `<div class="achievement-criteria-list" hidden></div>` : ""}`
          : ""
      }
    </div>
  `;

  if (canExpand) {
    const btn = card.querySelector(".achievement-progress-btn");
    const criteriaListEl = card.querySelector(".achievement-criteria-list");
    btn.addEventListener("click", () => {
      const willShow = criteriaListEl.hidden;
      criteriaListEl.hidden = !willShow;
      btn.classList.toggle("expanded", willShow);
      if (willShow && !criteriaListEl.dataset.rendered) {
        criteriaListEl.dataset.rendered = "true";
        const criteria = achievementCriteriaCache.get(achievement.key) || [];
        const sorted = [...criteria].sort((a, b) => {
          const aDone = achievementDoneCriteriaCache.has(`${achievement.key}|${a}`);
          const bDone = achievementDoneCriteriaCache.has(`${achievement.key}|${b}`);
          if (aDone !== bDone) return aDone ? -1 : 1;
          return formatCriterionLabel(a).localeCompare(formatCriterionLabel(b));
        });
        for (const criterion of sorted) {
          const criterionDone = achievementDoneCriteriaCache.has(`${achievement.key}|${criterion}`);
          const row = document.createElement("div");
          row.className = "achievement-criterion-row" + (criterionDone ? " done" : "");
          row.innerHTML = `<i class="fa-solid ${criterionDone ? "fa-circle-check" : "fa-circle"}" aria-hidden="true"></i><span>${escapeHtml(formatCriterionLabel(criterion))}</span>`;
          criteriaListEl.appendChild(row);
        }
      }
    });
  }
  return card;
}

// ---------- waypoints ----------

let waypointsCache = [];
let waypointCategoriesCache = [];
let waypointsCategoryFilter = null;
let waypointsDimensionFilter = null;
let waypointsSearchBound = false;

async function renderWaypoints(username) {
  try {
    [waypointsCache, waypointCategoriesCache] = await Promise.all([listWaypointsByUsername(username), listCategories()]);
  } catch (err) {
    console.error(err);
    waypointsCache = [];
    waypointCategoriesCache = [];
  }

  waypointsCategoryFilter = null;
  waypointsDimensionFilter = null;
  $("#profileWaypointsSearch").value = "";
  renderWaypointsCategoryRow();
  applyWaypointsFilter();

  if (!waypointsSearchBound) {
    waypointsSearchBound = true;
    $("#profileWaypointsSearch").addEventListener("input", applyWaypointsFilter);
  }
}

function renderWaypointsCategoryRow() {
  const rowEl = $("#profileWaypointsCategoryRow");
  const usedCategoryIds = new Set(waypointsCache.map((w) => w.category_id).filter(Boolean));
  const usedCategories = waypointCategoriesCache.filter((c) => usedCategoryIds.has(c.id));
  rowEl.innerHTML = "";

  rowEl.appendChild(
    buildDimensionFilter({
      selected: waypointsDimensionFilter ?? "",
      onChange: (value) => {
        waypointsDimensionFilter = value === "" ? null : value;
        applyWaypointsFilter();
      },
    }),
  );

  if (usedCategories.length) {
    rowEl.appendChild(
      buildCategoryFilter({
        categories: usedCategories,
        selected: waypointsCategoryFilter ?? "",
        onChange: (value) => {
          waypointsCategoryFilter = value === "" ? null : value;
          applyWaypointsFilter();
        },
      }),
    );
  }
  rowEl.hidden = false;
}

function applyWaypointsFilter() {
  const query = $("#profileWaypointsSearch").value.trim().toLowerCase();
  const categoryById = new Map(waypointCategoriesCache.map((c) => [c.id, c]));

  const filtered = waypointsCache.filter((wp) => {
    if (waypointsDimensionFilter !== null && wp.dimension !== waypointsDimensionFilter) return false;
    if (waypointsCategoryFilter !== null && wp.category_id !== waypointsCategoryFilter) return false;
    if (!query) return true;
    return [wp.name, wp.description].filter(Boolean).join(" ").toLowerCase().includes(query);
  });

  const listEl = $("#profileWaypointsList");
  listEl.innerHTML = "";
  $("#profileWaypointsEmpty").hidden = waypointsCache.length !== 0;
  if (waypointsCache.length > 0) {
    $("#profileWaypointsEmpty").hidden = filtered.length > 0;
    $("#profileWaypointsEmpty").querySelector("span").textContent = "No waypoints match this search or filter.";
  }
  if (!filtered.length) return;

  for (const waypoint of filtered) {
    const category = categoryById.get(waypoint.category_id) || null;
    const dimensionColor = DIM_COLORS[waypoint.dimension] || "var(--text-muted)";
    const coords = formatCoordsForDisplay(Math.round(waypoint.x), waypoint.y !== null && waypoint.y !== undefined ? Math.round(waypoint.y) : null, Math.round(waypoint.z));
    const coordsForCopy = formatCoordsForCopy(Math.round(waypoint.x), waypoint.y !== null && waypoint.y !== undefined ? Math.round(waypoint.y) : null, Math.round(waypoint.z));

    const card = buildWaypointCard(waypoint, {
      variant: "row",
      category,
      coordsText: coords,
      dimensionBadge: { label: DIM_LABELS[waypoint.dimension] || waypoint.dimension, color: dimensionColor },
      actions: [{ action: "jump", label: "Jump to", icon: "fa-location-crosshairs" }],
    });
    card.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      copyTextToClipboard(coordsForCopy, e.currentTarget);
    });
    card.querySelector('[data-action="jump"]')?.addEventListener("click", () => {
      window.location.href = `/?dim=${encodeURIComponent(waypoint.dimension)}&wp=${encodeURIComponent(waypoint.id)}`;
    });
    listEl.appendChild(card);
  }
}

// ---------- resolve username from the URL ----------

function resolveUsername() {
  const pathMatch = window.location.pathname.match(/^\/p\/([^/]+)\/?$/);
  if (pathMatch) {
    const username = decodeURIComponent(pathMatch[1]);
      window.history.replaceState({}, "", `/profile?user=${encodeURIComponent(username)}`);
    return username;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("user");
}

const username = resolveUsername();
if (!username) {
  showNotFound();
} else {
  openProfile(username);
}
