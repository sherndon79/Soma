import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFutureDesktopTraversalHelperOutput,
  desktopBrokerHelperArgs,
  desktopTraversalHelperArgs,
  inspectDesktopTraversalWithRustHelper,
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

test("assertFutureDesktopTraversalHelperOutput validates traversal helper output", () => {
  const traversal = validTraversalOutput();

  assert.equal(assertFutureDesktopTraversalHelperOutput(traversal), traversal);
  assert.throws(
    () => assertFutureDesktopTraversalHelperOutput({
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

async function executableScript(prefix, contents) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `soma-${prefix}-`));
  const scriptPath = path.join(directory, "helper.sh");
  await writeFile(scriptPath, contents, "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}
