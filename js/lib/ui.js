// Shared UI utilities used across every page: toasts, confirm dialog,
// clipboard, and the time/text formatters that were duplicated between
// app.js and profile.js in the old build.

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const ESC_RE = /[&<>"']/g;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export function sanitizeColor(value) {
  return COLOR_RE.test(value) ? value : "#ffffff";
}

export function escapeHtml(value) {
  return String(value ?? "").replace(ESC_RE, (ch) => ESC_MAP[ch]);
}

let toastContainer = null;

/**
 * Wires a .custom-select block to its hidden input.
 *
 * The markup and behaviour match the dropdown on the settings page: a trigger
 * button, a listbox menu, and a hidden input that carries the value and fires
 * "change". Callers keep reading input.value and listening for "change", so
 * swapping a native <select> for this needs no other changes.
 */
export function createSelect(root) {
  const input = root.querySelector('input[type="hidden"]');
  const trigger = root.querySelector(".custom-select-trigger");
  const menu = root.querySelector(".custom-select-menu");
  const label = root.querySelector(".custom-select-value");
  if (!input || !trigger || !menu || !label) return null;

  const options = () => [...menu.querySelectorAll(".custom-select-option")];

  function sync() {
    const current = menu.querySelector(`[data-value="${input.value}"]`);
    if (!current) return;
    label.textContent = current.textContent;
    for (const option of options()) {
      option.setAttribute("aria-selected", String(option === current));
    }
  }

  function close() {
    menu.hidden = true;
    root.classList.remove("custom-select--open", "custom-select--up");
    trigger.setAttribute("aria-expanded", "false");
  }

  function open() {
    close();
    menu.hidden = false;
    root.classList.add("custom-select--open");
    trigger.setAttribute("aria-expanded", "true");
    // Flip above the trigger when there is no room below in the viewport.
    root.classList.remove("custom-select--up");
    const rect = trigger.getBoundingClientRect();
    if (window.innerHeight - rect.bottom < menu.offsetHeight + 12 && rect.top > menu.offsetHeight + 12) {
      root.classList.add("custom-select--up");
    }
  }

  /** Rebuilds the option list, keeping the current value when it survives. */
  function setOptions(list, { placeholder = "" } = {}) {
    const previous = input.value;
    menu.innerHTML =
      (placeholder
        ? `<button type="button" class="custom-select-option" role="option" data-value="">${escapeHtml(placeholder)}</button>`
        : "") +
      list
        .map((o) => `<button type="button" class="custom-select-option" role="option" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`)
        .join("");
    input.value = list.some((o) => o.value === previous) ? previous : "";
    sync();
  }

  trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
  menu.addEventListener("click", (e) => {
    const option = e.target.closest(".custom-select-option");
    if (!option) return;
    const changed = input.value !== option.dataset.value;
    input.value = option.dataset.value;
    sync();
    close();
    if (changed) input.dispatchEvent(new Event("change"));
  });
  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  sync();
  return { close, sync, setOptions, input };
}

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement("div");
  toastContainer.className = "toast-container";
  toastContainer.setAttribute("aria-live", "polite");
  document.body.appendChild(toastContainer);
  return toastContainer;
}

export function toast(message, type = "success", duration = type === "error" ? 5000 : 3200) {
  const container = ensureToastContainer();
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  const icon = type === "error" ? "fa-circle-exclamation" : type === "info" ? "fa-circle-info" : "fa-circle-check";
  el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast-visible"));

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove("toast-visible");
    el.classList.add("toast-leaving");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  };
  const timer = setTimeout(dismiss, duration);
  el.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });
  return el;
}

const FOCUSABLE_RE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function trapFocus(container) {
  const focusable = Array.from(container.querySelectorAll(FOCUSABLE_RE)).filter((el) => el.offsetParent !== null);
  if (focusable.length === 0) return () => {};
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const handler = (e) => {
    if (e.key !== "Tab") return;
    const next = e.shiftKey ? last : first;
    if (next === document.activeElement || !container.contains(document.activeElement)) {
      e.preventDefault();
      next.focus();
    }
  };
  document.addEventListener("keydown", handler, true);
  return () => document.removeEventListener("keydown", handler, true);
}

