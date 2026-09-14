const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://qxgpsutkthtuejjrnywg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PxAxkWvN8EEiOt_MOSzMqA_ZmRG4oqF";

const PAGE_PATH = path.join(__dirname, "..", "profile.html");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function safeUsername(raw) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 50);
}

function formatPlaytime(value) {
  const n = Number(value) || 0;
  const totalSeconds = n / 20;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return hours + "h " + minutes + "m";
  if (minutes > 0) return minutes + "m";
  return null;
}

async function supabaseGet(pathname, searchParams) {
  const url = new URL(SUPABASE_URL + "/rest/v1" + pathname);
  url.search = searchParams;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY },
  });
  if (!res.ok) throw new Error("Supabase request failed: " + res.status);
  return res.json();
}

async function fetchPlayerData(username) {
  const players = await supabaseGet(
    "/players",
    "select=id,username,online,last_seen&username=ilike." + encodeURIComponent(username) + "&hidden=eq.false&limit=1",
  );
  if (!players || players.length === 0) return null;
  const player = players[0];

  const stats = await supabaseGet(
    "/player_stats",
    "select=stat_key,stat_value&player_id=eq." + player.id + "&stat_key=in.(PLAY_ONE_MINUTE,TIME_PLAYED)&order=stat_value.desc&limit=1",
  );
  const playtime = stats && stats.length > 0 ? stats[0].stat_value : null;

  return { username: player.username, online: player.online, last_seen: player.last_seen, playtime };
}

function buildMeta(origin, url, data) {
  const username = safeUsername(data?.username);
  const fallbackTitle = "Profile - Miaucraft";
  const fallbackDesc = "Stats, waypoints, achievements and more for a Miaucraft SMP player.";

  let title = fallbackTitle;
  let description = fallbackDesc;
  let image = origin + "/img/icon.webp";

  if (username) {
    const playtime = data.playtime != null ? formatPlaytime(data.playtime) : null;
    const status = data.online ? "Online right now" : "Offline";
    title = username + " - Miaucraft SMP";
    description = playtime
      ? username + " has played " + playtime + " on the Miaucraft SMP. " + status + "."
      : username + " plays on the Miaucraft SMP. " + status + ".";
    image = "https://mc-heads.net/avatar/" + encodeURIComponent(username) + "/256";
  }

  function fill(html, key, value) {
    return html.split(key).join(value);
  }

  return { title, description, image, url, fill };
}

module.exports = async function handler(req, res) {
  const parsedUrl = new URL(req.url || "", "https://" + (req.headers.host || "localhost"));
  const username = safeUsername(parsedUrl.searchParams.get("user"));

  let data = null;
  try {
    data = username ? await fetchPlayerData(username) : null;
  } catch (err) {
    console.error("OG lookup failed:", err);
    data = null;
  }

  const origin = "https://" + (req.headers.host || "localhost");
  const url = username ? origin + "/profile?user=" + encodeURIComponent(username) : origin + "/profile";
  const meta = buildMeta(origin, url, data);

  let html;
  try {
    html = fs.readFileSync(PAGE_PATH, "utf8");
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("Internal error");
    return;
  }

  html = meta.fill(html, "__OG_TITLE__", escapeHtml(meta.title));
  html = meta.fill(html, "__OG_DESCRIPTION__", escapeHtml(meta.description));
  html = meta.fill(html, "__OG_IMAGE__", escapeHtml(meta.image));
  html = meta.fill(html, "__OG_URL__", escapeHtml(meta.url));

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
};