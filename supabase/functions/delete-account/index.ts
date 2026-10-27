import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CORS_HEADERS, json } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_URL = Deno.env.get("BOT_URL");
const BOT_INTERNAL_SECRET = Deno.env.get("BOT_INTERNAL_SECRET");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing Authorization header" }, 401);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ error: "Invalid or expired session" }, 401);
  const userId = userData.user.id;

  const { data: profile } = await admin
    .from("profiles")
    .select("username, role")
    .eq("id", userId)
    .maybeSingle();

  // The last owner deleting themselves would leave nobody able to manage the
  // whitelist, access codes or bridge.
  if (profile?.role === "owner") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner");
    if ((count ?? 0) <= 1) {
      return json({ error: "You are the only owner. Promote another owner before deleting this account." }, 409);
    }
  }

  // Website-owned data goes first, in the same order as delete_account_by_username:
  // waypoints.owner_id and whitelist_commands.requested_by are NO ACTION foreign
  // keys, so deleting the user while they exist fails with a 500. Gameplay data
  // (players, stats, achievements) is keyed by Minecraft uuid and is kept.
  const steps = [
    admin.from("waypoints").delete().eq("owner_id", userId),
    admin.from("waypoints").delete().eq("created_by", userId),
    admin.from("whitelist_commands").delete().eq("requested_by", userId),
    admin.from("access_codes").update({ used_by: null }).eq("used_by", userId),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) {
      console.error("delete-account: cleanup failed", error);
      return json({ error: "Could not remove your data. Nothing was deleted." }, 500);
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("delete-account: deleteUser failed", deleteError);
    return json({ error: "Could not delete the account." }, 500);
  }

  if (BOT_URL && BOT_INTERNAL_SECRET) {
    fetch(`${BOT_URL}/api/account-deleted`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": BOT_INTERNAL_SECRET },
      body: JSON.stringify({ username: profile?.username ?? null, id: userId }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  return json({ ok: true });
});
