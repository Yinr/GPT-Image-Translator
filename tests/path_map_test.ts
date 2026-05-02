import { assertEquals, assertThrows } from "@std/assert";
import { join, normalize } from "@std/path";
import { ensureOutputDirectory, mapOutputPath } from "../src/core/path-map.ts";

Deno.test("mapOutputPath preserves relative structure and uses output format", () => {
  const output = mapOutputPath(
    { absolutePath: normalize("/input/a/b/test.jpg"), relativePath: "a/b/test.jpg" },
    normalize("/output"),
    "png",
  );

  assertEquals(output.relativePath, "a/b/test.png");
});

Deno.test("ensureOutputDirectory creates parent directories", async () => {
  const root = await Deno.makeTempDir();
  const outputPath = join(root, "a", "b", "file.png");

  await ensureOutputDirectory(outputPath);
  const stat = await Deno.stat(join(root, "a", "b"));

  assertEquals(stat.isDirectory, true);
});

Deno.test("mapOutputPath rejects escaping relative paths", () => {
  assertThrows(
    () => mapOutputPath({ absolutePath: "x", relativePath: "../x.jpg" }, "/output", "png"),
    Error,
    "escapes",
  );
});
