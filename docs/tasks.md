# Implementation Plan: GPT Image Translator

## Overview

This project is now past the initial vertical-slice implementation. The current plan tracks two
things:

- The completed baseline that must stay stable.
- The next architecture and feature iterations that should be implemented in small, verified slices.

The program remains a Deno CLI first, with queue, storage, OpenAI client, and query logic kept
reusable for a future Web UI.

## Architecture Decisions

- Use a local SQLite-backed queue rather than only in-memory iteration because real image requests
  are slow and interruption recovery is required.
- Keep CLI as a thin adapter over core queue execution so a future Web UI can reuse the same
  modules.
- Use `/v1/images/edits` and parse `data[0].b64_json`; do not expect raw binary HTTP responses.
- Use the API response `output_format` for output file extension.
- Prefer Deno Standard Library for common functionality: filesystem walking, path handling, CLI
  parsing, YAML parsing, and base64 decoding.
- Prefer JSR dependencies. Use npm or URL imports only when no suitable JSR package exists or a
  concrete compatibility issue requires it.
- Use `jsr:@db/sqlite` for SQLite storage unless implementation testing reveals a blocker.
- Keep image API option values centralized so config validation and client behavior cannot drift.
- Treat image aspect-ratio preprocessing as a separate pipeline stage before the OpenAI client, not
  as OpenAI client responsibility.

## Current Baseline

### Completed Phase 1: Foundation

- [x] Deno project skeleton exists.
- [x] `deno task check`, `deno task test`, and `deno task fmt` are configured.
- [x] `src/main.ts` is the program entrypoint.
- [x] Source directories are split by concern: `cli`, `config`, `core`, `queue`, `openai`,
      `storage`, `fs`, `shared`, and `services`.

Verification:

- `deno task check`
- `deno task test`
- `deno task fmt`

### Completed Phase 2: Config, Files, and Response Parsing

- [x] YAML config loading works with defaults and validation.
- [x] `config.example.yaml` contains Chinese comments for all current user-facing fields.
- [x] Scanner recursively finds supported image files in stable order.
- [x] Output path mapping preserves input directory structure and blocks path escape.
- [x] Image edit response parser decodes `data[0].b64_json`.
- [x] Missing `output_format` defaults to `png`.

Verification:

- `deno test tests/config_test.ts tests/scanner_test.ts tests/path_map_test.ts tests/response_parser_test.ts`

### Completed Phase 3: SQLite Queue

- [x] SQLite migrations initialize idempotently.
- [x] Runs, jobs, attempts, and outputs are persisted.
- [x] Jobs can be planned, upserted, queried, and updated.
- [x] Pending and due retryable jobs are scheduled.
- [x] Failed jobs are not retried unless future functionality explicitly supports it.

Verification:

- `deno test tests/storage_test.ts tests/scheduler_test.ts`

### Completed Phase 4: OpenAI Client and Retry

- [x] OpenAI-compatible image edit client sends multipart requests to `/v1/images/edits`.
- [x] Base URL works with or without `/v1`.
- [x] Request timeout is configurable.
- [x] API key is read from the configured environment variable and is not printed.
- [x] Error classifier marks 429 and 5xx as retryable.
- [x] Error classifier marks 401 and 403 as stop-run errors.
- [x] Retry policy supports exponential backoff and `Retry-After`.

Verification:

- `deno test tests/openai_client_test.ts tests/error_classifier_test.ts tests/retry_policy_test.ts`

### Completed Phase 5: Runner, CLI, and Query Layer

- [x] Single job runner marks jobs running before API attempts.
- [x] Successful jobs write output, record metadata, and become `succeeded`.
- [x] Retryable failures schedule `next_attempt_at`.
- [x] Non-retryable auth failures can stop the run.
- [x] Queue runner supports configurable concurrency and minimum delay.
- [x] CLI supports `translate`, `status`, `inspect`, and `failed` flows.
- [x] Default no-subcommand behavior remains compatible with `translate`.
- [x] Query service is separate from CLI so a future Web UI can reuse it.
- [x] Resume reuses a matching running run and resets stale running jobs.

Verification:

- `deno test tests/job_runner_test.ts tests/queue_runner_test.ts tests/cli_args_test.ts tests/cli_run_test.ts tests/query_commands_test.ts tests/run_query_service_test.ts`

### Completed Follow-up: Image Option Support

- [x] Verify official/compatible `gpt-image-2` supported options for image edit requests.
- [x] Add validated options to `OpenAIConfig`: `size`, `quality`, `background`, and `outputFormat`.
- [x] Add Chinese comments and option values to `config.example.yaml`.
- [x] Document manual smoke-test behavior under `.local/smoke-test/`.
- [x] Centralize image option values in `src/openai/image-options.ts`.

Implemented behavior notes:

- `size`, `quality`, and `background` accept `auto`.
- `auto` means the field is omitted from the request payload.
- `outputFormat` is still sent as `output_format` because it controls output decoding and file
  naming.
- The known supported `size` values are fixed API canvas sizes, not arbitrary source-image ratios.

Verification:

