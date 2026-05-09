import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createFutureTraversalProvenanceSummary } from "../src/desktopTraversalProvenance.js";

const traversalCasesPath = new URL(
  "../docs/fixtures/future-traversal-output-validation-cases.json",
  import.meta.url,
);
const provenanceSummaryPath = new URL(
  "../docs/fixtures/future-traversal-provenance-summary.json",
  import.meta.url,
);

test("future traversal provenance summary emits counts limits root source and truncation only", async () => {
  const traversalCases = JSON.parse(await readFile(traversalCasesPath, "utf8"));
  const expected = JSON.parse(await readFile(provenanceSummaryPath, "utf8"));

  const summary = createFutureTraversalProvenanceSummary({
    rootAuthorization: {
      authorization: "prior_disclosure",
      source_event_id: "provenance-uuid",
      source_type: "application_root",
    },
    request: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    traversal: {
      ...traversalCases.valid_case.traversal,
      nodes: Array.from({ length: 12 }, (_, index) => ({
        id: `n${index}`,
        service: ":1.42",
        path: `/node/${index}`,
        role: "frame",
        child_count: 0,
        depth: index === 0 ? 0 : 2,
        children: [],
      })),
    },
  });

  assert.deepEqual(summary, stripStaticEventFields(expected.event_fields));
});

test("future traversal provenance summary does not copy traversal tree details", () => {
  const summary = createFutureTraversalProvenanceSummary({
    rootAuthorization: {
      source_event_id: "provenance-uuid",
      source_type: "focused_object",
    },
    request: {
      max_depth: 1,
      max_nodes: 2,
      max_children_per_node: 1,
    },
    traversal: {
      nodes: [
        {
          id: "n0",
          service: ":1.private",
          path: "/private/path",
          role: "private role",
          child_count: 1,
          depth: 0,
          children: ["n1"],
          name: "private name",
        },
      ],
      truncated: true,
    },
  });

  const serialized = JSON.stringify(summary);
  for (const forbidden of [
    "n0",
    ":1.private",
    "/private/path",
    "private role",
    "private name",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(summary.traversal_node_count, 1);
  assert.equal(summary.traversal_truncated, true);
});

test("future traversal provenance summary stores unavailable traversal as summary only", () => {
  const summary = createFutureTraversalProvenanceSummary({
    rootAuthorization: {
      source_event_id: "provenance-uuid",
      source_type: "application_root",
    },
    request: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    traversal: null,
    unavailableReason: "atspi_traversal_unavailable",
  });

  assert.equal(summary.traversal_node_count, 0);
  assert.equal(summary.traversal_max_returned_depth, 0);
  assert.equal(summary.traversal_truncated, false);
  assert.equal(summary.traversal_unavailable_reason, "atspi_traversal_unavailable");
});

function stripStaticEventFields(eventFields) {
  const {
    event_type: _eventType,
    capability: _capability,
    ...summary
  } = eventFields;
  return summary;
}
