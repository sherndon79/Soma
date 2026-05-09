import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertDesktopInspectionResult,
  validateDesktopInspectionResult,
  validateFutureDesktopInspectionResultWithTraversal,
} from "../src/desktopInspectionSchema.js";

const schemaPath = new URL("../docs/schemas/desktop-inspection-result.schema.json", import.meta.url);
const futureTraversalSchemaPath = new URL(
  "../docs/schemas/future-desktop-inspection-result-with-traversal.schema.json",
  import.meta.url,
);
const futureDesktopRefFixturePath = new URL(
  "../docs/fixtures/future-desktop-ref-id-locations.json",
  import.meta.url,
);
const futureTraversalOutputFixturePath = new URL(
  "../docs/fixtures/future-traversal-output-schema.json",
  import.meta.url,
);
const futureTraversalOutputCasesPath = new URL(
  "../docs/fixtures/future-traversal-output-validation-cases.json",
  import.meta.url,
);

test("desktop inspection schema documents the current safe child metadata boundary", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const childMetadata = schema.$defs.child_metadata;

  assert.equal(schema.title, "Soma Desktop Inspection Result");
  assert.equal(schema.$defs.atspi_tree.properties.text_content_included.const, false);
  assert.equal(schema.$defs.root_object.properties.children_sample.maxItems, 8);
  assert.equal(schema.$defs.root_object.properties.child_metadata_sample.maxItems, 4);
  assert.deepEqual(childMetadata.required, ["service", "path", "role", "child_count"]);
  assert.equal(childMetadata.additionalProperties, false);
  assert.equal("name" in childMetadata.properties, false);
  assert.equal("description" in childMetadata.properties, false);
  assert.equal("text" in childMetadata.properties, false);
  assert.equal("actions" in childMetadata.properties, false);
});

test("future desktop_ref_id fixture documents locations without enabling the current schema", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const fixture = JSON.parse(await readFile(futureDesktopRefFixturePath, "utf8"));

  assert.equal(fixture.status, "future_fixture_not_current_schema");
  assert.deepEqual(fixture.allowed_future_locations, [
    "tree.applications[].root_object.desktop_ref_id",
    "tree.applications[].root_object.children_sample[].desktop_ref_id",
    "focused_object.desktop_ref_id",
    "focused_object.application.desktop_ref_id",
  ]);
  assert.equal("desktop_ref_id" in schema.$defs.root_object.properties, false);
  assert.equal("desktop_ref_id" in schema.$defs.object_ref.properties, false);
  assert.equal("desktop_ref_id" in schema.$defs.child_metadata.properties, false);
});

test("future traversal output fixture documents schema without enabling current traversal output", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const fixture = JSON.parse(await readFile(futureTraversalOutputFixturePath, "utf8"));

  assert.equal(fixture.status, "future_fixture_not_current_schema");
  assert.equal(fixture.location, "tree.applications[].root_object.traversal");
  assert.deepEqual(fixture.required_fields, [
    "root",
    "nodes",
    "limits",
    "truncated",
    "text_content_included",
    "withheld_fields",
  ]);
  assert.deepEqual(fixture.node_fields, [
    "id",
    "service",
    "path",
    "role",
    "child_count",
    "depth",
    "children",
  ]);
  assert.ok(fixture.must_not_include.includes("desktop_ref_id"));
  assert.equal("traversal" in schema.$defs.root_object.properties, false);
  assert.equal("traversal" in schema.$defs, false);
  assert.equal("traversal_node" in schema.$defs, false);
  assert.equal("traversal_limits" in schema.$defs, false);
});

test("future traversal schema draft documents bounded traversal without replacing the active schema", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const futureSchema = JSON.parse(await readFile(futureTraversalSchemaPath, "utf8"));
  const rootObject = futureSchema.$defs.root_object;
  const traversal = futureSchema.$defs.traversal;
  const traversalNode = futureSchema.$defs.traversal_node;
  const traversalLimits = futureSchema.$defs.traversal_limits;

  assert.equal(futureSchema.title, "Soma Future Desktop Inspection Result With Bounded Traversal");
  assert.equal("traversal" in schema.$defs.root_object.properties, false);
  assert.equal("traversal" in rootObject.properties, true);
  assert.deepEqual(traversal.required, [
    "root",
    "nodes",
    "limits",
    "truncated",
    "text_content_included",
    "withheld_fields",
  ]);
  assert.equal(traversal.properties.text_content_included.const, false);
  assert.equal(traversal.properties.nodes.maxItems, 256);
  assert.equal(traversalNode.additionalProperties, false);
  assert.deepEqual(Object.keys(traversalNode.properties), [
    "id",
    "service",
    "path",
    "role",
    "child_count",
    "depth",
    "children",
  ]);
  assert.equal("name" in traversalNode.properties, false);
  assert.equal("description" in traversalNode.properties, false);
  assert.equal("text" in traversalNode.properties, false);
  assert.equal("states" in traversalNode.properties, false);
  assert.equal("actions" in traversalNode.properties, false);
  assert.equal(traversalNode.properties.children.maxItems, 32);
  assert.equal(traversalLimits.properties.max_depth.maximum, 4);
  assert.equal(traversalLimits.properties.max_nodes.maximum, 256);
  assert.equal(traversalLimits.properties.max_children_per_node.maximum, 32);
});

