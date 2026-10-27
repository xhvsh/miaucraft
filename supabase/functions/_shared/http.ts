// Helpers shared by the edge functions. Supabase bundles `_shared` imports into
// each function at deploy time (`supabase functions deploy`).

export const CORS_HEADERS = {
  // These endpoints authenticate with a bearer token / credentials in the body,
  // never with cookies, so a wildcard origin does not expose ambient authority.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/**
 * The address to throttle on. `x-forwarded-for` can carry whatever the client
 * sent in its leftmost entries, so it is only a last resort and the RIGHTMOST
 * entry (the one the platform's proxy appended) is used. Cloudflare's own
 * header wins when present because a client cannot set it.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

export const RATE_WINDOW_SECONDS = 60 * 60;
