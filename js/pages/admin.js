import * as Auth from "../lib/auth.js";
import { createCategory, updateCategory, deleteCategory, listCategories, categoryIconClass, sanitizeIconClass, invalidateCategoriesCache } from "../lib/waypoints.js";
import { listWhitelist, subscribeWhitelist, requestWhitelistAdd, requestWhitelistRemove, listPendingWhitelistCommands, subscribeWhitelistCommands, cancelWhitelistCommand, listAccessCodes, accessCodeExists, createAccessCode, updateAccessCodeRole, deleteAccessCode } from "../lib/live.js";
import { escapeHtml, toast, confirmAction, debounce, sanitizeColor, copyTextToClipboard } from "../lib/ui.js";
import { initNav } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

await initNav("admin");

let booted = false;
let categories = [];
let editingCategory = null;
let users = [];
let whitelistLoaded = false;
let categoriesLoaded = false;

function isOwner() {
  return Auth.role() === "owner";
}

function refreshAdminAccess() {
  const loggedIn = Auth.isLoggedIn();
  const role = Auth.role();
  const allowed = loggedIn && (role === "owner" || role === "admin");
  $("#adminSignedOut").hidden = loggedIn;
  $("#adminNoAccess").hidden = loggedIn ? role === "owner" || role === "admin" : true;
  $("#adminBody").hidden = !allowed;
  if (allowed) boot();
}

async function boot() {
  if (booted) return;
  booted = true;
  setupTabs();
  showAdminTabsForRole();
  showAdminTab(firstVisibleTab() || "whitelist");
  loadCategories();
  loadWhitelistPanel();
  loadUsersPanel();
  loadAccessCodesPanel();
  consumeAdminParams();
  setupWhitelistRealtime();
}

function setupWhitelistRealtime() {
  subscribeWhitelist(() => {
    clearTimeout(loadWhitelistPanel._wlDebounce);
    loadWhitelistPanel._wlDebounce = setTimeout(loadWhitelistPanel, 300);
  });
  subscribeWhitelistCommands((payload) => {
    if (payload.eventType === "UPDATE" && payload.new.status === "failed") {
      const verb = payload.new.action === "remove" ? "remove" : "add";
      toast(`Could not ${verb} "${payload.new.username}" - the command failed on the server.`, "error");
    }
    clearTimeout(loadWhitelistPanel._wlDebounce);
    loadWhitelistPanel._wlDebounce = setTimeout(loadWhitelistPanel, 300);
  });
}

refreshAdminAccess();
Auth.onAuthChange(() => refreshAdminAccess());

// ---------- tabs (visibility per role) ----------

function showAdminTabsForRole() {
  const visibility = {
    whitelist: Auth.can("manageWhitelist"),
    users: Auth.can("manageCategories"),
    categories: Auth.can("manageCategories"),
    accesscodes: Auth.can("viewAccessCodes"),
  };
  for (const btn of $("#adminTabs").querySelectorAll(".tab")) {
    btn.hidden = !visibility[btn.dataset.tab];
  }
}

function firstVisibleTab() {
  return [...$("#adminTabs").querySelectorAll(".tab")].find((b) => !b.hidden)?.dataset.tab;
}

function setupTabs() {
  $("#adminTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || btn.hidden) return;
    showAdminTab(btn.dataset.tab);
  });
}

function showAdminTab(tab) {
  for (const btn of $("#adminTabs").querySelectorAll(".tab")) btn.dataset.active = String(btn.dataset.tab === tab);
  $("#adminWhitelistPanel").hidden = tab !== "whitelist";
  $("#adminUsersPanel").hidden = tab !== "users";
  $("#adminCategoriesPanel").hidden = tab !== "categories";
  $("#adminAccessCodesPanel").hidden = tab !== "accesscodes";
}

// after landing from a logs link like /admin?tab=categories&name=...
function consumeAdminParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.size === 0) return;
  window.history.replaceState({}, "", window.location.pathname);
  const tab = params.get("tab");
  if (tab && ["whitelist", "users", "categories", "accesscodes"].includes(tab)) showAdminTab(tab);
  if (tab === "categories" && params.has("name")) prefillCategoryForm(params);
}

function prefillCategoryForm(params) {
  editingCategory = null;
  $("#catId").value = "";
  $("#catName").value = params.get("name") || "";
  $("#catColor").value = params.get("color") || "#9683e0";
  $("#catIcon").value = params.get("icon") || "";
  updateCategoryIconPreview();
  $("#catSubmitBtn").textContent = "Add category";
  $("#catCancelEditBtn").hidden = true;
  $("#categoryFormTitle").textContent = "Add category";
  $("#catName").focus();
}

// ---------- whitelist ----------

async function loadWhitelistPanel() {
  if (!Auth.can("manageWhitelist")) return;
  if (!whitelistLoaded) $("#whitelistSkeleton").hidden = false;
  try {
    const [entries, pending] = await Promise.all([listWhitelist(), listPendingWhitelistCommands()]);
    whitelistLoaded = true;
    $("#whitelistSkeleton").hidden = true;
    renderWhitelist(entries, pending);
  } catch (err) {
    whitelistLoaded = true;
    $("#whitelistSkeleton").hidden = true;
    console.error(err);
    $("#whitelistList").innerHTML = "";
    $("#whitelistEmpty").hidden = false;
    $("#whitelistEmpty").querySelector("span").textContent = "Could not load whitelist.";
  }
}

