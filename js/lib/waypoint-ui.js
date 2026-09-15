// One waypoint "card" building block, shared by the map sidebar list, the
// map pin tooltip, and the profile page's waypoints tab, so a waypoint looks
// and behaves the same everywhere instead of three slightly different
// hand-rolled markups. Callers build a plain options object; this module
// only returns an HTMLElement with data-action buttons already labelled -
// the caller wires up what each action does (jump/edit/delete/copy/image).
// The one exception is the top-right share button, which always just copies
// the waypoint's link, so it is labelled and wired here.

import { categoryIconClass } from "./waypoints.js";
import { escapeHtml, sanitizeColor, copyTextToClipboard } from "./ui.js";

export function categoryBadgeHtml(category) {
  if (!category) return "";
  return `<span class="category-badge" style="--badge-color:${sanitizeColor(category.color)}"><i class="${escapeHtml(categoryIconClass(category.icon))}" aria-hidden="true"></i>${escapeHtml(category.name)}</span>`;
}

export function visibilityBadgeHtml(visibility) {
  if (visibility !== "private") return "";
  return `<span class="waypoint-visibility-badge" title="Only you can see this waypoint"><i class="fa-solid fa-lock" aria-hidden="true"></i>Private</span>`;
}

export function galleryTileHtml(image, { canDelete = false, onDelete = null, canSetDisplay = false, isDisplay = false, onSetDisplay = null } = {}) {
  const tile = document.createElement("div");
  tile.className = `waypoint-gallery-tile${isDisplay ? " waypoint-gallery-tile--display" : ""}`;
  tile.innerHTML = `
    <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.caption || "Waypoint screenshot")}" loading="lazy" />
    ${image.caption ? `<span class="waypoint-gallery-caption">${escapeHtml(image.caption)}</span>` : ""}
    ${canSetDisplay ? `<button type="button" class="waypoint-gallery-star icon-btn${isDisplay ? " active" : ""}" aria-label="${isDisplay ? "Clear display image" : "Set as display image"}"><i class="fa-solid fa-star" aria-hidden="true"></i></button>` : ""}
    ${canDelete ? `<button type="button" class="waypoint-gallery-delete icon-btn icon-btn--danger" aria-label="Delete screenshot"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>` : ""}
  `;
  tile.querySelector("img").addEventListener("click", () => {
    const lightbox = document.getElementById("imageLightbox");
    if (lightbox) {
      const img = document.getElementById("imageLightboxImg");
      img.src = image.url;
      img.alt = image.caption || "Waypoint screenshot";
      lightbox.hidden = false;
    }
  });
  tile.querySelector(".waypoint-gallery-star")?.addEventListener("click", (e) => {
    e.stopPropagation();
    onSetDisplay?.(image);
  });
  tile.querySelector(".waypoint-gallery-delete")?.addEventListener("click", (e) => {
    e.stopPropagation();
    onDelete?.(image);
  });
  return tile;
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
  positionCategoryFilterMenu(root);
}

