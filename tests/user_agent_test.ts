import { assertEquals } from "@std/assert";
import { APP_VERSION } from "../src/shared/app-meta.ts";
import { listBuiltinUserAgentKeywords, resolveUserAgent } from "../src/config/user-agent.ts";

Deno.test("resolveUserAgent returns undefined for empty input", () => {
  assertEquals(resolveUserAgent(undefined), undefined);
  assertEquals(resolveUserAgent(""), undefined);
  assertEquals(resolveUserAgent("   "), undefined);
});

Deno.test("resolveUserAgent keeps explicit string values", () => {
  assertEquals(resolveUserAgent("MyAgent/1.0"), "MyAgent/1.0");
});

Deno.test("resolveUserAgent resolves default keyword", () => {
  assertEquals(resolveUserAgent("default"), `GPT-Image-Translator/${APP_VERSION}`);
});

Deno.test("resolveUserAgent resolves keywords case-insensitively", () => {
  assertEquals(
    resolveUserAgent("Cherry-Studio"),
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CherryStudio/1.9.4 Chrome/146.0.7680.188 Electron/41.2.1 Safari/537.36",
  );
});

Deno.test("listBuiltinUserAgentKeywords includes expected entries", () => {
  const keywords = listBuiltinUserAgentKeywords();
  assertEquals(keywords.includes("default"), true);
  assertEquals(keywords.includes("cherry-studio"), true);
  assertEquals(keywords.includes("chrome-windows"), true);
  assertEquals(keywords.includes("firefox-linux"), true);
});
