// Guards the properties the Content-Security-Policy in vercel.json relies on.
// A page that adds an inline script, an inline event handler or a third-party
// host would silently stop working in production (CSP blocks it) or widen the
// attack surface - these tests fail first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const csp = Object.fromEntries(
  vercel.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === "Content-Security-Policy")
    .value.split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    }),
);
const pages = readdirSync(root).filter((f) => f.endsWith(".html"));

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const jsFiles = walk("js").filter((f) => f.endsWith(".js"));

test("script-src is 'self' only: no inline, eval or third-party scripts", () => {
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.ok(!csp["default-src"].includes("'unsafe-inline'"));
});

test("framing, base-uri, form-action and objects are locked down", () => {
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
});

for (const page of pages) {
  const html = readFileSync(join(root, page), "utf8");

  test(`${page}: no inline <script> blocks`, () => {
    const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/gi)];
    assert.equal(inline.length, 0, "inline scripts are blocked by the CSP");
  });

  test(`${page}: no inline event handler attributes`, () => {
    const handlers = [...html.matchAll(/\s(on[a-z]+)\s*=\s*["']/gi)].map((m) => m[1]);
    assert.deepEqual(handlers, []);
  });

  test(`${page}: every script/stylesheet/preload is same-origin and exists`, () => {
    const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)].map((m) => m[1]);
    for (const ref of refs) {
      assert.ok(!/^(https?:)?\/\//i.test(ref), `${ref} is third-party; vendor it under /vendor`);
      const file = ref.split(/[?#]/)[0].replace(/^\//, "");
      assert.ok(existsSync(join(root, file)), `${ref} does not exist`);
    }
  });
}

test("JS never uses inline handler attributes in generated markup", () => {
  const offenders = [];
  for (const file of jsFiles) {
    if (file.includes("i18n-editor")) continue;
    const src = readFileSync(join(root, file), "utf8");
    // `onerror="..."` inside a template literal (not `reader.onerror = fn`).
    for (const m of src.matchAll(/<[a-z][^>]*\son[a-z]+="/gi)) offenders.push(`${file}: ${m[0].slice(0, 60)}`);
  }
  assert.deepEqual(offenders, []);
});

test("every remote host the JS talks to is allowed by the CSP", () => {
  const allowed = [...csp["img-src"], ...csp["connect-src"]].map((v) => v.replace(/^wss?:\/\//, "https://"));
  const hostOk = (host) =>
    allowed.some((a) => a === `https://${host}` || (a.startsWith("https://*.") && host.endsWith(a.slice(10))));
  const unknown = new Set();
  for (const file of jsFiles) {
    if (file.includes("i18n-editor")) continue;
    for (const m of readFileSync(join(root, file), "utf8").matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
      if (!hostOk(m[1].toLowerCase())) unknown.add(`${file} -> ${m[1]}`);
    }
  }
  assert.deepEqual([...unknown], []);
});

test("the Supabase project in config.js matches the CSP connect-src", () => {
  const config = readFileSync(join(root, "js/lib/config.js"), "utf8");
  const url = config.match(/SUPABASE_URL = "(https:\/\/[^"]+)"/)[1];
  const host = new URL(url).host;
  assert.ok(csp["connect-src"].includes(`https://${host}`));
  assert.ok(csp["connect-src"].includes(`wss://${host}`));
});

test("no service-role or secret keys are shipped to the browser", () => {
  for (const file of [...jsFiles, ...pages]) {
    const src = readFileSync(join(root, file), "utf8");
    assert.ok(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\./.test(src), `${file} contains a JWT`);
    assert.ok(!/sb_secret_/.test(src), `${file} contains a secret key`);
  }
  const config = readFileSync(join(root, "js/lib/config.js"), "utf8");
  assert.ok(/sb_publishable_/.test(config), "the browser key must be the publishable key");
});

test("vendored libraries are version-pinned in their path", () => {
  for (const file of walk("vendor")) {
    if (file.endsWith(".woff2") || file.endsWith(".md")) continue;
    if (file.includes(`${"vendor"}${file.includes("\\") ? "\\" : "/"}fonts`)) continue; // versions are recorded in fonts.css
    assert.match(file, /\d+\.\d+\.\d+/, `${file} must carry its version so the immutable cache is safe`);
  }
});
