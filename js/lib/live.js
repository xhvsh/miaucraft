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

export async function getTop3Summary() {
  const query = SCHEMA === "public" ? supabase.rpc("get_top3_summary") : supabase.schema(SCHEMA).rpc("get_top3_summary");
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// live positions

export async function listLivePositions() {
  const { data, error } = await db("live_positions").select("*, players!inner(username, afk, online)").eq("players.hidden", false);
  if (error) throw error;
  return data;
}

export function subscribeLivePositions(onChange) {
  const channel = supabase.channel("live-positions-changes").on("postgres_changes", { event: "*", schema: SCHEMA, table: "live_positions" }, onChange).subscribe();
  return () => supabase.removeChannel(channel);
}

// biome map

/**
 * Reads one stride x stride biome cell grid covering the chunk box. PostgREST
 * caps RPC output at 1000 rows/page, so cells are paged until the box is fully
 * drained. Returns rows of {cell_x, cell_z, biome}.
 */
export async function listBiomeCells(dimension, minCx, maxCx, minCz, maxCz, stride) {
  const pageSize = 1000;
  const args = { p_dimension: dimension, p_stride: stride, p_min_cx: minCx, p_max_cx: maxCx, p_min_cz: minCz, p_max_cz: maxCz };
  let all = [];
  let from = 0;
  while (true) {
    const rpc = SCHEMA === "public" ? supabase.rpc("biomes_sample", args) : supabase.schema(SCHEMA).rpc("biomes_sample", args);
    const { data, error } = await rpc.range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) break;
    all = all.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return all;
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

// achievements

export async function getAchievementsCatalog() {
  const query = (cols) => db("achievements").select(cols).order("title", { ascending: true });
  const { data, error } = await query("key, title, description, frame, hidden, icon, total_criteria, min_criteria");
  if (error) {
    // Older schema before the min_criteria column was added: fall back without it.
    const retry = await query("key, title, description, frame, hidden, icon, total_criteria");
    if (retry.error) throw retry.error;
    return retry.data ?? [];
  }
  return data ?? [];
}

export async function getAchievementCriteriaCatalog() {
  const pageSize = 1000;
  let allRows = [];
  let from = 0;

  while (true) {
    const { data, error } = await db("achievement_criteria")
      .select("achievement_key, criterion_key")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    allRows = allRows.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

export async function getPlayerAchievements(playerId) {
  const { data, error } = await db("player_achievements").select("achievement_key, completed, criteria_done, criteria_total, completed_at").eq("player_id", playerId);
  if (error) throw error;
  return data ?? [];
}

export async function getPlayerAchievementCriteria(playerId) {
  const pageSize = 1000;
  let allRows = [];
  let from = 0;

  while (true) {
    const { data, error } = await db("player_achievement_criteria")
      .select("achievement_key, criterion_key, done")
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

/**
 * Returns a per-page staleness checker that learns the server's real heartbeat
 * interval from consecutive status updates. Stale threshold = 2.2x the median
 * observed beat (floor 10s, ceiling 60s), so it behaves correctly whether the
 * plugin currently heartbeats every 8s or every 25s - no hardcoded window that
 * can drift into false "offline" states.
 */
export function createStatusStaleChecker() {
  let lastAt = 0;
  const deltas = [];
  let median = 0;
  return (status) => {
    if (!status || !status.updated_at) return true;
    const t = new Date(status.updated_at).getTime();
    if (Number.isFinite(t)) {
      if (lastAt > 0 && t > lastAt) {
        const delta = t - lastAt;
        if (delta > 0 && delta < 600000) {
          deltas.push(delta);
          if (deltas.length > 5) deltas.splice(0, deltas.length - 5);
          const sorted = [...deltas].sort((a, b) => a - b);
          median = sorted[Math.floor(sorted.length / 2)];
        }
      }
      lastAt = Math.max(lastAt, t);
    }
    const staleMs = median <= 0
      ? 30000
      : Math.max(10000, Math.min(60000, Math.round(median * 2.2)));
    return Date.now() - t > staleMs;
  };
}

export async function listTpsSeries(hours) {
  const bucketSeconds = hours <= 1 ? 10 : 300;
  const { data, error } = await supabase.rpc("get_tps_series", { p_hours: hours, p_bucket_seconds: bucketSeconds });
  if (error) throw error;
  return (data ?? []).map((r) => ({ t: Date.parse(r.bucket), tps: Number(r.tps), players: Number(r.players_online) }));
}

export async function getLeaderboardLastUpdated() {
  const { data, error } = await db("player_stats").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.updated_at ?? null;
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

// access codes

export async function listAccessCodes() {
  const { data, error } = await db("access_codes")
    .select("code, role, used, used_by, created_by, created_at, used_at, profiles!access_codes_used_by_fkey(username)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function accessCodeExists(code) {
  const { data, error } = await db("access_codes").select("code").eq("code", code).maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function createAccessCode(entry) {
  const { error } = await db("access_codes").insert(entry);
  if (error) throw error;
}

export async function updateAccessCodeRole(code, role) {
  const { error } = await db("access_codes").update({ role }).eq("code", code);
  if (error) throw error;
}

export async function deleteAccessCode(code) {
  const { error } = await db("access_codes").delete().eq("code", code);
  if (error) throw error;
}
