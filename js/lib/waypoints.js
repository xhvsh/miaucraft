import { supabase } from "./supabaseClient.js";

export const DEFAULT_CATEGORY_ICON_CLASS = "fa-solid fa-hashtag";

export function sanitizeIconClass(raw) {
  const tokens = (raw || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean)
    .map((t) => (t.startsWith("fa-") ? t : `fa-${t}`));

  if (tokens.length === 0) return DEFAULT_CATEGORY_ICON_CLASS;
  if (tokens.length === 1) return `fa-solid ${tokens[0]}`;
  return tokens.join(" ");
}

export function categoryIconClass(rawIcon) {
  const value = (rawIcon || "").trim();
  if (!value) return DEFAULT_CATEGORY_ICON_CLASS;
  if (value.includes("fa-")) return sanitizeIconClass(value);
  return `fa-solid fa-${value.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
}

export async function listWaypoints(dimension) {
  const { data, error } = await supabase.from("waypoints").select("*").eq("dimension", dimension).order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listWaypointsByUsername(username) {
  const { data, error } = await supabase.from("waypoints").select("*").ilike("created_by_username", username).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createWaypoint(waypoint) {
  const { data, error } = await supabase.from("waypoints").insert(waypoint).select().single();
  if (error) throw error;
  return data;
}

export async function updateWaypoint(id, patch, before) {
  if (before && Object.keys(patch).every((key) => before[key] === patch[key])) {
    return before;
  }
  const { data, error } = await supabase.from("waypoints").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteWaypoint(id) {
  const { error } = await supabase.from("waypoints").delete().eq("id", id);
  if (error) throw error;
}

export async function listCategories() {
  const { data, error } = await supabase.from("categories").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createCategory(category) {
  const { data, error } = await supabase.from("categories").insert(category).select().single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, patch, before) {
  if (before && Object.keys(patch).every((key) => before[key] === patch[key])) {
    return before;
  }
  const { data, error } = await supabase.from("categories").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function listLogs(limit = 1000) {
  const { data, error } = await supabase.from("logs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
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
