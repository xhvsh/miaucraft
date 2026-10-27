import { assertEquals } from "jsr:@std/assert@1";
import { clientIp } from "./http.ts";

const req = (headers: Record<string, string>) => new Request("https://x.test", { headers });

Deno.test("clientIp prefers Cloudflare's header, which a client cannot set", () => {
  assertEquals(clientIp(req({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 2.2.2.2" })), "1.1.1.1");
});

Deno.test("clientIp ignores a spoofed leftmost x-forwarded-for entry", () => {
  assertEquals(clientIp(req({ "x-forwarded-for": "6.6.6.6, 3.3.3.3" })), "3.3.3.3");
});

Deno.test("clientIp falls back to a stable bucket", () => {
  assertEquals(clientIp(req({})), "unknown");
});
