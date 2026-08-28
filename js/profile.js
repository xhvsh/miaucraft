import { getPlayerProfile, getAllPlayerStats, getTop1Summary } from "./live.js";

import { listWaypointsByUsername, listCategories } from "./waypoints.js";

import { getStatDisplayName, formatStatValue, titleCaseStatKey, STAT_PREFIX_LABELS } from "./statPresets.js";

import { categoryIconClass } from "./waypoints.js";

import { formatCoordsForCopy } from "./app.js";

const $ = (sel) => document.querySelector(sel);

const DIM_LABELS = {
  overworld: "Overworld",
  nether: "Nether",
  end: "End",
};

const DIM_COLORS = {
  overworld: "#4ade80",
  nether: "#f87171",
  end: "#f2df8a",
};

const PLAYTIME_KEYS = ["PLAY_ONE_MINUTE", "TIME_PLAYED"];
const MOB_PREFIXES = new Set(["KILL_ENTITY", "ENTITY_KILLED_BY"]);

const ITEM_COLUMNS = ["MINE_BLOCK", "USE_ITEM", "BREAK_ITEM", "CRAFT_ITEM", "DROP", "PICKUP"];

const MOB_COLUMNS = ["KILL_ENTITY", "ENTITY_KILLED_BY"];

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatAbsoluteTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRelativeTime(value) {
  if (!value) return "unknown time";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown time";
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

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
    if (Math.abs(duration) < amount) {
      return rtf.format(Math.round(duration), unit);
    }

    duration /= amount;
  }

  return "unknown time";
}

const RESET_ARTIFACT_TIME = new Date("2026-08-20T19:37:58.589292Z").getTime();

const RESET_ARTIFACT_WINDOW_MS = 5 * 60 * 1000;

function isResetArtifact(value) {
  if (!value) return false;

  const time = new Date(value).getTime();

  if (Number.isNaN(time)) {
    return false;
  }

  return Math.abs(time - RESET_ARTIFACT_TIME) <= RESET_ARTIFACT_WINDOW_MS;
}

let currentUsername = null;

export async function openProfilePanel(username) {
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

  setActiveMainTab("stats");

  renderHeader(player);
  renderStats(player);
  renderTopBadges(player);
  renderWaypoints(player.username);
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

  badge.classList.remove("online", "offline");
  badge.classList.add(player.online ? "online" : "offline");

  const lastSeen = $("#profileLastSeen");

  if (player.online) {
    lastSeen.textContent = "Currently online";
  } else if (isResetArtifact(player.last_seen)) {
    lastSeen.textContent = "Last seen a long time ago";
  } else if (player.last_seen) {
    lastSeen.textContent = `Last seen ${formatRelativeTime(player.last_seen)} (${formatAbsoluteTime(player.last_seen)})`;
  } else {
    lastSeen.textContent = "Last seen unknown";
  }

  $("#profileTrackingDisabled").hidden = player.live_tracking_enabled !== false;
}

$("#profileShareBtn").addEventListener("click", async () => {
  if (!currentUsername) return;

  const shareBtn = $("#profileShareBtn");
  const icon = shareBtn.querySelector("i");

  const url = `${window.location.origin}/p/${encodeURIComponent(currentUsername)}`;

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
}

function guessStatFormat(key) {
  const normalized = key.trim();

  if (normalized.endsWith("_ONE_CM")) {
    return "distance";
  }

  if (PLAYTIME_KEYS.includes(normalized) || normalized.includes("TIME")) {
    return "time";
  }

  if (normalized.includes("DAMAGE")) {
    return "damage";
  }

  return "count";
}

function categorizeStats(stats) {
  const general = [];
  const itemGroups = new Map();
  const mobGroups = new Map();

  for (const row of stats) {
    const key = row.stat_key.trim();

    if (PLAYTIME_KEYS.includes(key)) {
      continue;
    }

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

    if (!columns.includes(prefix)) {
      continue;
    }

    if (!groups.has(suffix)) {
      groups.set(suffix, {
        suffix,
        label: titleCaseStatKey(suffix),
        values: {},
      });
    }

    groups.get(suffix).values[prefix] = Number(row.stat_value) || 0;
  }

  return {
    general,
    itemGroups,
    mobGroups,
  };
}

let statsCache = {
  general: [],
  itemGroups: new Map(),
  mobGroups: new Map(),
};

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

  if (playtimeRow) {
    playtimeEl.querySelector(".profile-playtime-value").textContent = formatStatValue("time", playtimeRow.stat_value);
  }

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

      for (const other of $("#profileStatTabs").querySelectorAll(".profile-stat-tab")) {
        other.dataset.active = String(other === button);
      }

      renderActiveStatTab();
    });
  }
}

