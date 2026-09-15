// Shared site chrome: top bar (desktop), bottom tab bar (mobile, thumb
// reach), the "more" overflow (dropdown on desktop, sheet on mobile), and
// the sign-in/register modal. One copy of this markup/logic, injected on
// every page, instead of duplicating nav across HTML files.

import * as Auth from "./auth.js";
import { closeOnBackdropClick, toast, escapeHtml, trapFocus } from "./ui.js";

const PAGES = [
  { id: "map", href: "/", label: "Map", icon: "fa-map" },
  { id: "server", href: "/server", label: "Server", icon: "fa-server" },
  { id: "leaderboards", href: "/leaderboards", label: "Leaderboards", icon: "fa-trophy" },
];

function currentProfileHref() {
  const state = Auth.getState();
  const username = state.profile?.username;
  return username ? `/profile?user=${encodeURIComponent(username)}` : null;
}

function renderTopbar(pageId) {
  const root = document.getElementById("navRoot");
  if (!root) return;

  const linkHtml = (href, current, icon, label, id) => {
    const iconHtml = `<i class="fa-solid ${icon}" aria-hidden="true"></i>${label}`;
    const idAttr = id ? ` id="${id}"` : "";
    if (current) return `<span class="nav-link"${idAttr} data-current="true" aria-current="page">${iconHtml}</span>`;
    return `<a class="nav-link"${idAttr} href="${href}" data-current="false">${iconHtml}</a>`;
  };

  const primaryLinks = PAGES.map((p) => linkHtml(p.href, p.id === pageId, p.icon, p.label)).join("");
  const logsLink = linkHtml("/logs", pageId === "logs", "fa-clock-rotate-left", "Logs", "navLogsLink").replace(">", " hidden>");
  const adminLink = linkHtml("/admin", pageId === "admin", "fa-shield-halved", "Admin", "navAdminLink").replace(">", " hidden>");

  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/">
        <span class="brand-mark"><img src="/img/icon.webp" alt="" width="26" height="26" /></span>
        MIAUCRAFT
      </a>
      <nav class="nav-primary" id="navPrimary" aria-label="Primary">
        ${primaryLinks}
        ${logsLink}
        ${adminLink}
      </nav>
      <div class="nav-right">
        <div id="navAuthSlot"></div>
        <div class="nav-more-wrap" id="navMoreWrap">
          <button class="icon-btn" id="navMoreBtn" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
          <div class="nav-more-menu" id="navMoreMenu" role="menu" hidden></div>
        </div>
      </div>
    </header>
  `;
}

function renderBottomNav(pageId) {
  if (document.getElementById("bottomNav")) return;
  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.id = "bottomNav";
  nav.setAttribute("aria-label", "Primary");
  const pageItem = (href, current, icon, label) => {
    const iconHtml = `<i class="fa-solid ${icon}" aria-hidden="true"></i>${label}`;
    if (current) return `<span class="bottom-nav-item" data-current="true" aria-current="page">${iconHtml}</span>`;
    return `<a class="bottom-nav-item" href="${href}">${iconHtml}</a>`;
  };
  nav.innerHTML = `
    ${pageItem("/", pageId === "map", "fa-map", "Map")}
    ${pageItem("/server", pageId === "server", "fa-server", "Server")}
    ${pageItem("/leaderboards", pageId === "leaderboards", "fa-trophy", "Leaderboards")}
    <button class="bottom-nav-item" id="bottomNavProfileBtn" type="button" data-current="${pageId === "profile"}"><i class="fa-solid fa-user" aria-hidden="true"></i>Profile</button>
    <button class="bottom-nav-item" id="bottomNavMoreBtn" type="button" data-current="${pageId === "admin" || pageId === "settings"}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i>More</button>
  `;
  document.body.appendChild(nav);
}

function moreMenuItems(pageId, isMobile) {
  const loggedIn = Auth.isLoggedIn();
  const items = [];

  if (loggedIn && !isMobile) {
    items.push({ href: currentProfileHref() || "#", icon: "fa-user", label: "My profile" });
  }
  items.push({ href: "/settings", icon: "fa-gear", label: "Settings" });
  if (isMobile) {
    if (loggedIn && (Auth.can("manageWhitelist") || Auth.can("manageCategories"))) {
      items.push({ href: "/admin", icon: "fa-shield-halved", label: "Admin dashboard" });
    }
    if (loggedIn) {
      items.push({ href: "/logs", icon: "fa-clock-rotate-left", label: "Logs" });
    }
  }
  items.push({ divider: true });
  if (loggedIn) {
    items.push({ action: "signout", icon: "fa-right-from-bracket", label: "Sign out", danger: true });
  } else {
    items.push({ action: "signin", icon: "fa-right-to-bracket", label: "Sign in" });
  }
  return items;
}

function itemsHtml(items, tag) {
  return items
    .map((item) => {
      if (item.divider) return `<div class="${tag === "sheet" ? "sheet-divider" : "nav-more-divider"}"></div>`;
      const cls = item.danger ? "danger" : "";
      if (item.action) {
        return `<button type="button" class="${cls}" data-nav-action="${item.action}"><i class="fa-solid ${item.icon}" aria-hidden="true"></i>${item.label}</button>`;
      }
      return `<a href="${item.href}" class="${cls}"><i class="fa-solid ${item.icon}" aria-hidden="true"></i>${item.label}</a>`;
    })
    .join("");
}

function wireMoreMenu(pageId) {
  const btn = document.getElementById("navMoreBtn");
  const menu = document.getElementById("navMoreMenu");
  if (!btn || !menu) return;

  function close() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  function open() {
    menu.innerHTML = itemsHtml(moreMenuItems(pageId, false), "menu");
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
  });
  menu.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-nav-action]");
    if (actionBtn) handleNavAction(actionBtn.dataset.navAction);
    close();
  });
}

function openSheet(pageId) {
  const items = moreMenuItems(pageId, true);
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = `<div class="sheet-grabber"><div class="sheet-handle"></div></div>${itemsHtml(items, "sheet")}`;

  function close(exitAnimation = true) {
    if (exitAnimation) {
      sheet.style.transform = "translateY(100%)";
      backdrop.classList.add("sheet-backdrop--hiding");
      setTimeout(() => {
        backdrop.remove();
        sheet.remove();
      }, 350);
    } else {
      backdrop.remove();
      sheet.remove();
    }
  }

  function dismiss() {
    close(true);
  }

  backdrop.addEventListener("click", dismiss);
  sheet.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-nav-action]");
    if (actionBtn) {
      handleNavAction(actionBtn.dataset.navAction);
      dismiss();
    } else if (e.target.closest("a")) {
      dismiss();
    }
  });

  document.body.append(backdrop, sheet);

  // Trigger enter animation
  requestAnimationFrame(() => {
    sheet.classList.add("sheet--entering");
    sheet.style.transform = "translateY(0)";
  });

  // Drag-to-dismiss (pointer events with a touch fallback so the whole top
  // strip is draggable on touch screens, and it also works with a mouse)
  const grabber = sheet.querySelector(".sheet-grabber");
  const dismissDelta = Math.max(90, Math.round(sheet.clientHeight * 0.3));
  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  function startDrag(y) {
    isDragging = true;
    startY = y;
    currentY = y;
    sheet.classList.add("sheet--dragging");
    sheet.classList.remove("sheet--entering");
  }

  function moveDrag(y) {
    if (!isDragging) return;
    currentY = y;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      sheet.style.transform = `translateY(${deltaY}px)`;
    }
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    sheet.classList.remove("sheet--dragging");

    const deltaY = currentY - startY;
    if (deltaY > dismissDelta) {
      dismiss();
    } else {
      sheet.style.transform = "translateY(0)";
    }
  }

  if (window.PointerEvent) {
    grabber.addEventListener("pointerdown", (e) => {
      grabber.setPointerCapture?.(e.pointerId);
      startDrag(e.clientY);
    });
    grabber.addEventListener("pointermove", (e) => moveDrag(e.clientY));
    const endPointer = (e) => {
      if (grabber.hasPointerCapture?.(e.pointerId)) grabber.releasePointerCapture(e.pointerId);
      endDrag();
    };
    grabber.addEventListener("pointerup", endPointer);
    grabber.addEventListener("pointercancel", endPointer);
  } else {
    grabber.addEventListener("touchstart", (e) => startDrag(e.touches[0].clientY), { passive: true });
    sheet.addEventListener("touchmove", (e) => moveDrag(e.touches[0].clientY), { passive: true });
    grabber.addEventListener("touchend", endDrag);
    sheet.addEventListener("touchend", endDrag);
  }
}

function handleNavAction(action) {
  if (action === "signin") openAuthModal("login");
  else if (action === "signout") doSignOut();
}

async function doSignOut() {
  try {
    await Auth.logout();
    toast("Signed out.", "success");
  } catch (err) {
    toast(err.message || "Could not sign out.", "error");
  }
}

function wireBottomNav(pageId) {
  const profileBtn = document.getElementById("bottomNavProfileBtn");
  const moreBtn = document.getElementById("bottomNavMoreBtn");
  profileBtn?.addEventListener("click", () => {
    const href = currentProfileHref();
    if (href) window.location.href = href;
    else openAuthModal("login");
  });
  moreBtn?.addEventListener("click", () => openSheet(pageId));
}

function renderAuthSlot() {
  const slot = document.getElementById("navAuthSlot");
  if (!slot) return;
  const state = Auth.getState();
  if (!state.session) {
    slot.innerHTML = `<button class="btn btn-primary btn-sm" id="navSignInBtn" type="button">Sign in</button>`;
    document.getElementById("navSignInBtn").addEventListener("click", () => openAuthModal("login"));
    return;
  }
  const username = state.profile?.username || "?";
  const role = Auth.role() || "user";
  slot.innerHTML = `
    <a class="auth-chip" href="${currentProfileHref() || "#"}">
      <img src="https://mc-heads.net/avatar/${encodeURIComponent(username)}/64" alt="" />
      <span class="auth-chip-name">
        <span>${escapeHtml(username)}</span>
        <span class="auth-chip-role" data-role="${escapeHtml(role)}">${escapeHtml(role)}</span>
      </span>
    </a>
  `;
}

function updateRoleVisibility() {
  const adminLink = document.getElementById("navAdminLink");
  if (adminLink) adminLink.hidden = !(Auth.can("manageWhitelist") || Auth.can("manageCategories"));
  const logsLink = document.getElementById("navLogsLink");
  if (logsLink) logsLink.hidden = !Auth.isLoggedIn();
}

// ---------- auth modal (sign in / register), shared across pages ----------

function ensureAuthModal() {
  if (document.getElementById("authModal")) return;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.id = "authModal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal auth-modal-card">
      <button class="modal-close" id="authModalClose" type="button" aria-label="Close">&times;</button>
      <span class="auth-kicker">Miaucraft</span>
      <h2 class="modal-title" style="margin-top:4px">Welcome back</h2>
      <p style="color:var(--text-muted);font-size:var(--fs-sm);margin:-8px 0 18px">Sign in to manage server waypoints.</p>
      <div class="modal-tabs auth-tabs">
        <button class="modal-tab" type="button" data-authtab="login" data-active="true">Sign in</button>
        <button class="modal-tab" type="button" data-authtab="register">Create account</button>
      </div>
      <form class="modal-form" id="loginForm">
        <label>Username<input type="text" id="loginUsername" autocomplete="username" required /></label>
        <label>Password
          <span class="password-field">
            <input type="password" id="loginPassword" autocomplete="current-password" required />
            <button class="password-toggle" type="button" data-password-toggle="loginPassword" aria-label="Show password"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
          </span>
        </label>
        <button class="btn btn-primary" type="submit">Sign in</button>
        <button class="btn btn-discord" type="button" id="discordLoginBtn"><i class="fa-brands fa-discord" aria-hidden="true"></i> Continue with Discord</button>
      </form>
      <form class="modal-form" id="registerForm" hidden>
        <label>Your Minecraft username<input type="text" id="registerUsername" autocomplete="username" required /></label>
        <label>Password
          <span class="password-field">
            <input type="password" id="registerPassword" autocomplete="new-password" required />
            <button class="password-toggle" type="button" data-password-toggle="registerPassword" aria-label="Show password"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
          </span>
        </label>
        <label>Repeat password
          <span class="password-field">
            <input type="password" id="registerPasswordRepeat" autocomplete="new-password" required />
            <button class="password-toggle" type="button" data-password-toggle="registerPasswordRepeat" aria-label="Show password"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
          </span>
        </label>
        <label><span id="registerCodeLabel">Access code (contact xhvsh if you need one)</span><input type="text" id="registerCode" autocomplete="off" required /></label>
        <button class="btn btn-primary" type="submit">Create account</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  closeOnBackdropClick(modal, closeAuthModal);
  modal.querySelector("#authModalClose").addEventListener("click", closeAuthModal);

  modal.querySelectorAll("[data-authtab]").forEach((btn) => {
    btn.addEventListener("click", () => setAuthTab(btn.dataset.authtab));
  });

  modal.querySelectorAll("[data-password-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.passwordToggle);
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.setAttribute("aria-pressed", String(!showing));
      btn.querySelector("i").className = showing ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
    });
  });

  modal.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.currentTarget.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";
    try {
      await Auth.login(document.getElementById("loginUsername").value.trim(), document.getElementById("loginPassword").value);
      closeAuthModal();
      toast("Signed in.", "success");
    } catch (err) {
      toast(err.message || "Could not sign in.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });

  modal.querySelector("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = document.getElementById("registerPassword").value;
    const p2 = document.getElementById("registerPasswordRepeat").value;
    if (p1 !== p2) {
      toast("Passwords don't match.", "error");
      return;
    }
    const submitBtn = e.currentTarget.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account...";
    try {
      await Auth.register(document.getElementById("registerUsername").value.trim(), p1, document.getElementById("registerCode").value.trim());
      closeAuthModal();
      toast("Account created.", "success");
    } catch (err) {
      toast(err.message || "Registration failed.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
    }
  });

  modal.querySelector("#discordLoginBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await Auth.loginWithDiscord();
    } catch (err) {
      toast(err.message || "Could not start Discord sign-in.", "error");
      btn.disabled = false;
    }
  });
}

function setAuthTab(tab) {
  document.querySelectorAll("[data-authtab]").forEach((btn) => (btn.dataset.active = String(btn.dataset.authtab === tab)));
  document.getElementById("loginForm").hidden = tab !== "login";
  document.getElementById("registerForm").hidden = tab !== "register";
}

let authModalFocusRelease = null;
let authModalRestoreFocus = null;

export function openAuthModal(tab = "login") {
  ensureAuthModal();
  setAuthTab(tab);
  const modal = document.getElementById("authModal");
  modal.hidden = false;
  authModalFocusRelease?.();
  authModalFocusRelease = trapFocus(modal);
  const previouslyFocused = document.activeElement;
  authModalRestoreFocus = () => {
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  };
  (tab === "register" ? document.getElementById("registerUsername") : document.getElementById("loginUsername")).focus();
}

export function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (modal) modal.hidden = true;
  authModalFocusRelease?.();
  authModalFocusRelease = null;
  authModalRestoreFocus?.();
  authModalRestoreFocus = null;
}

Auth.onAuthError?.((message) => toast(message, "error"));

// ---------- init ----------

export async function initNav(pageId) {
  renderTopbar(pageId);
  renderBottomNav(pageId);
  ensureAuthModal();
  wireMoreMenu(pageId);
  wireBottomNav(pageId);

  // skip link: jump past the nav without polluting the URL with a #fragment
  const skipLink = document.querySelector(".skip-link");
  const mainContent = document.getElementById("mainContent");
  if (skipLink && mainContent) {
    const activateSkip = (e) => {
      e.preventDefault();
      mainContent.focus({ preventScroll: true });
      mainContent.scrollIntoView({ behavior: "instant", block: "start" });
    };
    skipLink.addEventListener("click", activateSkip);
    skipLink.addEventListener("keydown", (e) => {
      if (e.key === " " || e.code === "Space") activateSkip(e);
    });
  }

  await Auth.init();
  Auth.onAuthChange(() => {
    renderAuthSlot();
    updateRoleVisibility();
  });
  Auth.onPasswordRecovery?.(() => {
    openAuthModal("login");
    toast("Set a new password from Settings after signing in.", "info");
  });
}

export { Auth };
