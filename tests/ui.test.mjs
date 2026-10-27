import { test, before } from "node:test";
import assert from "node:assert/strict";

// ui.js touches `document` at import time (image fallback listener); a minimal
// stub is enough because everything else is exercised through its exports.
const listeners = [];
class FakeImage {
  constructor(dataset) {
    this.dataset = dataset;
    this.removed = false;
    this.replacement = null;
  }
  remove() {
    this.removed = true;
  }
  replaceWith(node) {
    this.replacement = node;
  }
}
let ui;
before(async () => {
  globalThis.HTMLImageElement = FakeImage;
  globalThis.document = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    createElement: () => ({
      className: "",
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
    }),
  };
  ui = await import("../js/lib/ui.js");
});

test("escapeHtml neutralises every HTML metacharacter", () => {
  assert.equal(ui.escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(ui.escapeHtml(null), "");
  assert.equal(ui.escapeHtml(undefined), "");
  assert.equal(ui.escapeHtml(42), "42");
});

test("escapeHtml output is inert inside a double-quoted attribute", () => {
  assert.ok(!ui.escapeHtml('" onmouseover="alert(1)').includes('"'));
});

test("sanitizeColor only lets #rrggbb through", () => {
  assert.equal(ui.sanitizeColor("#a1B2c3"), "#a1B2c3");
  for (const bad of ["red", "#fff", "#12345g", "url(javascript:1)", "#aabbcc;position:fixed", "", null, undefined]) {
    assert.equal(ui.sanitizeColor(bad), "#ffffff", String(bad));
  }
});

test("formatUptime", () => {
  assert.equal(ui.formatUptime(0), "0m");
  assert.equal(ui.formatUptime(59 * 60_000), "59m");
  assert.equal(ui.formatUptime(61 * 60_000), "1h 1m");
  assert.equal(ui.formatUptime((26 * 60 + 5) * 60_000), "1d 2h 5m");
});

test("formatRelativeTime copes with junk", () => {
  assert.equal(ui.formatRelativeTime(null), "unknown time");
  assert.equal(ui.formatRelativeTime("not a date"), "unknown time");
  assert.match(ui.formatRelativeTime(new Date(Date.now() - 3 * 3600_000).toISOString()), /3 hours? ago/);
});

test("debounce coalesces calls", async () => {
  let calls = 0;
  const fn = ui.debounce(() => calls++, 10);
  fn();
  fn();
  fn();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 1);
});

test("image fallbacks replace inline onerror handlers (CSP-safe)", () => {
  const handler = listeners.find((l) => l.type === "error");
  assert.ok(handler?.capture, "error events do not bubble, so the listener must capture");

  const gone = new FakeImage({ imgFallback: "remove" });
  handler.fn({ target: gone });
  assert.ok(gone.removed);

  const icon = new FakeImage({ imgFallback: "icon", fallbackIcon: "fa-crown" });
  handler.fn({ target: icon });
  assert.equal(icon.replacement.className, "fa-solid fa-crown");

  // a hostile icon name must not become arbitrary classes/markup
  const hostile = new FakeImage({ imgFallback: "icon", fallbackIcon: 'x" onclick="evil' });
  handler.fn({ target: hostile });
  assert.ok(hostile.removed && hostile.replacement === null);

  const untouched = new FakeImage({});
  handler.fn({ target: untouched });
  assert.ok(!untouched.removed);
});
