import type { ImageEditRequest, ImageRequestSize } from "../shared/types.ts";
import { loadImageScript } from "../core/imagescript.ts";
import { OpenAICompatibleBaseAdapter } from "./base/openai-compatible-adapter.ts";
import type { ResolvedRequestOptions } from "./base/openai-compatible-adapter.ts";

const PIC2API_SIZE_POOLS = {
  "1k": [
    "1024x1024",
    "1280x720",
    "720x1280",
    "1536x1024",
    "1024x1536",
    "1152x864",
    "864x1152",
    "1120x896",
    "896x1120",
    "1456x624",
  ],
  "2k": [
    "2048x2048",
    "2560x1440",
    "1440x2560",
    "2496x1664",
    "1664x2496",
    "2304x1728",
    "1728x2304",
    "2240x1792",
    "1792x2240",
    "3024x1296",
  ],
  "4k": [
    "2480x2480",
    "3328x1872",
    "1872x3328",
    "3056x2032",
    "2032x3056",
    "2880x2160",
    "2160x2880",
    "2784x2224",
    "2224x2784",
    "3808x1632",
  ],
} as const;

export class Pic2ApiAdapter extends OpenAICompatibleBaseAdapter {
  protected async resolveRequestOptions(
    request: ImageEditRequest,
    imageBytes: Uint8Array,
  ): Promise<ResolvedRequestOptions> {
    const size = request.size ?? this.config.image.size;
    if (this.config.model !== "gpt-image-2") {
      return {
        size,
        quality: this.config.image.quality === "auto" ? undefined : this.config.image.quality,
      };
    }

    return {
      size: size === "auto" ? await selectPic2ApiSize(imageBytes, this.config.image.quality) : size,
      quality: mapPic2ApiQuality(this.config.image.quality),
    };
  }
}

async function selectPic2ApiSize(
  imageBytes: Uint8Array,
  quality: Pic2ApiAdapter["config"]["image"]["quality"],
): Promise<ImageRequestSize> {
  const { Image } = await loadImageScript();
  const source = await Image.decode(imageBytes);
  const sourceRatio = source.width / source.height;
  const candidates = PIC2API_SIZE_POOLS[pic2ApiTierForQuality(quality)].map((size) => {
    const [width, height] = size.split("x").map(Number);
    return {
      size,
      ratioDelta: Math.abs(sourceRatio - width / height),
      areaDelta: Math.abs(source.width * source.height - width * height),
    };
  }).sort((a, b) => {
    const ratioOrder = a.ratioDelta - b.ratioDelta;
    if (ratioOrder !== 0) return ratioOrder;
    return a.areaDelta - b.areaDelta;
  });

  return candidates[0].size as ImageRequestSize;
}

function pic2ApiTierForQuality(
  quality: Pic2ApiAdapter["config"]["image"]["quality"],
): keyof typeof PIC2API_SIZE_POOLS {
  if (quality === "low") return "1k";
  if (quality === "high") return "4k";
  return "2k";
}

function mapPic2ApiQuality(
  quality: Pic2ApiAdapter["config"]["image"]["quality"],
): string | undefined {
  if (quality === "auto") return undefined;
  if (quality === "low") return "standard";
  if (quality === "high") return "4k";
  return "hd";
}
