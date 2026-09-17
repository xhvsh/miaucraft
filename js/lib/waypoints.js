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

export async function listWaypointsByUsername(username, userId) {
  const userName = String(username ?? "");
  let rows = [];
  if (userId) {
    const { data, error } = await supabase
      .from("waypoints")
      .select("*")
      .or(`created_by_username.ilike.${userName},owner_id.eq.${userId}`)
      .order("created_at", { ascending: true });
    if (error) throw error;
    rows = data ?? [];
  } else {
    const { data, error } = await supabase
      .from("waypoints")
      .select("*")
      .or(`created_by_username.ilike.${userName},owner_username.ilike.${userName}`)
      .order("created_at", { ascending: true });
    if (error) throw error;
    rows = data ?? [];
  }
  try {
    if (userId) {
      const { data: collab, error: collabError } = await supabase.from("waypoint_collaborators").select("waypoint_id").eq("user_id", userId);
      if (collabError) throw collabError;
      const ids = (collab ?? []).map((c) => c.waypoint_id);
      if (ids.length) {
        const { data: collabWps, error: cErr } = await supabase.from("waypoints").select("*").in("id", ids);
        if (!cErr && collabWps) {
          const seen = new Set(rows.map((w) => w.id));
          rows = rows.concat(collabWps.filter((w) => !seen.has(w.id)));
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
  return rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export function validateWaypointInput(waypoint) {
  const name = String(waypoint?.name ?? "").trim();
  if (!name) return "Name is required.";
  if (name.length > 60) return "Name is too long (60 characters max).";
  const description = String(waypoint?.description ?? "").trim();
  if (description.length > 160) return "Description is too long (160 characters max).";
  if (waypoint?.x !== undefined && waypoint?.x !== null && !Number.isFinite(Number(waypoint.x))) return "X coordinate is invalid.";
  if (waypoint?.z !== undefined && waypoint?.z !== null && !Number.isFinite(Number(waypoint.z))) return "Z coordinate is invalid.";
  if (waypoint?.y !== undefined && waypoint?.y !== null && waypoint.y !== "" && !Number.isFinite(Number(waypoint.y))) return "Y coordinate is invalid.";
  return null;
}

export async function createWaypoint(waypoint) {
  const invalid = validateWaypointInput(waypoint);
  if (invalid) throw new Error(invalid);
  const { data, error } = await supabase.from("waypoints").insert(waypoint).select().single();
  if (error) throw error;
  return data;
}

export async function updateWaypoint(id, patch, before) {
  const affectsContent = Object.keys(patch).some((key) => ["name", "description", "x", "y", "z"].includes(key));
  if (affectsContent) {
    const invalid = validateWaypointInput({ ...(before || {}), ...patch });
    if (invalid) throw new Error(invalid);
  }
  if (before && Object.keys(patch).every((key) => before[key] === patch[key])) {
    return before;
  }
  const { data, error } = await supabase.from("waypoints").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteWaypoint(id) {
  const { data, error } = await supabase
    .from("waypoints")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    const err = new Error("Could not delete waypoint.");
    err.cause = "not_permitted";
    throw err;
  }
}

export const WAYPOINT_GALLERY_BUCKET = "waypoint-gallery";
export const GALLERY_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const GALLERY_MAX_BYTES = 5 * 1024 * 1024;

// waypoint_id -> "editor" | "viewer" for the signed-in user. Populated once
// per session so canEditWaypoint stays synchronous.
const _collabRoles = new Map();

export function collaboratorRoleFor(waypointId) {
  return _collabRoles.get(String(waypointId)) ?? null;
}

export async function loadCollaboratorRoles(userId) {
  _collabRoles.clear();
  if (!userId) return;
  try {
    const { data, error } = await supabase.from("waypoint_collaborators").select("waypoint_id, role").eq("user_id", userId);
    if (error) {
      console.error(error);
      return;
    }
    for (const row of data ?? []) _collabRoles.set(String(row.waypoint_id), row.role);
  } catch (err) {
    console.error(err);
  }
}

export function forceCollaboratorRole(waypointId, role) {
  if (role) _collabRoles.set(String(waypointId), role);
  else _collabRoles.delete(String(waypointId));
}

export async function listCollaborators(waypointId) {
  const { data, error } = await supabase.from("waypoint_collaborators").select("*").eq("waypoint_id", waypointId).order("added_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addCollaborator({ waypointId, userId, username, role, addedBy }) {
  const { data, error } = await supabase.from("waypoint_collaborators").insert({ waypoint_id: waypointId, user_id: userId, username, role, added_by: addedBy }).select().single();
  if (error) throw error;
  return data;
}

export async function updateCollaboratorRole(waypointId, userId, role) {
  const { data, error } = await supabase.from("waypoint_collaborators").update({ role }).eq("waypoint_id", waypointId).eq("user_id", userId).select().single();
  if (error) throw error;
  return data;
}

export async function removeCollaborator(waypointId, userId) {
  const { data, error } = await supabase.from("waypoint_collaborators").delete().eq("waypoint_id", waypointId).eq("user_id", userId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Only the waypoint owner can manage collaborators.");
}

export async function transferOwnership(waypointId, newOwnerId, newOwnerUsername) {
  const { data, error } = await supabase.rpc("wp_transfer_waypoint", {
    p_waypoint: waypointId,
    p_new_owner: newOwnerId,
    p_new_owner_username: newOwnerUsername,
  });
  if (error) throw error;
  return data;
}

export async function listGalleryImages(waypointId) {
  const { data, error } = await supabase.from("waypoint_gallery").select("*").eq("waypoint_id", waypointId).order("position", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addGalleryImage({ waypointId, url, caption, uploadedBy, uploadedByUsername }) {
  const { count, error: countError } = await supabase.from("waypoint_gallery").select("id", { count: "exact", head: true }).eq("waypoint_id", waypointId);
  if (countError) throw countError;
  const { data, error } = await supabase.from("waypoint_gallery").insert({ waypoint_id: waypointId, url, caption, uploaded_by: uploadedBy, uploaded_by_username: uploadedByUsername, position: count ?? 0 }).select().single();
  if (error) throw error;
  return data;
}

export async function updateGalleryCaption(imageId, caption) {
  const { data, error } = await supabase.from("waypoint_gallery").update({ caption }).eq("id", imageId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteGalleryImage(image) {
  const objectPath = galleryObjectPath(image);
  if (objectPath) {
    const { error: storageError } = await supabase.storage.from(WAYPOINT_GALLERY_BUCKET).remove([objectPath]).catch((err) => ({ error: err }));
    if (storageError && !/not found|does not exist|404/i.test(String(storageError.message || storageError))) {
      console.error("Storage remove failed:", storageError);
    }
  }
  const { data, error } = await supabase.from("waypoint_gallery").delete().eq("id", image.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Could not delete screenshot.");
}

function galleryObjectPath(image) {
  const match = String(image?.url || "").match(/\/object\/public\/waypoint-gallery\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function publicImageUrl(imageUrl) {
  if (!imageUrl) return "";
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const match = String(imageUrl).match(/\/object\/public\/waypoint-gallery\/(.+)$/);
  if (match) return supabase.storage.from(WAYPOINT_GALLERY_BUCKET).getPublicUrl(decodeURIComponent(match[1])).data.publicUrl;
  return imageUrl;
}

export async function reorderGalleryImages(orderedIds) {
  const promises = orderedIds.map((id, index) =>
    supabase.from("waypoint_gallery").update({ position: index }).eq("id", id),
  );
  const results = await Promise.all(promises);
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) throw firstError;
}

function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const GALLERY_EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function validateGalleryFile(file) {
  if (!file) return "No file selected.";
  if (!GALLERY_ALLOWED_TYPES.includes(file.type)) return "Only JPG, PNG and WebP images are allowed.";
  if (file.size > GALLERY_MAX_BYTES) return "Image is too large (5MB max).";
  return null;
}

export async function uploadGalleryImage(file, waypointId, userId) {
  const invalid = validateGalleryFile(file);
  if (invalid) throw new Error(invalid);
  const ext = GALLERY_EXT_BY_TYPE[file.type] || "jpg";
  const path = `${userId}/${waypointId}/${randomId()}.${ext}`;
  const { error } = await supabase.storage.from(WAYPOINT_GALLERY_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return supabase.storage.from(WAYPOINT_GALLERY_BUCKET).getPublicUrl(path).data.publicUrl;
}

let _categoriesCache = null;
let _categoriesCacheTime = 0;
const CATEGORIES_CACHE_TTL_MS = 30000;

export async function listCategories() {
  const now = Date.now();
  if (_categoriesCache && now - _categoriesCacheTime < CATEGORIES_CACHE_TTL_MS) return _categoriesCache;
  const { data, error } = await supabase.from("categories").select("*").order("name", { ascending: true });
  if (error) throw error;
  _categoriesCache = data;
  _categoriesCacheTime = now;
  return data;
}

export function invalidateCategoriesCache() {
  _categoriesCache = null;
  _categoriesCacheTime = 0;
}

export function validateCategoryInput(category) {
  const name = String(category?.name ?? "").trim();
  if (!name) return "Name is required.";
  if (name.length > 40) return "Name is too long (40 characters max).";
  return null;
}

export async function createCategory(category) {
  const invalid = validateCategoryInput(category);
  if (invalid) throw new Error(invalid);
  const { data, error } = await supabase.from("categories").insert(category).select().single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, patch, before) {
  const invalid = validateCategoryInput({ ...(before || {}), ...patch });
  if (invalid) throw new Error(invalid);
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
  const { data, error } = await supabase
    .from("logs")
    .select("id, created_at, entity_type, entity_id, entity_name, username, user_id, action, dimension, changes")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getLogChanges(id) {
  const { data, error } = await supabase.from("logs").select("changes").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.changes ?? null;
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
