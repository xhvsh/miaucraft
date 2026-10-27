# Miaucraft website

Static site (plain HTML, CSS and ES modules, no build step) for the Miaucraft SMP: live map and waypoints, server status, leaderboards, profiles, chat, activity log, and owner/admin tools. It talks directly to Supabase from the browser with the **publishable** key; everything sensitive is enforced by Postgres row-level security and three edge functions.

```
Minecraft server ── miaucraft-bridge plugin ──(service role)──▶ Supabase Postgres ◀──(anon / user JWT, RLS)── browser
                                                                    ▲
                                              edge functions: register · signin · delete-account
```

The plugin lives in [xhvsh/miaucraft-bridge](https://github.com/xhvsh/miaucraft-bridge); the database migrations are in that repo (`dev/supabase/migrations`).

## Layout

| Path | What |
| --- | --- |
| `*.html` | One page per route (`/`, `/server`, `/leaderboards`, `/profile`, `/chat`, `/logs`, `/settings`, `/admin`, `/bridge`, `/404`, `/i18n-editor`). Vercel `cleanUrls` strips `.html`. |
| `css/` | `tokens.css` (design tokens), `base.css`, `components.css`, `nav.css`, then one file per page. |
| `js/lib/` | Shared modules: `supabaseClient`, `auth`, `live` (players/stats/status), `waypoints`, `chat`, `bridge`, `ui` (toasts, dialogs, escaping), `nav`. |
| `js/pages/` | One entry module per page. |
| `vendor/` | Self-hosted third-party assets, version in the path: `supabase-js-2.118.0.min.js`, `fontawesome-6.7.2/`, `fonts/`. |
| `supabase/functions/` | Source of the deployed edge functions (they used to exist only in the Supabase dashboard). |
| `bridge/` | Mirror of the plugin's manifest and remote config for already-deployed servers (see the plugin repo's release script). |
| `tests/` | `node --test` suites. |

## Develop

```bash
npm run dev     # http://127.0.0.1:5173, serves with the exact headers/CSP from vercel.json
npm test        # no dependencies to install
```

`scripts/serve.mjs` applies `vercel.json` (clean URLs, rewrites, headers), so a Content-Security-Policy regression shows up locally. The CSP only allows scripts from `'self'`: no inline `<script>`, no inline `on*=` attributes, no third-party scripts. `tests/site-security.test.mjs` enforces that for every page.

### Updating a vendored library

Download the new version, put it under a new versioned path (the files are served `immutable` for a year, so never edit one in place), update the `<script>`/`<link>` tags and delete the old copy.

## Deploy

Vercel serves the repository root; `vercel.json` carries the headers. Nothing else is needed for the site itself.

**Database and edge functions need a manual, ordered rollout** (nothing here is applied automatically):

1. Apply `dev/supabase/migrations/20260101000600_security_hardening.sql` from the plugin repo (Supabase SQL editor or `supabase db push`). It is idempotent; the rollback is `dev/supabase/rollbacks/20260101000600_security_hardening.down.sql`.
2. Deploy the edge functions: `supabase functions deploy register signin delete-account`. They require the `rate_limit_*` functions from step 1 and refuse requests (503) without them. Never deploy them first.
3. Deploy the site.

Edge function secrets: `BOT_URL` and `BOT_INTERNAL_SECRET` (optional Discord bot hook). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. The service-role key must never appear in this repository or in any file served to the browser; a test checks for it.

### Dashboard settings that cannot be set from code

- **Auth → Providers → Discord / sign-ups:** if "Allow new users to sign up" is on, anyone can create an auth user through Discord OAuth. The migration stops such users from getting a profile and from reading chat/logs/server info, but turning sign-ups off for OAuth is the cleaner fix if Discord is only used to *link* existing accounts.
- **Auth → Password protection:** leaked-password protection needs a paid Supabase plan; not available on the free plan.
- ~~Extensions: `pg_net` in `public`~~ — done (moved to `extensions`, migration `move_pg_net_to_extensions_schema`).

## Security model in one paragraph

Roles live in `profiles.role` (`owner` > `admin` > `user`) and are only changeable by an owner (trigger `prevent_non_owner_role_change`, and the column grant on `profiles` allows `role` only). Accounts are created only by the `register` function with a single-use access code. The browser-side `can()` helpers in `js/lib/auth.js` are UI hints; every permission is re-checked by RLS. See [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) for the full audit, what was fixed, and what remains.
