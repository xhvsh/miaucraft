import { supabase } from "./supabaseClient.js";
import { REGISTER_FUNCTION_URL, SUPABASE_ANON_KEY } from "./config.js";

// Username-only accounts: Supabase Auth needs *an* email under the hood, so
// we derive one deterministically and never surface it anywhere.
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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("Failed to load profile:", error);
    return null;
  }
  return data;
}

export async function init() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session ?? null;
  state.profile = state.session ? await loadProfile(state.session.user.id) : null;
  state.ready = true;
  emit();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.profile = session ? await loadProfile(session.user.id) : null;
    emit();
  });
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
