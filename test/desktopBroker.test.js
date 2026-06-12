import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertDesktopTraversalHelperOutput,
  assertFutureDesktopTraversalHelperOutput,
  attachTraversalToDesktopInspectionResult,
  desktopBrokerHelperArgs,
  desktopTraversalHelperArgs,
  inspectDesktopAccessibilityTreeWithDescriptor,
  inspectFocusedDesktopObject,
  inspectDesktopTextWithDescriptor,
  inspectDesktopWindows,
  inspectDesktopTraversalWithRustHelper,
  syntheticContainerDesktopBrokerArgs,
} from "../src/desktopBroker.js";

test("desktopBrokerHelperArgs preserves current invocation when limits are omitted", () => {
  assert.deepEqual(desktopBrokerHelperArgs(), ["inspect-environment"]);
  assert.deepEqual(desktopBrokerHelperArgs({ mode: "environment" }), ["inspect-environment"]);
  assert.deepEqual(desktopBrokerHelperArgs({ mode: "atspi" }), ["inspect-atspi"]);
});

test("desktopBrokerHelperArgs maps max_apps to helper application limit", () => {
  assert.deepEqual(
    desktopBrokerHelperArgs({ mode: "atspi", maxApps: 8 }),
    ["inspect-atspi", "--max-applications", "8"],
  );
});

test("desktopBrokerHelperArgs maps max_children to child ref and metadata hints", () => {
  assert.deepEqual(
    desktopBrokerHelperArgs({ mode: "atspi", maxChildren: 2 }),
    [
      "inspect-atspi",
      "--max-root-child-refs",
      "2",
      "--max-root-child-metadata",
      "2",
    ],
  );
});

test("desktopBrokerHelperArgs caps helper child metadata hint at schema limit", () => {
  assert.deepEqual(
    desktopBrokerHelperArgs({ mode: "atspi", maxChildren: 8 }),
    [
      "inspect-atspi",
      "--max-root-child-refs",
      "8",
      "--max-root-child-metadata",
      "4",
    ],
  );
});

test("desktopBrokerHelperArgs combines application and child helper hints", () => {
  assert.deepEqual(
    desktopBrokerHelperArgs({ mode: "atspi", maxApps: 3, maxChildren: 5 }),
    [
      "inspect-atspi",
      "--max-applications",
      "3",
      "--max-root-child-refs",
      "5",
      "--max-root-child-metadata",
      "4",
    ],
  );
});

test("syntheticContainerDesktopBrokerArgs targets the in-container broker adapter", () => {
  assert.deepEqual(
    syntheticContainerDesktopBrokerArgs({
      descriptor: {
        limits: { max_apps: 2, max_children: 1 },
      },
      env: {
        SOMA_DESKTOP_REALISM_COMPOSE_PROJECT: "soma-desktop-realism",
        SOMA_DESKTOP_REALISM_COMPOSE_FILE: "docker-compose.desktop-realism.yml",
        SOMA_DESKTOP_REALISM_SERVICE: "desktop-realism",
        SOMA_DESKTOP_REALISM_INSPECT_COMMAND: "/usr/local/bin/desktop-realism-broker-inspect",
      },
    }),
    [
      "compose",
      "-p",
      "soma-desktop-realism",
      "-f",
      "docker-compose.desktop-realism.yml",
      "exec",
      "-T",
      "-e",
      "DESKTOP_REALISM_BROKER_MAX_APPS=2",
      "-e",
      "DESKTOP_REALISM_BROKER_MAX_CHILDREN=1",
      "desktop-realism",
      "/usr/local/bin/desktop-realism-broker-inspect",
    ],
  );
});

test("synthetic_container_live descriptor invokes the container adapter and validates output", async () => {
  const inspection = baseAtspiInspection();
  const dockerPath = await executableScript("desktop-container-docker", `#!/bin/sh
printf '%s\\n' '${JSON.stringify(inspection)}'
`);

  const result = await inspectDesktopAccessibilityTreeWithDescriptor({
    descriptor: syntheticContainerDescriptor(),
    env: { SOMA_DESKTOP_REALISM_DOCKER: dockerPath },
  });

  assert.equal(result.broker_source, "rust_helper");
  assert.equal(result.tree_available, true);
  assert.equal(result.application_count, 1);
});

