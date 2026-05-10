import assert from "node:assert/strict";
import test from "node:test";

import {
  validateDesktopTraversalRequest,
  validateFutureDesktopTraversalRequest,
} from "../src/desktopTraversalRequest.js";

test("desktop traversal validator accepts root_ref-only requests", () => {
  const result = validateDesktopTraversalRequest({
    mode: "atspi",
    traversal: {
      enabled: true,
      root_ref: "desktop-ref-1",
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
  }, {
    authorizeRootRef({ rootRef, capability }) {
      assert.equal(rootRef, "desktop-ref-1");
      assert.equal(capability, "desktop.inspect.accessibility_tree");
      return {
        ok: true,
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        source_event_id: "prov-1",
        source_type: "application_root",
      };
    },
  });

  assert.deepEqual(result, {
    mode: "atspi",
    traversal: {
      enabled: true,
      root_ref: "desktop-ref-1",
      authorized_root: {
        ok: true,
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        source_event_id: "prov-1",
        source_type: "application_root",
      },
      max_depth: 2,
      max_nodes: 64,
      max_children_per_node: 8,
    },
  });
});

test("desktop traversal validator rejects raw service path roots", () => {
  assert.throws(
    () => validateDesktopTraversalRequest({
      mode: "atspi",
      traversal: {
        enabled: true,
        root_ref: "desktop-ref-1",
        root: { service: ":1.42", path: "/root" },
      },
    }),
    {
      code: "desktop_traversal_request_invalid",
      validation_errors: ["request.traversal.root is not allowed"],
    },
  );
});

test("desktop traversal validator rejects unexpected top-level fields", () => {
  assert.throws(
    () => validateDesktopTraversalRequest({
      mode: "atspi",
      include_text: true,
      traversal: {
        enabled: true,
        root_ref: "desktop-ref-1",
      },
    }),
    {
      code: "desktop_traversal_request_invalid",
      validation_errors: ["request.include_text is not allowed"],
    },
  );
});

test("desktop traversal validator rejects invalid mode, root, fields, and limits", () => {
  assert.throws(
    () => validateDesktopTraversalRequest({
      mode: "environment",
      traversal: {
        enabled: false,
        root_ref: "",
        max_depth: 0,
        max_nodes: 257,
        max_children_per_node: "8",
        text: true,
      },
    }),
    (error) => {
      assert.equal(error.code, "desktop_traversal_request_invalid");
      assert.deepEqual(error.validation_errors, [
        "request.mode must be atspi when traversal is enabled",
        "request.traversal.text is not allowed",
        "request.traversal.enabled must be true",
        "request.traversal.root_ref must be a non-empty string",
        "request.traversal.max_depth must be an integer from 1 to 4",
        "request.traversal.max_nodes must be an integer from 1 to 256",
        "request.traversal.max_children_per_node must be an integer from 1 to 32",
      ]);
      return true;
    },
  );
});

test("desktop traversal validator maps registry authorization failures to stable errors", () => {
  for (const code of [
    "desktop_traversal_root_not_disclosed",
    "desktop_traversal_root_expired",
    "desktop_traversal_root_revoked",
    "desktop_traversal_root_capability_inactive",
  ]) {
    assert.throws(
      () => validateDesktopTraversalRequest({
        mode: "atspi",
        traversal: {
          enabled: true,
          root_ref: "desktop-ref-1",
        },
      }, {
        authorizeRootRef() {
          return { ok: false, error: code };
        },
      }),
      {
        code,
        statusCode: 403,
      },
    );
  }
});

test("future traversal request validator remains as compatibility delegate", () => {
  const body = {
    mode: "atspi",
    traversal: {
      enabled: true,
      root_ref: "desktop-ref-1",
    },
  };
  const options = {
    authorizeRootRef() {
      return {
        ok: true,
        service: ":1.42",
        path: "/org/a11y/atspi/accessible/root",
        source_event_id: "prov-1",
        source_type: "application_root",
      };
    },
  };

  assert.deepEqual(
    validateFutureDesktopTraversalRequest(body, options),
    validateDesktopTraversalRequest(body, options),
  );
});
