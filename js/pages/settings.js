import * as Auth from "../lib/auth.js";
import { setLiveTracking, getPlayerByUsername } from "../lib/live.js";
import { settings, saveSettings } from "../lib/settings.js";
import { toast, confirmAction, closeOnBackdropClick } from "../lib/ui.js";
import { initNav } from "../lib/nav.js";

const $ = (sel) => document.querySelector(sel);

await initNav("settings");

const settingHideFilteredEl = $("#settingHideFiltered");
const settingCopyFormatEl = $("#settingCopyFormat");
const settingShowConversionEl = $("#settingShowConversion");
const settingDisableLiveTrackingEl = $("#settingDisableLiveTracking");
const settingLiveTrackingErrorHintEl = $("#settingLiveTrackingErrorHint");
const settingsAuthOnlyEl = $("#settingsAuthOnly");
const settingsLoginFooterEl = $("#settingsLoginFooter");
const settingDiscordActionEl = $("#settingDiscordAction");
const changePasswordModal = $("#changePasswordModal");

function updateSettingsUI() {
  settingHideFilteredEl.checked = settings.hideFilteredWaypoints;
  settingCopyFormatEl.value = settings.copyFormat;
  syncCopyFormatLabel();
  settingShowConversionEl.checked = settings.showDimensionConversion;
}

settingHideFilteredEl.addEventListener("change", () => {
  settings.hideFilteredWaypoints = settingHideFilteredEl.checked;
  saveSettings();
});
settingCopyFormatEl.addEventListener("change", () => {
  settings.copyFormat = settingCopyFormatEl.value;
  saveSettings();
});
settingShowConversionEl.addEventListener("change", () => {
  settings.showDimensionConversion = settingShowConversionEl.checked;
  saveSettings();
});

// custom dropdown for the coordinate format (keeps the hidden input's
// value + change contract so the save logic stays untouched)
const copyFormatSelectEl = $("#settingCopyFormatSelect");
const copyFormatTriggerEl = copyFormatSelectEl.querySelector(".custom-select-trigger");
const copyFormatMenuEl = copyFormatSelectEl.querySelector(".custom-select-menu");
const copyFormatValueEl = copyFormatSelectEl.querySelector(".custom-select-value");

function syncCopyFormatLabel() {
  const current = copyFormatMenuEl.querySelector(`[data-value="${settingCopyFormatEl.value}"]`);
  if (!current) return;
  copyFormatValueEl.textContent = current.textContent;
  for (const option of copyFormatMenuEl.querySelectorAll(".custom-select-option")) {
    option.setAttribute("aria-selected", String(option === current));
  }
}

function closeCopyFormatMenu() {
  copyFormatMenuEl.hidden = true;
  copyFormatSelectEl.classList.remove("custom-select--open", "custom-select--up");
  copyFormatTriggerEl.setAttribute("aria-expanded", "false");
}

copyFormatTriggerEl.addEventListener("click", () => {
  if (copyFormatMenuEl.hidden) {
    copyFormatMenuEl.hidden = false;
    copyFormatSelectEl.classList.add("custom-select--open");
    copyFormatTriggerEl.setAttribute("aria-expanded", "true");
    // flip above the trigger when there is no room below in the viewport
    copyFormatSelectEl.classList.remove("custom-select--up");
    const rect = copyFormatTriggerEl.getBoundingClientRect();
    if (window.innerHeight - rect.bottom < copyFormatMenuEl.offsetHeight + 12 && rect.top > copyFormatMenuEl.offsetHeight + 12) {
      copyFormatSelectEl.classList.add("custom-select--up");
    }
  } else {
    closeCopyFormatMenu();
  }
});

copyFormatMenuEl.addEventListener("click", (e) => {
  const option = e.target.closest(".custom-select-option");
  if (!option) return;
  const changed = settingCopyFormatEl.value !== option.dataset.value;
  settingCopyFormatEl.value = option.dataset.value;
  syncCopyFormatLabel();
  closeCopyFormatMenu();
  if (changed) settingCopyFormatEl.dispatchEvent(new Event("change"));
});

document.addEventListener("click", (e) => {
  if (!copyFormatSelectEl.contains(e.target)) closeCopyFormatMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCopyFormatMenu();
});

function updateSettingsAuthVisibility() {
  const loggedIn = Auth.isLoggedIn();
  settingsAuthOnlyEl.hidden = !loggedIn;
  settingsLoginFooterEl.hidden = loggedIn;
}

let liveTrackingPlayerId = null;
async function refreshLiveTrackingSetting() {
  const state = Auth.getState();
  liveTrackingPlayerId = null;
  settingLiveTrackingErrorHintEl.hidden = true;
  if (!state.session || !state.profile) {
    settingDisableLiveTrackingEl.checked = false;
    settingDisableLiveTrackingEl.disabled = true;
    return;
  }
  try {
    const player = await getPlayerByUsername(state.profile.username);
    if (!player) {
      settingDisableLiveTrackingEl.checked = false;
      settingDisableLiveTrackingEl.disabled = true;
      settingLiveTrackingErrorHintEl.textContent = `No player row found for username "${state.profile.username}".`;
      settingLiveTrackingErrorHintEl.hidden = false;
      return;
    }
    liveTrackingPlayerId = player.id;
    settingDisableLiveTrackingEl.checked = !player.live_tracking_enabled;
    settingDisableLiveTrackingEl.disabled = false;
  } catch (err) {
    console.error(err);
    settingDisableLiveTrackingEl.disabled = true;
    settingLiveTrackingErrorHintEl.textContent = err.message || "Could not load this setting.";
    settingLiveTrackingErrorHintEl.hidden = false;
    toast(err.message || "Could not load live tracking setting.", "error");
  }
}

