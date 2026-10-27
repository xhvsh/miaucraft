# Security and reliability audit — October 2026

Scope: this repository, [miaucraft-bridge](https://github.com/xhvsh/miaucraft-bridge), and the live Supabase project `miaucraft` (schema, policies, grants, functions, edge-function source, storage). The live project was inspected **read-only** (catalog queries, advisors, function source); nothing was written to it. Every change below is in the two repositories and still has to be rolled out (see *Rollout*).

Status legend: **Fixed (repo)** = changed and tested here, not live until rolled out · **Open** = not changed, decision or larger work needed · **Accepted** = understood trade-off.

## Architecture (as found)

- **Website**: static HTML + ES modules on Vercel, no build step, no dependencies. Browser → Supabase directly with the publishable key; authorization is RLS plus triggers.
- **Auth**: usernames map to synthetic emails (`<name>@miaucraft.internal`); accounts are created only by the `register` edge function with a single-use access code; sign-in goes through the `signin` function (service role) which returns a session the site adopts. Roles (`owner`/`admin`/`user`) live in `profiles.role`.
- **Plugin** (Paper, Java 21): writes players, stats, achievements, positions, TPS, chat, status with the **service-role key** from its local `config.yml`; polls `whitelist_commands`, `bridge_commands`, and `chat_messages` (kind `web`); pulls behaviour from a remote config on GitHub and self-updates from a manifest on GitHub.
- **Data flow of trust**: browser ⇄ RLS ⇄ tables ⇄ plugin (service role, bypasses RLS). Anything a signed-in account can write into a table the plugin reads is therefore *untrusted input to the game server* (chat rows, whitelist rows, command rows).

## Confirmed findings

| # | Severity | Finding | Where | Status |
| --- | --- | --- | --- | --- |
| S1 | **High** | **Rate limiting never worked.** The `register`/`signin` functions read/write `public.rate_limits`, which does not exist in production; errors were ignored, so every request was "allowed". Access codes and passwords could be guessed without the function throttling (only GoTrue's own per-IP limits applied to direct calls). Also: counters were read-modify-write (racy) and the client IP was the *leftmost* `x-forwarded-for` entry, which a client controls. | `supabase/functions/{register,signin}` | Fixed (repo): atomic `rate_limit_*` SQL functions, fail-closed (503) if the limiter is down, trusted IP header. Needs migration + deploy. |
| S2 | **High** | **Chat forgery reaching the game.** `chat_insert_web` only checked `kind in ('web','system')`: any signed-in account could post as any username/user id, forge `system` notices ("Server offline"), and send arbitrarily long rows that the plugin broadcast to every player. | `chat_messages` policy, `ChatBridge.relay` | Fixed (repo): insert policy bound to the caller's own profile, kind `web` only, 1–500 chars, burst limit, hard 2000-char column cap; plugin now strips control characters and clips inbound rows. |
| S3 | **High if Discord sign-ups are open** | **Access-code bypass via OAuth.** `handle_new_user` created a profile (role `user`) for *any* new auth user, and chat/logs/server-info read policies only required `authenticated`. A Discord OAuth sign-up could therefore read chat, logs and the server address, and post chat, without an access code. The client-side check in `handlePostOAuthSignIn` is UI only (and always passed, because the trigger had just created the profile). No Discord-provider users exist in production today (verified), so this was latent. | `handle_new_user`, three read policies | Fixed (repo): no profile for non-email sign-ups; reads require a profile. Also disable OAuth sign-ups in the dashboard. |
| S4 | Medium | **Update authenticity.** The manifest's `sha256` and the jar URL come from the same GitHub repo, so the digest only proves integrity, not origin: anyone able to push to the repo (stolen token) could ship code that runs inside the server. | `Updater` | Fixed (repo): Ed25519 signature over `(version, sha256)`, public key compiled in, private key kept off-repo, enforced by default (`update.require-signature`). Needs plugin release ≥ 2.7.0. |
| S5 | Medium | **Admins could rewrite any account's username/Discord fields** via REST (`UPDATE` was granted on all `profiles` columns), bypassing the owner-only, validated `update_username_by_profile`. One `admin` account exists. | `profiles` grants | Fixed (repo): only `role` is updatable by API roles. |
| S6 | Medium | **Floating third-party code on every page.** `@supabase/supabase-js@2` from jsDelivr (no pin, no SRI) and the Font Awesome kit script, in pages whose origin holds the session in `localStorage`. A compromised CDN release = account takeover. | all `*.html` | Fixed (repo): pinned `2.118.0` (the version served today) and Font Awesome 6.7.2 / fonts self-hosted; CSP is now `script-src 'self'`. |
| S7 | Medium (bug) | **Self-service account deletion fails** for any user who owns a waypoint or has whitelist requests: both are `NO ACTION` foreign keys, so `deleteUser` aborts with a 500. The owner-side RPC deletes them first; the edge function did not. Also: the last owner could delete themselves. | `delete-account` | Fixed (repo). |
| S8 | Low–Med | **Excess privileges.** `TRUNCATE`/`REFERENCES`/`TRIGGER` granted to `anon`/`authenticated` (TRUNCATE ignores RLS); `anon` had write grants on waypoint tables (RLS was the only barrier); trigger/internal functions (incl. `rls_auto_enable`) and the admin tool `merge_player` callable via `/rest/v1/rpc`; `list_account_usernames()` returned every website account name to anonymous visitors; 10 functions with mutable `search_path`. | migration §5 | Fixed (repo). |
| S9 | Low | **Gallery bucket.** No server-side MIME/size limit (the 5 MB / jpg-png-webp rule was client-only). | `storage.buckets` | Fixed (repo). |
| S10 | Low | No server-side limits on waypoint name/description/coordinates/colour or gallery caption. | `waypoints`, `waypoint_gallery` | Fixed (repo) as `NOT VALID` checks; production data already conforms. |
| S11 | Low | Four inline `onerror="…"` handlers were silently dead under the production CSP (broken stat icons stayed visible). | `leaderboards.js`, `profile.js` | Fixed (repo): delegated `data-img-fallback` handler. |
| S12 | Low | Username search passed `%`/`_` through to `ILIKE`. | `auth.js` | Fixed (repo). |
| S13 | Low | Input focus indicator was a 40 %-alpha border (< 3:1 contrast). | `components.css` | Fixed (repo). |
| O1 | Low | **Gallery bucket is public**, so images of *private* waypoints are readable by anyone holding the (unguessable) URL; the object-level policy is bypassed for public buckets. | `waypoint-gallery` | **Open**: needs a private bucket + signed URLs in `waypoints.js`/`gallery-viewer.js`. |
| O2 | Low | `enforce_waypoint_min_distance` is `SECURITY DEFINER` and checks *all* waypoints, so its error message reveals whether a private waypoint exists within 50 blocks of a probe. | trigger | **Open** (behaviour change; needs a product decision). |
| O3 | Low | `wp_can_view/edit`, `wp_is_*` accept an arbitrary `p_user`; callable by anyone (RLS needs them). Needs a waypoint UUID to be useful. | functions | **Open**. |
| O4 | Info | A `test` schema in production holds copies of `players`, `live_positions`, `whitelist` with `anon SELECT`. Harmless unless PostgREST exposes it; probably a leftover. | database | **Open**: drop it if unused. |
| O5 | Info | Dashboard-only: leaked-password protection disabled; `pg_net` in `public`. | Supabase | **Open** (see README). |
| A1 | Accepted | The per-username sign-in lockout (10 failures/h) lets a stranger lock a *known* username out for an hour. The ceiling is deliberately higher than the per-IP one (5/h). | `signin` | Accepted. |
| A2 | Accepted | `auth.js` keeps a second copy of the session in `localStorage` to survive transient refresh failures (≤ 7 days). Same exposure class as supabase-js's own storage; the strict CSP is the mitigation. | `auth.js` | Accepted. |
| A3 | Accepted | Edge functions answer `Access-Control-Allow-Origin: *`. They use bearer tokens/body credentials, never cookies. | functions | Accepted. |

Checked and found sound: output escaping (the data-bearing `innerHTML` sites in waypoints, map, admin, profile, chat, server, logs and nav were read and escape or sanitize every interpolated value; the remaining ~100 sites of the 133 are static markup or `= ""` clears and were only pattern-checked; colours go through `sanitizeColor`, icon classes through `sanitizeIconClass`); whitelist command path in the plugin (username regex, fixed action set, `dispatchCommand` with a constructed string); `bridge_commands` (fixed symbol set, no path from a row to a console string); `request_bridge_command` / `delete_account_by_username` / `update_username_by_profile` (owner re-check inside); `players` self-update trigger; waypoint ownership/visibility triggers; no secret keys in either repository or git history (patterns for JWTs, `sb_secret_`, service-role assignments); the publishable key is the only key in the browser.

## Performance and code health

Measured / counted (not timed — network timings against production were not taken):

- Third-party origins contacted on load: **5 → 0** for code, styles and fonts (`cdn.jsdelivr.net`, `kit.fontawesome.com`, `ka-f.fontawesome.com`, `fonts.googleapis.com`, `fonts.gstatic.com`). Render-blocking cross-origin resources per page: **2 → 0** (Google Fonts stylesheet, Font Awesome kit script).
- Vendored assets are served `immutable` for a year (they carry their version in the path); `/img` gets a 1-day cache with stale-while-revalidate.
- Plugin idle write traffic of the diagnostics lane: `bridge_status` upserts **12/min → 4/min** (arithmetic from the 5 s → 15 s cadence; the website marks status stale after 90 s).
- Indexes: two redundant indexes dropped (`idx_player_stats_player_id`, `waypoint_collaborators_waypoint_idx`, both prefixes of existing unique keys), three lookup indexes added for chat rate-limiting and account deletion.
- Dead code removed after verifying no static, dynamic or HTML reference: `isWaypointOwner`, `insertSystemChatMessage`, `listAccountUsernamesLower`, `getTop1Summary`, `getLiveTrackingEnabled`, `updateCollaboratorRole`, `reorderGalleryImages`, `setServerInfo`.

Not changed, with reasons: RLS `auth.uid()` → `(select auth.uid())` rewrites flagged by the advisor (30 policies; largest table has ~19k rows, no measurable gain, nontrivial risk); unused-index advisories (`players_username_lower_idx` backs an RLS policy; the others are on tiny tables). Known smaller issues left alone: `logs.js` probes each gallery image URL with a `fetch` when expanding a log entry; Realtime channels are sometimes closed before they connect on fast navigations (harmless console warnings); `i18n-editor` is a public developer tool and `i18n-editor-defaults.js` says "generated by build" although no build exists.

Plugin review (no change needed): all network I/O is asynchronous (`HttpClient.sendAsync`), Bukkit API work is hopped to the main thread, queues are bounded (1000-row cap with oldest-drop), per-sink exponential backoff caps at 60 s with a quiet cold-start retry, claim queries are conditional PATCHes (safe with multiple servers). The only blocking waits on the main thread are bounded: shutdown flush (≤ 8 s + 5 s) and finalising `update.apply` before the JVM exits (≤ 4 s).

## Design

The existing interface already has a coherent system (tokens, dark theme, nav + mobile tab bar, skip link, focus styles, reduced-motion support, empty/loading/offline states). A rewrite would have discarded working, deliberately designed UI for no concrete benefit, so the redesign work was limited to defects found while auditing: the focus ring, dead icon fallbacks, and self-hosted fonts/icons (no layout shift from late third-party CSS). Larger visual changes should be a separate, reviewed effort with screenshots.

## Verification actually run

| Suite | Command | Result |
| --- | --- | --- |
| Website | `npm test` | 51 passed |
| SQL (in-process Postgres, prod-shaped baseline + migration + rollback) | `cd dev/db-tests && npm test` (plugin repo) | 24 passed |
| Plugin | `mvn test`, `mvn package` | 79 passed (66 before); jar builds |
| Edge functions | `deno check`, `deno test` | type-check clean; 3 helper tests passed |
| Manual | site served under the production CSP (`scripts/serve.mjs`), pages loaded in a browser | fonts/icons/Supabase data load, no CSP violations, no failing requests |
| Signing | real release key → `ReleaseSigner` → built-in public key | verifies; wrong version rejected |
| `npm audit` (db-tests) | | 0 vulnerabilities |

**Not run:** the migration against the live database, the edge functions against a live Supabase (needs deployment), the plugin on a real Paper server, and logged-in UI flows (no credentials). The SQL tests use a reconstruction of the production objects the migration touches (policies/functions copied from the live catalogs), not a full dump.

## Rollout

1. Plugin repo: apply `20260101000600_security_hardening.sql`; keep the `.down.sql` at hand.
2. Deploy the three edge functions (after step 1).
3. Release plugin 2.7.0 with `publish-release.ps1` (signs the manifest) and mirror `bridge/` into this repo (`-SiteRepo`). Servers on ≤ 2.6.1 ignore the new `signature` field and keep updating.
4. Deploy the site.
5. Dashboard: disable OAuth sign-ups (or Discord sign-ups), enable leaked-password protection.

## Recommended next steps

1. Private gallery bucket with signed URLs (O1).
2. Decide on O2 (private-waypoint proximity oracle) and drop the `test` schema (O4).
3. Back up `%USERPROFILE%\.miaucraft\release-signing.key` somewhere safe; without it no further update can be published (a new key requires a manual jar install on each server).
4. Add a CI job running `npm test`, the SQL suite and `mvn test`.
5. Consider Playwright smoke tests with a seeded test account for the logged-in flows.