function renderWhitelist(entries, pending) {
  const listEl = $("#whitelistList");
  listEl.innerHTML = "";
  $("#whitelistEmpty").hidden = entries.length + pending.length > 0;

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "whitelist-row";
    row.dataset.search = entry.username.toLowerCase();
    row.innerHTML = `
      <img class="whitelist-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(entry.username)}/64" alt="" width="22" height="22" loading="lazy" />
      <span class="whitelist-username">${escapeHtml(entry.username)}</span>
      <button class="icon-btn icon-btn--danger" data-username="${escapeHtml(entry.username)}" title="Remove" aria-label="Remove ${escapeHtml(entry.username)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      const ok = await confirmAction(`"${entry.username}" will be removed from the server's whitelist within a few seconds.`, { title: "Remove from whitelist?" });
      if (!ok) return;
      try {
        await requestWhitelistRemove(entry.username);
        toast("Requested - applies within a few seconds.", "success");
        loadWhitelistPanel();
      } catch (err) {
        toast(err.message || "Could not request removal.", "error");
      }
    });
    listEl.appendChild(row);
  }

  for (const cmd of pending) {
    const row = document.createElement("div");
    row.className = "whitelist-row whitelist-row--pending";
    row.dataset.search = cmd.username.toLowerCase();
    row.innerHTML = `
      <img class="whitelist-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(cmd.username)}/64" alt="" width="22" height="22" loading="lazy" />
      <span class="whitelist-username">${escapeHtml(cmd.username)}</span>
      <button class="icon-btn" title="Cancel request" aria-label="Cancel request for ${escapeHtml(cmd.username)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      const ok = await confirmAction("The pending whitelist request will be canceled.", { title: "Cancel request?" });
      if (!ok) return;
      try {
        await cancelWhitelistCommand(cmd.id);
        toast("Request canceled.", "success");
        loadWhitelistPanel();
      } catch (err) {
        toast(err.message || "Could not cancel request.", "error");
      }
    });
    listEl.appendChild(row);
  }
  applyWhitelistSearch();
}

function applyWhitelistSearch() {
  const query = $("#whitelistSearch").value.trim().toLowerCase();
  const rows = $("#whitelistList").querySelectorAll("[data-search]");
  for (const row of rows) row.hidden = query ? !row.dataset.search.includes(query) : false;
}
$("#whitelistSearch").addEventListener("input", debounce(applyWhitelistSearch, 150));

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

// ---------- website users ----------

async function loadUsersPanel() {
  if (!Auth.can("manageCategories")) return;
  const errorEl = $("#usersTableError");
  errorEl.hidden = true;
  try {
    users = await Auth.listProfiles();
    renderUsers();
  } catch (err) {
    console.error(err);
    users = [];
    errorEl.querySelector("span").textContent = err.message || "Could not load accounts.";
    errorEl.hidden = false;
    $("#usersTableBody").innerHTML = "";
  }
}

const USER_ROLES = ["owner", "admin", "user"];
const openRoleMenus = [];

function closeRoleMenu(root) {
  const menu = root.querySelector(".users-role-menu");
  const trigger = root.querySelector(".users-role-trigger");
  if (menu) menu.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  const idx = openRoleMenus.indexOf(root);
  if (idx !== -1) openRoleMenus.splice(idx, 1);
}

function positionRoleMenu(root) {
  const menu = root.querySelector(".users-role-menu");
  const trigger = root.querySelector(".users-role-trigger");
  const wrap = root.closest(".users-table-wrap");
  const wrapRect = wrap ? wrap.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const triggerRect = trigger.getBoundingClientRect();
  const spaceBelow = wrapRect.bottom - triggerRect.bottom;
  const spaceAbove = triggerRect.top - wrapRect.top;
  const needsUp = spaceBelow < menu.offsetHeight + 8 && spaceAbove >= menu.offsetHeight + 8;
  root.classList.toggle("users-role-select--up", needsUp);
}

function openRoleMenu(root) {
  root.querySelector(".users-role-menu").hidden = false;
  root.querySelector(".users-role-trigger").setAttribute("aria-expanded", "true");
  if (!openRoleMenus.includes(root)) openRoleMenus.push(root);
  positionRoleMenu(root);
}

function toggleRoleMenu(root) {
  if (openRoleMenus.includes(root)) {
    closeRoleMenu(root);
  } else {
    for (const m of [...openRoleMenus]) closeRoleMenu(m);
    openRoleMenu(root);
  }
}

function roleBadgeHtml(role) {
  const safe = USER_ROLES.includes(role) ? role : "user";
  return `<span class="users-role role-${safe}">${escapeHtml(safe)}</span>`;
}

function buildRoleSelect(profileId, currentRole) {
  const safeRole = USER_ROLES.includes(currentRole) ? currentRole : "user";
  const root = document.createElement("div");
  root.className = "users-role-select";
  root.dataset.roleSelect = profileId;
  root.dataset.roleValue = safeRole;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "users-role-trigger";
  trigger.dataset.roleTrigger = "";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `${roleBadgeHtml(safeRole)}<i class="fa-solid fa-chevron-down users-role-chevron" aria-hidden="true"></i>`;

  const menu = document.createElement("div");
  menu.className = "users-role-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  menu.innerHTML = USER_ROLES.map(
    (r) => `<button type="button" class="users-role-option" role="option" data-role-option="${r}" aria-selected="${safeRole === r}">${roleBadgeHtml(r)}</button>`,
  ).join("");

  root.appendChild(trigger);
  root.appendChild(menu);
  return root;
}

async function applyRoleSelection(root, role) {
  if (!USER_ROLES.includes(role) || role === root.dataset.roleValue) {
    closeRoleMenu(root);
    return;
  }
  const profileId = root.dataset.roleSelect;
  const trigger = root.querySelector(".users-role-trigger");
  closeRoleMenu(root);
  trigger.disabled = true;
  try {
    await Auth.updateUserRole(profileId, role);
    toast("Role updated.", "success");
    await loadUsersPanel();
  } catch (err) {
    trigger.disabled = false;
    toast(err.message || "Could not update role.", "error");
    loadUsersPanel();
  }
}

document.addEventListener("click", (e) => {
  const root = e.target.closest("[data-role-select]");
  if (root) {
    if (e.target.closest("[data-role-trigger]")) {
      toggleRoleMenu(root);
    } else if (e.target.closest("[data-role-option]")) {
      applyRoleSelection(root, e.target.closest("[data-role-option]").dataset.roleOption);
    }
    return;
  }
  for (const m of [...openRoleMenus]) closeRoleMenu(m);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    for (const m of [...openRoleMenus]) closeRoleMenu(m);
    closeAccessCodeMenus();
  }
});

function rowMatchesSearch(u) {
  const q = $("#usersSearch").value.trim().toLowerCase();
  if (!q) return true;
  return (u.username || "").toLowerCase().includes(q) || (u.role || "").toLowerCase().includes(q);
}

function buildUserRow(u) {
  const me = Auth.getState()?.profile?.username?.toLowerCase();
  const tr = document.createElement("tr");
  tr.dataset.username = (u.username || "").toLowerCase();
  tr.dataset.profileId = u.id || "";
  const username = (u.username || "").toLowerCase();
  const isSelf = me && me === username;
  const isProtected = isSelf || username === "xhvsh";
  const canEdit = isOwner() && !isProtected;
  const userRole = (u.role || "user").toLowerCase();

  let roleCell;
  if (canEdit) {
    roleCell = buildRoleSelect(u.id || "", userRole).outerHTML;
  } else {
    const safeRole = USER_ROLES.includes(userRole) ? userRole : "user";
    roleCell = `<span class="users-role role-${safeRole}">${escapeHtml(safeRole)}</span>`;
  }

  let actionCell = "";
  if (canEdit) {
    const editBtn = `<button class="icon-btn users-edit-btn" data-edit-username="${escapeHtml(u.username || "")}" title="Edit username" aria-label="Edit username for ${escapeHtml(u.username || "")}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>`;
    const revokeBtn = `<button class="icon-btn icon-btn--danger" data-revoke="${escapeHtml(u.username || "")}" title="Revoke (delete account)" aria-label="Revoke ${escapeHtml(u.username || "")}"><i class="fa-solid fa-user-xmark" aria-hidden="true"></i></button>`;
    actionCell = `<div class="users-actions">${editBtn}${revokeBtn}</div>`;
  }

  const discordCell = u.discord_username
    ? `<td class="users-discord-cell"><span class="users-discord" title="Discord connected"><i class="fa-brands fa-discord" aria-hidden="true"></i>${escapeHtml(u.discord_username)}</span></td>`
    : `<td class="users-discord-cell"><span class="users-discord-empty">&mdash;</span></td>`;

  tr.innerHTML = `
    <td><span class="users-table-player"><img src="https://mc-heads.net/avatar/${encodeURIComponent(u.username || "Steve")}/64" alt="" width="24" height="24" loading="lazy" /><span class="users-table-username">${escapeHtml(u.username || "Unknown")}</span>${isSelf ? ` <span class="users-you">(You)</span>` : ""}</span></td>
    ${discordCell}
    <td>${roleCell}</td>
    <td class="users-joined">${u.created_at ? formatJoinedDate(u.created_at) : "-"}</td>
    <td>${actionCell}</td>
  `;
  return tr;
}

