import { supabase } from "./supabaseClient.js";
import { REGISTER_FUNCTION_URL, SIGNIN_FUNCTION_URL, DELETE_ACCOUNT_FUNCTION_URL, SUPABASE_ANON_KEY } from "./config.js";

// Supabase error messages can leak SQL/schema details; log the raw error for
// debugging but only surface a generic, user-safe message.
function friendlyError(err, fallback = "Something went wrong. Please try again.") {
  if (err) console.error("Auth error:", err);
  return fallback;
}

const listeners = new Set();

const state = {
  ready: false,
  session: null,
  profile: null,
};

function emit() {
  for (const cb of listeners) cb(state);
}

export function onAuthChange(cb) {
  listeners.add(cb);
  if (state.ready) cb(state);
  return () => listeners.delete(cb);
}

export function getState() {
  return state;
}

export function isLoggedIn() {
  return !!state.session;
}

export function role() {
  return (state.profile?.role ?? "guest").toLowerCase();
}

export function can(action) {
  const r = role();
  switch (action) {
    case "viewServerIp":
      return r !== "guest";
    case "addWaypoint":
      return r === "owner" || r === "admin" || r === "user";
    case "editServerInfo":
    case "editAnyWaypoint":
    case "manageCategories":
      return r === "owner" || r === "admin";
    case "viewAccessCodes":
    case "manageAccessCodes":
    case "manageWhitelist":
      return r === "owner";
    default:
      return false;
  }
}

export function canEditWaypoint(waypoint) {
  const r = role();
  if (r === "owner" || r === "admin") return true;
  if (r === "user") return waypoint.created_by === state.session?.user?.id;
  return false;
}

async function loadProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("id, username, role").eq("id", userId).maybeSingle();
  if (error) {
    console.error("Failed to load profile:", error);
    return null;
  }
  return data;
}

async function withFreshIdentities(session) {
  if (!session) return session;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return session;
  return { ...session, user: data.user };
}

const OAUTH_INTENT_KEY = "miaucraft-oauth-intent";

async function handlePostOAuthSignIn(session) {
  const intent = sessionStorage.getItem(OAUTH_INTENT_KEY);
  sessionStorage.removeItem(OAUTH_INTENT_KEY);
  if (intent !== "login") return true;

  const profile = await loadProfile(session.user.id);
  if (profile) return true;

  await supabase.auth.signOut();
  throw new Error("This Discord account isn't linked to a Miaucraft account. Sign in with your username and password first, then link Discord from Settings.");
}

export async function init() {
  let initialSyncDone = false;

  // Register the listener BEFORE the initial session sync so auth events that
  // fire during startup (OAuth/email-link callbacks, token refresh) aren't lost.
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      emitPasswordRecovery();
    }
    if (initialSyncDone && event === "SIGNED_IN" && session) {
      try {
        await handlePostOAuthSignIn(session);
      } catch (err) {
        console.error(err);
        emitAuthError(err.message);
        state.session = null;
        state.profile = null;
        emit();
        return;
      }
    }
    state.session = await withFreshIdentities(session);
    state.profile = state.session ? await loadProfile(state.session.user.id) : null;
    state.ready = true;
    emit();
  });

  // supabase-js consumes the #access_token=... fragment from OAuth/email-link
  // callbacks but leaves a bare "#" on the URL; strip it so /# never lingers.
  const { data } = await supabase.auth.getSession();
  if (window.location.href.endsWith("#")) {
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }
  initialSyncDone = true;
}

const errorListeners = new Set();
export function onAuthError(cb) {
  errorListeners.add(cb);
  return () => errorListeners.delete(cb);
}
function emitAuthError(message) {
  for (const cb of errorListeners) cb(message);
}

const passwordRecoveryListeners = new Set();
export function onPasswordRecovery(cb) {
  passwordRecoveryListeners.add(cb);
  return () => passwordRecoveryListeners.delete(cb);
}
function emitPasswordRecovery() {
  for (const cb of passwordRecoveryListeners) cb();
}

