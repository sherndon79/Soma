import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateFutureDesktopTraversalOutput } from "../src/desktopTraversalOutput.js";

const futureTraversalOutputCasesPath = new URL(
  "../docs/fixtures/future-traversal-output-validation-cases.json",
  import.meta.url,
);

test("future traversal output validator accepts the valid fixture case", async () => {
  const fixture = JSON.parse(await readFile(futureTraversalOutputCasesPath, "utf8"));

  assert.deepEqual(
    validateFutureDesktopTraversalOutput(fixture.valid_case.traversal),
    { valid: true, errors: [] },
  );
});

test("future traversal output validator rejects fixture invalid cases", async () => {
  const fixture = JSON.parse(await readFile(futureTraversalOutputCasesPath, "utf8"));

  for (const invalidCase of fixture.invalid_cases) {
    const result = validateFutureDesktopTraversalOutput(invalidCase.traversal);

    assert.equal(result.valid, false, invalidCase.name);
    assert.ok(result.errors.length > 0, invalidCase.name);
  }
});

test("future traversal output validator rejects protected traversal node fields", () => {
  const result = validateFutureDesktopTraversalOutput({
    root: { service: ":1.42", path: "/root" },
    nodes: [
      {
        id: "n0",
        service: ":1.42",
        path: "/root",
        role: "application",
        child_count: 0,
        depth: 0,
        children: [],
        actions: ["click"],
      },
    ],
    limits: { max_depth: 1, max_nodes: 1, max_children_per_node: 1 },
    truncated: false,
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.nodes[0].actions is not allowed"));
});

test("future traversal output validator requires protected fields to remain withheld", () => {
  const result = validateFutureDesktopTraversalOutput({
    root: { service: ":1.42", path: "/root" },
    nodes: [
      {
        id: "n0",
        service: ":1.42",
        path: "/root",
        role: "application",
        child_count: 0,
        depth: 0,
        children: [],
      },
    ],
    limits: { max_depth: 1, max_nodes: 1, max_children_per_node: 1 },
    truncated: false,
    text_content_included: false,
    withheld_fields: ["name", "description"],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.withheld_fields must include text"));
  assert.ok(result.errors.includes("traversal.withheld_fields must include states"));
  assert.ok(result.errors.includes("traversal.withheld_fields must include actions"));
});

