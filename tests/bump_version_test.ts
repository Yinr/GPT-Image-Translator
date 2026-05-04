import { assertEquals, assertThrows } from "@std/assert";
import { bumpVersion } from "../scripts/bump-version.ts";

Deno.test("bumpVersion increments patch version", () => {
  assertEquals(bumpVersion("0.1.0", "patch"), "0.1.1");
});

Deno.test("bumpVersion increments minor version", () => {
  assertEquals(bumpVersion("0.1.0", "minor"), "0.2.0");
});

Deno.test("bumpVersion increments major version", () => {
  assertEquals(bumpVersion("0.1.0", "major"), "1.0.0");
});

Deno.test("bumpVersion rejects non-semver version", () => {
  assertThrows(
    () => bumpVersion("0.1", "patch"),
    Error,
    "APP_VERSION must be a semantic version in x.y.z format",
  );
});
