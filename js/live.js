import { supabase } from "./supabaseClient.js";

const SCHEMA = "public";

const db = (table) => (SCHEMA === "public" ? supabase.from(table) : supabase.schema(SCHEMA).from(table));

// ---------------------------------------------------------------------------
// Players (list + last-seen)
// ---------------------------------------------------------------------------

export async function listPlayers() {
  // Hidden covers both merged duplicate accounts (see merged_into) and
  // manually-hidden accounts like "test".
  const { data, error } = await db("players").select("*").eq("hidden", false);
  if (error) throw error;
  return data;
}

export function subscribePlayers(onChange) {
  const channel = supabase
    .channel("players-changes")
    .on("postgres_changes", { event: "*", schema: SCHEMA, table: "players" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// Usernames (lowercased) that have a website account, for the "has account" badge.
export async function listAccountUsernamesLower() {
  const { data, error } = await supabase.rpc("list_account_usernames");
  if (error) throw error;
  return new Set(data.map((username) => username.toLowerCase()));
}

export async function listPlayerStats(statKeys, limit = 10) {
  const keys = Array.isArray(statKeys) ? statKeys : [statKeys];
  for (const key of keys) {
    // players!inner + players.hidden filter: excludes stat rows belonging to
    // hidden/merged-away player accounts from leaderboards.
    const { data, error } = await db("player_stats")
      .select("player_id, stat_value, players!inner(username)")
      .eq("stat_key", key)
      .eq("players.hidden", false)
      .order("stat_value", { ascending: false })
      .limit(limit);
    if (error) throw error;
    if (data && data.length > 0) return data;
  }
  return [];
}

export async function listStatKeys() {
  // Supabase/PostgREST caps rows returned per request (commonly 1000) unless
  // paginated. With 1000+ distinct stat_key values now, an unpaginated call
  // silently truncates alphabetically - e.g. PICKUP/USE_ITEM sort late enough
  // to fall past the cutoff after all the MINE_BLOCK/BREAK_ITEM/CRAFT_ITEM
  // rows ahead of them. Page through with .range() until a page comes back
  // short, so we always get the full set regardless of the project's cap.
  const pageSize = 1000;
  let allKeys = [];
  let from = 0;

  while (true) {
    const query = SCHEMA === "public" ? supabase.rpc("list_stat_keys") : supabase.schema(SCHEMA).rpc("list_stat_keys");
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    allKeys = allKeys.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allKeys;
}

// Sums every "*_CM" distance stat per player server-side (WALK_ONE_CM,
// SPRINT_ONE_CM, AVIATE_ONE_CM, BOAT_ONE_CM, etc.) via the distance_leaderboard
// RPC, rather than a single stat_key lookup. Shaped to match listPlayerStats's
// row shape ({ stat_value, players: { username } }) so it drops straight into
// the existing leaderboard row renderer.
export async function listDistanceLeaderboard(limit = 10) {
  const query = SCHEMA === "public" ? supabase.rpc("distance_leaderboard", { limit_count: limit }) : supabase.schema(SCHEMA).rpc("distance_leaderboard", { limit_count: limit });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({ stat_value: row.stat_value, players: { username: row.username } }));
}

// ---------------------------------------------------------------------------
// Live positions
// ---------------------------------------------------------------------------

export async function listLivePositions() {
  const { data, error } = await db("live_positions").select("*, players!inner(username, afk)").eq("players.hidden", false);
  if (error) throw error;
  return data;
}

export function subscribeLivePositions(onChange) {
  const channel = supabase
    .channel("live-positions-changes")
    .on("postgres_changes", { event: "*", schema: SCHEMA, table: "live_positions" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---------------------------------------------------------------------------
// Live tracking opt-out (per-player)
// ---------------------------------------------------------------------------

// profiles.id (the logged-in account) and players.id are different id spaces
// - the only link between an account and its player row is the username.
// This is also why listAccountUsernamesLower() above works by username.
// hidden=false excludes merged-away duplicate accounts (see players.hidden
// above) - without it, a username with a merged history can match more than
// one row and maybeSingle() throws "multiple rows returned".
export async function getPlayerByUsername(username) {
  const { data, error } = await db("players").select("id, live_tracking_enabled").ilike("username", username).eq("hidden", false).maybeSingle();
  if (error) throw error;
  return data;
}

// Current value of a player's opt-out flag, read straight from the DB (never
// cached in localStorage) so it can't drift from what the tracking plugin
// itself is honoring server-side.
export async function getLiveTrackingEnabled(playerId) {
  const { data, error } = await db("players").select("live_tracking_enabled").eq("id", playerId).single();
  if (error) throw error;
  return data.live_tracking_enabled;
}

export async function setLiveTracking(playerId, enabled) {
  // .select() forces Postgres to return the row(s) actually touched. If an
  // RLS policy silently blocks the update, Supabase reports no error but
  // matches zero rows - without .select() that looks identical to success.
  const { data, error } = await db("players").update({ live_tracking_enabled: enabled }).eq("id", playerId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Update was blocked - check that a Row Level Security policy allows updating your own player row.");
  }
}

// ---------------------------------------------------------------------------
// Server status (TPS / uptime / version - public, no connection info)
// ---------------------------------------------------------------------------

export async function getServerStatus() {
  const { data, error } = await db("server_status_public").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

export function subscribeServerStatus(onChange) {
  const channel = supabase
    .channel("server-status-changes")
    .on("postgres_changes", { event: "*", schema: SCHEMA, table: "server_status_public" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---------------------------------------------------------------------------
// Whitelist - read-only mirror of the server's real whitelist (owner-only,
// enforced by RLS). Adds/removes go through whitelist_commands instead of
// writing this table directly; the plugin executes them as real
// /whitelist add|remove commands and the mirror reflects the result shortly
// after.
// ---------------------------------------------------------------------------

export async function listWhitelist() {
  const { data, error } = await db("whitelist").select("*").order("username", { ascending: true });
  if (error) throw error;
  return data;
}

export function subscribeWhitelist(onChange) {
  const channel = supabase
    .channel("whitelist-changes")
    .on("postgres_changes", { event: "*", schema: SCHEMA, table: "whitelist" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export async function listPendingWhitelistCommands() {
  const { data, error } = await db("whitelist_commands").select("*").eq("status", "pending").order("requested_at", { ascending: true });
  if (error) throw error;
  return data;
}

export function subscribeWhitelistCommands(onChange) {
  const channel = supabase
    .channel("whitelist-commands-changes")
    .on("postgres_changes", { event: "*", schema: SCHEMA, table: "whitelist_commands" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export async function cancelWhitelistCommand(id) {
  const { error } = await db("whitelist_commands").delete().eq("id", id);
  if (error) throw error;
}

export async function requestWhitelistAdd(username) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await db("whitelist_commands").insert({ action: "add", username: username.trim(), requested_by: user?.id ?? null });
  if (error) throw error;
}

export async function requestWhitelistRemove(username) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await db("whitelist_commands").insert({ action: "remove", username: username.trim(), requested_by: user?.id ?? null });
  if (error) throw error;
}