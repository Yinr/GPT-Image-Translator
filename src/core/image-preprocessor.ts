import { dirname } from "@std/path";
import type { AspectPadFill } from "../shared/types.ts";
import {
  type AspectRatioPlan,
  mapRectToOutput,
  planAspectRatioPadding,
} from "./aspect-ratio-planner.ts";
import { loadImageScript } from "./imagescript.ts";

export interface PrepareImageOptions {
  inputPath: string;
  outputPath: string;
  fill: AspectPadFill;
}

export interface PreparedImage {
  imagePath: string;
  plan: AspectRatioPlan;
  cleanup: () => Promise<void>;
}

export interface CropBackOptions {
  apiOutputBytes: Uint8Array;
  plan: AspectRatioPlan;
}

const TRANSPARENT = 0x00000000;
const WHITE = 0xffffffff;

type ImageScriptImage = Awaited<ReturnType<typeof loadImageScript>>["Image"];
type DecodedImage = Awaited<ReturnType<ImageScriptImage["decode"]>>;

export async function prepareAspectPaddedImage(
  options: PrepareImageOptions,
): Promise<PreparedImage> {
  const sourceBytes = await Deno.readFile(options.inputPath);
  const source = await decodeImage(sourceBytes, options.inputPath);
  const plan = planAspectRatioPadding({ width: source.width, height: source.height });
  const { Image } = await loadImageScript();
  const padded = new Image(plan.canvas.width, plan.canvas.height);
  padded.fill(fillColor(options.fill));
  padded.composite(source, plan.sourceRect.x, plan.sourceRect.y);

  const imagePath = `${options.outputPath}.preprocess.png`;
  await Deno.mkdir(dirname(imagePath), { recursive: true });
  await Deno.writeFile(imagePath, await padded.encode());

  return {
    imagePath,
    plan,
    cleanup: async () => {
      try {
        await Deno.remove(imagePath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    },
  };
}

export async function cropApiOutputToOriginal(options: CropBackOptions): Promise<Uint8Array> {
  const output = await decodeImage(options.apiOutputBytes, "API output");
  const rect = mapRectToOutput(options.plan.sourceRect, options.plan.canvas, {
    width: output.width,
    height: output.height,
  });
  const cropped = output.crop(rect.x, rect.y, rect.width, rect.height);
  return await cropped.encode();
}

async function decodeImage(bytes: Uint8Array, label: string): Promise<DecodedImage> {
  try {
    const { Image } = await loadImageScript();
    return await Image.decode(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decode image ${label}: ${message}`);
  }
}

function fillColor(fill: AspectPadFill): number {
  return fill === "white" ? WHITE : TRANSPARENT;
}
