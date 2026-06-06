import assert from "node:assert/strict";
import test from "node:test";

import { runInternalDesktopTraversalRequest } from "../src/desktopTraversalPipeline.js";
import { ProvenanceLog } from "../src/provenanceLog.js";

test("internal traversal pipeline validates root ref invokes helper attaches output and appends summary provenance", async () => {
  const calls = [];
  const provenanceLog = new ProvenanceLog();
  const result = await runInternalDesktopTraversalRequest({
    body: traversalRequest(),
    inspection: baseAtspiInspection(),
    desktopDisclosureRegistry: {
      authorizeRootRef(args) {
        calls.push({ type: "authorizeRootRef", args });
        return authorizedRoot();
      },
    },
    provenanceLog,
    caller: "test-suite",
    async inspectTraversal(args) {
      calls.push({ type: "inspectTraversal", args });
      return validTraversalOutput();
    },
  });

  assert.deepEqual(calls.map((call) => call.type), ["authorizeRootRef", "inspectTraversal"]);
  assert.deepEqual(calls[0].args, {
    rootRef: "desktop-ref-1",
    capability: "desktop.inspect.accessibility_tree",
  });
  assert.deepEqual(calls[1].args.authorizedRoot, authorizedRoot());
  assert.equal(calls[1].args.maxDepth, 2);
  assert.equal(calls[1].args.maxNodes, 64);
  assert.equal(calls[1].args.maxChildrenPerNode, 8);
  assert.deepEqual(result.inspection.tree.applications[0].root_object.traversal, validTraversalOutput());
  assert.equal(result.traversal_summary.traversal_node_count, 1);
  assert.equal(result.traversal_summary.traversal_root_source_event_id, "prov-tree");

  const [event] = provenanceLog.query({ eventType: "desktop.inspect.accessibility_tree" });
  assert.equal(event.id, result.provenance.id);
  assert.equal(event.caller_identity, "test-suite");
  assert.equal(event.traversal_requested, true);
  assert.equal(event.traversal_node_count, 1);
  assert.equal(event.text_content_included, false);
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes(":1.42"), false);
  assert.equal(serialized.includes("/org/a11y/atspi/accessible/root"), false);
  assert.equal(serialized.includes("n0"), false);
});

test("internal traversal pipeline rejects unauthorized roots before helper invocation and provenance append", async () => {
  let helperCalled = false;
  const provenanceLog = new ProvenanceLog();

  await assert.rejects(
    runInternalDesktopTraversalRequest({
      body: traversalRequest(),
      inspection: baseAtspiInspection(),
      desktopDisclosureRegistry: {
        authorizeRootRef() {
          return { ok: false, error: "desktop_traversal_root_revoked" };
        },
      },
      provenanceLog,
      async inspectTraversal() {
        helperCalled = true;
        return validTraversalOutput();
      },
    }),
    {
      code: "desktop_traversal_root_revoked",
      statusCode: 403,
    },
  );

  assert.equal(helperCalled, false);
  assert.equal(provenanceLog.list().length, 0);
});

test("internal traversal pipeline rejects helper output before provenance append", async () => {
  const provenanceLog = new ProvenanceLog();

  await assert.rejects(
    runInternalDesktopTraversalRequest({
      body: traversalRequest(),
      inspection: baseAtspiInspection(),
      desktopDisclosureRegistry: {
        authorizeRootRef() {
          return authorizedRoot();
        },
      },
      provenanceLog,
      async inspectTraversal() {
        return {
          ...validTraversalOutput(),
          text_content_included: true,
        };
      },
    }),
    (error) => {
      assert.equal(error.code, "desktop_traversal_helper_output_invalid");
      assert.ok(error.validation_errors.includes("traversal.text_content_included must be false"));
      return true;
    },
  );

  assert.equal(provenanceLog.list().length, 0);
});

test("internal traversal pipeline records summary-only unavailable traversal provenance", async () => {
  const provenanceLog = new ProvenanceLog();
  const result = await runInternalDesktopTraversalRequest({
    body: traversalRequest(),
    inspection: baseAtspiInspection(),
    desktopDisclosureRegistry: {
      authorizeRootRef() {
        return authorizedRoot();
      },
    },
    provenanceLog,
    async inspectTraversal() {
      return unavailableTraversalOutput();
    },
  });

  assert.deepEqual(result.inspection.tree.applications[0].root_object.traversal, unavailableTraversalOutput());
  assert.equal(result.traversal_summary.traversal_node_count, 0);
  assert.equal(result.traversal_summary.traversal_unavailable_reason, "atspi_bus_address_unavailable");
  const [event] = provenanceLog.query({ eventType: "desktop.inspect.accessibility_tree" });
  assert.equal(event.traversal_node_count, 0);
  assert.equal(event.traversal_unavailable_reason, "atspi_bus_address_unavailable");
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes(":1.42"), false);
  assert.equal(serialized.includes("/org/a11y/atspi/accessible/root"), false);
  assert.equal(serialized.includes("n0"), false);
});

function traversalRequest() {
  return {
    mode: "atspi",
    traversal: {
      enabled: true,
      root_ref: "desktop-ref-1",
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
  };
}

function authorizedRoot() {
  return {
    ok: true,
    service: ":1.42",
    path: "/org/a11y/atspi/accessible/root",
    source_event_id: "prov-tree",
    source_type: "application_root",
  };
}

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

function unavailableTraversalOutput() {
  return {
    root: { service: ":1.42", path: "/org/a11y/atspi/accessible/root" },
    nodes: [],
    limits: {
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
    truncated: false,
    unavailable_reason: "atspi_bus_address_unavailable",
    text_content_included: false,
    withheld_fields: ["name", "description", "text", "states", "actions"],
  };
}

function baseAtspiInspection() {
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
            role: "application",
            child_count: 1,
            children_sample: [],
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
