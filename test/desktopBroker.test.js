import assert from "node:assert/strict";
import test from "node:test";

import { desktopBrokerHelperArgs } from "../src/desktopBroker.js";

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
