import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { scanImages } from "../src/core/scanner.ts";

Deno.test("scanImages recursively finds supported images in stable order", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "nested"));
  await Deno.writeTextFile(join(root, "b.png"), "b");
  await Deno.writeTextFile(join(root, "a.txt"), "a");
  await Deno.writeTextFile(join(root, "nested", "a.JPG"), "a");

  const images = await scanImages(root, { recursive: true, extensions: [".jpg", ".png"] });

  assertEquals(images.map((image) => image.relativePath), ["b.png", "nested/a.JPG"]);
});

Deno.test("scanImages respects non-recursive mode", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "nested"));
  await Deno.writeTextFile(join(root, "nested", "a.jpg"), "a");

  const images = await scanImages(root, { recursive: false, extensions: [".jpg"] });

  assertEquals(images.length, 0);
});