function replaceUserRow(tr, user) {
  const fresh = buildUserRow(user);
  tr.replaceWith(fresh);
  fresh.hidden = !rowMatchesSearch(user);
}

function renderUsers() {
  const body = $("#usersTableBody");
  body.innerHTML = "";

  const me = Auth.getState()?.profile?.username?.toLowerCase();
  const filtered = users.filter(rowMatchesSearch).sort((a, b) => {
    const aSelf = me && me === (a.username || "").toLowerCase();
    const bSelf = me && me === (b.username || "").toLowerCase();
    if (aSelf !== bSelf) return aSelf ? -1 : 1;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });
  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="users-table-empty">No accounts found.</td></tr>`;
    return;
  }
  for (const u of filtered) body.appendChild(buildUserRow(u));
}

function formatJoinedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "&mdash;";
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `<span class="users-joined-date">${day}</span><span class="users-joined-time">${time}</span>`;
}

$("#usersSearch").addEventListener("input", debounce(() => renderUsers(), 150));

$("#usersTableBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-revoke]");
  if (!btn || btn.disabled) return;
  const username = btn.dataset.revoke;
  if (!username) return;
  const ok = await confirmAction(`Delete the account for "${username}"? This permanently removes it and everything tied to it. This can't be undone.`, { title: "Revoke account?", confirmLabel: "Delete account" });
  if (!ok) return;
  btn.disabled = true;
  try {
    await Auth.revokeAccount(username);
    toast(`Account "${username}" deleted.`, "success");
    loadUsersPanel();
  } catch (err) {
    btn.disabled = false;
    toast(err.message || "Could not revoke account.", "error");
  }
});

