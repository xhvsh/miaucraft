// One waypoint "card" building block, shared by the map sidebar list, the
// map pin tooltip, and the profile page's waypoints tab, so a waypoint looks
// and behaves the same everywhere instead of three slightly different
// hand-rolled markups. Callers build a plain options object; this module
// only returns an HTMLElement with data-action buttons already labelled -
// the caller wires up what each action does (jump/edit/delete/copy/image).

import { categoryIconClass } from "./waypoints.js";
import { escapeHtml } from "./ui.js";

export function categoryBadgeHtml(category) {
  if (!category) return "";
  return `<span class="category-badge" style="--badge-color:${escapeHtml(category.color)}"><i class="${escapeHtml(categoryIconClass(category.icon))}" aria-hidden="true"></i>${escapeHtml(category.name)}</span>`;
}

// The custom category dropdown used by the waypoint-list filters on the map
// sidebar and the profile page. Renders each option as a badge-style row
// (colored icon chip + name, like .category-badge) instead of a native
// <select>, so category colors/icons actually survive the dropdown.
const openCategoryFilters = [];

function closeCategoryFilterMenu(root) {
  root.querySelector(".category-filter-menu").hidden = true;
  root.querySelector(".category-filter-trigger").setAttribute("aria-expanded", "false");
  const idx = openCategoryFilters.indexOf(root);
  if (idx !== -1) openCategoryFilters.splice(idx, 1);
}

function openCategoryFilterMenu(root) {
  root.querySelector(".category-filter-menu").hidden = false;
  root.querySelector(".category-filter-trigger").setAttribute("aria-expanded", "true");
  if (!openCategoryFilters.includes(root)) openCategoryFilters.push(root);
}

document.addEventListener("click", (e) => {
  for (const root of [...openCategoryFilters]) {
    if (!root.contains(e.target)) closeCategoryFilterMenu(root);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    for (const root of [...openCategoryFilters]) closeCategoryFilterMenu(root);
  }
});

function categoryFilterPillInner(name, iconClass, color) {
  const colored = Boolean(color);
  const chipStyle = colored ? ` style="background:color-mix(in srgb, ${escapeHtml(color)} 18%, transparent);color:${escapeHtml(color)}"` : "";
  const labelStyle = colored ? ` style="color:${escapeHtml(color)}"` : "";
  return `<span class="category-pill-icon${colored ? "" : " category-pill-icon--none"}"${chipStyle}><i class="${escapeHtml(iconClass)}" aria-hidden="true"></i></span><span class="category-pill-label"${labelStyle}>${escapeHtml(name)}</span>`;
}

/**
 * Category filter dropdown for the waypoint list.
 * @param {object} opts
 * @param {Array<{id:string,name:string,color:string,icon:string}>} [opts.categories]
 * @param {string} [opts.selected] - current value: "" = all, "__none__" = uncategorized
 * @param {boolean} [opts.includeUncategorized]
 * @param {string} [opts.allLabel]
 * @param {string} [opts.uncategorizedLabel]
 * @param {string} [opts.ariaLabel]
 * @param {(value: string) => void} [opts.onChange]
 */
