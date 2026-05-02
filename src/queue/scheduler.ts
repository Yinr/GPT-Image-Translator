import type { JobRecord } from "../shared/types.ts";
import { JobStore } from "../storage/job-store.ts";

export function listRunnableJobs(
  jobStore: JobStore,
  runId: string,
  now: string,
  limit: number,
): JobRecord[] {
  return jobStore.listRunnable(runId, now, limit);
}