- `deno test tests/config_test.ts tests/openai_client_test.ts`

## Next Architecture Maintenance

### Task A1: Normalize Shared Constants and Status Metadata

**Description:** Review repeated status strings, config option lists, and CLI/query display
mappings. Move constants only when doing so reduces duplication without creating a generic dumping
ground.

**Acceptance criteria:**

- Job/run status values have a single authoritative type definition.
- User-facing status summaries still match current CLI output.
- No CLI-specific formatting leaks into storage or queue modules.

**Verification:**

- `deno task check`
- `deno task test`

**Files likely touched:**

- `src/shared/types.ts`
- `src/cli/run.ts`
- `src/cli/query-commands.ts`
- `src/services/run-query.ts`

**Estimated scope:** Small

### Task A2: Tighten Query-Service Boundaries

**Description:** Audit `RunQueryService` and storage row mapping to ensure future Web UI callers can
consume stable DTOs without depending on SQLite row shapes or CLI output formatting.

**Acceptance criteria:**

- Query service returns typed records that are independent from database row names.
- CLI query commands only format query-service results.
- Storage row mappers remain internal to storage.

**Verification:**

- `deno test tests/run_query_service_test.ts tests/query_commands_test.ts`
- `deno task check`

**Files likely touched:**

- `src/services/run-query.ts`
- `src/storage/row-mappers.ts`
- `src/cli/query-commands.ts`
- `tests/run_query_service_test.ts`
- `tests/query_commands_test.ts`

**Estimated scope:** Medium

### Task A3: Document Real Smoke-Test Workflow

**Description:** Convert the ad-hoc smoke-test notes under `.local/smoke-test/` into a stable, safe
manual workflow document that does not include secrets or generated outputs.

**Acceptance criteria:**

- [x] A documented opt-in smoke command exists.
- [x] Required environment variables are listed without exposing values.
- [x] Expected success and failure signals are documented.
- [x] Generated outputs remain under ignored temporary directories.

**Verification:**

- Documentation review.
- Optional manual smoke test.

**Files likely touched:**

- `docs/smoke-tests.md`
- `.local/smoke-test/api-test-notes.md`
- `.gitignore` for temporary outputs

**Estimated scope:** Small

## Future Feature Roadmap

### Task F1: Aspect-Ratio Preprocessing Design

**Description:** Design a preprocessing stage that pads input images to the nearest supported
`gpt-image-2` canvas ratio without shrinking original pixels. This stage should run before the
OpenAI client and produce a prepared image path plus the chosen API `size`.

Target behavior:

- Read the original image dimensions.
- Select the best supported API canvas by aspect-ratio match.
- Keep the original image centered.
- Expand the canvas to the selected ratio without compressing original pixels.
- Fill expanded areas with transparent or white background based on config.
- Send the preprocessed image to `/v1/images/edits`.
- Set request `size` to the selected supported canvas size.

**Acceptance criteria:**

- Design documents where preprocessing sits in the queue/job-runner flow.
- Config shape is specified but not necessarily implemented.
- Storage implications are identified for original, preprocessed, uncropped API output, and final
  output paths.
- Image library choice is justified, preferably JSR/Deno-compatible.

**Verification:**

- `docs/spec.md` updated with the agreed design.
- `docs/tasks.md` updated if task boundaries change.

**Files likely touched:**

- `docs/spec.md`
- `docs/tasks.md`
- Possibly an ADR under `docs/adr/`

**Estimated scope:** Medium

### Task F2: Add Aspect-Ratio Preprocessing Config

**Description:** Add configuration for optional aspect-ratio preprocessing and optional crop-back
behavior.

Proposed YAML shape:

```yaml
preprocess:
  aspectPad:
    enabled: false
    fill: transparent # transparent / white
    cropBackToOriginal: false
    intermediateDir: .intermediate
```

Config behavior:

- `enabled: false` preserves current behavior.
- `fill: transparent` uses transparent padding when output format and image processing support it.
- `fill: white` uses opaque white padding.
- `cropBackToOriginal: true` crops returned API output back to the original pixel rectangle.
- `intermediateDir` is inside `outputDir` and stores pre-crop API outputs when crop-back is enabled.

**Acceptance criteria:**

- Defaults preserve current behavior.
- Config validation rejects unknown fill modes and unsafe intermediate paths.
- `config.example.yaml` documents the feature in Chinese.

**Verification:**

- `deno test tests/config_test.ts`
- `deno task check`

**Files likely touched:**

- `config.example.yaml`
- `src/config/defaults.ts`
- `src/config/load.ts`
- `src/config/schema.ts`
- `src/shared/types.ts`
- `tests/config_test.ts`

**Estimated scope:** Medium

### Task F3: Implement Aspect-Ratio Planner

**Description:** Implement pure functions that choose the best supported API canvas size and compute
padding/crop rectangles from source dimensions.

Rules:

- Do not shrink the original image pixels.
- Scale the selected API canvas ratio up to contain the original dimensions.
- Center the original image in the expanded canvas.
- Store the original image rectangle for optional crop-back after API output.

**Acceptance criteria:**

