import { test, before } from "node:test";
import assert from "node:assert/strict";

let wp;
before(async () => {
  globalThis.window = { supabase: { createClient: () => ({}) } };
  globalThis.document = { addEventListener() {} };
  wp = await import("../js/lib/waypoints.js");
});

test("validateWaypointInput accepts a normal waypoint", () => {
  assert.equal(wp.validateWaypointInput({ name: "Home", description: "base", x: 10, y: 64, z: -20 }), null);
  assert.equal(wp.validateWaypointInput({ name: "No coords yet" }), null);
});

test("validateWaypointInput mirrors the database limits", () => {
  assert.match(wp.validateWaypointInput({ name: "  " }), /Name is required/);
  assert.match(wp.validateWaypointInput({ name: "n".repeat(61) }), /too long/);
  assert.equal(wp.validateWaypointInput({ name: "n".repeat(60) }), null);
  assert.match(wp.validateWaypointInput({ name: "a", description: "d".repeat(161) }), /Description is too long/);
  assert.match(wp.validateWaypointInput({ name: "a", x: "abc" }), /X coordinate is invalid/);
  assert.match(wp.validateWaypointInput({ name: "a", z: NaN }), /Z coordinate is invalid/);
  assert.match(wp.validateWaypointInput({ name: "a", x: 30_000_001 }), /outside the world/);
  assert.match(wp.validateWaypointInput({ name: "a", z: -30_000_001 }), /outside the world/);
  assert.equal(wp.validateWaypointInput({ name: "a", x: 30_000_000, z: -30_000_000 }), null);
});

test("gallery uploads are limited to jpeg/png/webp under the size cap", () => {
  assert.match(wp.validateGalleryFile(null), /No file/);
  assert.match(wp.validateGalleryFile({ type: "image/svg+xml", size: 10 }), /Only JPG, PNG and WebP/);
  assert.match(wp.validateGalleryFile({ type: "text/html", size: 10 }), /Only JPG, PNG and WebP/);
  assert.match(wp.validateGalleryFile({ type: "image/png", size: wp.GALLERY_MAX_BYTES + 1 }), /too large/);
  assert.equal(wp.validateGalleryFile({ type: "image/webp", size: 1024 }), null);
});

test("category icon classes cannot smuggle arbitrary classes", () => {
  assert.equal(wp.sanitizeIconClass("fa-solid fa-star"), "fa-solid fa-star");
  assert.ok(!wp.categoryIconClass('x" onmouseover="alert(1)').includes('"'));
});
