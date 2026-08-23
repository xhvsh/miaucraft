import { supabase } from "./supabaseClient.js";
import { REGISTER_FUNCTION_URL, DELETE_ACCOUNT_FUNCTION_URL, SUPABASE_ANON_KEY } from "./config.js";

function emailFor(username) {
  return `${username.trim().toLowerCase()}@miaucraft.internal`;
}

const listeners = new Set();

const state = {
  ready: false,
  session: null,
  profile: null, // { id, username, role }
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
  // guest by default
  return state.profile?.role ?? "guest";
}

export function can(action) {
  const r = role();
  switch (action) {
    case "viewServerIp":
      return r !== "guest";
    case "addWaypoint":
      return r === "owner" || r === "user";
    case "editServerInfo":
    case "editAnyWaypoint":
    case "manageCategories":
    case "manageWhitelist":
      return r === "owner";
    default:
      return false;
  }
}

export function canEditWaypoint(waypoint) {
  const r = role();
  if (r === "owner") return true;
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
  throw new Error(
    "This Discord account isn't linked to a Miaucraft account. Sign in with your username and password first, then link Discord from Settings."
  );
}

export async function init() {
  const { data } = await supabase.auth.getSession();
  state.session = await withFreshIdentities(data.session ?? null);
  state.profile = state.session ? await loadProfile(state.session.user.id) : null;
  state.ready = true;
  emit();

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      emitPasswordRecovery();
    }
    if (event === "SIGNED_IN" && session) {
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
    emit();
  });
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
  const { error } = await supabase.auth.signInWithPassword({
    email: emailFor(username),
    password,
  });
  if (error) {
    if (error.message?.toLowerCase().includes("invalid login credentials")) {
      throw new Error("Wrong username or password.");
    }
    throw new Error(error.message);
  }
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
  if (error) throw new Error(error.message);
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

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

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
    throw new Error(error.message);
  }
}

export async function linkDiscord() {
  discordForcedUnlinked = false;
  const { error } = await supabase.auth.linkIdentity({
    provider: "discord",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
}

export async function unlinkDiscord() {
  const { data, error: listError } = await supabase.auth.getUserIdentities();
  if (listError) throw new Error(listError.message);
  const identity = data?.identities?.find((i) => i.provider === "discord");
  if (!identity) throw new Error("No linked Discord account.");
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) throw new Error(error.message);

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