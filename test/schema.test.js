import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertDesktopInspectionResult,
  validateDesktopInspectionResult,
} from "../src/desktopInspectionSchema.js";

const schemaPath = new URL("../docs/schemas/desktop-inspection-result.schema.json", import.meta.url);

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