test("synthetic_container_live descriptor fails closed when container adapter is unreachable", async () => {
  await assert.rejects(
    inspectDesktopAccessibilityTreeWithDescriptor({
      descriptor: syntheticContainerDescriptor(),
      env: { SOMA_DESKTOP_REALISM_DOCKER: "/does/not/exist/docker" },
    }),
    {
      code: "desktop_synthetic_container_unreachable",
      statusCode: 503,
    },
  );
});

test("desktop text descriptor invokes synthetic container provider and validates bounded text output", async () => {
  const output = baseTextInspection();
  const dockerPath = await executableScript("desktop-text-container-docker", `#!/bin/sh
printf '%s\\n' '${JSON.stringify(output)}'
`);

  const result = await inspectDesktopTextWithDescriptor({
    descriptor: syntheticContainerTextDescriptor(),
    env: { SOMA_DESKTOP_REALISM_DOCKER: dockerPath },
  });

  assert.deepEqual(result, output);
});

test("desktop text descriptor rejects identity-bearing provider output", async () => {
  const output = baseTextInspection();
  output.windows[0].service = ":1.42";
  const dockerPath = await executableScript("bad-desktop-text-container-docker", `#!/bin/sh
printf '%s\\n' '${JSON.stringify(output)}'
`);

  await assert.rejects(
    inspectDesktopTextWithDescriptor({
      descriptor: syntheticContainerTextDescriptor(),
      env: { SOMA_DESKTOP_REALISM_DOCKER: dockerPath },
    }),
    (error) => {
      assert.equal(error.code, "desktop_synthetic_container_text_contract_invalid");
      assert.ok(error.validation_errors.includes("result.windows[0].service is not allowed"));
      return true;
    },
  );
});

test("desktopTraversalHelperArgs maps authorized root and traversal limits", () => {
  assert.deepEqual(
    desktopTraversalHelperArgs({
      authorizedRoot: {
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
      },
      maxDepth: 2,
      maxNodes: 64,
      maxChildrenPerNode: 8,
    }),
    [
      "inspect-atspi-traversal",
      "--root-service",
      ":1.42",
      "--root-path",
      "/org/a11y/atspi/accessible/root",
      "--max-depth",
      "2",
      "--max-nodes",
      "64",
      "--max-children-per-node",
      "8",
    ],
  );
});

test("desktopTraversalHelperArgs requires an authorized concrete root", () => {
  assert.throws(
    () => desktopTraversalHelperArgs({
      authorizedRoot: { service: ":1.42" },
      maxDepth: 2,
      maxNodes: 64,
      maxChildrenPerNode: 8,
    }),
    /authorizedRoot\.service and authorizedRoot\.path are required/,
  );
});

test("desktopTraversalHelperArgs validates traversal helper limits", () => {
  for (const [field, value] of Object.entries({
    maxDepth: 0,
    maxNodes: 257,
    maxChildrenPerNode: "8",
  })) {
    assert.throws(
      () => desktopTraversalHelperArgs({
        authorizedRoot: {
          service: ":1.42",
          path: "/org/a11y/atspi/accessible/root",
        },
        maxDepth: 2,
        maxNodes: 64,
        maxChildrenPerNode: 8,
        [field]: value,
      }),
      new RegExp(`${field} must be an integer`),
    );
  }
});

test("assertDesktopTraversalHelperOutput validates traversal helper output", () => {
  const traversal = validTraversalOutput();

  assert.equal(assertDesktopTraversalHelperOutput(traversal), traversal);
  assert.throws(
    () => assertDesktopTraversalHelperOutput({
      ...traversal,
      nodes: [
        {
          ...traversal.nodes[0],
          name: "private window title",
        },
      ],
    }),
    (error) => {
      assert.equal(error.code, "desktop_traversal_helper_output_invalid");
      assert.deepEqual(error.validation_errors, ["traversal.nodes[0].name is not allowed"]);
      return true;
    },
  );
});