function renderActiveStatTab() {
  const listEl = $("#profileStatsGrid");

  listEl.innerHTML = "";

  let count = 0;

  if (activeStatTab === "general") {
    count = renderGeneralLines(listEl, statsCache.general);
  } else if (activeStatTab === "item") {
    count = renderStatsTable(listEl, statsCache.itemGroups, ITEM_COLUMNS);
  } else {
    count = renderStatsTable(listEl, statsCache.mobGroups, MOB_COLUMNS);
  }

  $("#profileStatsEmpty").hidden = count > 0;

  applyStatSearch();
}

function renderGeneralLines(listEl, rows) {
  const sorted = [...rows].sort((a, b) => Number(b.stat_value) - Number(a.stat_value));

  for (const row of sorted) {
    const format = guessStatFormat(row.stat_key);
    const label = getStatDisplayName(row.stat_key);

    const line = document.createElement("div");

    line.className = "profile-stat-line";
    line.dataset.search = label.toLowerCase();

    line.innerHTML = `
      <span class="profile-stat-label">
        ${escapeHtml(label)}
      </span>

      <span class="profile-stat-value">
        ${escapeHtml(formatStatValue(format, row.stat_value))}
      </span>
    `;

    listEl.appendChild(line);
  }

  return sorted.length;
}

function getSortArrow(key) {
  if (statSort.key !== key) return "";
  return statSort.dir === "asc" ? " ▲" : " ▼";
}

function compareStatRows(a, b, key, dir) {
  if (key === "__label") {
    const cmp = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  }

  const va = a.values[key];
  const vb = b.values[key];
  const aMissing = va === undefined;
  const bMissing = vb === undefined;

  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  return dir === "asc" ? va - vb : vb - va;
}