test("desktop inspection runtime validator accepts the current AT-SPI shape", () => {
  const result = validateDesktopInspectionResult(baseAtspiResult({
    children_sample: [{ service: ":1.42", path: "/child" }],
    child_metadata_sample: [{ service: ":1.42", path: "/child", role: "frame", child_count: 0 }],
  }));

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("desktop inspection runtime validator rejects child metadata over-disclosure", () => {
  for (const [field, value] of Object.entries({
    name: "private tab title",
    description: "private child description",
    text: "private text",
    states: ["focused"],
    actions: ["click"],
  })) {
    const result = validateDesktopInspectionResult(atspiResultWithChildField(field, value));

    assert.equal(result.valid, false);
    assert.ok(result.errors.includes(`result.tree.applications[0].root_object.child_metadata_sample[0].${field} is not allowed`));
  }
});

test("desktop inspection runtime validator rejects windows until window inspection is implemented", () => {
  const result = validateDesktopInspectionResult({
    mode: "read_only_atspi_probe",
    broker_source: "rust_helper",
    platform: "linux",
    release: "test",
    desktop_session: "GNOME",
    session_type: "wayland",
    dbus_session_bus_available: true,
    atspi_likely_available: true,
    atspi_bus_address_available: true,
    application_count: 1,
    root_object_available_count: 1,
    window_count: 0,
    tree: {
      applications: [
        {
          service: ":1.42",
          pid: 123,
          process: "test-app",
          registry: false,
          root_object: {
            path: "/org/a11y/atspi/accessible/root",
            name: "test-app",
            role: "application",
            child_count: 1,
            children_sample: [],
            child_metadata_sample: [],
          },
          root_object_error: null,
        },
      ],
      windows: [{ title: "private window title" }],
      bounded: true,
      text_content_included: false,
    },
    tree_available: true,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("result.tree.windows must be empty until desktop.inspect.windows is implemented"));
});

test("desktop inspection runtime validator rejects traversal output until traversal is implemented", () => {
  const result = validateDesktopInspectionResult(atspiResultWithRootObjectField("traversal", {
    root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
    nodes: [
      {
        id: "n0",
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        role: "application",
        child_count: 1,
        depth: 0,
        children: [],
      },
    ],
    limits: { max_depth: 1, max_nodes: 64, max_children_per_node: 8 },
    truncated: false,
    text_content_included: false,
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("result.tree.applications[0].root_object.traversal is not allowed"));
});

test("future traversal output cases remain rejected by current runtime validator", async () => {
  const fixture = JSON.parse(await readFile(futureTraversalOutputCasesPath, "utf8"));
  assert.equal(fixture.status, "future_fixture_not_current_schema");

  const validFutureResult = validateDesktopInspectionResult(
    atspiResultWithRootObjectField("traversal", fixture.valid_case.traversal),
  );
  assert.equal(validFutureResult.valid, false);
  assert.ok(validFutureResult.errors.includes("result.tree.applications[0].root_object.traversal is not allowed"));

  for (const invalidCase of fixture.invalid_cases) {
    const result = validateDesktopInspectionResult(
      atspiResultWithRootObjectField("traversal", invalidCase.traversal),
    );
    assert.equal(result.valid, false, invalidCase.name);
    assert.equal(typeof invalidCase.future_error, "string", invalidCase.name);
    assert.ok(result.errors.includes("result.tree.applications[0].root_object.traversal is not allowed"));
  }
});

test("future traversal-aware desktop validator accepts bounded traversal output behind an explicit gate", async () => {
  const fixture = JSON.parse(await readFile(futureTraversalOutputCasesPath, "utf8"));
  const result = validateFutureDesktopInspectionResultWithTraversal(
    atspiResultWithRootObjectField("traversal", fixture.valid_case.traversal),
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);

  const currentResult = validateDesktopInspectionResult(
    atspiResultWithRootObjectField("traversal", fixture.valid_case.traversal),
  );
  assert.equal(currentResult.valid, false);
  assert.ok(currentResult.errors.includes("result.tree.applications[0].root_object.traversal is not allowed"));
});

test("future traversal-aware desktop validator rejects invalid traversal output before provenance", async () => {
  const fixture = JSON.parse(await readFile(futureTraversalOutputCasesPath, "utf8"));

  for (const invalidCase of fixture.invalid_cases) {
    const result = validateFutureDesktopInspectionResultWithTraversal(
      atspiResultWithRootObjectField("traversal", invalidCase.traversal),
    );

    assert.equal(result.valid, false, invalidCase.name);
    assert.ok(
      result.errors.some((error) => error.includes(invalidCase.future_error)),
      invalidCase.name,
    );
  }
});

test("desktop inspection runtime validator rejects desktop_ref_id until exposure is implemented", () => {
  for (const [name, result] of Object.entries({
    root_object: atspiResultWithRootObjectField("desktop_ref_id", "desktop-ref-root"),
    child_ref: baseAtspiResult({
      children_sample: [{ service: ":1.42", path: "/child", desktop_ref_id: "desktop-ref-child" }],
    }),
    child_metadata: atspiResultWithChildField("desktop_ref_id", "desktop-ref-metadata"),
  })) {
    const validation = validateDesktopInspectionResult(result);

    assert.equal(validation.valid, false, name);
    assert.ok(
      validation.errors.some((error) => error.endsWith(".desktop_ref_id is not allowed")),
      name,
    );
  }
});

test("desktop inspection runtime validator rejects future traversal over-disclosure by keeping traversal closed", () => {
  for (const [field, value] of Object.entries({
    name: "private child title",
    description: "private child description",
    text: "private text",
    selected_text: "private selection",
    value: "private value",
    states: ["focused"],
    actions: ["click"],
    screenshot: "data:image/png;base64,private",
    image: { uri: "private://image" },
    pointer_state: { x: 10, y: 20 },
    keyboard_state: { modifiers: ["ctrl"] },
  })) {
    const result = validateDesktopInspectionResult(atspiResultWithTraversalNodeField(field, value));

    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("result.tree.applications[0].root_object.traversal is not allowed"));
  }
});

test("desktop inspection runtime assertion uses stable broker contract error semantics", () => {
  assert.throws(
    () => assertDesktopInspectionResult({}),
    {
      code: "desktop_inspection_schema_invalid",
      statusCode: 502,
    },
  );
});

function atspiResultWithChildField(field, value) {
  return baseAtspiResult({
    child_metadata_sample: [
      {
        service: ":1.42",
        path: "/child",
        role: "frame",
        child_count: 0,
        [field]: value,
      },
    ],
  });
}

function atspiResultWithRootObjectField(field, value) {
  return baseAtspiResult({
    [field]: value,
  });
}

function atspiResultWithTraversalNodeField(field, value) {
  return atspiResultWithRootObjectField("traversal", {
    root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
    nodes: [
      {
        id: "n0",
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        role: "application",
        child_count: 1,
        depth: 0,
        children: [],
        [field]: value,
      },
    ],
    limits: { max_depth: 1, max_nodes: 64, max_children_per_node: 8 },
    truncated: false,
    text_content_included: false,
  });
}

function baseAtspiResult(rootObjectOverrides = {}) {
  return {
    mode: "read_only_atspi_probe",
    broker_source: "rust_helper",
    platform: "linux",
    release: "test",
    desktop_session: "GNOME",
    session_type: "wayland",
    dbus_session_bus_available: true,
    atspi_likely_available: true,
    atspi_bus_address_available: true,
    application_count: 1,
    root_object_available_count: 1,
    window_count: 0,
    tree: {
      applications: [
        {
          service: ":1.42",
          pid: 123,
          process: "test-app",
          registry: false,
          root_object: {
            path: "/org/a11y/atspi/accessible/root",
            name: "test-app",
            role: "application",
            child_count: 1,
            children_sample: [],
            child_metadata_sample: [],
            ...rootObjectOverrides,
          },
          root_object_error: null,
        },
      ],
      windows: [],
      bounded: true,
      text_content_included: false,
    },
    tree_available: true,
  };
}
