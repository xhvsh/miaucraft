import { listPlayerStats, listStatKeys, listDistanceLeaderboard } from "../lib/live.js";
import { PRESET_STATS, getStatDisplayName, formatStatValue } from "../lib/statPresets.js";
import { escapeHtml } from "../lib/ui.js";
import { initNav } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

await initNav("leaderboards");

const leaderboardStatChipsEl = $("#leaderboardStatChips");
const leaderboardCustomInputEl = $("#leaderboardCustomInput");
const leaderboardStatTitleEl = $("#leaderboardStatTitle");
const statPickerEl = $("#statPicker");
const statPickerMenuEl = $("#statPickerMenu");
const leaderboardListEl = $("#leaderboardList");
const leaderboardEmptyEl = $("#leaderboardEmpty");
const leaderboardLoadingEl = $("#leaderboardLoading");

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
let allStatKeys = [];
let leaderboardCustomDebounce = null;
let statPickerHighlighted = -1;

function renderLeaderboardChips() {
  leaderboardStatChipsEl.innerHTML = "";
  for (const stat of PRESET_STATS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.active = String(activeLeaderboardStatId === stat.id);
    chip.innerHTML = `<span>${escapeHtml(stat.label)}</span>`;
    chip.addEventListener("click", () => selectLeaderboardStat(stat.id));
    leaderboardStatChipsEl.appendChild(chip);
  }
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
    if (preset.aggregateCm) loadLeaderboard(() => listDistanceLeaderboard(10), preset.format);
    else loadLeaderboard(() => listPlayerStats(preset.keys, 10), preset.format);
  }
}

async function ensureStatKeysLoaded() {
  if (statKeysLoaded) return;
  try {
    const keys = await listStatKeys();
    allStatKeys = keys.map((k) => {
      const rawKey = k.stat_key.trim();
      const name = getStatDisplayName(rawKey);
      const aliasTerms = STAT_ALIAS_TERMS.filter((a) => rawKey.toUpperCase().includes(a.match)).flatMap((a) => a.terms);
      const rawWords = rawKey.replace(/[_:\s]+/g, " ").trim();
      const search = `${name} ${rawWords} ${aliasTerms.join(" ")}`.toLowerCase();
      const searchCompact = search.replace(/[^a-z0-9]/g, "");
      return { key: k.stat_key, name, search, searchCompact };
    });
    allStatKeys.sort((a, b) => a.name.localeCompare(b.name));
    statKeysLoaded = true;
  } catch (err) {
    console.error(err);
  }
}

const STAT_PICKER_RENDER_LIMIT = 50;

function highlightMatch(text, tokens) {
  if (!tokens.length) return escapeHtml(text);
  const ranges = [];
  const lower = text.toLowerCase();
  for (const t of tokens) {
    let from = 0,
      idx;
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
  let result = "",
    cursor = 0;
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
  const matches = tokens.length === 0 ? allStatKeys : allStatKeys.filter((s) => tokens.every((t) => s.search.includes(t) || s.searchCompact.includes(t.replace(/[^a-z0-9]/g, ""))));

  statPickerMenuEl.innerHTML = "";
  statPickerHighlighted = -1;

  if (matches.length === 0) {
    statPickerMenuEl.innerHTML = `<div class="stat-picker-empty">${statKeysLoaded ? "No matching statistic." : "Loading statistics…"}</div>`;
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
  statPickerOptionEls().forEach((opt, idx) => {
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
  if (activeLeaderboardStatId !== "custom") {
    activeLeaderboardStatId = "custom";
    renderLeaderboardChips();
    leaderboardStatTitleEl.textContent = leaderboardCustomInputEl.value.trim() ? getStatDisplayName(leaderboardCustomInputEl.value.trim()) : "";
  }
  await ensureStatKeysLoaded();
  renderStatPickerOptions(leaderboardCustomInputEl.value);
  openStatPicker();
});

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
    if (!options.length) return;
    statPickerHighlighted = Math.min(statPickerHighlighted + 1, options.length - 1);
    updateStatPickerHighlight();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!options.length) return;
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

let leaderboardRequestId = 0;
async function loadLeaderboard(fetchRows, format) {
  const requestId = ++leaderboardRequestId;
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
  if (requestId !== leaderboardRequestId) return;
  leaderboardLoadingEl.hidden = true;
  leaderboardEmptyEl.hidden = rows.length > 0;
  rows.forEach((row, index) => leaderboardListEl.appendChild(buildLeaderboardRow(row, index + 1, format)));
}

function buildLeaderboardRow(row, rank, format) {
  const item = document.createElement("div");
  item.className = "leaderboard-row";
  item.dataset.rank = rank <= 3 ? String(rank) : "other";
  const username = row.players?.username ?? "Unknown";
  item.innerHTML = `
    <span class="leaderboard-rank">#${rank}</span>
    <img class="leaderboard-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(username)}/64" alt="" width="28" height="28" />
    <button class="leaderboard-username" type="button" data-username="${escapeHtml(username)}">${escapeHtml(username)}</button>
    <span class="leaderboard-value">${escapeHtml(formatStatValue(format, row.stat_value))}</span>
  `;
  return item;
}

leaderboardListEl.addEventListener("click", (e) => {
  const nameBtn = e.target.closest(".leaderboard-username");
  if (nameBtn) window.location.href = `/profile?user=${encodeURIComponent(nameBtn.dataset.username)}`;
});

function consumeDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("lb") ?? params.get("stat");
  if (!value) return null;
  window.history.replaceState({}, "", "/leaderboards");
  return value.trim();
}

function initFromDeepLink(value) {
  const preset = PRESET_STATS.find((s) => s.id === value) ?? PRESET_STATS.find((s) => s.keys?.includes(value));
  if (preset) {
    selectLeaderboardStat(preset.id);
    return;
  }
  activeLeaderboardStatId = "custom";
  renderLeaderboardChips();
  leaderboardCustomInputEl.value = value;
  leaderboardStatTitleEl.textContent = getStatDisplayName(value);
  loadLeaderboard(() => listPlayerStats([value], 10), "count");
}

renderLeaderboardChips();
const deepLinked = consumeDeepLink();
if (deepLinked) initFromDeepLink(deepLinked);
else selectLeaderboardStat(activeLeaderboardStatId);