const confirmQueue = [];
let confirmActive = false;
function pumpConfirmQueue() {
  if (confirmActive || confirmQueue.length === 0) return;
  confirmActive = true;
  const job = confirmQueue.shift();
  runConfirmDialog(job.opts, (result) => {
    job.resolve(result);
    confirmActive = false;
    pumpConfirmQueue();
  });
}

function runConfirmDialog({ title, message, confirmLabel, danger, alertOnly }, resolve) {
  let modal = document.getElementById("confirmModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.id = "confirmModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal confirm-modal-card">
        <h3 class="modal-title" id="confirmModalTitle">Are you sure?</h3>
        <p class="confirm-modal-message" id="confirmModalMessage"></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="confirmModalCancelBtn" type="button">Cancel</button>
          <button class="btn btn-danger" id="confirmModalConfirmBtn" type="button">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  const confirmBtn = modal.querySelector("#confirmModalConfirmBtn");
  const cancelBtn = modal.querySelector("#confirmModalCancelBtn");

  modal.querySelector("#confirmModalTitle").textContent = title;
  modal.querySelector("#confirmModalMessage").textContent = message;
  confirmBtn.textContent = alertOnly ? "OK" : confirmLabel;
  confirmBtn.className = `btn ${danger && !alertOnly ? "btn-danger" : "btn-primary"}`;
  cancelBtn.hidden = alertOnly;

  const previouslyFocused = document.activeElement;
  modal.hidden = false;
  const release = trapFocus(modal);

  function cleanup(result) {
    modal.hidden = true;
    release();
    confirmBtn.removeEventListener("click", onConfirm);
    cancelBtn.removeEventListener("click", onCancel);
    document.removeEventListener("keydown", onKeydown);
    modal.removeEventListener("mousedown", onBackdrop);
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    resolve(result);
  }
  function onConfirm() {
    cleanup(true);
  }
  function onCancel() {
    cleanup(false);
  }
  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup(false);
    } else if (e.key === "Enter" && alertOnly) cleanup(true);
  }
  function onBackdrop(e) {
    if (e.target === modal) cleanup(false);
  }

  confirmBtn.addEventListener("click", onConfirm);
  cancelBtn.addEventListener("click", onCancel);
  document.addEventListener("keydown", onKeydown);
  modal.addEventListener("mousedown", onBackdrop);
  confirmBtn.focus();
}

export function showConfirmDialog(opts = {}) {
  return new Promise((resolve) => {
    confirmQueue.push({ opts, resolve });
    pumpConfirmQueue();
  });
}

export function confirmAction(message, opts = {}) {
  return showConfirmDialog({ message, ...opts });
}

export function closeOnBackdropClick(backdrop, close) {
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
}

export async function copyTextToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Copy this:", text);
    return;
  }
  if (btn) {
    const icon = btn.querySelector("i");
    const prevClass = icon ? icon.className : null;
    btn.classList.add("copied");
    if (icon) icon.className = "fa-solid fa-check";
    setTimeout(() => {
      btn.classList.remove("copied");
      if (icon && prevClass) icon.className = prevClass;
    }, 1200);
  }
}

const RESET_ARTIFACT_TIME = new Date("2026-08-20T19:37:58.589292Z").getTime();
const RESET_ARTIFACT_WINDOW_MS = 5 * 60 * 1000;

export function isResetArtifact(value) {
  if (!value) return false;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return false;
  return Math.abs(t - RESET_ARTIFACT_TIME) <= RESET_ARTIFACT_WINDOW_MS;
}

export function formatAbsoluteTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelativeTime(value) {
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

export function formatUptime(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
