import { supabase } from "./supabaseClient.js";

export async function listWaypoints(dimension) {
  const { data, error } = await supabase
    .from("waypoints")
    .select("*")
    .eq("dimension", dimension)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createWaypoint(waypoint) {
  const { data, error } = await supabase.from("waypoints").insert(waypoint).select().single();
  if (error) throw error;
  return data;
}

export async function updateWaypoint(id, patch) {
  const { data, error } = await supabase
    .from("waypoints")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteWaypoint(id) {
  const { error } = await supabase.from("waypoints").delete().eq("id", id);
  if (error) throw error;
}

export async function getServerInfo() {
  const { data, error } = await supabase.from("server_info").select("key, value");
  if (error) throw error;
  const map = {};
  for (const row of data) map[row.key] = row.value;
  return map;
}

export async function setServerInfo(key, value) {
  const { error } = await supabase.from("server_info").upsert({ key, value });
  if (error) throw error;
}
