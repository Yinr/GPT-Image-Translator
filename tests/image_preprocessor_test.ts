import { join } from "@std/path";
import { assertEquals, assertRejects } from "@std/assert";
import { Image } from "@matmen/imagescript";
import {
  cropApiOutputToOriginal,
  prepareAspectPaddedImage,
} from "../src/core/image-preprocessor.ts";

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;
const TRANSPARENT = 0x00000000;
const WHITE = 0xffffffff;

Deno.test("prepareAspectPaddedImage pads with transparent background and cleans up", async () => {
  const dir = await Deno.makeTempDir();
  const inputPath = join(dir, "input.png");
  const outputPath = join(dir, "out", "image.png");
  await writeSolidImage(inputPath, 800, 1000, RED);

  const prepared = await prepareAspectPaddedImage({ inputPath, outputPath, fill: "transparent" });
  const padded = await readImage(prepared.imagePath);

  assertEquals(prepared.plan.apiSize, "1024x1536");
  assertEquals(prepared.plan.canvas, { width: 800, height: 1200 });
  assertEquals(prepared.plan.sourceRect, { x: 0, y: 100, width: 800, height: 1000 });
  assertEquals(padded.width, 800);
  assertEquals(padded.height, 1200);
  assertEquals(padded.getPixelAt(1, 1), TRANSPARENT);
  assertEquals(padded.getPixelAt(1, 101), RED);

  await prepared.cleanup();
  await assertRejects(() => Deno.stat(prepared.imagePath), Deno.errors.NotFound);
});

Deno.test("prepareAspectPaddedImage supports white padding", async () => {
  const dir = await Deno.makeTempDir();
  const inputPath = join(dir, "input.png");
  const outputPath = join(dir, "out.png");
  await writeSolidImage(inputPath, 800, 1000, BLUE);

  const prepared = await prepareAspectPaddedImage({ inputPath, outputPath, fill: "white" });
  const padded = await readImage(prepared.imagePath);

  assertEquals(padded.getPixelAt(1, 1), WHITE);
  assertEquals(padded.getPixelAt(1, 101), BLUE);

  await prepared.cleanup();
});

Deno.test("cropApiOutputToOriginal crops mapped source rectangle without resizing", async () => {
  const output = new Image(800, 1200);
  output.fill(WHITE);
  const sourceRegion = new Image(800, 1000);
  sourceRegion.fill(BLUE);
  output.composite(sourceRegion, 0, 100);

  const croppedBytes = await cropApiOutputToOriginal({
    apiOutputBytes: await output.encode(),
    plan: {
      apiSize: "1024x1536",
      source: { width: 800, height: 1000 },
      canvas: { width: 800, height: 1200 },
      sourceRect: { x: 0, y: 100, width: 800, height: 1000 },
    },
  });
  const cropped = await Image.decode(croppedBytes);

  assertEquals(cropped.width, 800);
  assertEquals(cropped.height, 1000);
  assertEquals(cropped.getPixelAt(1, 1), BLUE);
  assertEquals(cropped.getPixelAt(800, 1000), BLUE);
});

Deno.test("cropApiOutputToOriginal maps crop rectangle when API output size differs", async () => {
  const output = new Image(400, 600);
  output.fill(WHITE);
  const sourceRegion = new Image(400, 500);
  sourceRegion.fill(RED);
  output.composite(sourceRegion, 0, 50);

  const croppedBytes = await cropApiOutputToOriginal({
    apiOutputBytes: await output.encode(),
    plan: {
      apiSize: "1024x1536",
      source: { width: 800, height: 1000 },
      canvas: { width: 800, height: 1200 },
      sourceRect: { x: 0, y: 100, width: 800, height: 1000 },
    },
  });
  const cropped = await Image.decode(croppedBytes);

  assertEquals(cropped.width, 400);
  assertEquals(cropped.height, 500);
  assertEquals(cropped.getPixelAt(1, 1), RED);
});

async function writeSolidImage(
  path: string,
  width: number,
  height: number,
  color: number,
): Promise<void> {
  const image = new Image(width, height);
  image.fill(color);
  await Deno.writeFile(path, await image.encode());
}

async function readImage(path: string): Promise<Image> {
  return await Image.decode(await Deno.readFile(path));
}