export function buildCategoryFilter({ categories = [], selected = "", includeUncategorized = false, allLabel = "All categories", uncategorizedLabel = "Uncategorized", ariaLabel = "Filter categories", onChange = () => {} }) {
  const root = document.createElement("div");
  root.className = "category-filter";
  root.setAttribute("aria-label", ariaLabel);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "category-filter-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const triggerPill = document.createElement("span");
  triggerPill.className = "category-pill";
  trigger.appendChild(triggerPill);
  trigger.insertAdjacentHTML("beforeend", '<i class="fa-solid fa-chevron-down category-filter-chevron" aria-hidden="true"></i>');

  const menu = document.createElement("div");
  menu.className = "category-filter-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  root.appendChild(trigger);
  root.appendChild(menu);

  const optionDefs = [
    { value: "", label: allLabel, icon: "fa-solid fa-border-all", color: null },
    ...categories.map((cat) => ({ value: cat.id, label: cat.name, icon: categoryIconClass(cat.icon), color: cat.color })),
  ];
  if (includeUncategorized) optionDefs.push({ value: "__none__", label: uncategorizedLabel, icon: "fa-solid fa-ban", color: null });

  function setSelected(value) {
    selected = value;
    for (const btn of optionButtons) btn.setAttribute("aria-selected", String(btn.dataset.value === value));
    refreshTrigger();
    closeCategoryFilterMenu(root);
    onChange(value);
  }

  function refreshTrigger() {
    const def = optionDefs.find((d) => d.value === selected) || optionDefs[0];
    triggerPill.innerHTML = categoryFilterPillInner(def.label, def.icon, def.color);
  }

  const optionButtons = optionDefs.map((def) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-filter-option";
    btn.dataset.value = def.value;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(selected === def.value));
    btn.innerHTML = categoryFilterPillInner(def.label, def.icon, def.color);
    btn.addEventListener("click", () => setSelected(def.value));
    menu.appendChild(btn);
    return btn;
  });

  refreshTrigger();
  trigger.addEventListener("click", () => (menu.hidden ? openCategoryFilterMenu(root) : closeCategoryFilterMenu(root)));

  return root;
}

/**
 * @param {object} wp - waypoint row (name, description, color, x, y, z)
 * @param {object} opts
 * @param {"list"|"compact"} [opts.variant] - "compact" for the map tooltip
 * @param {object|null} [opts.category] - category row, or null
 * @param {string} opts.coordsText - already-formatted coordinate string
 * @param {string} [opts.conversionText] - optional "Nether: x ..." line
 * @param {{label:string,color:string}|null} [opts.dimensionBadge] - shown on profile cards
 * @param {string} [opts.author] - "by username"
 * @param {{src:string,alt:string}|null} [opts.image] - reference image
 * @param {Array<{action:string,label:string,variant?:"ghost"|"danger",icon?:string}>} [opts.actions]
 */
export function buildWaypointCard(wp, opts = {}) {
  const { variant = "list", category = null, coordsText, conversionText = "", dimensionBadge = null, author = "", image = null, actions = [] } = opts;

  const card = document.createElement("div");
  card.className = variant === "compact" ? "waypoint-card waypoint-card--compact" : "waypoint-card";

  const actionsHtml = actions.length
    ? `<div class="waypoint-card-actions">${actions
        .map((a) => `<button type="button" class="btn ${a.variant === "danger" ? "btn-danger" : "btn-ghost"} btn-sm" data-action="${escapeHtml(a.action)}">${a.icon ? `<i class="fa-solid ${escapeHtml(a.icon)}" aria-hidden="true"></i> ` : ""}${escapeHtml(a.label)}</button>`)
        .join("")}</div>`
    : "";

  card.innerHTML = `
    <div class="waypoint-card-top">
      <span class="waypoint-card-dot" style="background:${escapeHtml(wp.color)};color:${escapeHtml(wp.color)}"></span>
      <span class="waypoint-card-name">${escapeHtml(wp.name)}</span>
      ${dimensionBadge ? `<span class="players-dim-badge" style="--dim-badge-color:${escapeHtml(dimensionBadge.color)}">${escapeHtml(dimensionBadge.label)}</span>` : ""}
    </div>
    ${wp.description ? `<div class="waypoint-card-desc">${escapeHtml(wp.description)}</div>` : ""}
    ${image ? `<img class="waypoint-card-image" src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy" title="Click to enlarge" data-action="image" />` : ""}
    <div class="waypoint-card-coords" style="margin-top:6px;display:flex;align-items:center;gap:6px">
      <span>${escapeHtml(coordsText)}</span>
      <button type="button" class="icon-btn" style="width:22px;height:22px;font-size:10px" title="Copy coordinates" aria-label="Copy coordinates" data-action="copy"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>
    </div>
    ${conversionText ? `<div class="waypoint-card-coords">${escapeHtml(conversionText)}</div>` : ""}
    <div class="waypoint-card-meta">
      ${categoryBadgeHtml(category)}
      ${author ? `<span class="waypoint-card-author">${escapeHtml(author)}</span>` : ""}
    </div>
    ${actionsHtml}
  `;

  return card;
}
