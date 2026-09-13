// Shared UI utilities used across every page: toasts, confirm dialog,
// clipboard, and the time/text formatters that were duplicated between
// app.js and profile.js in the old build.

export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

let toastContainer = null;
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

export function showConfirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", danger = true, alertOnly = false } = {}) {
  return new Promise((resolve) => {
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

    modal.hidden = false;

    function cleanup(result) {
      modal.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKeydown);
      modal.removeEventListener("mousedown", onBackdrop);
      resolve(result);
    }
    function onConfirm() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    function onKeydown(e) {
      if (e.key === "Escape") cleanup(false);
      else if (e.key === "Enter" && alertOnly) cleanup(true);
    }
    function onBackdrop(e) {
      if (e.target === modal) cleanup(false);
    }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKeydown);
    modal.addEventListener("mousedown", onBackdrop);
    confirmBtn.focus();
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
