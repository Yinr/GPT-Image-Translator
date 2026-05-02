import type { ProcessingMetadataRecord } from "../shared/types.ts";
import type { AppDatabase } from "./db.ts";
import { mapProcessingMetadata } from "./row-mappers.ts";

export class ProcessingMetadataStore {
  constructor(private readonly db: AppDatabase) {}

  create(record: ProcessingMetadataRecord): void {
    this.db.prepare(`
      INSERT INTO processing_metadata (
        id, job_id, enabled, api_size, source_width, source_height,
        canvas_width, canvas_height, source_rect_x, source_rect_y,
        source_rect_width, source_rect_height, fill, crop_back_to_original,
        uncropped_output_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        enabled = excluded.enabled,
        api_size = excluded.api_size,
        source_width = excluded.source_width,
        source_height = excluded.source_height,
        canvas_width = excluded.canvas_width,
        canvas_height = excluded.canvas_height,
        source_rect_x = excluded.source_rect_x,
        source_rect_y = excluded.source_rect_y,
        source_rect_width = excluded.source_rect_width,
        source_rect_height = excluded.source_rect_height,
        fill = excluded.fill,
        crop_back_to_original = excluded.crop_back_to_original,
        uncropped_output_path = excluded.uncropped_output_path,
        created_at = excluded.created_at
    `).run(
      record.id,
      record.jobId,
      record.enabled ? 1 : 0,
      record.apiSize ?? null,
      record.sourceWidth ?? null,
      record.sourceHeight ?? null,
      record.canvasWidth ?? null,
      record.canvasHeight ?? null,
      record.sourceRectX ?? null,
      record.sourceRectY ?? null,
      record.sourceRectWidth ?? null,
      record.sourceRectHeight ?? null,
      record.fill ?? null,
      record.cropBackToOriginal ? 1 : 0,
      record.uncroppedOutputPath ?? null,
      record.createdAt,
    );
  }

  getByJob(jobId: string): ProcessingMetadataRecord | undefined {
    const row = this.db.prepare("SELECT * FROM processing_metadata WHERE job_id = ?").get(jobId);
    return row ? mapProcessingMetadata(row as Record<string, unknown>) : undefined;
  }
}
