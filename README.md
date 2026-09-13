# Miaucraft - v2 (redesign)

Full rebuild of the site as a real multi-page app instead of one big
scroll/section-toggling `index.html`. Same Supabase backend, same data
layer - new structure, new visual design, new profile page, plus a new
admin dashboard.

## Pages

| File               | What it is                                                  |
| ------------------ | ------------------------------------------------------------ |
| `index.html`       | Map - overworld / nether / end, waypoints, live players       |
| `server.html`      | TPS, uptime, connection info, player list                     |
| `leaderboards.html`| Stat leaderboards (presets + search any tracked stat)         |
| `profile.html`     | Player profile - stats, waypoints, top ranks, achievements    |
| `admin.html`       | Whitelist, website users (edit usernames; revoke = delete), categories |
| `logs.html`         | Activity log (waypoints, categories, whitelist)               |
| `settings.html`    | Display prefs, Discord link, password, delete account         |

Every page shares one nav (`js/lib/nav.js`) - top bar on desktop, a
bottom tab bar on mobile so the primary pages (Map / Server / Ranks /
Profile) sit in the thumb zone, with a "More" sheet/dropdown for
Settings and Admin. That's the one file to edit if the nav itself
needs to change.

## Structure

```
css/
  tokens.css        design tokens - colors, type, spacing, shadows. Edit this first.
  base.css          reset + global element styles
  components.css    buttons, inputs, modals, toasts, badges, tabs - shared everywhere
  nav.css           top bar + bottom tab bar + sheets
  map.css / server.css / leaderboards.css / profile.css / admin.css / settings.css / logs.css
                     one file per page, only what that page needs

js/
  lib/              data layer + shared UI, no page-specific markup
    config.js, supabaseClient.js, auth.js, waypoints.js, live.js,
    statPresets.js, grid.js        - carried over from the old build, unchanged
    settings.js                    - local display prefs (coord format etc.)
    ui.js                          - toasts, confirm dialog, time formatting
    nav.js                         - the shared nav + sign-in modal
  pages/            one controller per HTML page, only imports what it needs
    map.js, server.js, leaderboards.js, profile.js, admin.js, settings.js, logs.js
```

Nothing else references the old single `app.js` / `profile.js` / `style.css`
- those are gone. `auth.js`, `waypoints.js`, `live.js`, `statPresets.js`,
`grid.js`, `config.js`, `supabaseClient.js` are carried over as-is since
they were already clean data-layer modules; only the presentation layer
was rebuilt.

## Needs SQL before it's real

**Admin → Website users** is coded and waiting on two things in the
database (see `sql/admin-accounts.sql` for the exact commands):

1. An RLS `SELECT` policy so owner/admin roles can list every row of
   `profiles` (everyone else should still only read their own row).
2. The `delete_account_by_username(username)` function, called by the
   revoke button. It runs as a `security definer`, checks the caller is
   an owner, and deletes the target auth user + their rows so the
   account is gone completely.
3. `update_username_by_profile(profile_id, username)`, called by the
   username edit button. Owner-only `security definer` that renames the
   profile and keeps the matching `auth.users`/`auth.identities` email
   (and waypoint author names) in sync.

Without those, the panel shows "Admins can't read the accounts table
yet" / "The delete_account_by_username function isn't set up yet" and
the revoke button still works - it just reports the missing SQL.

## Deep links

All cross-page links use clean, extensionless URLs (the site runs with
Vercel `cleanUrls`), so share the root-absolute versions:

- `/profile?user=<name>` - a player's profile.
- `/?dim=<dim>&wp=<id>` - jump straight to a waypoint (used by the profile
  page's "Jump to" button and the logs page's "Jump to waypoint"). Restore
  links from deleted log entries also pre-fill to a waypoint or open the
  admin category form (`/admin?tab=categories&name=...`).
- `/leaderboards?lb=<stat-key>` - opens a specific leaderboard. Preset keys
  (e.g. `MOB_KILLS`, `DEATHS`, `PLAY_ONE_MINUTE`) land on the matching preset
  chip; any other raw stat key (e.g. `KILL_ENTITY:COW`) opens it via the
  search picker. `?stat=<preset-id>` still works.
- `/c/:code` rewrites to `/` and pre-fills the register form's access code,
  same behavior as before.

## Adding Minecraft screenshots/art later

Colors, radii, shadows all live in `css/tokens.css` as CSS variables,
so reskinning stays contained there. For images specifically:

- Category icons are Font Awesome classes right now
  (`categoryIconClass()` in `waypoints.js`) - swapping a category to a
  small image would mean changing `buildCategoryBadgeHtml()` /
  `.category-badge` (map.js/map.css) to render an `<img>` instead of an
  `<i>` when the category has an image URL.
- The map background (`.grid-panel` in `map.css`) is just a radial
  gradient - a texture/screenshot can drop in as a `background-image`
  there.
- The waypoint special-image system already exists
  (`SPECIAL_WAYPOINT_IMAGES` in `map.js`) for the "Blehh Cat" waypoint -
  the same pattern (name → image path) is the easiest way to attach a
  reference image to any other specific waypoint.
