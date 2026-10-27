// Zero-dependency static server that mimics the Vercel setup from vercel.json
// (clean URLs, rewrites, redirects, response headers - CSP included), so a CSP
// regression shows up locally instead of in production.
//
//   node scripts/serve.mjs [port]      (default 5173)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const port = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

/** Vercel route patterns here are `/(.*)`, `/vendor/(.*)` or `/c/:code`. */
function toRegex(source) {
  const escaped = source.replace(/[.+?^${}|[\]\\]/g, "\\$&").replace(/\(\\\.\*\)/g, "(.*)").replace(/:[a-zA-Z]+/g, "([^/]+)");
  return new RegExp("^" + escaped + "$");
}

export function headersFor(pathname) {
  const out = {};
  for (const rule of config.headers ?? []) {
    if (toRegex(rule.source).test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

async function resolveFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const candidates = [clean, clean + ".html", join(clean, "index.html")];
  for (const candidate of candidates) {
    const full = resolve(root, candidate);
    if (full !== root && !full.startsWith(root + sep)) return null;
    if (full.includes(`${sep}.git${sep}`) || full.includes(`${sep}node_modules${sep}`)) return null;
    try {
      if ((await stat(full)).isFile()) return full;
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  let { pathname } = new URL(req.url, "http://localhost");
  for (const r of config.redirects ?? []) {
    if (toRegex(r.source).test(pathname)) {
      res.writeHead(308, { Location: r.destination });
      return res.end();
    }
  }
  const headers = headersFor(pathname);
  for (const rw of config.rewrites ?? []) {
    if (toRegex(rw.source).test(pathname)) pathname = rw.destination;
  }
  const file = await resolveFile(pathname === "/" ? "/index.html" : pathname);
  if (!file) {
    const notFound = await readFile(join(root, "404.html")).catch(() => Buffer.from("Not found"));
    res.writeHead(404, { "Content-Type": TYPES[".html"], ...headers });
    return res.end(notFound);
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", ...headers });
  res.end(await readFile(file));
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} at http://127.0.0.1:${port}`));
