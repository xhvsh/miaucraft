import { supabase } from "./supabaseClient.js";

// Set to "test" locally (after running 002_test_schema.sql) to develop
// against isolated tables without touching production data or needing a
// second Supabase project. Leave as "public" for the real deployment.
const SCHEMA = "public";

const db = (table) => (SCHEMA === "public" ? supabase.from(table) : supabase.schema(SCHEMA).from(table));

// ---------------------------------------------------------------------------
// Players (list + last-seen)
// ---------------------------------------------------------------------------

export async function listPlayers() {
  const { data, error } = await db("players").select("*");
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
    const { data, error } = await db("player_stats").select("player_id, stat_value, players(username)").eq("stat_key", key).order("stat_value", { ascending: false }).limit(limit);
    if (error) throw error;
    if (data && data.length > 0) return data;
  }
  return [];
}

export async function listStatKeys() {
  const { data, error } = await (SCHEMA === "public" ? supabase.rpc("list_stat_keys") : supabase.schema(SCHEMA).rpc("list_stat_keys"));
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Live positions
// ---------------------------------------------------------------------------

export async function listLivePositions() {
  const { data, error } = await db("live_positions").select("*, players(username, afk)");
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