test("assertFutureDesktopTraversalHelperOutput remains as compatibility delegate", () => {
  const traversal = validTraversalOutput();

  assert.equal(assertFutureDesktopTraversalHelperOutput(traversal), assertDesktopTraversalHelperOutput(traversal));
});

test("inspectDesktopTraversalWithRustHelper invokes helper and validates traversal output", async () => {
  const helperPath = await executableScript("traversal-helper", `#!/bin/sh
printf '%s\\n' '${JSON.stringify(validTraversalOutput())}'
`);

  const traversal = await inspectDesktopTraversalWithRustHelper({
    helperPath,
    authorizedRoot: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
    maxDepth: 2,
    maxNodes: 64,
    maxChildrenPerNode: 8,
  });

  assert.deepEqual(traversal, validTraversalOutput());
});

test("inspectDesktopTraversalWithRustHelper rejects schema-invalid traversal output", async () => {
  const traversal = validTraversalOutput();
  const helperPath = await executableScript("bad-traversal-helper", `#!/bin/sh
printf '%s\\n' '${JSON.stringify({ ...traversal, text_content_included: true })}'
`);

  await assert.rejects(
    inspectDesktopTraversalWithRustHelper({
      helperPath,
      authorizedRoot: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
      maxDepth: 2,
      maxNodes: 64,
      maxChildrenPerNode: 8,
    }),
    (error) => {
      assert.equal(error.code, "desktop_traversal_helper_output_invalid");
      assert.ok(error.validation_errors.includes("traversal.text_content_included must be false"));
      return true;
    },
  );
});

test("inspectDesktopWindows invokes helper and validates bounded window output", async () => {
  const output = {
    mode: "read_only_window_probe",
    broker_source: "rust_helper",
    platform_family: "linux",
    dbus_session_bus_available: true,
    atspi_bus_address_available: true,
    window_count: 0,
    windows: [],
    bounded: true,
    geometry_included: true,
    focus_included: true,
    identity_fields_included: false,
    text_content_included: false,
    titles_included: false,
    withheld_fields: ["name", "description", "text", "title", "pid", "process", "service", "path", "registry", "raw_atspi_locators", "states", "actions", "screenshots"],
  };
  const helperPath = await executableScript("windows-helper", `#!/bin/sh
printf '%s\\n' '${JSON.stringify(output)}'
`);

  assert.deepEqual(await inspectDesktopWindows({ helperPath }), output);
});

test("inspectDesktopWindows rejects schema-invalid helper output", async () => {
  const helperPath = await executableScript("bad-windows-helper", `#!/bin/sh
printf '%s\\n' '{"mode":"read_only_window_probe","broker_source":"rust_helper","platform_family":"linux","dbus_session_bus_available":true,"window_count":1,"windows":[{"title":"private"}],"bounded":true,"geometry_included":true,"focus_included":true,"identity_fields_included":false,"text_content_included":false,"titles_included":false,"withheld_fields":[]}'
`);

  await assert.rejects(
    inspectDesktopWindows({ helperPath }),
    (error) => {
      assert.equal(error.code, "desktop_windows_inspection_schema_invalid");
      assert.ok(error.validation_errors.includes("result.windows[0].title is not allowed"));
      return true;
    },
  );
});

test("inspectFocusedDesktopObject rejects host identity top-level fields", async () => {
  const helperPath = await executableScript("bad-focus-helper", `#!/bin/sh
printf '%s\\n' '{"mode":"read_only_focused_object_probe","broker_source":"rust_helper","platform_family":"linux","release":"test","focus_available":false,"focused_object":null,"text_content_included":false,"withheld_fields":["name","description","text","states","actions"]}'
`);

  await assert.rejects(
    inspectFocusedDesktopObject({ helperPath }),
    (error) => {
      assert.equal(error.code, "focused_desktop_inspection_schema_invalid");
      assert.ok(error.validation_errors.includes("result.release is not allowed"));
      return true;
    },
  );
});

