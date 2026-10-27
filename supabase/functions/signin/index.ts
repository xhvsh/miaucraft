import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CORS_HEADERS, RATE_WINDOW_SECONDS, clientIp, json } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service role so GoTrue's coarse per-IP limiter (shared across all users) is
// bypassed here - the limits below are the throttle for this endpoint.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Failed attempts per hour. The per-user ceiling is higher than the per-IP one
// so a stranger cannot cheaply lock a real player out of their own account.
const MAX_FAILURES_PER_IP = 5;
const MAX_FAILURES_PER_USER = 10;

// The counters live in Postgres (see migration 20260101000600): atomic upserts,
// so concurrent guesses cannot race past the limit.
async function allowed(key: string, max: number): Promise<boolean> {
  const { data, error } = await admin.rpc("rate_limit_allowed", { p_key: key, p_max: max });
  if (error) throw error;
  return data === true;
}

async function recordFailure(key: string) {
  const { error } = await admin.rpc("rate_limit_fail", { p_key: key, p_window_seconds: RATE_WINDOW_SECONDS });
  if (error) throw error;
}

async function clear(key: string) {
  await admin.rpc("rate_limit_clear", { p_key: key });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!USERNAME_RE.test(username) || !password || password.length > 256) {
    // Malformed requests are not counted, or an attacker could lock an account
    // out by spamming empty passwords at a target username.
    return json({ error: "Wrong username or password." }, 400);
  }

  const ipKey = `signin:ip:${clientIp(req)}`;
  const userKey = `signin:user:${username}`;

  try {
    if (!(await allowed(ipKey, MAX_FAILURES_PER_IP)) || !(await allowed(userKey, MAX_FAILURES_PER_USER))) {
      return json({ error: "Too many failed sign-in attempts. Try again in about an hour." }, 429);
    }
  } catch (err) {
    // Fail closed: if the limiter is unavailable, refuse instead of letting
    // unlimited guesses through (the previous deployment failed open).
    console.error("signin: rate limiter unavailable", err);
    return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503);
  }

  const { data, error: authErr } = await admin.auth.signInWithPassword({
    email: `${username}@miaucraft.internal`,
    password,
  });

  if (authErr || !data?.session) {
    try {
      await Promise.all([recordFailure(ipKey), recordFailure(userKey)]);
    } catch (err) {
      console.error("signin: could not record failure", err);
    }
    return json({ error: "Wrong username or password." }, 401);
  }

  await Promise.all([clear(ipKey), clear(userKey)]);
  return json({ ok: true, session: data.session });
});