// ---------- username editing (owners) ----------

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

function startUsernameEdit(tr) {
  if (tr.querySelector(".users-name-input")) return;
  const nameEl = tr.querySelector(".users-table-username");
  if (!nameEl) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "users-name-input";
  input.value = nameEl.textContent;
  input.maxLength = 30;
  input.autocomplete = "off";
  nameEl.replaceWith(input);
  tr.classList.add("is-editing");
  const actionCell = tr.querySelector(".users-actions");
  if (actionCell) {
    actionCell.innerHTML = `
      <button type="button" class="btn btn-primary btn-sm" data-save-username>Save</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel-username>Cancel</button>
    `;
  }
  const roleSel = tr.querySelector("[data-role-select]");
  if (roleSel) {
    closeRoleMenu(roleSel);
    roleSel.querySelector(".users-role-trigger").disabled = true;
  }
  input.focus();
  input.select();
}

async function saveUsernameEdit(tr) {
  const input = tr.querySelector(".users-name-input");
  const profileId = tr.dataset.profileId;
  const value = input.value.trim();
  if (!USERNAME_RE.test(value)) {
    toast("Usernames must be 3-30 characters using letters, numbers or underscores.", "error");
    input.focus();
    input.select();
    return;
  }
  input.disabled = true;
  for (const b of tr.querySelectorAll("[data-save-username], [data-cancel-username]")) b.disabled = true;
  try {
    await Auth.updateUsername(profileId, value);
    const idx = users.findIndex((u) => (u.id || "") === profileId);
    if (idx !== -1) users[idx] = { ...users[idx], username: value };
    toast(`Username updated to "${value}".`, "success");
    replaceUserRow(tr, idx !== -1 ? users[idx] : { id: profileId, username: value, role: "user" });
  } catch (err) {
    input.disabled = false;
    for (const b of tr.querySelectorAll("[data-save-username], [data-cancel-username]")) b.disabled = false;
    toast(err.message || "Could not update username.", "error");
  }
}

function cancelUsernameEdit(tr) {
  const profileId = tr.dataset.profileId;
  const user = users.find((u) => (u.id || "") === profileId);
  if (!user) {
    renderUsers();
    return;
  }
  replaceUserRow(tr, user);
}

$("#usersTableBody").addEventListener("click", (e) => {
  const editBtn = e.target.closest("[data-edit-username]");
  if (editBtn) {
    startUsernameEdit(editBtn.closest("tr"));
    return;
  }
  const saveBtn = e.target.closest("[data-save-username]");
  if (saveBtn) {
    saveUsernameEdit(saveBtn.closest("tr"));
    return;
  }
  const cancelBtn = e.target.closest("[data-cancel-username]");
  if (cancelBtn) {
    cancelUsernameEdit(cancelBtn.closest("tr"));
  }
});

// ---------- categories ----------

function updateCategoryIconPreview() {
  const iconClass = sanitizeIconClass($("#catIcon").value);
  const color = $("#catColor").value;
  const name = $("#catName").value.trim() || "Category";
  $("#catIconPreviewGlyph").className = iconClass;
  $("#catIconPreview").style.background = `color-mix(in srgb, ${color} 18%, transparent)`;
  $("#catIconPreview").style.color = color;
  $("#catColorValue").textContent = color.toUpperCase();
  const tag = $("#catTagPreview");
  if (tag) {
    tag.style.setProperty("--badge-color", color);
    tag.querySelector("i").className = iconClass;
    tag.querySelector("#catTagPreviewName").textContent = name;
  }
}

async function loadCategories() {
  if (!categoriesLoaded) $("#categoriesSkeleton").hidden = false;
  try {
    categories = await listCategories();
  } catch (err) {
    console.error(err);
    categories = [];
  }
  categoriesLoaded = true;
  $("#categoriesSkeleton").hidden = true;
  renderCategoriesList();
}

