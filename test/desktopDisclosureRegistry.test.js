import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDisclosureRegistry } from "../src/desktopDisclosureRegistry.js";

test("records application roots and shallow child refs from accessibility inspection", () => {
  const registry = makeRegistry();

  const entries = registry.recordFromAccessibilityTree({
    inspection: accessibilityInspection(),
    provenanceId: "prov-tree",
  });

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.source_type), [
    "application_root",
    "root_child_sample",
    "root_child_sample",
  ]);
  assert.deepEqual(registry.authorizeRootRef({
    rootRef: entries[0].id,
    capability: "desktop.inspect.accessibility_tree",
  }), {
    ok: true,
    service: ":1.42",
    path: "/org/a11y/atspi/accessible/root",
    source_event_id: "prov-tree",
    source_type: "application_root",
  });
});

test("records focused object and focused application refs from successful focus inspection", () => {
  const registry = makeRegistry();

  const entries = registry.recordFromFocusedInspection({
    inspection: focusedInspection(),
    provenanceId: "prov-focus",
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.source_type), [
    "focused_object",
    "focused_application",
  ]);
  assert.deepEqual(registry.summary().entries.map((entry) => entry.source_capability), [
    "desktop.inspect.focus",
    "desktop.inspect.focus",
  ]);
});

test("does not record unavailable focus responses", () => {
  const registry = makeRegistry();

  const entries = registry.recordFromFocusedInspection({
    inspection: {
      ...focusedInspection(),
      focus_available: false,
      focused_object: null,
    },
    provenanceId: "prov-focus",
  });

  assert.deepEqual(entries, []);
  assert.equal(registry.summary().total, 0);
});

test("stores only metadata needed for future root authorization", () => {
  const registry = makeRegistry();

  registry.recordFromAccessibilityTree({
    inspection: accessibilityInspection(),
    provenanceId: "prov-tree",
  });
  registry.recordFromFocusedInspection({
    inspection: focusedInspection(),
    provenanceId: "prov-focus",
  });

  const serialized = JSON.stringify(registry.snapshot());
  for (const sensitiveValue of [
    "private-app-name",
    "private-process-name",
    "private role",
    "private description",
    "private text",
    "click",
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false, sensitiveValue);
  }
});

test("deduplicates repeated refs and refreshes expiry", () => {
  const clock = { value: new Date("2026-05-08T12:00:00.000Z") };
  const registry = makeRegistry({ now: () => clock.value });

  const [first] = registry.recordFromAccessibilityTree({
    inspection: accessibilityInspection(),
    provenanceId: "prov-tree-1",
  });
  clock.value = new Date("2026-05-08T12:05:00.000Z");
  const [second] = registry.recordFromAccessibilityTree({
    inspection: accessibilityInspection(),
    provenanceId: "prov-tree-2",
  });

  assert.equal(first.id, second.id);
  assert.equal(second.source_event_id, "prov-tree-2");
  assert.equal(second.created_at, "2026-05-08T12:00:00.000Z");
  assert.equal(second.expires_at, "2026-05-08T12:15:00.000Z");
  assert.equal(registry.summary().total, 3);
});

test("expires entries and rejects expired root refs", () => {
  const clock = { value: new Date("2026-05-08T12:00:00.000Z") };
  const registry = makeRegistry({ now: () => clock.value });
  const [entry] = registry.recordFromAccessibilityTree({
    inspection: accessibilityInspection(),
    provenanceId: "prov-tree",
  });

  clock.value = new Date("2026-05-08T12:10:00.000Z");

  assert.deepEqual(registry.authorizeRootRef({
    rootRef: entry.id,
    capability: "desktop.inspect.accessibility_tree",
  }), { ok: false, error: "desktop_traversal_root_expired" });
  assert.equal(registry.summary().total, 0);
});

test("revokes entries by capability and across desktop inspection", () => {
  const registry = makeRegistry();
  const [treeEntry] = registry.recordFromAccessibilityTree({
    inspection: accessibilityInspection(),
    provenanceId: "prov-tree",
  });
  const [focusEntry] = registry.recordFromFocusedInspection({
    inspection: focusedInspection(),
    provenanceId: "prov-focus",
  });

  registry.revokeByCapability("desktop.inspect.focus");
  assert.deepEqual(registry.authorizeRootRef({
    rootRef: focusEntry.id,
    capability: "desktop.inspect.focus",
  }), { ok: false, error: "desktop_traversal_root_revoked" });
  assert.equal(registry.authorizeRootRef({
    rootRef: treeEntry.id,
    capability: "desktop.inspect.accessibility_tree",
  }).ok, true);

  registry.revokeAllDesktop();
  assert.deepEqual(registry.authorizeRootRef({
    rootRef: treeEntry.id,
    capability: "desktop.inspect.accessibility_tree",
  }), { ok: false, error: "desktop_traversal_root_revoked" });
});

test("rejects unknown refs and refs for inactive capability paths", () => {
  const registry = makeRegistry();
  const [entry] = registry.recordFromAccessibilityTree({
    inspection: accessibilityInspection(),
    provenanceId: "prov-tree",
  });

  assert.deepEqual(registry.authorizeRootRef({
    rootRef: "missing",
    capability: "desktop.inspect.accessibility_tree",
  }), { ok: false, error: "desktop_traversal_root_not_disclosed" });
  assert.deepEqual(registry.authorizeRootRef({
    rootRef: entry.id,
    capability: "desktop.inspect.focus",
  }), { ok: false, error: "desktop_traversal_root_capability_inactive" });
});

function makeRegistry(overrides = {}) {
  let nextId = 0;
  return new DesktopDisclosureRegistry({
    ttlMs: 10 * 60 * 1000,
    now: () => new Date("2026-05-08T12:00:00.000Z"),
    idFactory: () => `desktop-ref-${++nextId}`,
    ...overrides,
  });
}

function accessibilityInspection() {
  return {
    mode: "read_only_atspi_probe",
    broker_source: "rust_helper",
    platform: "linux",
    release: "test",
    desktop_session: "GNOME",
    session_type: "wayland",
    dbus_session_bus_available: true,
    atspi_likely_available: true,
    tree_available: true,
    tree: {
      applications: [
        {
          service: ":1.42",
          pid: 123,
          process: "private-process-name",
          registry: false,
          root_object: {
            path: "/org/a11y/atspi/accessible/root",
            role: "application",
            child_count: 2,
            children_sample: [
              { service: ":1.42", path: "/child-a" },
              { service: ":1.42", path: "/child-b" },
            ],
            child_metadata_sample: [
              {
                service: ":1.42",
                path: "/child-a",
                role: "private role",
                child_count: 0,
              },
            ],
          },
          root_object_error: null,
        },
      ],
      windows: [],
      bounded: true,
      text_content_included: false,
    },
  };
}

function focusedInspection() {
  return {
    mode: "read_only_focused_object_probe",
    broker_source: "rust_helper",
    platform: "linux",
    release: "test",
    desktop_session: "GNOME",
    session_type: "wayland",
    focus_available: true,
    focused_object: {
      service: ":1.50",
      path: "/focus",
      role: "private role",
      child_count: 1,
      description: "private description",
      text: "private text",
      actions: ["click"],
      application: {
        service: ":1.50",
        path: "/org/a11y/atspi/accessible/root",
      },
    },
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  };
}