export async function login(username, password) {
  // Sign-in goes through the /signin edge function so brute-force rate limiting
  // is enforced server-side (per-IP and per-username), not just by Supabase's
  // coarse per-IP token endpoint limit. The function returns a session which we
  // adopt locally so the rest of the app is unaware of the detour.
  const res = await fetch(SIGNIN_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ username, password }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) throw new Error("Too many failed sign-in attempts. Try again in about an hour.");
    throw new Error(body.error || "Wrong username or password.");
  }
  if (!body.session) throw new Error("Sign-in succeeded but no session was returned.");

  const { error } = await supabase.auth.setSession(body.session);
  if (error) throw new Error(friendlyError(error, "Couldn't sign in. Please try again."));
}

export async function register(username, password, accessCode) {
  const res = await fetch(REGISTER_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ username, password, accessCode }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Registration failed.");
  }

  await login(username, password);
  return body;
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyError(error, "Couldn't update your password."));
}

export async function deleteAccount() {
  const token = state.session?.access_token;
  if (!token) throw new Error("Not logged in.");

  const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Failed to delete account.");
  }

  await supabase.auth.signOut();
}

export async function listProfiles() {
  const { data, error } = await supabase.from("profiles").select("id, username, role, created_at").order("created_at", { ascending: true });
  if (error) {
    if (error.code === "42501") throw new Error("Admins can't read the accounts table yet - the RLS policy from the SQL below isn't applied.");
    throw new Error(friendlyError(error, "Couldn't load accounts."));
  }
  return data ?? [];
}

export async function revokeAccount(username) {
  const { data, error } = await supabase.rpc("delete_account_by_username", { _username: username });
  if (error) {
    if (error.code === "PGRST202") throw new Error("The delete_account_by_username function isn't set up yet - run the SQL below.");
    throw new Error(friendlyError(error, "Couldn't revoke that account."));
  }
  if (data === false) throw new Error("Only owners can delete accounts.");
  if (data?.error) throw new Error(data.error);
}

export async function updateUserRole(profileId, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", profileId);
  if (error) {
    if (error.code === "42501") throw new Error("Role changes aren't allowed yet - the profiles_update_owner_only RLS policy may not cover this.");
    throw new Error(friendlyError(error, "Couldn't update that role."));
  }
}

export async function updateUsername(profileId, newUsername) {
  const { data, error } = await supabase.rpc("update_username_by_profile", { _profile_id: profileId, _new_username: newUsername });
  if (error) {
    if (error.code === "PGRST202") throw new Error("The update_username_by_profile function isn't set up yet - run the SQL below.");
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// discord handling

let discordForcedUnlinked = false;

export function discordIdentity() {
  if (discordForcedUnlinked) return null;
  return state.session?.user?.identities?.find((i) => i.provider === "discord") ?? null;
}

export async function loginWithDiscord() {
  sessionStorage.setItem(OAUTH_INTENT_KEY, "login");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: window.location.origin },
  });
  if (error) {
    sessionStorage.removeItem(OAUTH_INTENT_KEY);
    throw new Error(friendlyError(error, "Couldn't start Discord sign-in."));
  }
}

export async function linkDiscord() {
  discordForcedUnlinked = false;
  const { error } = await supabase.auth.linkIdentity({
    provider: "discord",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(friendlyError(error, "Couldn't link Discord."));
}

export async function unlinkDiscord() {
  const { data, error: listError } = await supabase.auth.getUserIdentities();
  if (listError) throw new Error(friendlyError(listError, "Couldn't unlink Discord."));
  const identity = data?.identities?.find((i) => i.provider === "discord");
  if (!identity) throw new Error("No linked Discord account.");
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) throw new Error(friendlyError(error, "Couldn't unlink Discord."));

  discordForcedUnlinked = true;

  if (state.session?.user) {
    state.session = {
      ...state.session,
      user: {
        ...state.session.user,
        identities: (state.session.user.identities || []).filter((i) => i.provider !== "discord"),
      },
    };
  }
  emit();
}
