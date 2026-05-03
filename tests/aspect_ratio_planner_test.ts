import { assertEquals, assertThrows } from "@std/assert";
import { mapRectToOutput, planAspectRatioPadding } from "../src/core/aspect-ratio-planner.ts";

Deno.test("planAspectRatioPadding keeps square images on square canvas", () => {
  const plan = planAspectRatioPadding({ width: 1000, height: 1000 });

  assertEquals(plan.apiSize, "1024x1024");
  assertEquals(plan.canvas, { width: 1000, height: 1000 });
  assertEquals(plan.sourceRect, { x: 0, y: 0, width: 1000, height: 1000 });
});

Deno.test("planAspectRatioPadding pads portrait images without shrinking source pixels", () => {
  const plan = planAspectRatioPadding({ width: 800, height: 1200 });

  assertEquals(plan.apiSize, "1024x1536");
  assertEquals(plan.canvas, { width: 800, height: 1200 });
  assertEquals(plan.sourceRect, { x: 0, y: 0, width: 800, height: 1200 });
});

Deno.test("planAspectRatioPadding pads landscape images without shrinking source pixels", () => {
  const plan = planAspectRatioPadding({ width: 1200, height: 800 });

  assertEquals(plan.apiSize, "1536x1024");
  assertEquals(plan.canvas, { width: 1200, height: 800 });
  assertEquals(plan.sourceRect, { x: 0, y: 0, width: 1200, height: 800 });
});

Deno.test("planAspectRatioPadding centers source in expanded canvas", () => {
  const plan = planAspectRatioPadding({ width: 800, height: 1000 });

  assertEquals(plan.apiSize, "1024x1536");
  assertEquals(plan.canvas, { width: 800, height: 1200 });
  assertEquals(plan.sourceRect, { x: 0, y: 100, width: 800, height: 1000 });
});

Deno.test("planAspectRatioPadding chooses deterministic canvas for extreme ratios", () => {
  const wide = planAspectRatioPadding({ width: 3000, height: 500 });
  const tall = planAspectRatioPadding({ width: 500, height: 3000 });

  assertEquals(wide.apiSize, "1536x1024");
  assertEquals(wide.canvas.width >= 3000, true);
  assertEquals(wide.canvas.height >= 500, true);
  assertEquals(wide.sourceRect, { x: 0, y: 750, width: 3000, height: 500 });

  assertEquals(tall.apiSize, "1024x1536");
  assertEquals(tall.canvas.width >= 500, true);
  assertEquals(tall.canvas.height >= 3000, true);
  assertEquals(tall.sourceRect, { x: 750, y: 0, width: 500, height: 3000 });
});

Deno.test("planAspectRatioPadding uses stable tie-break order", () => {
  const plan = planAspectRatioPadding({ width: 1200, height: 1440 });

  assertEquals(plan.apiSize, "1024x1024");
  assertEquals(plan.canvas, { width: 1440, height: 1440 });
  assertEquals(plan.sourceRect, { x: 120, y: 0, width: 1200, height: 1440 });
});

Deno.test("mapRectToOutput scales crop rectangle to API output dimensions", () => {
  const mapped = mapRectToOutput(
    { x: 120, y: 0, width: 1200, height: 1440 },
    { width: 1440, height: 1440 },
    { width: 1024, height: 1024 },
  );

  assertEquals(mapped, { x: 85, y: 0, width: 853, height: 1024 });
});

Deno.test("planner rejects invalid dimensions", () => {
  assertThrows(
    () => planAspectRatioPadding({ width: 0, height: 100 }),
    Error,
    "source.width must be a positive integer",
  );
  assertThrows(
    () => planAspectRatioPadding({ width: 100, height: 1.5 }),
    Error,
    "source.height must be a positive integer",
  );
});