- Square, portrait, landscape, and extreme aspect-ratio inputs choose deterministic sizes.
- Computed canvas dimensions always contain the original dimensions.
- Crop rectangle corresponds to the original image position within the padded canvas.
- No filesystem or image library dependency is required for the planner tests.

**Verification:**

- `deno test tests/aspect_ratio_planner_test.ts`
- `deno task check`

**Files likely touched:**

- `src/core/aspect-ratio-planner.ts`
- `tests/aspect_ratio_planner_test.ts`

**Estimated scope:** Medium

### Task F4: Implement Image Padding and Crop Processing

**Description:** Add an image processing adapter that can create padded input images and optionally
crop API outputs back to the original rectangle.

Processing flow:

- Read original dimensions.
- Create a padded canvas using the planner result.
- Write a temporary/preprocessed input image for the API call.
- Preserve the API's uncropped output when crop-back is enabled.
- Crop the API output back to the original rectangle when configured.
- Write the final output to the normal output path.

**Acceptance criteria:**

- Original pixels are not downscaled during preprocessing.
- Padded image dimensions match the planner output.
- Fill mode supports transparent and white padding.
- Crop-back produces only a crop, not a resize.
- Uncropped API output is retained under the configured intermediate directory when crop-back is
  enabled.
- Temporary files are cleaned up when safe, while durable intermediate outputs are preserved.

**Verification:**

- Unit tests using generated small images.
- `deno task check`
- `deno task test`

**Files likely touched:**

- `src/core/image-preprocessor.ts`
- `src/fs/output-path.ts`
- `src/queue/job-runner.ts`
- `src/storage/output-store.ts`
- `tests/image_preprocessor_test.ts`
- `tests/job_runner_test.ts`

**Estimated scope:** Large

### Task F5: Integrate Preprocessing with Queue Execution

**Description:** Wire aspect-ratio preprocessing into job execution while preserving current
behavior when disabled.

**Acceptance criteria:**

- Disabled preprocessing leaves existing request and output behavior unchanged.
- Enabled preprocessing sends the padded image path to the OpenAI client.
- Enabled preprocessing sets request `size` to the planner-selected API size.
- Crop-back mode writes the final cropped output to the normal output path.
- Crop-back mode also preserves the uncropped API output in the intermediate directory.
- Attempts and output metadata clearly identify final output and any preserved intermediate output.

**Verification:**

- `deno test tests/job_runner_test.ts tests/queue_runner_test.ts`
- `deno task test`
- Optional manual smoke test on one portrait, one landscape, and one square image.

**Files likely touched:**

- `src/queue/job-runner.ts`
- `src/openai/client.ts`
- `src/shared/types.ts`
- `src/storage/output-store.ts`
- `tests/job_runner_test.ts`
- `tests/queue_runner_test.ts`

**Estimated scope:** Large

### Task F6: Expose Operational Controls for Preprocessing

**Description:** Add CLI/query visibility for preprocessing decisions so users can diagnose why a
given output used a particular canvas size or crop behavior.

**Acceptance criteria:**

- Job inspection shows whether preprocessing was enabled.
- Job inspection shows selected API size and crop-back status when available.
- Failed preprocessing errors are clear and non-retryable unless caused by transient filesystem
  issues.

**Verification:**

- `deno test tests/query_commands_test.ts tests/run_query_service_test.ts`
- Manual CLI inspection of a preprocessed run.

**Files likely touched:**

- `src/services/run-query.ts`
- `src/cli/query-commands.ts`
- `src/storage/migrations.ts`
- `tests/query_commands_test.ts`
- `tests/run_query_service_test.ts`

**Estimated scope:** Medium

## Open Planning Questions

- Should `gpt-image-2-2k` and `gpt-image-2-4k` be exposed as model presets or remain plain model
  strings?
- Which image processing library should be used for padding/cropping on Deno and Windows?
- Should transparent padding automatically force `outputFormat: png` or only validate/warn?
- Should intermediate preprocessed API inputs be preserved, or only uncropped API outputs?
- Should crop-back metadata be stored in the existing `outputs` table or a new processing-metadata
  table?
- Should prompt support per-directory or per-file overrides later?
- Are cancellation and pause controls needed in the first CLI release or only for the future Web UI?

## Risks and Mitigations

| Risk                                                   | Impact | Mitigation                                                     |
| ------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| Image requests take several minutes                    | High   | Long timeout, durable queue, resume support                    |
| API key leaks in logs                                  | High   | Read from env and mask secret values                           |
| 429 or transient failures interrupt batches            | High   | Retry policy with `Retry-After` and SQLite attempts            |
| Output extension mismatch                              | Medium | Use `output_format` from response                              |
| Future Web UI needs different control flow             | Medium | Keep queue/core independent from CLI                           |
| Fixed API canvas sizes crop or alter unusual ratios    | Medium | Optional aspect-ratio preprocessing and crop-back workflow     |
| Cropped output hides useful uncropped API result       | Medium | Preserve uncropped API output in an intermediate output folder |
| Image processing dependencies behave poorly on Windows | Medium | Choose a Deno/Windows-compatible library and test early        |
