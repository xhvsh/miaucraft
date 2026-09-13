import * as Auth from "../lib/auth.js";
import { createCategory, updateCategory, deleteCategory, listCategories, categoryIconClass, sanitizeIconClass } from "../lib/waypoints.js";
import { listWhitelist, subscribeWhitelist, requestWhitelistAdd, requestWhitelistRemove, listPendingWhitelistCommands, subscribeWhitelistCommands, cancelWhitelistCommand } from "../lib/live.js";
import { escapeHtml, toast, confirmAction } from "../lib/ui.js";
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
  consumeAdminParams();
}

refreshAdminAccess();
Auth.onAuthChange(() => refreshAdminAccess());

// ---------- tabs (visibility per role) ----------

function showAdminTabsForRole() {
  const visibility = {
    whitelist: Auth.can("manageWhitelist"),
    users: Auth.can("manageCategories"),
    categories: Auth.can("manageCategories"),
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
}

// after landing from a logs link like /admin?tab=categories&name=...
function consumeAdminParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.size === 0) return;
  window.history.replaceState({}, "", window.location.pathname);
  const tab = params.get("tab");
  if (tab && ["whitelist", "users", "categories"].includes(tab)) showAdminTab(tab);
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
      <img class="whitelist-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(entry.username)}/64" alt="" width="22" height="22" />
      <span class="whitelist-username">${escapeHtml(entry.username)}</span>
      <button class="icon-btn icon-btn--danger" data-username="${escapeHtml(entry.username)}" title="Remove" aria-label="Remove ${escapeHtml(entry.username)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      const ok = await confirmAction(`Remove "${entry.username}" from the whitelist?`);
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
      <img class="whitelist-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(cmd.username)}/64" alt="" width="22" height="22" />
      <span class="whitelist-username">${escapeHtml(cmd.username)}</span>
      <button class="icon-btn" title="Cancel request" aria-label="Cancel request for ${escapeHtml(cmd.username)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      const ok = await confirmAction("Cancel this pending request?");
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
$("#whitelistSearch").addEventListener("input", applyWhitelistSearch);

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

subscribeWhitelist(() => loadWhitelistPanel());
subscribeWhitelistCommands((payload) => {
  if (payload.eventType === "UPDATE" && payload.new.status === "failed") {
    const verb = payload.new.action === "remove" ? "remove" : "add";
    toast(`Could not ${verb} "${payload.new.username}" - the command failed on the server.`, "error");
  }
  loadWhitelistPanel();
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
  if (e.key === "Escape") for (const m of [...openRoleMenus]) closeRoleMenu(m);
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

  tr.innerHTML = `
    <td><span class="users-table-player"><img src="https://mc-heads.net/avatar/${encodeURIComponent(u.username || "Steve")}/64" alt="" width="24" height="24" /><span class="users-table-username">${escapeHtml(u.username || "Unknown")}</span>${isSelf ? ` <span class="users-you">(You)</span>` : ""}</span></td>
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
    body.innerHTML = `<tr><td colspan="4" class="users-table-empty">No accounts found.</td></tr>`;
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

$("#usersSearch").addEventListener("input", () => renderUsers());

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
      <span class="category-item-icon" style="--item-color:${escapeHtml(cat.color)}"><i class="${escapeHtml(categoryIconClass(cat.icon))}" aria-hidden="true"></i></span>
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