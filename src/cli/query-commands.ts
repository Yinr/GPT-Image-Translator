import { RunQueryService } from "../services/run-query.ts";
import type { JobDetail, RunDetail, RunSummary } from "../services/run-query.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { openDatabase } from "../storage/db.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";
import { ProcessingMetadataStore } from "../storage/processing-metadata-store.ts";
import { RunStore } from "../storage/run-store.ts";
export async function runStatusCommand(sqlitePath: string, limit: number): Promise<RunSummary[]> {
  const service = await openQueryService(sqlitePath);
  try {
    return service.query.listRecentRuns(limit);
  } finally {
    service.close();
  }
}

export async function runInspectCommand(
  sqlitePath: string,
  runId: string,
): Promise<RunDetail | undefined> {
  const service = await openQueryService(sqlitePath);
  try {
    return service.query.getRunDetail(runId);
  } finally {
    service.close();
  }
}

export async function runFailedCommand(sqlitePath: string, runId: string): Promise<JobDetail[]> {
  const service = await openQueryService(sqlitePath);
  try {
    return service.query.listFailedJobs(runId);
  } finally {
    service.close();
  }
}

async function openQueryService(sqlitePath: string) {
  const db = await openDatabase(sqlitePath);
  return {
    query: new RunQueryService(
      new RunStore(db),
      new JobStore(db),
      new AttemptStore(db),
      new OutputStore(db),
      new ProcessingMetadataStore(db),
    ),
    close: () => db.close(),
  };
}