function renderCategoriesList() {
  const listEl = $("#categoriesList");
  listEl.innerHTML = "";
  if (categories.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><i class="fa-solid fa-layer-group" aria-hidden="true"></i><span>No categories yet. Add one.</span></div>`;
    return;
  }
  for (const cat of categories) {
    const item = document.createElement("div");
    item.className = "category-item";
    item.innerHTML = `
      <span class="category-item-icon" style="--item-color:${sanitizeColor(cat.color)}"><i class="${escapeHtml(categoryIconClass(cat.icon))}" aria-hidden="true"></i></span>
      <span class="category-item-name">${escapeHtml(cat.name)}</span>
      <div class="category-item-actions">
        <button type="button" class="icon-btn" title="Edit category" aria-label="Edit category"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button type="button" class="icon-btn icon-btn--danger" title="Delete category" aria-label="Delete category"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    `;
    item.querySelectorAll("button")[0].addEventListener("click", () => startEditCategory(cat));
    item.querySelectorAll("button")[1].addEventListener("click", () => handleDeleteCategory(cat));
    listEl.appendChild(item);
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
  $("#categoryFormTitle").textContent = "Edit category";
  $("#catName").focus();
}

function resetCategoryForm() {
  editingCategory = null;
  $("#categoryForm").reset();
  $("#catId").value = "";
  $("#catColor").value = "#9683e0";
  $("#catIcon").value = "";
  updateCategoryIconPreview();
  $("#catSubmitBtn").textContent = "Add category";
  $("#catCancelEditBtn").hidden = true;
  $("#categoryFormTitle").textContent = "Add category";
}

async function handleDeleteCategory(cat) {
  const ok = await confirmAction(`Delete category "${cat.name}"? Waypoints using it will become uncategorized.`, { title: "Delete category?", confirmLabel: "Delete" });
  if (!ok) return;
  try {
    await deleteCategory(cat.id);
    if (editingCategory && editingCategory.id === cat.id) resetCategoryForm();
    invalidateCategoriesCache();
    await loadCategories();
    toast("Category deleted.", "success");
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
    if (editingCategory) await updateCategory(editingCategory.id, { name, color, icon }, editingCategory);
    else await createCategory({ name, color, icon });
    resetCategoryForm();
    invalidateCategoriesCache();
    await loadCategories();
    toast("Category saved.", "success");
  } catch (err) {
    toast(err.message || "Could not save category.", "error");
  }
});
$("#catCancelEditBtn").addEventListener("click", resetCategoryForm);
$("#catIcon").addEventListener("input", updateCategoryIconPreview);
$("#catColor").addEventListener("input", updateCategoryIconPreview);
$("#catName").addEventListener("input", updateCategoryIconPreview);
updateCategoryIconPreview();

// ---------- access codes ----------

let accessCodes = [];

const MAX_UNUSED_ACCESS_CODES = 3;

function unusedAccessCodeCount() {
  return accessCodes.filter((c) => !c.used).length;
}

function updateAccessCodeGate() {
  const gated = unusedAccessCodeCount() >= MAX_UNUSED_ACCESS_CODES;
  $("#accessCodeGenerateBtn").disabled = gated;
  $("#accessCodeGateHint").hidden = !gated;
}

async function loadAccessCodesPanel() {
  if (!Auth.can("viewAccessCodes")) return;
  const errorEl = $("#accessCodesError");
  errorEl.hidden = true;
  try {
    accessCodes = await listAccessCodes();
    renderAccessCodes();
  } catch (err) {
    console.error(err);
    accessCodes = [];
    errorEl.querySelector("span").textContent = err.message || "Could not load access codes.";
    errorEl.hidden = false;
    renderAccessCodes();
  }
}

function roleBadgeHtmlForCode(role) {
  const safe = ["owner", "admin", "user"].includes(role) ? role : "user";
  return `<span class="users-role role-${safe}">${escapeHtml(safe)}</span>`;
}

function formatAccessCodeDateTimeText(value, fallback = "&mdash;") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

function relativeDateText(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = date.getTime() - Date.now();
  if (Math.abs(diffMs) < 60_000) return "just now";
  const mins = Math.floor(Math.abs(diffMs) / 60_000);
  const pl = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  let text;
  if (days > 0) text = hours > 0 ? `${pl(days, "day")} ${pl(hours, "hour")}` : pl(days, "day");
  else if (hours > 0) text = minutes > 0 ? `${pl(hours, "hour")} ${pl(minutes, "minute")}` : pl(hours, "hour");
  else text = pl(minutes, "minute");
  return diffMs < 0 ? `${text} ago` : `in ${text}`;
}

function acTimeHtml(value, fallback = "&mdash;") {
  return `<span class="ac-meta-time">${formatAccessCodeDateTimeText(value, fallback)}</span>`;
}

// tooltip rides on the whole cell so the tap target is big enough for thumbs
function acCellTipAttr(value, key) {
  const relative = relativeDateText(value);
  if (!relative) return "";
  return ` data-tooltip="${escapeHtml(relative)}" data-tip-key="${escapeHtml(key)}"`;
}

function buildAccessCodeRoleSelect(code, currentRole) {
  const safeRole = ["owner", "admin", "user"].includes(currentRole) ? currentRole : "user";
  const root = document.createElement("div");
  root.className = "users-role-select";
  root.dataset.acRoleSelect = code;
  root.dataset.roleValue = safeRole;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "users-role-trigger";
  trigger.dataset.acRoleTrigger = "";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `${roleBadgeHtmlForCode(safeRole)}<i class="fa-solid fa-chevron-down users-role-chevron" aria-hidden="true"></i>`;

  const menu = document.createElement("div");
  menu.className = "users-role-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  menu.innerHTML = ["owner", "admin", "user"]
    .map((r) => `<button type="button" class="users-role-option" role="option" data-ac-role-option="${r}" aria-selected="${safeRole === r}">${roleBadgeHtmlForCode(r)}</button>`)
    .join("");

  root.appendChild(trigger);
  root.appendChild(menu);
  return root;
}

function buildAccessCodeRow(entry) {
  const tr = document.createElement("tr");
  tr.dataset.search = [entry.code, entry.created_by, entry.profiles?.username, entry.role].filter(Boolean).join(" ").toLowerCase();

  const canEdit = isOwner();
  const isUsed = !!entry.used;
  const statusLabel = isUsed ? "Used" : "Valid";

  const roleCell = canEdit && !isUsed
    ? buildAccessCodeRoleSelect(entry.code, entry.role).outerHTML
    : roleBadgeHtmlForCode(entry.role);

  const usedCell = isUsed
    ? `
    <td class="ac-meta-cell"${acCellTipAttr(entry.used_at, `ac:used:${entry.code}`)}>
      <span class="ac-meta-actor">${escapeHtml(entry.profiles?.username || "unknown")}</span>
      ${acTimeHtml(entry.used_at)}
    </td>`
    : `
    <td class="ac-meta-cell">
      <span class="ac-meta-actor ac-meta-unused">unused</span>
    </td>`;

  const copyBtns = `
    <button class="icon-btn" data-ac-copy-text="${escapeHtml(entry.code)}" title="Copy code" aria-label="Copy code ${escapeHtml(entry.code)}"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>
    <button class="icon-btn" data-ac-copy-url="${escapeHtml(entry.code)}" title="Copy link" aria-label="Copy access code link"><i class="fa-solid fa-link" aria-hidden="true"></i></button>
  `;

  const deleteBtn = canEdit && !isUsed
    ? `<button class="icon-btn icon-btn--danger" data-ac-delete="${escapeHtml(entry.code)}" title="Delete code" aria-label="Delete code ${escapeHtml(entry.code)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`
    : "";

  tr.innerHTML = `
    <td>
      <div class="ac-code-cell">
        <span class="ac-status-dot${isUsed ? " ac-status-dot--used" : ""}" data-tooltip="${statusLabel}" data-tip-key="ac:dot:${escapeHtml(entry.code)}" role="img" aria-label="${statusLabel}"></span>
        <code class="ac-code">${escapeHtml(entry.code)}</code>
        ${copyBtns}
      </div>
    </td>
    <td>${roleCell}</td>
    <td class="ac-meta-cell"${acCellTipAttr(entry.created_at, `ac:created:${entry.code}`)}>
      <span class="ac-meta-actor">${escapeHtml(entry.created_by || "-")}</span>
      ${acTimeHtml(entry.created_at)}
    </td>
    ${usedCell}
    <td>${deleteBtn ? `<div class="users-actions">${deleteBtn}</div>` : ""}</td>
  `;
  return tr;
}

function renderAccessCodes() {
  hideTip();
  renderAccessCodeList();
  const body = $("#accessCodesTableBody");
  const query = $("#accessCodesSearch").value.trim().toLowerCase();
  const filtered = accessCodes.filter((c) => !query || c.code.toLowerCase().includes(query) || (c.created_by || "").toLowerCase().includes(query) || (c.profiles?.username || "").toLowerCase().includes(query));

  body.innerHTML = "";
  $("#accessCodesEmpty").hidden = accessCodes.length !== 0;

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="users-table-empty">No access codes found.</td></tr>`;
    updateAccessCodeGate();
    return;
  }
  for (const c of filtered) body.appendChild(buildAccessCodeRow(c));
  updateAccessCodeGate();
}

// left card: every unused ("available") code, always visible
function renderAccessCodeList() {
  const list = $("#accessCodeList");
  const unused = accessCodes.filter((c) => !c.used);
  list.innerHTML = "";
  if (unused.length === 0) {
    const hint = document.createElement("p");
    hint.className = "admin-hint access-code-list-empty";
    hint.textContent = accessCodes.length === 0 ? "No codes yet." : "All generated codes have been used.";
    list.appendChild(hint);
    return;
  }
  for (const c of unused) {
    if (c === unused[0]) {
      const label = document.createElement("span");
      label.className = "access-code-list-label";
      label.textContent = "Unused codes";
      list.appendChild(label);
    }
    const row = document.createElement("div");
    row.className = "access-code-row";
    row.innerHTML = `
      <code class="access-code-value">${escapeHtml(c.code)}</code>
      <button class="icon-btn ac-copy" data-ac-copy-text="${escapeHtml(c.code)}" title="Copy code" aria-label="Copy code ${escapeHtml(c.code)}"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>
      <button class="icon-btn ac-copy" data-ac-copy-url="${escapeHtml(c.code)}" title="Copy link" aria-label="Copy access code link"><i class="fa-solid fa-link" aria-hidden="true"></i></button>
    `;
    list.appendChild(row);
  }
}

function handleAccessCodeCopyClick(e) {
  const copyTextBtn = e.target.closest("[data-ac-copy-text]");
  if (copyTextBtn) {
    copyTextToClipboard(copyTextBtn.dataset.acCopyText, copyTextBtn);
    return;
  }
  const copyUrlBtn = e.target.closest("[data-ac-copy-url]");
  if (copyUrlBtn) {
    copyTextToClipboard(`${window.location.origin}/c/${encodeURIComponent(copyUrlBtn.dataset.acCopyUrl)}`, copyUrlBtn);
  }
}

$("#accessCodeList").addEventListener("click", handleAccessCodeCopyClick);

// floating tooltip for status dots + date cells, ported from the server
// page's player tips (same .player-tip styles, same hover/tap behavior)
const tipEl = document.createElement("div");
tipEl.className = "player-tip";
tipEl.hidden = true;
document.body.appendChild(tipEl);

// desktop (fine pointer + hover) shows tips instantly on hover and hides
// instantly on leave; touch devices pin a tip by tapping and dismiss it by
// tapping anywhere else
const CAN_HOVER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const compactScreen = window.matchMedia("(max-width: 860px)");
function allowTapToggle() {
  return !CAN_HOVER || compactScreen.matches;
}

let activeTipKey = null;
let tipPinned = false;
let tipAnchorRect = null;
let tipContainer = null;

// last known pointer position, so a mid-hover re-render can tell whether the
// pointer is still parked on a tooltip target (keep the tip up) vs leaving
let lastPointerPos = null;
window.addEventListener("pointermove", (e) => {
  lastPointerPos = { x: e.clientX, y: e.clientY };
}, { passive: true });

function tipAnchor(key) {
  return document.querySelector(`[data-tip-key="${CSS.escape(key)}"]`);
}

function showTip(key) {
  const anchor = tipAnchor(key);
  if (!anchor) return hideTip();
  activeTipKey = key;
  tipEl.textContent = anchor.dataset.tooltip || "";
  tipEl.hidden = false;
  // date cells anchor to the date stamp itself, not the tall cell top
  const posEl = anchor.querySelector(".ac-meta-time") || anchor;
  tipAnchorRect = posEl.getBoundingClientRect();
  tipContainer = anchor.closest(".card") || null;
  positionTip();
}

function positionTip() {
  if (!tipAnchorRect) return;
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const margin = 8;
  const box = tipContainer ? tipContainer.getBoundingClientRect() : null;
  const anchor = tipAnchor(activeTipKey);
  // dots get a centered tip like the server page's dimension dots; the wide
  // date cells line the tip up with the cell's left edge instead
  const center = anchor && anchor.classList.contains("ac-status-dot");
  let left;
  if (center) left = tipAnchorRect.left + tipAnchorRect.width / 2 - tw / 2;
  else left = tipAnchorRect.left;
  if (box) left = Math.max(box.left + margin, Math.min(left, box.right - tw - margin));
  else left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
  let top = tipAnchorRect.top - th - margin;
  if (box) {
    const minTop = box.top + margin;
    const maxTop = box.bottom - th - margin;
    if (top < minTop) top = tipAnchorRect.bottom + margin;
    top = Math.max(minTop, Math.min(top, maxTop));
  } else {
    if (top < margin) top = tipAnchorRect.bottom + margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
  }
  tipEl.style.left = left + "px";
  tipEl.style.top = top + "px";
}

function hideTip() {
  tipEl.hidden = true;
  activeTipKey = null;
  tipAnchorRect = null;
  tipContainer = null;
}

// after re-renders keep an open tooltip anchored to the fresh element
function refreshTip() {
  if (CAN_HOVER && tipEl.hidden && lastPointerPos) {
    const at = document.elementFromPoint(lastPointerPos.x, lastPointerPos.y);
    const over = at ? at.closest("[data-tooltip]") : null;
    if (over) {
      showTip(over.dataset.tipKey);
      return;
    }
  }
  if (tipEl.hidden || !activeTipKey) return;
  const anchor = tipAnchor(activeTipKey);
  if (!anchor) return hideTip();
  const text = anchor.dataset.tooltip || "";
  if (tipEl.textContent !== text) tipEl.textContent = text;
  const posEl = anchor.querySelector(".ac-meta-time") || anchor;
  const rect = posEl.getBoundingClientRect();
  if (!tipAnchorRect || Math.hypot(rect.left - tipAnchorRect.left, rect.top - tipAnchorRect.top) > 2) {
    tipAnchorRect = rect;
    positionTip();
  }
}

function closePinnedTip() {
  if (!tipPinned) return;
  tipPinned = false;
  hideTip();
}

$("#accessCodesTableBody").addEventListener("pointerover", (e) => {
  if (!CAN_HOVER) return;
  const over = e.target.closest("[data-tooltip]");
  if (!over) return;
  showTip(over.dataset.tipKey);
});

$("#accessCodesTableBody").addEventListener("pointerout", (e) => {
  if (!CAN_HOVER) return;
  if (tipPinned) return;
  const related = e.relatedTarget instanceof HTMLElement ? e.relatedTarget.closest("[data-tooltip]") : null;
  if (related) return;
  hideTip();
});

// tap toggle: taps are resolved from the finger-down point (lastDownTipKey)
// because on touch the synthetic click target can drift off a tiny element
// like the 10px status dot
let lastDownTipKey = null;
let lastDownTime = 0;
function recentDownTipKey() {
  return Date.now() - lastDownTime < 500 ? lastDownTipKey : null;
}

$("#accessCodesTableBody").addEventListener("pointerdown", (e) => {
  const at = e.target instanceof HTMLElement ? e.target.closest("[data-tooltip]") : null;
  lastDownTipKey = at ? at.dataset.tipKey : null;
  lastDownTime = Date.now();
}, { passive: true });

$("#accessCodesTableBody").addEventListener("click", (e) => {
  if (!allowTapToggle()) return;
  const tipTarget = e.target.closest("[data-tooltip]");
  const key = tipTarget ? tipTarget.dataset.tipKey : recentDownTipKey();
  if (!key) return closePinnedTip();
  if (tipPinned && activeTipKey === key) closePinnedTip();
  else {
    tipPinned = true;
    showTip(key);
  }
});

document.addEventListener("click", (e) => {
  if (!tipPinned) return;
  const hit = e.target instanceof HTMLElement ? e.target.closest("[data-tooltip]") : null;
  if (!hit && !recentDownTipKey()) closePinnedTip();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePinnedTip();
});

document.addEventListener("scroll", () => {
  if (tipEl.hidden || !tipAnchorRect) return;
  refreshTip();
}, { passive: true, capture: true });

$("#accessCodesSearch").addEventListener("input", debounce(renderAccessCodes, 150));

$("#accessCodesTableBody").addEventListener("click", async (e) => {
  if (e.target.closest("[data-ac-copy-text], [data-ac-copy-url]")) {
    handleAccessCodeCopyClick(e);
    return;
  }
  const btn = e.target.closest("[data-ac-delete]");
  if (!btn || btn.disabled) return;
  const code = btn.dataset.acDelete;
  if (!code) return;
  const ok = await confirmAction(`Delete the access code "${code}"?`, { title: "Delete access code?", confirmLabel: "Delete" });
  if (!ok) return;
  btn.disabled = true;
  try {
    await deleteAccessCode(code);
    accessCodes = accessCodes.filter((c) => c.code !== code);
    renderAccessCodes();
    toast("Access code deleted.", "success");
  } catch (err) {
    btn.disabled = false;
    toast(err.message || "Could not delete access code.", "error");
    loadAccessCodesPanel();
  }
});

function closeAccessCodeMenus(except) {
  for (const el of document.querySelectorAll("[data-ac-role-select]")) {
    if (el === except) continue;
    const menu = el.querySelector(".users-role-menu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      el.querySelector("[data-ac-role-trigger]").setAttribute("aria-expanded", "false");
    }
  }
}

document.addEventListener("click", (e) => {
  const root = e.target.closest("[data-ac-role-select]");
  if (!root) {
    closeAccessCodeMenus();
    return;
  }
  closeAccessCodeMenus(root);
  if (e.target.closest("[data-ac-role-trigger]")) {
    const menu = root.querySelector(".users-role-menu");
    menu.hidden = !menu.hidden;
    root.querySelector("[data-ac-role-trigger]").setAttribute("aria-expanded", String(!menu.hidden));
  } else if (e.target.closest("[data-ac-role-option]")) {
    applyAccessCodeRole(root, e.target.closest("[data-ac-role-option]").dataset.acRoleOption);
  }
});

async function applyAccessCodeRole(root, role) {
  if (!["owner", "admin", "user"].includes(role) || role === root.dataset.roleValue) {
    closeRoleMenu(root);
    return;
  }
  const code = root.dataset.acRoleSelect;
  const trigger = root.querySelector(".users-role-trigger");
  closeRoleMenu(root);
  trigger.disabled = true;
  try {
    await updateAccessCodeRole(code, role);
    toast("Access code role updated.", "success");
    await loadAccessCodesPanel();
  } catch (err) {
    trigger.disabled = false;
    toast(err.message || "Could not update role.", "error");
    loadAccessCodesPanel();
  }
}

const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACCESS_CODE_LENGTH = 12;
const ACCESS_CODE_PREFIX = "MIAU";

function randomAccessCode() {
  let body = "";
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) {
    body += ACCESS_CODE_ALPHABET[Math.floor(Math.random() * ACCESS_CODE_ALPHABET.length)];
  }
  return `${ACCESS_CODE_PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

$("#accessCodeGenerateBtn").addEventListener("click", async () => {
  if (unusedAccessCodeCount() >= MAX_UNUSED_ACCESS_CODES) {
    toast(`You already have ${MAX_UNUSED_ACCESS_CODES} unused codes. Delete or hand them out first.`, "error");
    return;
  }
  const btn = $("#accessCodeGenerateBtn");
  btn.disabled = true;

  let code = null;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomAccessCode();
      const exists = await accessCodeExists(candidate);
      if (!exists) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Could not generate a unique code - try again.");
    const username = Auth.getState()?.profile?.username;
    await createAccessCode({ code, role: "user", created_by: username ? `${username} (website)` : "unknown (website)" });
    toast("Access code generated.", "success");
    await loadAccessCodesPanel();
  } catch (err) {
    toast(err.message || "Could not generate access code.", "error");
  } finally {
    updateAccessCodeGate();
  }
});