function renderStatsTable(listEl, groupMap, columns) {
  const rows = [...groupMap.values()].filter((row) => row.label);

  if (!rows.length) {
    return 0;
  }

  if (statSort.key && (statSort.key === "__label" || columns.includes(statSort.key))) {
    rows.sort((a, b) => compareStatRows(a, b, statSort.key, statSort.dir));
  } else {
    rows.sort((a, b) => sumValues(b, columns) - sumValues(a, columns));
  }

  const table = document.createElement("table");

  table.className = "profile-stat-table";

  const thead = document.createElement("thead");

  thead.innerHTML = `
    <tr>
      <th class="profile-stat-table-label-header profile-stat-table-sortable" data-sort-key="__label">
        Item${getSortArrow("__label")}
      </th>

      ${columns
        .map(
          (prefix) => `
            <th class="profile-stat-table-sortable" data-sort-key="${escapeHtml(prefix)}">
              ${escapeHtml(STAT_PREFIX_LABELS[prefix] || titleCaseStatKey(prefix))}${getSortArrow(prefix)}
            </th>
          `,
        )
        .join("")}
    </tr>
  `;

  thead.addEventListener("click", (event) => {
    const th = event.target.closest(".profile-stat-table-sortable");

    if (!th) return;

    const key = th.dataset.sortKey;

    if (statSort.key === key) {
      statSort.dir = statSort.dir === "desc" ? "asc" : "desc";
    } else {
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

    tr.innerHTML = `
      <td class="profile-stat-table-label">
        <span>
          ${escapeHtml(row.label)}
        </span>
      </td>

      ${columns
        .map((prefix) => {
          const value = row.values[prefix];

          return `
            <td>
              ${value === undefined ? "-" : value.toLocaleString()}
            </td>
          `;
        })
        .join("")}
    `;

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  listEl.appendChild(table);

  return rows.length;
}

function sumValues(row, columns) {
  return columns.reduce((sum, prefix) => sum + (row.values[prefix] || 0), 0);
}

function applyStatSearch() {
  const query = $("#profileStatSearch").value.trim().toLowerCase();

  const rows = [...$("#profileStatsGrid").querySelectorAll("[data-search]")];

  let visibleCount = 0;

  for (const row of rows) {
    const match = !query || row.dataset.search.includes(query);

    row.hidden = !match;

    if (match) {
      visibleCount++;
    }
  }

  const noMatchEl = $("#profileStatsNoMatch");

  noMatchEl.hidden = !query || visibleCount > 0 || rows.length === 0;

  if (!noMatchEl.hidden) {
    noMatchEl.querySelector("span").textContent = query;
  }
}

async function renderTopBadges(player) {
  let summaryRow = null;

  try {
    const summary = await getTop1Summary();

    summaryRow = summary.find((row) => row.username?.toLowerCase() === player.username.toLowerCase()) ?? null;
  } catch (err) {
    console.error(err);
  }

  const wrap = $("#profileTopBadges");

  const keys = summaryRow?.top_in
    ? summaryRow.top_in
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
    : [];

  if (!keys.length) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }

  wrap.hidden = false;
  wrap.innerHTML = "";

  const summary = document.createElement("button");

  summary.type = "button";
  summary.className = "profile-top-summary";

  summary.innerHTML = `
    #1 in ${keys.length}
    categor${keys.length === 1 ? "y" : "ies"}
  `;

  const list = document.createElement("div");

  list.className = "profile-top-list";
  list.hidden = true;

  for (const key of keys) {
    const item = document.createElement("button");

    item.type = "button";
    item.className = "profile-top-item";

    item.innerHTML = `
      <span>
        ${escapeHtml(getStatDisplayName(key))}
      </span>

      <span class="profile-top-item-link">
        View leaderboard
      </span>
    `;

    item.addEventListener("click", () => {
      window.dispatchEvent(
        new CustomEvent("miaucraft:open-leaderboard", {
          detail: { key },
        }),
      );
    });

    list.appendChild(item);
  }

  summary.addEventListener("click", () => {
    list.hidden = !list.hidden;

    summary.classList.toggle("expanded", !list.hidden);
  });

  wrap.append(summary, list);
}

async function renderWaypoints(username) {
  let waypoints = [];
  let categories = [];

  try {
    [waypoints, categories] = await Promise.all([listWaypointsByUsername(username), listCategories()]);
  } catch (err) {
    console.error(err);
  }

  const listEl = $("#profileWaypointsList");

  listEl.innerHTML = "";

  $("#profileWaypointsEmpty").hidden = waypoints.length > 0;

  if (!waypoints.length) {
    return;
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  for (const waypoint of waypoints) {
    const category = categoryById.get(waypoint.category_id);

    const categoryBadge = category
      ? `
        <span
          class="category-badge"
          style="--badge-color: ${escapeHtml(category.color)}"
        >
          <i class="${escapeHtml(categoryIconClass(category.icon))}" aria-hidden="true"></i>
          <span>
            ${escapeHtml(category.name)}
          </span>
        </span>
      `
      : "";

    const dimensionColor = DIM_COLORS[waypoint.dimension] || "var(--text-muted)";

    const coords = formatCoordsForCopy(Math.round(waypoint.x), waypoint.y !== null && waypoint.y !== undefined ? Math.round(waypoint.y) : null, Math.round(waypoint.z));

    const row = document.createElement("div");

    row.className = "profile-waypoint-row";

    row.innerHTML = `
      <div class="profile-waypoint-top">
        <span class="profile-waypoint-name">
          ${escapeHtml(waypoint.name)}
        </span>

        <span
          class="players-dim-badge"
          style="--dim-badge-color: ${dimensionColor}"
        >
          ${escapeHtml(DIM_LABELS[waypoint.dimension] || waypoint.dimension)}
        </span>

        ${categoryBadge}
      </div>

      ${
        waypoint.description
          ? `
            <div class="profile-waypoint-desc">
              ${escapeHtml(waypoint.description)}
            </div>
          `
          : ""
      }

      <div class="profile-waypoint-bottom">
        <div class="profile-waypoint-coords">
          ${escapeHtml(coords)}
        </div>

        <button
          class="profile-waypoint-jump"
          type="button"
        >
          <i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> Jump to
        </button>
      </div>
    `;

    row.querySelector(".profile-waypoint-jump").addEventListener("click", () => {
      window.dispatchEvent(
        new CustomEvent("miaucraft:jump-to-waypoint", {
          detail: {
            id: waypoint.id,
            dimension: waypoint.dimension,
          },
        }),
      );
    });

    listEl.appendChild(row);
  }
}
