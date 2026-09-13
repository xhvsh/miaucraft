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
