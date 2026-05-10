import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createFutureTraversalProvenanceSummary,
  createTraversalProvenanceSummary,
  createValidatedFutureTraversalProvenanceSummary,
  createValidatedTraversalProvenanceSummary,
} from "../src/desktopTraversalProvenance.js";

const traversalCasesPath = new URL(
  "../docs/fixtures/future-traversal-output-validation-cases.json",
  import.meta.url,
);
const provenanceSummaryPath = new URL(
  "../docs/fixtures/future-traversal-provenance-summary.json",
  import.meta.url,
);

test("desktop traversal provenance summary emits counts limits root source and truncation only", async () => {
  const traversalCases = JSON.parse(await readFile(traversalCasesPath, "utf8"));
  const expected = JSON.parse(await readFile(provenanceSummaryPath, "utf8"));

  const summary = createTraversalProvenanceSummary({
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

test("desktop traversal provenance summary does not copy traversal tree details", () => {
  const summary = createTraversalProvenanceSummary({
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

test("future traversal provenance builders remain as compatibility delegates", () => {
  const args = {
    rootAuthorization: {
      authorization: "prior_disclosure",
      source_event_id: "provenance-uuid",
      source_type: "application_root",
    },
    request: {
      max_depth: 1,
      max_nodes: 1,
      max_children_per_node: 1,
    },
    traversal: {
      root: { service: ":1.42", path: "/root" },
      nodes: [],
      limits: { max_depth: 1, max_nodes: 1, max_children_per_node: 1 },
      truncated: false,
      text_content_included: false,
      withheld_fields: ["name", "description", "text", "states", "actions"],
    },
  };

  assert.deepEqual(
    createFutureTraversalProvenanceSummary(args),
    createTraversalProvenanceSummary(args),
  );
  assert.deepEqual(
    createValidatedFutureTraversalProvenanceSummary(args),
    createValidatedTraversalProvenanceSummary(args),
  );
});

test("desktop traversal provenance summary stores unavailable traversal as summary only", () => {
  const summary = createTraversalProvenanceSummary({
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

test("desktop traversal provenance summary stores validator-approved unavailable traversal without details", async () => {
  const traversalCases = JSON.parse(await readFile(traversalCasesPath, "utf8"));
  const summary = createValidatedTraversalProvenanceSummary({
    rootAuthorization: {
      source_event_id: "provenance-uuid",
      source_type: "application_root",
    },
    request: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    traversal: traversalCases.unavailable_case.traversal,
  });

  assert.equal(summary.traversal_node_count, 0);
  assert.equal(summary.traversal_max_returned_depth, 0);
  assert.equal(summary.traversal_truncated, false);
  assert.equal(summary.traversal_unavailable_reason, "atspi_bus_address_unavailable");
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(":1.42"), false);
  assert.equal(serialized.includes("/org/a11y/atspi/accessible/root"), false);
});

test("desktop traversal provenance adapter validates output before summary creation", async () => {
  const traversalCases = JSON.parse(await readFile(traversalCasesPath, "utf8"));
  const summary = createValidatedTraversalProvenanceSummary({
    rootAuthorization: {
      source_event_id: "provenance-uuid",
      source_type: "application_root",
    },
    request: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    traversal: traversalCases.valid_case.traversal,
  });

  assert.equal(summary.traversal_node_count, 2);
  assert.equal(summary.traversal_max_returned_depth, 1);
  assert.equal(summary.text_content_included, false);
});

test("desktop traversal provenance adapter rejects invalid output before summary creation", async () => {
  const traversalCases = JSON.parse(await readFile(traversalCasesPath, "utf8"));

  assert.throws(
    () => createValidatedTraversalProvenanceSummary({
      rootAuthorization: {
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
        text_content_included: true,
      },
    }),
    (error) => {
      assert.equal(error.code, "desktop_traversal_provenance_output_invalid");
      assert.ok(error.validation_errors.includes("traversal.text_content_included must be false"));
      return true;
    },
  );
});

function stripStaticEventFields(eventFields) {
  const {
    event_type: _eventType,
    capability: _capability,
    ...summary
  } = eventFields;
  return summary;
}
