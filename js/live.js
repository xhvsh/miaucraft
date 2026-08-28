import { supabase } from "./supabaseClient.js";

const SCHEMA = "public";

const db = (table) => (SCHEMA === "public" ? supabase.from(table) : supabase.schema(SCHEMA).from(table));

export async function listPlayers() {
  const { data, error } = await db("players").select("*").eq("hidden", false);
  if (error) throw error;
  return data;
}

export function subscribePlayers(onChange) {
  const channel = supabase.channel("players-changes").on("postgres_changes", { event: "*", schema: SCHEMA, table: "players" }, onChange).subscribe();
  return () => supabase.removeChannel(channel);
}

export async function listAccountUsernamesLower() {
  const { data, error } = await supabase.rpc("list_account_usernames");
  if (error) throw error;
  return new Set(data.map((username) => username.toLowerCase()));
}

export async function listPlayerStats(statKeys, limit = 10) {
  const keys = Array.isArray(statKeys) ? statKeys : [statKeys];
  for (const key of keys) {
    const { data, error } = await db("player_stats").select("player_id, stat_value, players!inner(username)").eq("stat_key", key).eq("players.hidden", false).order("stat_value", { ascending: false }).limit(limit);
    if (error) throw error;
    if (data && data.length > 0) return data;
  }
  return [];
}

export async function listStatKeys() {
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

export async function listDistanceLeaderboard(limit = 10) {
  const query = SCHEMA === "public" ? supabase.rpc("distance_leaderboard", { limit_count: limit }) : supabase.schema(SCHEMA).rpc("distance_leaderboard", { limit_count: limit });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({ stat_value: row.stat_value, players: { username: row.username } }));
}

export async function getTop1Summary() {
  const query = SCHEMA === "public" ? supabase.rpc("get_top1_summary") : supabase.schema(SCHEMA).rpc("get_top1_summary");
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// live positions

export async function listLivePositions() {
  const { data, error } = await db("live_positions").select("*, players!inner(username, afk)").eq("players.hidden", false);
  if (error) throw error;
  return data;
}

export function subscribeLivePositions(onChange) {
  const channel = supabase.channel("live-positions-changes").on("postgres_changes", { event: "*", schema: SCHEMA, table: "live_positions" }, onChange).subscribe();
  return () => supabase.removeChannel(channel);
}

export async function getPlayerByUsername(username) {
  const { data, error } = await db("players").select("id, live_tracking_enabled").ilike("username", username).eq("hidden", false).maybeSingle();
  if (error) throw error;
  return data;
}

// profile pages

export async function getPlayerProfile(username) {
  const { data, error } = await db("players").select("id, username, online, last_seen, live_tracking_enabled").ilike("username", username).eq("hidden", false).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAllPlayerStats(playerId) {
  const pageSize = 1000;
  let allRows = [];
  let from = 0;

  while (true) {
    const { data, error } = await db("player_stats")
      .select("stat_key, stat_value")
      .eq("player_id", playerId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    allRows = allRows.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

export async function getLiveTrackingEnabled(playerId) {
  const { data, error } = await db("players").select("live_tracking_enabled").eq("id", playerId).single();
  if (error) throw error;
  return data.live_tracking_enabled;
}

export async function setLiveTracking(playerId, enabled) {
  const { data, error } = await db("players").update({ live_tracking_enabled: enabled }).eq("id", playerId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Update was blocked - check that a Row Level Security policy allows updating your own player row.");
  }
}

// server status

export async function getServerStatus() {
  const { data, error } = await db("server_status_public").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

export function subscribeServerStatus(onChange) {
  const channel = supabase.channel("server-status-changes").on("postgres_changes", { event: "*", schema: SCHEMA, table: "server_status_public" }, onChange).subscribe();
  return () => supabase.removeChannel(channel);
}

// whitelist

export async function listWhitelist() {
  const { data, error } = await db("whitelist").select("*").order("username", { ascending: true });
  if (error) throw error;
  return data;
}

export function subscribeWhitelist(onChange) {
  const channel = supabase.channel("whitelist-changes").on("postgres_changes", { event: "*", schema: SCHEMA, table: "whitelist" }, onChange).subscribe();
  return () => supabase.removeChannel(channel);
}

export async function listPendingWhitelistCommands() {
  const { data, error } = await db("whitelist_commands").select("*").eq("status", "pending").order("requested_at", { ascending: true });
  if (error) throw error;
  return data;
}

export function subscribeWhitelistCommands(onChange) {
  const channel = supabase.channel("whitelist-commands-changes").on("postgres_changes", { event: "*", schema: SCHEMA, table: "whitelist_commands" }, onChange).subscribe();
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