// On phones the page-level dropdown lives inside .app-shell, which is below the
// fixed bottom-nav in stacking order, so a menu that extends past the nav gets
// covered and its lower options become unreachable. Flip the menu upward when
// there isn't room below it, and clamp its height to stay clear of the nav.
function positionCategoryFilterMenu(root) {
  root.classList.remove("category-filter--up");
  root.querySelector(".category-filter-menu").style.maxHeight = "";
  if (!window.matchMedia("(max-width: 860px)").matches) return;

  const docStyle = getComputedStyle(document.documentElement);
  const navH = parseFloat(docStyle.getPropertyValue("--bottom-nav-h")) || 64;
  const safeB = parseFloat(docStyle.getPropertyValue("--safe-b")) || 0;
  const clearance = navH + safeB + 12;
  const rect = root.getBoundingClientRect();
  const menu = root.querySelector(".category-filter-menu");
  const menuH = Math.min(menu.offsetHeight, 240);
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  if (spaceBelow - clearance < menuH && spaceAbove > spaceBelow) {
    root.classList.add("category-filter--up");
    menu.style.maxHeight = `${Math.max(80, Math.min(240, spaceAbove - 12))}px`;
  } else {
    menu.style.maxHeight = `${Math.max(80, Math.min(240, spaceBelow - clearance))}px`;
  }
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
  const cleanColor = sanitizeColor(color);
  const colored = Boolean(color);
  const chipStyle = colored ? ` style="background:color-mix(in srgb, ${cleanColor} 18%, transparent);color:${cleanColor}"` : "";
  const labelStyle = colored ? ` style="color:${cleanColor}"` : "";
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
 * Dimension filter for the waypoint list - the same segmented switch (`.dim-tabs`
 * / `.dim-tab`) used on the map page. Exactly one dimension is active; clicking
 * the active one clears the filter ("" = all dimensions).
 * @param {object} opts
 * @param {string} [opts.selected] - current value: "" = all dimensions
 * @param {string} [opts.ariaLabel]
 * @param {(value: string) => void} [opts.onChange]
 */
export function buildDimensionFilter({ selected = "", ariaLabel = "Filter dimensions", onChange = () => {} } = {}) {
  const dims = [
    { value: "overworld", label: "Overworld" },
    { value: "nether", label: "Nether" },
    { value: "end", label: "End" },
  ];

  const root = document.createElement("div");
  root.className = "dim-tabs";
  root.setAttribute("role", "tablist");
  root.setAttribute("aria-label", ariaLabel);

  const buttons = dims.map((def) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dim-tab";
    btn.dataset.dim = def.value;
    btn.dataset.active = String(selected === def.value);
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(selected === def.value));
    btn.textContent = def.label;
    btn.addEventListener("click", () => {
      const value = selected === def.value ? "" : def.value;
      selected = value;
      for (const b of buttons) {
        const on = b.dataset.dim === def.value && value !== "";
        b.dataset.active = String(on);
        b.setAttribute("aria-selected", String(on));
      }
      onChange(value);
    });
    root.appendChild(btn);
    return btn;
  });

  root.setValue = (value) => {
    selected = value;
    for (const b of buttons) {
      const on = b.dataset.dim === value && value !== "";
      b.dataset.active = String(on);
      b.setAttribute("aria-selected", String(on));
    }
  };

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

  const color = sanitizeColor(wp.color || "#9683e0");
  const dotHtml = `<span class="waypoint-card-dot" style="background:${color};color:${color}"></span>`;
  const copyBtnHtml = `<button type="button" class="icon-btn" style="width:22px;height:22px;font-size:10px" title="Copy coordinates" aria-label="Copy coordinates" data-action="copy"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>`;
  const shareBtnHtml = `<button type="button" class="icon-btn waypoint-card-share" style="width:28px;height:28px;font-size:13px" title="Copy waypoint link" aria-label="Copy waypoint link" data-action="share"><i class="fa-solid fa-link" aria-hidden="true"></i></button>`;
  const shareUrl = `${window.location.origin}/?dim=${encodeURIComponent(wp.dimension || "")}&wp=${encodeURIComponent(wp.id ?? "")}`;
  const wireShareButton = (cardEl) => {
    cardEl.querySelector('[data-action="share"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      copyTextToClipboard(shareUrl, e.currentTarget);
    });
  };
  const actionsHtml = actions.length
    ? `<div class="waypoint-card-actions">${actions
        .map((a) => {
          const iconOnly = Boolean(a.iconOnly);
          const btnClass = `${a.variant === "danger" ? "btn-danger" : "btn-ghost"} btn-sm${iconOnly ? " waypoint-card-action-end" : ""}`;
          const inner = iconOnly
            ? `<i class="fa-solid ${escapeHtml(a.icon)}" aria-hidden="true"></i>`
            : `${a.icon ? `<i class="fa-solid ${escapeHtml(a.icon)}" aria-hidden="true"></i> ` : ""}${escapeHtml(a.label)}`;
          const a11y = iconOnly ? ` aria-label="${escapeHtml(a.label)}" title="${escapeHtml(a.label)}"` : "";
          return `<button type="button" class="btn ${btnClass}" data-action="${escapeHtml(a.action)}"${a11y}>${inner}</button>`;
        })
        .join("")}</div>`
    : "";
  const dimBadgeHtml = dimensionBadge ? `<span class="players-dim-badge" style="--dim-badge-color:${sanitizeColor(dimensionBadge.color)}">${escapeHtml(dimensionBadge.label)}</span>` : "";
  const metaHtml = `<div class="waypoint-card-meta">
      ${visibilityBadgeHtml(wp.visibility)}
      ${categoryBadgeHtml(category)}
      ${author ? `<span class="waypoint-card-author">${escapeHtml(author)}</span>` : ""}
    </div>`;

  const card = document.createElement("div");

  // horizontal "row" variant - the profile waypoints tab lays the info out in
  // two compact rows instead of stacking it vertically (dimension + category
  // on the right, coords + jump on the bottom). nether/overworld conversion
  // coords are never shown here, even when the user has them enabled.
  if (variant === "row") {
    card.className = "waypoint-card waypoint-card--row";
    card.innerHTML = `
      <div class="waypoint-card-row-top">
        ${dotHtml}
        <span class="waypoint-card-name">${escapeHtml(wp.name)}</span>
        <span class="waypoint-card-meta waypoint-card-meta--right">
          ${dimBadgeHtml}
          ${visibilityBadgeHtml(wp.visibility)}
          ${categoryBadgeHtml(category)}
        </span>
      </div>
      <div class="waypoint-card-row-bottom">
        ${wp.description ? `<span class="waypoint-card-desc waypoint-card-desc--row">${escapeHtml(wp.description)}</span>` : ""}
        <span class="waypoint-card-coords waypoint-card-coords--row${wp.description ? "" : " waypoint-card-coords--push"}"><span>${escapeHtml(coordsText)}</span>${copyBtnHtml}</span>
        ${actionsHtml}
      </div>
    `;
    return card;
  }

  card.className = variant === "compact" ? "waypoint-card waypoint-card--compact" : "waypoint-card";

  card.innerHTML = `
    <div class="waypoint-card-top">
      ${dotHtml}
      <span class="waypoint-card-name">${escapeHtml(wp.name)}</span>
      ${dimBadgeHtml}
      ${shareBtnHtml}
    </div>
    ${wp.description ? `<div class="waypoint-card-desc">${escapeHtml(wp.description)}</div>` : ""}
    ${image ? `<img class="waypoint-card-image" src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy" title="Click to enlarge" data-action="image" />` : ""}
    <div class="waypoint-card-coords" style="margin-top:6px;display:flex;align-items:center;gap:6px">
      <span>${escapeHtml(coordsText)}</span>
      ${copyBtnHtml}
    </div>
    ${conversionText ? `<div class="waypoint-card-coords">${escapeHtml(conversionText)}</div>` : ""}
    ${metaHtml}
    ${actionsHtml}
  `;
  wireShareButton(card);

  return card;
}
