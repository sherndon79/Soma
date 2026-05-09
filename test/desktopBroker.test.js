import assert from "node:assert/strict";
import test from "node:test";

import { desktopBrokerHelperArgs, desktopTraversalHelperArgs } from "../src/desktopBroker.js";

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