settingDisableLiveTrackingEl.addEventListener("change", async () => {
  if (!liveTrackingPlayerId) {
    settingDisableLiveTrackingEl.checked = !settingDisableLiveTrackingEl.checked;
    toast("Could not update live tracking - your player row wasn't found.", "error");
    return;
  }
  const wantsDisabled = settingDisableLiveTrackingEl.checked;
  settingDisableLiveTrackingEl.disabled = true;
  try {
    await setLiveTracking(liveTrackingPlayerId, !wantsDisabled);
  } catch (err) {
    console.error(err);
    settingDisableLiveTrackingEl.checked = !wantsDisabled;
    settingLiveTrackingErrorHintEl.textContent = err.message || "Could not update live tracking.";
    settingLiveTrackingErrorHintEl.hidden = false;
    toast(err.message || "Could not update live tracking.", "error");
  } finally {
    settingDisableLiveTrackingEl.disabled = false;
  }
});

function renderDiscordSetting() {
  settingDiscordActionEl.innerHTML = "";
  if (!Auth.isLoggedIn()) {
    settingDiscordActionEl.innerHTML = `<span class="settings-row-hint">Log in to link</span>`;
    return;
  }
  const identity = Auth.discordIdentity();
  if (!identity) {
    const linkBtn = document.createElement("button");
    linkBtn.className = "btn btn-discord";
    linkBtn.type = "button";
    linkBtn.innerHTML = `<i class="fa-brands fa-discord" aria-hidden="true"></i> Link Discord`;
    linkBtn.addEventListener("click", async () => {
      linkBtn.disabled = true;
      try {
        await Auth.linkDiscord();
      } catch (err) {
        toast(err.message || "Could not link Discord.", "error");
        linkBtn.disabled = false;
      }
    });
    settingDiscordActionEl.appendChild(linkBtn);
    return;
  }

  const data = identity.identity_data || {};
  const discordUsername = (data.user_name || data.name || data.full_name || "Unknown").replace(/#0$/, "");

  const wrap = document.createElement("div");
  wrap.className = "discord-linked";
  wrap.innerHTML = `
    <span class="discord-linked-label">
      <span class="discord-linked-name-line"><i class="fa-brands fa-discord" aria-hidden="true"></i> <span class="discord-linked-name"></span></span>
    </span>
  `;
  wrap.querySelector(".discord-linked-name").textContent = discordUsername;

  const unlinkBtn = document.createElement("button");
  unlinkBtn.className = "btn btn-danger";
  unlinkBtn.type = "button";
  unlinkBtn.textContent = "Unlink";
  unlinkBtn.addEventListener("click", async () => {
    const confirmed = await confirmAction("You'll need your username and password to sign in.", { title: "Unlink Discord account?", confirmLabel: "Unlink" });
    if (!confirmed) return;
    unlinkBtn.disabled = true;
    try {
      await Auth.unlinkDiscord();
      toast("Discord account unlinked.");
      renderDiscordSetting();
    } catch (err) {
      toast(err.message || "Could not unlink Discord.", "error");
      unlinkBtn.disabled = false;
    }
  });
  wrap.appendChild(unlinkBtn);
  settingDiscordActionEl.appendChild(wrap);
}

// change password modal

function openChangePasswordModal() {
  changePasswordModal.hidden = false;
}
function closeChangePasswordModal() {
  changePasswordModal.hidden = true;
  $("#changePasswordForm").reset();
}
closeOnBackdropClick(changePasswordModal, closeChangePasswordModal);
$("#changePasswordModalClose").addEventListener("click", closeChangePasswordModal);
$("#changePasswordBtn").addEventListener("click", openChangePasswordModal);

changePasswordModal.querySelectorAll("[data-password-toggle]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.passwordToggle);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.querySelector("i").className = showing ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
  });
});

$("#changePasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const newPassword = $("#newPassword").value;
  const repeat = $("#newPasswordRepeat").value;
  if (newPassword !== repeat) {
    toast("Passwords don't match.", "error");
    return;
  }
  try {
    await Auth.updatePassword(newPassword);
    closeChangePasswordModal();
    toast("Password updated.");
  } catch (err) {
    toast(err.message || "Could not update password.", "error");
  }
});

$("#deleteAccountBtn").addEventListener("click", async () => {
  const confirmed = await confirmAction("This permanently deletes your account and everything tied to it. This can't be undone.", { title: "Delete your account?", confirmLabel: "Delete account" });
  if (!confirmed) return;
  try {
    await Auth.deleteAccount();
    toast("Account deleted.");
  } catch (err) {
    toast(err.message || "Could not delete account.", "error");
  }
});

Auth.onPasswordRecovery(() => openChangePasswordModal());

updateSettingsUI();
Auth.onAuthChange(() => {
  updateSettingsAuthVisibility();
  refreshLiveTrackingSetting();
  renderDiscordSetting();
});