test("attachTraversalToDesktopInspectionResult rejects minimized inspection without raw root locators", () => {
  const inspection = baseAtspiInspection();
  const traversal = validTraversalOutput();
  assert.throws(
    () => attachTraversalToDesktopInspectionResult({ inspection, traversal }),
    { code: "desktop_traversal_root_not_in_inspection" },
  );
});

test("attachTraversalToDesktopInspectionResult rejects roots not present in inspection", () => {
  assert.throws(
    () => attachTraversalToDesktopInspectionResult({
      inspection: baseAtspiInspection(),
      traversal: {
        ...validTraversalOutput(),
        root: { service: ":1.404", path: "/org/a11y/atspi/accessible/root" },
      },
    }),
    {
      code: "desktop_traversal_root_not_in_inspection",
    },
  );
});

function validTraversalOutput() {
  return {
    root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
    nodes: [
      {
        id: "n0",
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        role: "application",
        child_count: 0,
        depth: 0,
        children: [],
      },
    ],
    limits: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    truncated: false,
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  };
}

function baseAtspiInspection() {
  return {
    mode: "read_only_atspi_probe",
    broker_source: "rust_helper",
    platform_family: "linux",
    dbus_session_bus_available: true,
    atspi_likely_available: true,
    atspi_bus_address_available: true,
    application_count: 1,
    root_object_available_count: 1,
    window_count: 0,
    tree: {
      applications: [
        {
          root_object: {
            role: "application",
            child_count: 1,
            child_metadata_sample: [],
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

function syntheticContainerDescriptor() {
  return {
    domain: "testing",
    capability: "desktop.inspect.accessibility_tree",
    provider_id: "soma.provider.synthetic-container-desktop",
    provider_mode: "synthetic_container_live",
    resource_class: "desktop",
    synthetic: true,
    desktop_surface: "accessibility_tree",
    session_id: "desktop-realism-minimal-x11-v1",
    canary_set_id: "desktop-realism-minimal-x11-v1",
    canary_set_digest: "0".repeat(64),
    limits: { max_apps: 2, max_children: 1 },
    grant_id: "grant-container-desktop",
  };
}

function syntheticContainerTextDescriptor() {
  return {
    domain: "testing",
    capability: "desktop.inspect.text",
    provider_id: "soma.provider.synthetic-container-desktop",
    provider_mode: "synthetic_container_live",
    resource_class: "desktop",
    synthetic: true,
    desktop_surface: "text_content",
    session_id: "desktop-realism-minimal-x11-v1",
    canary_set_id: "desktop-realism-minimal-x11-v1",
    canary_set_digest: "0".repeat(64),
    grant_id: "grant-container-text",
    content_included: true,
    titles_included: true,
    names_included: true,
    descriptions_included: true,
    identity_fields_included: false,
    screenshots_included: false,
  };
}

function baseTextInspection() {
  return {
    mode: "read_only_desktop_text_probe",
    broker_source: "rust_helper",
    platform_family: "linux",
    dbus_session_bus_available: true,
    atspi_bus_address_available: true,
    window_count: 1,
    text_item_count: 1,
    windows: [
      {
        index: 0,
        z_order: 0,
        role: "frame",
        child_count: 2,
        geometry: { x: 10, y: 20, width: 800, height: 600 },
        title: { value: "Window title", char_count: 12, truncated: false },
        text_items: [
          {
            kind: "text",
            role: "label",
            text: { value: "Visible text", char_count: 12, truncated: false },
          },
        ],
        truncated: false,
      },
    ],
    bounded: true,
    truncated: false,
    max_windows: 16,
    max_nodes_per_window: 512,
    max_text_items: 1024,
    max_text_chars_per_item: 512,
    titles_included: true,
    names_included: true,
    descriptions_included: true,
    text_content_included: true,
    identity_fields_included: false,
    screenshots_included: false,
    withheld_fields: ["pid", "process", "service", "path", "registry", "raw_atspi_locators", "states", "actions", "screenshots"],
  };
}

async function executableScript(prefix, contents) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `soma-${prefix}-`));
  const scriptPath = path.join(directory, "helper.sh");
  await writeFile(scriptPath, contents, "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}
