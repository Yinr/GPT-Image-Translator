import type { ImageEditRequest, ImageEditResult } from "../shared/types.ts";

export interface ImageAdapter {
  editImage(request: ImageEditRequest): Promise<ImageEditResult>;
  close?(): void;
}
