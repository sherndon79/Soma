import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateFutureDesktopTraversalOutput } from "../src/desktopTraversalOutput.js";

const futureTraversalOutputCasesPath = new URL(
  "../docs/fixtures/future-traversal-output-validation-cases.json",
  import.meta.url,
);

function minimalTraversal(overrides = {}) {
  return {
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
    withheld_fields: ["name", "description", "text", "states", "actions"],
    ...overrides,
  };
}

test("future traversal output validator accepts the valid fixture case", async () => {
  const fixture = JSON.parse(await readFile(futureTraversalOutputCasesPath, "utf8"));

  assert.deepEqual(
    validateFutureDesktopTraversalOutput(fixture.valid_case.traversal),
    { valid: true, errors: [] },
  );
  assert.deepEqual(
    validateFutureDesktopTraversalOutput(fixture.unavailable_case.traversal),
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
  const result = validateFutureDesktopTraversalOutput(minimalTraversal({
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
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.nodes[0].actions is not allowed"));
});

test("future traversal output validator requires protected fields to remain withheld", () => {
  const result = validateFutureDesktopTraversalOutput(minimalTraversal({
    withheld_fields: ["name", "description"],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.withheld_fields must include text"));
  assert.ok(result.errors.includes("traversal.withheld_fields must include states"));
  assert.ok(result.errors.includes("traversal.withheld_fields must include actions"));
});

test("future traversal output validator rejects node counts beyond declared limit", () => {
  const result = validateFutureDesktopTraversalOutput(minimalTraversal({
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
      {
        id: "n1",
        service: ":1.42",
        path: "/child",
        role: "frame",
        child_count: 0,
        depth: 1,
        children: [],
      },
    ],
    limits: { max_depth: 1, max_nodes: 1, max_children_per_node: 1 },
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.nodes must have at most limits.max_nodes items"));
});

test("future traversal output validator rejects children beyond declared per-node limit", () => {
  const result = validateFutureDesktopTraversalOutput(minimalTraversal({
    nodes: [
      {
        id: "n0",
        service: ":1.42",
        path: "/root",
        role: "application",
        child_count: 2,
        depth: 0,
        children: ["n1", "n2"],
      },
      {
        id: "n1",
        service: ":1.42",
        path: "/child-1",
        role: "frame",
        child_count: 0,
        depth: 1,
        children: [],
      },
      {
        id: "n2",
        service: ":1.42",
        path: "/child-2",
        role: "frame",
        child_count: 0,
        depth: 1,
        children: [],
      },
    ],
    limits: { max_depth: 1, max_nodes: 3, max_children_per_node: 1 },
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.nodes[0].children must have at most limits.max_children_per_node items"));
});

test("future traversal output validator rejects text content inclusion", () => {
  const result = validateFutureDesktopTraversalOutput(minimalTraversal({
    text_content_included: true,
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.text_content_included must be false"));
});

test("future traversal output validator accepts zero-node unavailable traversal", () => {
  const result = validateFutureDesktopTraversalOutput(minimalTraversal({
    nodes: [],
    truncated: false,
    unavailable_reason: "atspi_bus_address_unavailable",
  }));

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("future traversal output validator rejects unavailable traversal with nodes", () => {
  const result = validateFutureDesktopTraversalOutput(minimalTraversal({
    unavailable_reason: "atspi_root_query_unavailable",
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("traversal.nodes must be empty when unavailable_reason is present"));
});
