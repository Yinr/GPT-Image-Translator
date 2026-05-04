import type { ImageFile } from "../shared/types.ts";
import { JOB_STATUS } from "../shared/status.ts";
import { JobStore } from "../storage/job-store.ts";

export interface PlanJobsInput {
  runId: string;
  images: ImageFile[];
  outputFor: (image: ImageFile) => PlannedOutput;
  now: string;
}

export interface PlannedOutput {
  path: string;
  skip: boolean;
}

export function planJobs(jobStore: JobStore, input: PlanJobsInput): void {
  for (const image of input.images) {
    const output = input.outputFor(image);
    jobStore.upsert({
      id: crypto.randomUUID(),
      runId: input.runId,
      inputPath: image.absolutePath,
      outputPath: output.path,
      status: output.skip ? JOB_STATUS.skipped : JOB_STATUS.pending,
      completedAt: output.skip ? input.now : undefined,
      now: input.now,
    });
  }
}

export function createJobId(): string {
  return crypto.randomUUID();
}
