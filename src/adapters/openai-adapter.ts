import type { ImageEditRequest } from "../shared/types.ts";
import { OpenAICompatibleBaseAdapter } from "./base/openai-compatible-adapter.ts";
import type { ResolvedRequestOptions } from "./base/openai-compatible-adapter.ts";

export class OpenAIAdapter extends OpenAICompatibleBaseAdapter {
  protected resolveRequestOptions(request: ImageEditRequest): Promise<ResolvedRequestOptions> {
    return Promise.resolve({
      size: request.size ?? this.config.image.size,
      quality: this.config.image.quality === "auto" ? undefined : this.config.image.quality,
    });
  }
}
