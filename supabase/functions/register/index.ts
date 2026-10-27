import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CORS_HEADERS, RATE_WINDOW_SECONDS, clientIp, json } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_URL = Deno.env.get("BOT_URL"); // e.g. https://your-bot.vercel.app
const BOT_INTERNAL_SECRET = Deno.env.get("BOT_INTERNAL_SECRET");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Failed attempts per IP per hour. A success clears the bucket.
const MAX_FAILURES_PER_IP = 5;

async function allowed(key: string): Promise<boolean> {
  const { data, error } = await admin.rpc("rate_limit_allowed", { p_key: key, p_max: MAX_FAILURES_PER_IP });
  if (error) throw error;
  return data === true;
}

async function fail(key: string, body: unknown, status = 400) {
  const { error } = await admin.rpc("rate_limit_fail", { p_key: key, p_window_seconds: RATE_WINDOW_SECONDS });
  if (error) console.error("register: could not record failure", error);
  return json(body, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const key = `register:${clientIp(req)}`;
  try {
    if (!(await allowed(key))) {
      return json({ error: "Too many failed registration attempts. Try again in about an hour." }, 429);
    }
  } catch (err) {
    // Fail closed: access codes must never be guessable without a limiter.
    console.error("register: rate limiter unavailable", err);
    return json({ error: "Registration is temporarily unavailable. Try again shortly." }, 503);
  }

  let body: { username?: string; password?: string; accessCode?: string };
  try {
    body = await req.json();
  } catch {
    return fail(key, { error: "Invalid JSON body." });
  }

  const username = String(body.username ?? "").trim();
  const password = typeof body.password === "string" ? body.password : "";
  const accessCode = String(body.accessCode ?? "").trim();

  if (!USERNAME_RE.test(username)) {
    return fail(key, { error: "Username must be 3-20 characters: letters, numbers, or underscore." });
  }
  if (password.length < 8 || password.length > 256) {
    return fail(key, { error: "Password must be 8-256 characters." });
  }
  if (!accessCode || accessCode.length > 128) {
    return fail(key, { error: "Access code is required." });
  }

  // Service role bypasses the zero-policy RLS on access_codes.
  const { data: codeRow, error: codeErr } = await admin
    .from("access_codes")
    .select("code, role, used, expires_at, created_by")
    .eq("code", accessCode)
    .maybeSingle();

  if (codeErr) return fail(key, { error: "Could not validate access code." }, 500);
  if (!codeRow) return fail(key, { error: "Invalid access code." });
  if (codeRow.used) return fail(key, { error: "This access code has already been used." });
  if (codeRow.expires_at && new Date(codeRow.expires_at).getTime() < Date.now()) {
    return fail(key, { error: "This access code has expired." });
  }
  if (codeRow.role !== "owner" && codeRow.role !== "user") {
    return fail(key, { error: "This access code has an invalid role." });
  }

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .ilike("username", username.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();
  if (existingProfile) return fail(key, { error: "That username is already taken." });

  // The email is derived and never shown. Role rides only in app_metadata,
  // which a user's own session can never write, so it is safe to trust.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${username.toLowerCase()}@miaucraft.internal`,
    password,
    email_confirm: true,
    app_metadata: { registration_source: "access_code", role: codeRow.role },
    user_metadata: { username },
  });

  if (createErr || !created?.user) {
    if (createErr) console.error("register: createUser failed", createErr);
    return fail(key, { error: "Could not create the account. The username may already be taken." });
  }

  const userId = created.user.id;

  // Atomically claim the code: if two people race on it, only the update that
  // still finds used = false succeeds.
  const { data: claimed, error: claimErr } = await admin
    .from("access_codes")
    .update({ used: true, used_by: userId, used_at: new Date().toISOString() })
    .eq("code", accessCode)
    .eq("used", false)
    .select("code");

  if (claimErr || !claimed || claimed.length === 0) {
    await admin.auth.admin.deleteUser(userId);
    return fail(key, { error: "That access code was just claimed by someone else. Ask for a new one." }, 409);
  }

  // Best-effort notification to the Discord bot; never blocks registration.
  if (BOT_URL && BOT_INTERNAL_SECRET) {
    fetch(`${BOT_URL}/api/code-used`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": BOT_INTERNAL_SECRET },
      body: JSON.stringify({ code: accessCode, username, createdBy: codeRow.created_by }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  await admin.rpc("rate_limit_clear", { p_key: key });
  return json({ ok: true, username, role: codeRow.role });
});
