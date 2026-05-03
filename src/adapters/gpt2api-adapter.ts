import type { ImageEditRequest } from "../shared/types.ts";
import { OpenAICompatibleBaseAdapter } from "./base/openai-compatible-adapter.ts";
import type { ResolvedRequestOptions } from "./base/openai-compatible-adapter.ts";

export class Gpt2ApiAdapter extends OpenAICompatibleBaseAdapter {
  protected resolveRequestOptions(request: ImageEditRequest): Promise<ResolvedRequestOptions> {
    return Promise.resolve({
      size: request.size ?? this.config.image.size,
      quality: this.config.image.quality === "auto" ? undefined : this.config.image.quality,
    });
  }

  protected override shouldFallbackToReferenceGenerations(status: number, body: string): boolean {
    if ([404, 405, 415].includes(status)) return true;
    if (![400, 422].includes(status)) return false;

    const normalized = body.toLowerCase();
    return normalized.includes("reference_images") || normalized.includes("application/json") ||
      normalized.includes("images/generations") || normalized.includes("unsupported") ||
      normalized.includes("not support");
  }
}
