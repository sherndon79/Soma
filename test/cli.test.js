import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { parseCli, runCli } from "../src/cli.js";

test("parseCli reads command, flags, and default URL", () => {
  const parsed = parseCli([
    "node",
    "soma",
    "chat",
    "hello",
    "--memory",
    "--max-tokens",
    "12",
    "--url",
    "http://127.0.0.1:9999",
  ]);

  assert.equal(parsed.command, "chat");
  assert.equal(parsed.subcommand, "hello");
  assert.equal(parsed.flags.memory, true);
  assert.equal(parsed.flags["max-tokens"], "12");
  assert.equal(parsed.baseUrl, "http://127.0.0.1:9999");
});

test("runCli status gathers operator summary", async () => {
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "status"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, _method, path) => {
      if (path === "/health") {
        return {
          status: "ok",
          runtime_writes_enabled: false,
          runtime_write_posture: {
            runtime_writes_enabled: false,
            status: "disabled",
          },
        };
      }
      if (path === "/harness") {
        return {
          harness_id: "soma.base",
          mode: "local_text",
          runtime_profiles: { default_profile: "local-test" },
        };
      }
      if (path === "/harness-modules") {
        return { active_modules: ["pause-local-chat"], pending_capability_proposals: 2 };
      }
      if (path === "/capability-proposals?status=pending") {
        return {
          proposals: [
            {
              id: "proposal-1",
              capability: "desktop.inspect.focus",
              requested_by: "assistant",
              requested_scope: "session",
              reason: "Need focused object role.",
            },
            {
              id: "proposal-2",
              capability: "tool.files.write",
              requested_by: "assistant",
              requested_scope: "once",
              reason: "Need to update a selected file.",
            },
          ],
        };
      }
      if (path === "/provenance/summary") {
        return { summary: { total: 3 } };
      }
      throw new Error(`Unexpected path ${path}`);
    },
  });

  assert.equal(code, 0);
  const payload = JSON.parse(writes.join(""));
  assert.equal(payload.health.status, "ok");
  assert.equal(payload.runtime_writes_enabled, false);
  assert.equal(payload.runtime_write_posture.status, "disabled");
  assert.equal(payload.harness_id, "soma.base");
  assert.deepEqual(payload.active_modules, ["pause-local-chat"]);
  assert.equal(payload.pending_capability_proposals, 2);
  assert.equal(payload.pending_capability_proposal_details[0].id, "proposal-1");
  assert.equal(payload.pending_capability_proposal_details[0].capability, "desktop.inspect.focus");
  assert.equal(payload.provenance_summary.total, 3);
});

test("runCli status snapshot sends grant-bound request", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "status",
    "snapshot",
    "--grant-id",
    "grant-status-snapshot",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        grant_id: "grant-status-snapshot",
        provider: "soma.provider.status",
        provenance_id: "prov-status",
        activation_performed: false,
        grant_written: false,
        snapshot: {
          generated_at: "2026-06-01T20:00:00.000Z",
          health: {
            status: "ok",
            runtime_write_posture: { status: "disabled" },
          },
          modules: { active_count: 1 },
          proposals: { pending_total: 2 },
          capabilities: { total: 9 },
          provenance: { total: 4 },
          grants: { total: 1 },
          raw_entries_included: false,
          memory_content_included: false,
        },
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/status/snapshot");
  assert.deepEqual(captured.body, {
    grant_id: "grant-status-snapshot",
    provider: undefined,
    scope: undefined,
  });
  const output = writes.join("");
  assert.match(output, /Status snapshot/);
  assert.match(output, /grant: grant-status-snapshot/);
  assert.match(output, /pending proposals: 2/);
  assert.match(output, /raw entries included: no/);
  assert.match(output, /activation performed: no/);
});

test("runCli chat sends expected request body", async () => {
  let captured;
  const writes = [];

  const code = await runCli(parseCli([
    "node",
    "soma",
    "chat",
    "hello world",
    "--memory",
    "--write-memory",
    "--assess-load",
    "--assess-escalation",
    "--grant-id",
    "grant-remote-chat",
    "--tool-calls",
    "--tool-call-grant-id",
    "grant-tool-calls",
    "--tool-call-provider",
    "local-model",
    "--tool-call-scope",
    "session",
    "--max-tokens",
    "10",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return { text: "ok" };
    },
  });

  assert.equal(code, 0);
  assert.equal(writes.join(""), "ok\n");
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/chat");
  assert.deepEqual(captured.body.messages, [{ role: "user", content: "hello world" }]);
  assert.equal(captured.body.use_session_memory, true);
  assert.equal(captured.body.write_session_memory, true);
  assert.equal(captured.body.assess_cognitive_load, true);
  assert.equal(captured.body.assess_escalation, true);
  assert.equal(captured.body.grant_id, "grant-remote-chat");
  assert.equal(captured.body.use_tool_calls, true);
  assert.equal(captured.body.tool_call_grant_id, "grant-tool-calls");
  assert.equal(captured.body.tool_call_provider, "local-model");
  assert.equal(captured.body.tool_call_scope, "session");
  assert.equal(captured.body.max_tokens, 10);
});

test("runCli provenance list builds filters", async () => {
  let capturedPath = "";
  const writes = [];
  await runCli(parseCli([
    "node",
    "soma",
    "provenance",
    "list",
    "--allowed",
    "false",
    "--event-type",
    "harness.module.adopted",
    "--limit",
    "5",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, _method, path) => {
      capturedPath = path;
      return {
        entries: [
          {
            id: "prov-1",
            timestamp: "2026-05-05T00:00:00.000Z",
            event_type: "desktop.inspect.accessibility_tree",
            capability: "desktop.inspect.accessibility_tree",
            allowed: true,
            inspection_mode: "read_only_atspi_probe",
            requested_mode: "atspi",
            requested_max_apps: 2,
            requested_max_children: 1,
            application_count: 2,
            root_object_available_count: 2,
          },
        ],
      };
    },
  });

  assert.equal(capturedPath, "/provenance?allowed=false&event_type=harness.module.adopted&limit=5");
  assert.match(writes.join(""), /Provenance entries/);
  assert.match(writes.join(""), /desktop\.inspect\.accessibility_tree/);
  assert.match(writes.join(""), /max_apps=2/);
  assert.match(writes.join(""), /apps=2/);
});

test("runCli provenance summary prints operator summary", async () => {
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "provenance", "summary"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      assert.equal(path, "/provenance/summary");
      return {
        summary: {
          total: 4,
          allowed: 3,
          denied: 1,
          memory_read: 1,
          memory_written: 2,
          remote_service_used: 0,
          cognitive_load_assessed: 1,
          by_capability: {
            "desktop.inspect.accessibility_tree": 1,
            "model.local.chat": 2,
          },
          by_event_type: {
            "desktop.inspect.accessibility_tree": 1,
          },
        },
      };
    },
  });

  assert.equal(code, 0);
  assert.match(writes.join(""), /Provenance summary/);
  assert.match(writes.join(""), /total: 4/);
  assert.match(writes.join(""), /denied: 1/);
  assert.match(writes.join(""), /desktop\.inspect\.accessibility_tree: 1/);
});

test("runCli capabilities prints grouped capability view", async () => {
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "capabilities"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      assert.equal(path, "/capability-view");
      return {
        summary: {
          total: 3,
          by_status: {
            active: 1,
            requestable: 1,
            unsupported: 1,
          },
        },
        grouped: {
          desktop: {
            total: 2,
            by_status: {
              requestable: 1,
              unsupported: 1,
            },
          },
          model: {
            total: 1,
            by_status: {
              active: 1,
            },
          },
        },
      };
    },
  });

  assert.equal(code, 0);
  assert.match(writes.join(""), /Capability view/);
  assert.match(writes.join(""), /active: 1/);
  assert.match(writes.join(""), /desktop: 2 \(requestable=1 unsupported=1\)/);
  assert.match(writes.join(""), /model: 1 \(active=1\)/);
});

test("runCli model-visual review requests non-activating review text", async () => {
  let captured;
  const writes = [];
  const reviewResponse = {
    type: "model_visual_attach_proposal_template",
    activation_performed: false,
    proposal: {
      capability: "model.context.visual.color.attach",
    },
    review: {
      capability: "model.context.visual.color.attach",
      provider: "soma.provider.local-model",
      source: {
        subscription_id: "sub-color-1",
        provider: "soma.provider.sensorium.jetsorano",
        topic: "sensor/jetsorano/realsense/color",
        grant_id: "grant-color-1",
        capability: "perception.sensorium.color.subscribe",
      },
      model_target: "local.gemma4",
      payload_type: "color",
      transformed_dimensions: [384, 384],
      format_required: "jpeg",
      preview: {
        required: true,
        available: true,
        acknowledgement_required: true,
        acknowledged: false,
        artifact_id: "preview-color-1",
        acknowledgement_id: "ack-preview-color-1",
        acknowledged_by: "user",
        acknowledged_at: "2026-05-19T12:00:00.000Z",
        cleanup_required: true,
      },
      retention: {
        mode: "none",
        payload_retained: false,
        memory_write_authorized: false,
      },
    },
  };

  const code = await runCli(parseCli([
    "node",
    "soma",
    "model-visual",
    "review",
    "--kind",
    "proposal",
    "--review-json",
    JSON.stringify(reviewResponse),
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        text: "Model visual attach proposal\n  preview acknowledgement: artifact=preview-color-1",
        review_only: true,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/model-visual/review-text");
  assert.equal(captured.body.kind, "proposal");
  assert.equal(captured.body.review_response.review.preview.artifact_id, "preview-color-1");
  assert.match(writes.join(""), /Model visual attach proposal/);
  assert.match(writes.join(""), /artifact=preview-color-1/);
});

test("runCli model-visual review validates kind and review JSON before request", async () => {
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "model-visual",
      "review",
      "--kind",
      "stream",
      "--review-json",
      "{}",
    ]), {
      request: async () => {
        throw new Error("request should not be called");
      },
    }),
    { code: "usage_error", statusCode: 2 },
  );

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "model-visual",
      "review",
      "--kind",
      "proposal",
      "--review-json",
      "{",
    ]), {
      request: async () => {
        throw new Error("request should not be called");
      },
    }),
    { code: "usage_error", statusCode: 2 },
  );
});

test("runCli model-visual attach-dry-run requests non-delivering validation", async () => {
  let captured;
  const writes = [];
  const requestBody = modelVisualAttachRequestFixture();
  const code = await runCli(parseCli([
    "node",
    "soma",
    "model-visual",
    "attach-dry-run",
    "--request-json",
    JSON.stringify(requestBody),
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        request: {
          ...requestBody,
          provider: "soma.provider.local-model",
          scope: "once",
        },
        dry_run: true,
        accepted: true,
        activation_performed: false,
        grant_written: false,
        subscription_activated: false,
        model_delivery_performed: false,
        payload_attached: false,
        payload_bytes_included: false,
        future_provenance_preview: {
          event_type: "model.context.visual.attached",
          grant_id: "grant-visual-color",
          payload_bytes_included: false,
          visual_memory_written: false,
        },
        future_provenance_appended: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/model-visual/attach-requests/dry-run");
  assert.equal(captured.body.grant_id, "grant-visual-color");
  assert.equal(captured.body.preview_acknowledgement_id, "ack-preview-color-1");
  assert.match(writes.join(""), /Model visual attach dry-run/);
  assert.match(writes.join(""), /accepted: yes/);
  assert.match(writes.join(""), /payload: color dimensions=384x384 jpeg/);
  assert.match(writes.join(""), /model delivery performed: no/);
  assert.match(writes.join(""), /payload bytes included: no/);
  assert.match(writes.join(""), /future provenance preview: preview only/);
  assert.match(writes.join(""), /future provenance event: model\.context\.visual\.attached/);
  assert.match(writes.join(""), /future provenance appended: no/);
});

test("runCli model-visual attach-dry-run validates request JSON before request", async () => {
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "model-visual",
      "attach-dry-run",
      "--request-json",
      "[1]",
    ]), {
      request: async () => {
        throw new Error("request should not be called");
      },
    }),
    { code: "usage_error", statusCode: 2 },
  );

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "model-visual",
      "attach-dry-run",
      "--request-json",
      "{",
    ]), {
      request: async () => {
        throw new Error("request should not be called");
      },
    }),
    { code: "usage_error", statusCode: 2 },
  );
});

function modelVisualAttachRequestFixture() {
  return {
    capability: "model.context.visual.color.attach",
    grant_id: "grant-visual-color",
    source_subscription_ids: ["sub-color-1"],
    source_capabilities: ["perception.sensorium.color.subscribe"],
    source_provider: "soma.provider.sensorium.jetsorano",
    source_topic: "sensor/jetsorano/realsense/color",
    source_grant_id: "grant-color-1",
    model_target: "local.gemma4",
    payload_type: "color",
    max_frame_count: 1,
    max_frame_age_ms: 5_000,
    transformed_dimensions: [384, 384],
    format_required: "jpeg",
    preview_artifact_id: "preview-color-1",
    preview_acknowledgement_id: "ack-preview-color-1",
    preview_acknowledged_by: "user",
    preview_acknowledged_at: "2026-05-19T12:00:00.000Z",
    preview_acknowledged: true,
    preview_cleanup_required: true,
    retention_mode: "none",
  };
}

test("runCli proposals list prints pending proposals", async () => {
  let capturedPath = "";
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "proposals", "list", "--status", "pending"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      capturedPath = path;
      return {
        proposals: [
          {
            id: "proposal-1",
            status: "pending",
            requested_by: "assistant",
            capability: "desktop.inspect.focus",
            requested_scope: "session",
            reason: "Need focused object role.",
            risk: "May reveal active application context.",
            fallback: "Continue with desktop summary.",
            data_exposed: ["focused object role"],
          },
        ],
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(capturedPath, "/capability-proposals?status=pending");
  assert.match(writes.join(""), /Capability proposals/);
  assert.match(writes.join(""), /desktop\.inspect\.focus/);
  assert.match(writes.join(""), /reason: Need focused object role\./);
  assert.match(writes.join(""), /proposals show proposal-id/);
  assert.doesNotMatch(writes.join(""), /risk: May reveal active application context\./);
});

test("runCli notifications prints proposal review actions", async () => {
  let capturedPath = "";
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "notifications"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      capturedPath = path;
      return {
        notifications: [
          {
            id: "notification-proposal-1",
            type: "capability_proposal",
            status: "pending",
            proposal_id: "proposal-1",
            requested_by: "assistant",
            capability: "desktop.inspect.focus",
            requested_scope: "session",
            reason: "Need focused object role.",
            activation_performed: false,
          },
        ],
        summary: { total: 1 },
        activation_performed: false,
        durable: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(capturedPath, "/notifications");
  assert.match(writes.join(""), /Notifications/);
  assert.match(writes.join(""), /desktop\.inspect\.focus/);
  assert.match(writes.join(""), /show: soma proposals show proposal-1/);
  assert.match(writes.join(""), /approve: soma proposals approve proposal-1 --scope session/);
  assert.match(writes.join(""), /deny: soma proposals deny proposal-1 --reason text/);
  assert.match(writes.join(""), /activation performed: no/);
});

test("runCli proposals show prints full review context", async () => {
  let capturedPath = "";
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "proposals", "show", "proposal-1"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      capturedPath = path;
      return {
        proposal: {
          id: "proposal-1",
          type: "capability_design",
          status: "pending",
          requested_by: "assistant",
          capability: "desktop.inspect.selected_text",
          proposed_name: "Selected Desktop Text Inspection",
          requested_scope: "session",
          reason: "Need selected text only.",
          risk: "May reveal active application context.",
          fallback: "Continue with desktop summary.",
          data_exposed: ["selected text"],
          excluded_data: ["text content"],
          proposed_risk_class: "sensitive",
          proposed_reversibility: false,
          failure_mode: "Could disclose selected private text.",
          provider_boundary: "desktop broker selected-text-only boundary",
          grant_eligible: false,
          provenance_id: "prov-1",
        },
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(capturedPath, "/capability-proposals/proposal-1");
  assert.match(writes.join(""), /Capability proposal/);
  assert.match(writes.join(""), /type: capability_design/);
  assert.match(writes.join(""), /proposed name: Selected Desktop Text Inspection/);
  assert.match(writes.join(""), /proposed risk class: sensitive/);
  assert.match(writes.join(""), /proposed reversible: no/);
  assert.match(writes.join(""), /failure mode: Could disclose selected private text\./);
  assert.match(writes.join(""), /provider boundary: desktop broker selected-text-only boundary/);
  assert.match(writes.join(""), /grant eligible: no/);
  assert.match(writes.join(""), /risk: May reveal active application context\./);
  assert.match(writes.join(""), /data exposed: selected text/);
  assert.match(writes.join(""), /excluded data: text content/);
  assert.match(writes.join(""), /activation performed: no/);
});

test("runCli proposals approve sends decision request", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "proposals",
    "approve",
    "proposal-1",
    "--scope",
    "session",
    "--feedback",
    "Looks good.",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: { id: "proposal-1", status: "approved", capability: "desktop.inspect.focus" },
        decision: {
          decision: "approved",
          approved_scope: "session",
          feedback: "Looks good.",
        },
        activation_performed: false,
        provenance_id: "prov-1",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/capability-proposals/proposal-1/approve");
  assert.deepEqual(captured.body, {
    approved_scope: "session",
    decided_by: "user",
    feedback: "Looks good.",
  });
  assert.match(writes.join(""), /status: approved/);
  assert.match(writes.join(""), /feedback: Looks good\./);
  assert.match(writes.join(""), /activation performed: no/);
});

test("runCli grants list builds filters and prints non-activating summary", async () => {
  let capturedPath = "";
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "grants", "list", "--status", "active"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      capturedPath = path;
      return {
        grants: [
          {
            id: "grant-1",
            status: "active",
            capability: "desktop.inspect.focus",
            provider: "desktop-broker",
            scope: "session",
            reason: "Need focused object role.",
            activation_performed: false,
          },
        ],
        summary: { total: 1 },
        examples_available: true,
        file_backed: true,
        writable: false,
        runtime_writes_enabled: false,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(capturedPath, "/grants?status=active");
  assert.match(writes.join(""), /Grants/);
  assert.match(writes.join(""), /desktop\.inspect\.focus/);
  assert.match(writes.join(""), /examples available: yes/);
  assert.match(writes.join(""), /writable: no/);
  assert.match(writes.join(""), /activation performed: no/);
});

test("runCli grants list prints revocation metadata", async () => {
  const writes = [];
  await runCli(parseCli(["node", "soma", "grants", "list", "--status", "revoked"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      assert.equal(path, "/grants?status=revoked");
      return {
        grants: [
          {
            id: "grant-2",
            status: "revoked",
            capability: "desktop.inspect.text",
            provider: "desktop-broker",
            scope: "session",
            reason: "Previous text inspection test.",
            revoked_at: "2026-05-06T12:15:00.000Z",
            revoked_by: "user",
            revocation_reason: "Text inspection was no longer needed.",
            replacement_grant_id: "grant-3",
            activation_performed: false,
          },
        ],
        summary: { total: 1 },
        examples_available: false,
        file_backed: true,
        writable: false,
        runtime_writes_enabled: false,
        activation_performed: false,
      };
    },
  });

  assert.match(writes.join(""), /revoked at: 2026-05-06T12:15:00\.000Z/);
  assert.match(writes.join(""), /revoked by: user/);
  assert.match(writes.join(""), /revocation reason: Text inspection was no longer needed\./);
  assert.match(writes.join(""), /replacement grant: grant-3/);
});

test("runCli grants recovery prints bounded recovery summary", async () => {
  let capturedPath;
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "grants", "recovery"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      capturedPath = path;
      return {
        recovery_inspection_available: true,
        ok: false,
        degraded: true,
        grant_count: 1,
        finding_count: 1,
        findings: [
          {
            code: "grant_provenance_metadata_mismatch",
            grant_id: "grant-1",
            capability: "desktop.inspect.focus",
            provider: "soma.provider.desktop.local",
            scope: "session",
            authorizing_safe: false,
            event_type: "grant.created",
            field: "reason",
          },
        ],
        runtime_writes_enabled: false,
        activation_performed: false,
      };
    },
  });

  const output = writes.join("");
  assert.equal(code, 0);
  assert.equal(capturedPath, "/grants/recovery");
  assert.match(output, /Grant recovery/);
  assert.match(output, /inspection available: yes/);
  assert.match(output, /ok: no/);
  assert.match(output, /degraded: yes/);
  assert.match(output, /grant_provenance_metadata_mismatch/);
  assert.match(output, /field=reason/);
  assert.doesNotMatch(output, /grant_value/);
});

test("runCli grants recovery returns JSON when requested", async () => {
  const writes = [];
  const code = await runCli(parseCli(["node", "soma", "grants", "recovery", "--json"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "GET");
      assert.equal(path, "/grants/recovery");
      return {
        recovery_inspection_available: false,
        ok: null,
        degraded: false,
        grant_count: 0,
        finding_count: 0,
        findings: [],
        runtime_writes_enabled: false,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.recovery_inspection_available, false);
  assert.equal(parsed.ok, null);
});

test("runCli grants preview-create calls dry-run preview route", async () => {
  let capturedBody;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "grants",
    "preview-create",
    "--capability",
    "desktop.inspect.focus",
    "--provider",
    "desktop-broker",
    "--reason",
    "Preview focused inspection authority.",
    "--constraints-json",
    "{\"include_text\":false}",
    "--mutation-id",
    "mutation-preview-create",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      assert.equal(method, "POST");
      assert.equal(path, "/grants/mutation-previews");
      capturedBody = body;
      return {
        ok: true,
        dry_run: true,
        mutation_kind: "grant.created",
        grant: { id: "grant-preview", capability: "desktop.inspect.focus" },
        event: { event_type: "grant.created" },
        receipt_preview: {
          mutation_id: "mutation-preview-create",
          mutation_kind: "grant.created",
          grant_id: "grant-preview",
          event_type: "grant.created",
          status: "preview",
        },
        next_store_summary: { grant_count: 1, changed: true },
        grant_written: false,
        provenance_appended: false,
        activation_performed: false,
      };
    },
  });

  const output = writes.join("");
  assert.equal(code, 0);
  assert.equal(capturedBody.kind, "grant.created");
  assert.equal(capturedBody.mutation_id, "mutation-preview-create");
  assert.equal(capturedBody.input.provider, "desktop-broker");
  assert.deepEqual(capturedBody.input.constraints, { include_text: false });
  assert.equal(capturedBody.input.direct_user_action, true);
  assert.match(output, /Grant mutation preview/);
  assert.match(output, /dry run: yes/);
  assert.match(output, /grant written: no/);
  assert.match(output, /provenance appended: no/);
});

test("runCli grants preview-revoke calls dry-run preview route", async () => {
  let capturedBody;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "grants",
    "preview-revoke",
    "grant-active",
    "--reason",
    "Preview revocation.",
    "--mutation-id",
    "mutation-preview-revoke",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      assert.equal(method, "POST");
      assert.equal(path, "/grants/mutation-previews");
      capturedBody = body;
      return {
        ok: true,
        dry_run: true,
        mutation_kind: "grant.revoked",
        grant: { id: "grant-active", status: "revoked" },
        event: { event_type: "grant.revoked" },
        receipt_preview: {
          mutation_id: "mutation-preview-revoke",
          mutation_kind: "grant.revoked",
          grant_id: "grant-active",
          event_type: "grant.revoked",
          status: "preview",
        },
        next_store_summary: { grant_count: 1, changed: true },
        grant_written: false,
        provenance_appended: false,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(capturedBody.kind, "grant.revoked");
  assert.equal(capturedBody.input.id, "grant-active");
  assert.equal(capturedBody.input.actor, "user");
  assert.equal(capturedBody.input.reason, "Preview revocation.");
  assert.match(writes.join(""), /mutation: grant\.revoked/);
});

test("runCli grants preview-create renders dry-run refusal text from HTTP 400", async () => {
  const { baseUrl, close } = await createJsonServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/grants/mutation-previews");
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      dry_run: true,
      error: "grant_mutation_preview_recovery_required",
      message: "Grant mutation preview requires recovery inspection before previewing durable authority changes.",
      findings: [{ code: "missing_grant_created_provenance", grant_id: "grant-1" }],
      durable: false,
      grant_written: false,
      provenance_appended: false,
      activation_performed: false,
      subscription_activated: false,
      model_delivery_performed: false,
    }));
  });

  try {
    const writes = [];
    const code = await runCli(parseCli([
      "node",
      "soma",
      "grants",
      "preview-create",
      "--capability",
      "desktop.inspect.focus",
      "--provider",
      "desktop-broker",
      "--reason",
      "Preview focused inspection authority.",
      "--url",
      baseUrl,
    ]), {
      stdout: { write: (value) => writes.push(value) },
    });

    const output = writes.join("");
    assert.equal(code, 0);
    assert.match(output, /Grant mutation preview/);
    assert.match(output, /result: not accepted/);
    assert.match(output, /dry run: yes/);
    assert.match(output, /refusal code: grant_mutation_preview_recovery_required/);
    assert.match(output, /grant written: no/);
    assert.match(output, /provenance appended: no/);
    assert.match(output, /activation performed: no/);
  } finally {
    await close();
  }
});

test("runCli grants preview-revoke preserves raw JSON refusal output", async () => {
  const refusal = {
    ok: false,
    dry_run: true,
    code: "grant_mutation_preview_unsupported_kind",
    mutation_kind: "grant.superseded",
    receipt_preview: {
      status: "failed",
      error_code: "grant_mutation_preview_unsupported_kind",
      grant_store_committed: false,
      provenance_appended: false,
    },
    durable: false,
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
  };
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "grants",
    "preview-revoke",
    "grant-active",
    "--reason",
    "Preview revocation.",
    "--json",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path) => {
      assert.equal(method, "POST");
      assert.equal(path, "/grants/mutation-previews");
      return refusal;
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(writes.join("")), refusal);
});

test("runCli grants preview-create validates constraints JSON before request", async () => {
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "grants",
      "preview-create",
      "--capability",
      "desktop.inspect.focus",
      "--provider",
      "desktop-broker",
      "--reason",
      "Preview focused inspection authority.",
      "--constraints-json",
      "[]",
    ]), {
      request: async () => {
        throw new Error("request should not be called");
      },
    }),
    /grants preview-create --constraints-json must decode to an object/,
  );
});

test("runCli grants review-preview requests formatting-only review text", async () => {
  const writes = [];
  const preview = {
    ok: true,
    dry_run: true,
    mutation_kind: "grant.created",
    grant: {
      id: "grant-preview",
      status: "active",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
    },
    receipt_preview: { status: "preview" },
    next_store_summary: { grant_count: 1, changed: true },
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
  };

  const code = await runCli(parseCli([
    "node",
    "soma",
    "grants",
    "review-preview",
    "--preview-json",
    JSON.stringify(preview),
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      assert.equal(method, "POST");
      assert.equal(path, "/grants/mutation-preview-review-text");
      assert.deepEqual(body, { review_response: preview });
      return {
        text: "Grant mutation preview\n  durable write: no",
        review_only: true,
        durable: false,
        grant_written: false,
        provenance_appended: false,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.match(writes.join(""), /Grant mutation preview/);
  assert.match(writes.join(""), /durable write: no/);
});

test("runCli grants review-preview can read preview JSON from stdin", async () => {
  const writes = [];
  const preview = {
    ok: false,
    dry_run: true,
    code: "invalid_constraints",
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
  };

  const code = await runCli(parseCli([
    "node",
    "soma",
    "grants",
    "review-preview",
    "--stdin",
    "--json",
  ]), {
    stdin: [JSON.stringify(preview)],
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      assert.equal(method, "POST");
      assert.equal(path, "/grants/mutation-preview-review-text");
      assert.deepEqual(body, { review_response: preview });
      return {
        text: "Grant mutation preview",
        review_only: true,
        durable: false,
        grant_written: false,
        provenance_appended: false,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(JSON.parse(writes.join("")).review_only, true);
});

test("runCli grants review-preview validates preview JSON before request", async () => {
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "grants",
      "review-preview",
      "--preview-json",
      "[]",
    ]), {
      request: async () => {
        throw new Error("request should not be called");
      },
    }),
    /grants review-preview preview JSON must decode to an object/,
  );
});

test("runCli grants create calls durable mutation route", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "grants",
    "create",
    "--capability",
    "desktop.inspect.focus",
    "--provider",
    "desktop-broker",
    "--reason",
    "Persist focused inspection authority.",
    "--constraints-json",
    "{\"include_text\":false}",
    "--mutation-id",
    "mutation-create",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        ok: true,
        mutation_kind: "grant.created",
        grant: { id: "grant-created", status: "active" },
        receipt: {
          mutation_id: "mutation-create",
          mutation_kind: "grant.created",
          grant_id: "grant-created",
          status: "committed",
        },
        recovery: { ok: true, degraded: false },
        durable: true,
        grant_written: true,
        provenance_appended: true,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/grants");
  assert.equal(captured.body.capability, "desktop.inspect.focus");
  assert.equal(captured.body.provider, "desktop-broker");
  assert.deepEqual(captured.body.constraints, { include_text: false });
  assert.equal(captured.body.direct_user_action, true);
  assert.equal(captured.body.mutation_id, "mutation-create");
  assert.match(writes.join(""), /Grant mutation/);
  assert.match(writes.join(""), /durable: yes/);
  assert.match(writes.join(""), /provenance appended: yes/);
});

test("runCli grants revoke calls durable mutation route", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "grants",
    "revoke",
    "grant-created",
    "--reason",
    "No longer needed.",
    "--mutation-id",
    "mutation-revoke",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        ok: true,
        mutation_kind: "grant.revoked",
        grant: { id: "grant-created", status: "revoked" },
        receipt: {
          mutation_id: "mutation-revoke",
          mutation_kind: "grant.revoked",
          grant_id: "grant-created",
          status: "committed",
        },
        recovery: { ok: true, degraded: false },
        durable: true,
        grant_written: true,
        provenance_appended: true,
        activation_performed: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/grants/grant-created/revoke");
  assert.deepEqual(captured.body, {
    actor: "user",
    reason: "No longer needed.",
    mutation_id: "mutation-revoke",
  });
  assert.match(writes.join(""), /mutation: grant\.revoked/);
});

test("runCli still throws non-preview HTTP failures", async () => {
  const { baseUrl, close } = await createJsonServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: "server_unavailable",
      message: "Server unavailable.",
    }));
  });

  try {
    await assert.rejects(
      () => runCli(parseCli(["node", "soma", "grants", "recovery", "--url", baseUrl]), {
        stdout: { write: () => {} },
      }),
      Object.assign(new Error("Server unavailable."), {
        code: "server_unavailable",
        statusCode: 500,
      }),
    );
  } finally {
    await close();
  }
});

test("runCli sensorium proposal-template requests non-activating review context", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "proposal-template",
    "--capability",
    "perception.sensorium.color.subscribe",
    "--provider",
    "soma.provider.sensorium.jetsorano",
    "--topic",
    "sensor/jetsorano/realsense/color",
    "--reason",
    "Need a bounded color view.",
    "--max-seconds",
    "600",
    "--max-fps",
    "5",
    "--format",
    "jpeg",
    "--downsample",
    "384x384",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: {
          capability: "perception.sensorium.color.subscribe",
          requested_scope: "session",
          reason: "Need a bounded color view.",
        },
        review: {
          provider: "soma.provider.sensorium.jetsorano",
          topic: "sensor/jetsorano/realsense/color",
          stream_type: "color",
          risk_class: "high",
          scope: "session",
          max_seconds: 600,
          max_fps: 5,
          format_required: "jpeg",
          downsample_to: [384, 384],
          active_disclosure: "perception via Sensorium: color from jetsorano, 5 fps max, expires in 600 seconds",
          revocation: {
            summary: "Revoking this grant stops active color subscriptions for jetsorano immediately.",
          },
          recording_posture: "Frame payloads are not recorded by default.",
          model_boundary_warning: "Camera-class payloads can be stopped later.",
        },
        activation_performed: false,
        grant_written: false,
        subscription_activated: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/sensorium/proposal-template");
  assert.deepEqual(captured.body, {
    capability: "perception.sensorium.color.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    topic: "sensor/jetsorano/realsense/color",
    requested_scope: "session",
    reason: "Need a bounded color view.",
    constraints: {
      max_seconds: 600,
      max_fps: 5,
      format_required: "jpeg",
      downsample_to: [384, 384],
    },
  });
  assert.match(writes.join(""), /Sensorium proposal template/);
  assert.match(writes.join(""), /constraints: max_seconds=600 max_fps=5 format=jpeg downsample=384x384/);
  assert.match(writes.join(""), /activation performed: no/);
  assert.match(writes.join(""), /grant written: no/);
  assert.match(writes.join(""), /subscription activated: no/);
});

test("runCli sensorium proposal-template validates required flags before request", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "sensorium",
      "proposal-template",
      "--capability",
      "perception.sensorium.status.subscribe",
      "--provider",
      "soma.provider.sensorium.jetsorano",
      "--reason",
      "Need status.",
      "--max-seconds",
      "30",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        return {};
      },
    }),
    { code: "usage_error", statusCode: 2 },
  );
  assert.equal(called, false);
});

test("runCli remote-graphical proposal-template requests non-activating review context", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "proposal-template",
    "--capability",
    "perception.remote_desktop.video.subscribe",
    "--provider",
    "soma.provider.remote_desktop.sunshine",
    "--host",
    "soma-agent-desktop.local.sthnet.org",
    "--mode",
    "view_only",
    "--reason",
    "Need a bounded graphical view.",
    "--max-seconds",
    "120",
    "--max-fps",
    "30",
    "--max-width",
    "1280",
    "--max-height",
    "720",
    "--channels",
    "video",
    "--locality",
    "lan",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: {
          capability: "perception.remote_desktop.video.subscribe",
          requested_scope: "session",
          reason: "Need a bounded graphical view.",
        },
        review: {
          provider: "soma.provider.remote_desktop.sunshine",
          target_host: "soma-agent-desktop.local.sthnet.org",
          mode: "view_only",
          authority: "video",
          risk_class: "high",
          scope: "session",
          constraints: {
            max_seconds: 120,
            max_fps: 30,
            max_width: 1280,
            max_height: 720,
            locality: "lan",
            attended: true,
          },
          requested_channels: ["video"],
          excluded_channels: ["keyboard", "pointer", "recording"],
          active_disclosure: "remote graphical video authority for soma-agent-desktop.local.sthnet.org, expires in 120 seconds",
          revocation: {
            summary: "Revoking this grant stops video authority for soma-agent-desktop.local.sthnet.org.",
          },
          recording_posture: "No screenshots or frames are retained by default.",
          model_boundary_warning: "Remote desktop frames can be stopped later.",
        },
        activation_performed: false,
        grant_written: false,
        session_opened: false,
        pairing_performed: false,
        input_dispatched: false,
        video_attached: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/remote-graphical/proposal-template");
  assert.deepEqual(captured.body, {
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    mode: "view_only",
    requested_scope: "session",
    reason: "Need a bounded graphical view.",
    locality: "lan",
    requested_channels: ["video"],
    constraints: {
      max_seconds: 120,
      max_fps: 30,
      max_width: 1280,
      max_height: 720,
    },
  });
  assert.match(writes.join(""), /Remote graphical proposal template/);
  assert.match(writes.join(""), /constraints: max_seconds=120 max_fps=30 bounds=1280x720 locality=lan attended=yes/);
  assert.match(writes.join(""), /activation performed: no/);
  assert.match(writes.join(""), /grant written: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /input dispatched: no/);
});

test("runCli remote-graphical proposal-template validates required flags before request", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "proposal-template",
      "--capability",
      "desktop.remote.input.pointer",
      "--provider",
      "soma.provider.remote_desktop.sunshine",
      "--mode",
      "pointer_input",
      "--reason",
      "Need pointer input.",
      "--max-seconds",
      "30",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical proposal-template requires --host/,
  );
  assert.equal(called, false);
});

test("runCli remote-graphical status reports no-op broker posture", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "status",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        configured: false,
        requested: false,
        enabled: false,
        status: "provider_not_configured",
        state: "unconfigured",
        provider: "",
        target_host: "",
        active_count: 0,
        summary: "Remote graphical broker is not configured.",
        activation_performed: false,
        grant_written: false,
        session_opened: false,
        pairing_performed: false,
        input_dispatched: false,
        video_attached: false,
        recording_started: false,
        live_transport_used: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "GET");
  assert.equal(captured.path, "/remote-graphical/status");
  assert.equal(captured.body, undefined);
  assert.match(writes.join(""), /Remote graphical status/);
  assert.match(writes.join(""), /status: provider_not_configured/);
  assert.match(writes.join(""), /requested: no/);
  assert.match(writes.join(""), /enabled: no/);
  assert.match(writes.join(""), /configured: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /input dispatched: no/);
  assert.match(writes.join(""), /video attached: no/);
  assert.match(writes.join(""), /live transport used: no/);
});

test("runCli remote-graphical manifest-review formats local fixture without service request", async () => {
  let called = false;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "manifest-review",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => {
      called = true;
      throw new Error("request should not be called");
    },
  });

  const output = writes.join("");
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.match(output, /Remote graphical live provider manifest/);
  assert.match(output, /provider: soma\.provider\.remote_desktop\.sunshine/);
  assert.match(output, /runtime opt-ins: SOMA_REMOTE_GRAPHICAL_ENABLED=1/);
  assert.match(output, /target hosts: soma-agent-desktop\.local\.sthnet\.org/);
  assert.match(output, /disabled authorities: .*video_observation.*keyboard_input.*model_visual_delivery/);
  assert.match(output, /activation blockers: not in provider registry; not loaded by server startup; no broker construction/);
  assert.match(output, /activation boundary: manifest review is not live transport, pairing, observation, input, recording, grant write, or model delivery/);
});

test("runCli remote-graphical manifest-review json includes validated fixture without activation", async () => {
  let called = false;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "manifest-review",
    "--json",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => {
      called = true;
      throw new Error("request should not be called");
    },
  });

  const payload = JSON.parse(writes.join(""));
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.equal(payload.review_only, true);
  assert.equal(payload.fixture_path, "docs/fixtures/remote-graphical-live-provider-manifest.json");
  assert.equal(payload.manifest.id, "soma.provider.remote_desktop.sunshine");
  assert.equal(payload.manifest.runtime_loaded, false);
  assert.equal(payload.manifest.provider_registry_entry, false);
  assert.equal(payload.manifest.broker_construction, false);
  assert.equal(payload.activation_performed, false);
  assert.equal(payload.live_transport_used, false);
  assert.equal(payload.grant_written, false);
  assert.equal(payload.session_opened, false);
  assert.equal(payload.input_dispatched, false);
  assert.equal(payload.video_attached, false);
  assert.equal(payload.model_delivery_performed, false);
  assert.match(payload.text, /Remote graphical live provider manifest/);
});

test("runCli remote-graphical startup-review formats local startup plan without service request", async () => {
  let called = false;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "startup-review",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => {
      called = true;
      throw new Error("request should not be called");
    },
  });

  const output = writes.join("");
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.match(output, /Remote graphical live broker startup review/);
  assert.match(output, /review only: yes/);
  assert.match(output, /eligible: yes/);
  assert.match(output, /eligibility: eligible/);
  assert.match(output, /provider: soma\.provider\.remote_desktop\.sunshine/);
  assert.match(output, /target host: soma-agent-desktop\.local\.sthnet\.org/);
  assert.match(output, /helper binary reviewed: yes/);
  assert.match(output, /manager constructed: no/);
  assert.match(output, /helper started: no/);
  assert.match(output, /live transport used: no/);
});

test("runCli remote-graphical startup-review json includes plan without activation", async () => {
  let called = false;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "startup-review",
    "--json",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => {
      called = true;
      throw new Error("request should not be called");
    },
  });

  const payload = JSON.parse(writes.join(""));
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.equal(payload.type, "remote_graphical_live_broker_startup_review");
  assert.equal(payload.review_only, true);
  assert.equal(payload.fixture_path, "docs/fixtures/remote-graphical-live-provider-manifest.json");
  assert.equal(payload.plan.eligible, true);
  assert.equal(payload.plan.eligibility, "eligible");
  assert.equal(payload.plan.manager_constructed, false);
  assert.equal(payload.runtime_loaded, false);
  assert.equal(payload.manager_constructed, false);
  assert.equal(payload.helper_started, false);
  assert.equal(payload.broker_called, false);
  assert.equal(payload.session_opened, false);
  assert.equal(payload.video_attached, false);
  assert.equal(payload.input_dispatched, false);
  assert.equal(payload.live_transport_used, false);
});

test("runCli remote-graphical startup-review rejects unsupported source-selection flags locally", async () => {
  for (const flag of ["--manifest-path", "--stdin", "--helper-binary", "--source", "--url", "--provider"]) {
    let called = false;
    await assert.rejects(
      () => runCli(parseCli([
        "node",
        "soma",
        "remote-graphical",
        "startup-review",
        flag,
        flag === "--stdin" ? undefined : "ignored-source",
      ].filter(Boolean)), {
        stdout: { write: () => {} },
        request: async () => {
          called = true;
          throw new Error("request should not be called");
        },
      }),
      /startup-review does not accept/,
    );
    assert.equal(called, false);
  }
});

test("runCli remote-graphical manifest-review rejects unsupported source-selection flags locally", async () => {
  for (const flag of ["--manifest-path", "--stdin", "--manifest-url", "--source", "--url", "--provider"]) {
    let called = false;
    await assert.rejects(
      () => runCli(parseCli([
        "node",
        "soma",
        "remote-graphical",
        "manifest-review",
        flag,
        flag === "--stdin" ? undefined : "ignored-source",
      ].filter(Boolean)), {
        stdout: { write: () => {} },
        request: async () => {
          called = true;
          throw new Error("request should not be called");
        },
      }),
      {
        code: "usage_error",
        statusCode: 2,
      },
    );
    assert.equal(called, false, `${flag} should fail before service request`);
  }
});

test("runCli remote-graphical manifest-review rejects positional manifest paths locally", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "manifest-review",
      "/tmp/operator-manifest.json",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /does not accept manifest paths or positional source inputs/,
  );
  assert.equal(called, false);
});

test("runCli remote-graphical session-open-review requests non-activating review", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "session-open-review",
    "grant-remote-video",
    "--reason",
    "Need to prepare a reviewed broker session before observation.",
    "--by",
    "assistant",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        source_grant_id: "grant-remote-video",
        provider: "soma.provider.remote_desktop.sunshine",
        target_host: "soma-agent-desktop.local.sthnet.org",
        broker_action: "open_session",
        review: {
          video_observation_authority: "separate_action_required",
          input_authority: "separate_action_required",
          recording_authority: "not_requested",
          model_delivery_authority: "not_requested",
        },
        review_only: true,
        broker_called: false,
        activation_performed: false,
        grant_written: false,
        session_opened: false,
        pairing_performed: false,
        input_dispatched: false,
        video_attached: false,
        recording_started: false,
        live_transport_used: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/remote-graphical/session-open-review");
  assert.deepEqual(captured.body, {
    grant_id: "grant-remote-video",
    requested_by: "assistant",
    reason: "Need to prepare a reviewed broker session before observation.",
  });
  assert.match(writes.join(""), /Remote graphical session-open review/);
  assert.match(writes.join(""), /grant: grant-remote-video/);
  assert.match(writes.join(""), /broker called: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /video attached: no/);
  assert.match(writes.join(""), /input dispatched: no/);
  assert.match(writes.join(""), /live transport used: no/);
});

test("runCli remote-graphical session-open-review validates grant id and reason", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "session-open-review",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical session-open-review requires a grant id/,
  );
  assert.equal(called, false);

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "session-open-review",
      "grant-remote-video",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical session-open-review requires --reason text/,
  );
  assert.equal(called, false);
});

test("runCli remote-graphical session-open reports provider-not-configured refusal", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "session-open",
    "grant-remote-video",
    "--reason",
    "Need to open a reviewed broker session.",
    "--by",
    "user",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        source_grant_id: "grant-remote-video",
        provider: "soma.provider.remote_desktop.sunshine",
        target_host: "soma-agent-desktop.local.sthnet.org",
        refused: true,
        status: "provider_not_configured",
        state: "unconfigured",
        message: "Remote graphical session-open is not enabled on this Soma instance.",
        broker_called: false,
        activation_performed: false,
        grant_written: false,
        session_opened: false,
        pairing_performed: false,
        input_dispatched: false,
        video_attached: false,
        recording_started: false,
        live_transport_used: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/remote-graphical/sessions");
  assert.deepEqual(captured.body, {
    grant_id: "grant-remote-video",
    actor: "user",
    requested_by: "assistant",
    reason: "Need to open a reviewed broker session.",
  });
  assert.match(writes.join(""), /Remote graphical session-open refused/);
  assert.match(writes.join(""), /status: provider_not_configured/);
  assert.match(writes.join(""), /refused: yes/);
  assert.match(writes.join(""), /broker called: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /video attached: no/);
  assert.match(writes.join(""), /input dispatched: no/);
  assert.match(writes.join(""), /live transport used: no/);
});

test("runCli remote-graphical session-open text omits provenance preview fields", async () => {
  const writes = [];
  const response = makeRemoteGraphicalSessionOpenFixtureResponse();
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "session-open",
    "grant-remote-video",
    "--reason",
    "Need to open a reviewed broker session.",
    "--by",
    "user",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => response,
  });

  const output = writes.join("");
  assert.equal(code, 0);
  assert.match(output, /Remote graphical session-open refused/);
  assert.match(output, /session opened: yes/);
  assert.match(output, /broker called: yes/);
  assert.doesNotMatch(output, /provenance_preview/);
  assert.doesNotMatch(output, /provenance appended/);
  assert.doesNotMatch(output, /remote_graphical\.session_open\.fixture/);
});

test("runCli remote-graphical session-open json includes provenance preview fields", async () => {
  const writes = [];
  const response = makeRemoteGraphicalSessionOpenFixtureResponse();
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "session-open",
    "grant-remote-video",
    "--reason",
    "Need to open a reviewed broker session.",
    "--by",
    "user",
    "--json",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => response,
  });

  assert.equal(code, 0);
  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.provenance_appended, true);
  assert.equal(parsed.provenance_preview.event_type, "remote_graphical.session_open.fixture");
  assert.equal(parsed.provenance_preview.outcome, "success");
  assert.equal(parsed.provenance_preview.session_id, "fixture-session-1");
});

test("runCli remote-graphical session-open validates grant id and reason", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "session-open",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical session-open requires a grant id/,
  );
  assert.equal(called, false);

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "session-open",
      "grant-remote-video",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical session-open requires --reason text/,
  );
  assert.equal(called, false);
});

test("runCli remote-graphical propose creates pending proposal without activation", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "propose",
    "--capability",
    "desktop.remote.input.keyboard",
    "--provider",
    "soma.provider.remote_desktop.sunshine",
    "--host",
    "soma-agent-desktop.local.sthnet.org",
    "--mode",
    "keyboard_input",
    "--reason",
    "Need bounded keyboard input.",
    "--max-seconds",
    "20",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: {
          id: "remote-proposal-1",
          capability: "desktop.remote.input.keyboard",
          status: "pending",
        },
        review: {
          provider: "soma.provider.remote_desktop.sunshine",
          target_host: "soma-agent-desktop.local.sthnet.org",
          mode: "keyboard_input",
        },
        provenance_id: "prov-1",
        activation_performed: false,
        grant_written: false,
        session_opened: false,
        pairing_performed: false,
        input_dispatched: false,
        video_attached: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/remote-graphical/proposals");
  assert.deepEqual(captured.body, {
    capability: "desktop.remote.input.keyboard",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    mode: "keyboard_input",
    requested_scope: "session",
    reason: "Need bounded keyboard input.",
    constraints: {
      max_seconds: 20,
    },
  });
  assert.match(writes.join(""), /Remote graphical proposal created/);
  assert.match(writes.join(""), /id: remote-proposal-1/);
  assert.match(writes.join(""), /activation performed: no/);
  assert.match(writes.join(""), /grant written: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /input dispatched: no/);
});

test("runCli remote-graphical grant-candidate requests non-writing candidate review", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "grant-candidate",
    "remote-proposal-1",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        source_proposal_id: "remote-proposal-1",
        grant_create_input: {
          id: "grant-remote-1",
          capability: "perception.remote_desktop.video.subscribe",
          provider: "soma.provider.remote_desktop.sunshine",
          scope: "session",
          approval_provenance_id: "prov-1",
          constraints: {
            target_host: "soma-agent-desktop.local.sthnet.org",
            mode: "view_only",
            requested_channels: ["video"],
            max_seconds: 120,
          },
        },
        review_only: true,
        activation_performed: false,
        grant_written: false,
        session_opened: false,
        pairing_performed: false,
        input_dispatched: false,
        video_attached: false,
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/remote-graphical/grant-candidates");
  assert.deepEqual(captured.body, { proposal_id: "remote-proposal-1" });
  assert.match(writes.join(""), /Remote graphical grant candidate/);
  assert.match(writes.join(""), /source proposal: remote-proposal-1/);
  assert.match(writes.join(""), /review only: yes/);
  assert.match(writes.join(""), /grant written: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /input dispatched: no/);
});

test("runCli remote-graphical grant-candidate validates proposal id before request", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "grant-candidate",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical grant-candidate requires a proposal id/,
  );
  assert.equal(called, false);
});

test("runCli remote-graphical grant-create creates runtime grant without session activation", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "grant-create",
    "remote-proposal-1",
    "--by",
    "user",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        grant: {
          id: "grant-remote-1",
          capability: "perception.remote_desktop.video.subscribe",
          provider: "soma.provider.remote_desktop.sunshine",
          scope: "session",
          constraints: {
            target_host: "soma-agent-desktop.local.sthnet.org",
            mode: "view_only",
            requested_channels: ["video"],
            max_seconds: 120,
          },
        },
        source_proposal_id: "remote-proposal-1",
        activation_performed: false,
        grant_written: true,
        file_written: false,
        session_opened: false,
        pairing_performed: false,
        input_dispatched: false,
        video_attached: false,
        recording_started: false,
        provenance_id: "prov-grant",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/remote-graphical/grants");
  assert.deepEqual(captured.body, {
    proposal_id: "remote-proposal-1",
    actor: "user",
  });
  assert.match(writes.join(""), /Remote graphical grant created/);
  assert.match(writes.join(""), /grant: grant-remote-1/);
  assert.match(writes.join(""), /proposal: remote-proposal-1/);
  assert.match(writes.join(""), /target host: soma-agent-desktop\.local\.sthnet\.org/);
  assert.match(writes.join(""), /grant written: yes/);
  assert.match(writes.join(""), /file written: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /input dispatched: no/);
  assert.match(writes.join(""), /recording started: no/);
});

test("runCli remote-graphical grant-create validates proposal id before request", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "grant-create",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical grant-create requires a proposal id/,
  );
  assert.equal(called, false);
});

test("runCli remote-graphical grant-revoke revokes runtime grant without provider session control", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "grant-revoke",
    "grant-remote-1",
    "--reason",
    "Operator ended the bounded graphical authority.",
    "--by",
    "user",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        grant: {
          id: "grant-remote-1",
          status: "revoked",
          capability: "perception.remote_desktop.video.subscribe",
          provider: "soma.provider.remote_desktop.sunshine",
          revoked_by: "user",
          revocation_reason: "Operator ended the bounded graphical authority.",
          constraints: {
            target_host: "soma-agent-desktop.local.sthnet.org",
          },
        },
        changed: true,
        activation_performed: false,
        grant_written: true,
        file_written: false,
        session_opened: false,
        provider_session_stopped: false,
        input_dispatched: false,
        video_attached: false,
        recording_started: false,
        provenance_id: "prov-revoke",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/remote-graphical/grants/grant-remote-1/revoke");
  assert.deepEqual(captured.body, {
    actor: "user",
    reason: "Operator ended the bounded graphical authority.",
  });
  assert.match(writes.join(""), /Remote graphical grant revoked/);
  assert.match(writes.join(""), /grant: grant-remote-1/);
  assert.match(writes.join(""), /changed: yes/);
  assert.match(writes.join(""), /status: revoked/);
  assert.match(writes.join(""), /file written: no/);
  assert.match(writes.join(""), /session opened: no/);
  assert.match(writes.join(""), /provider session stopped: no/);
  assert.match(writes.join(""), /input dispatched: no/);
  assert.match(writes.join(""), /recording started: no/);
});

test("runCli remote-graphical grant-revoke validates grant id and reason before request", async () => {
  let called = false;
  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "grant-revoke",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical grant-revoke requires a grant id/,
  );
  assert.equal(called, false);

  await assert.rejects(
    () => runCli(parseCli([
      "node",
      "soma",
      "remote-graphical",
      "grant-revoke",
      "grant-remote-1",
    ]), {
      stdout: { write: () => {} },
      request: async () => {
        called = true;
        throw new Error("request should not be called");
      },
    }),
    /remote-graphical grant-revoke requires --reason text/,
  );
  assert.equal(called, false);
});

test("runCli sensorium propose creates pending proposal without activation", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "propose",
    "--capability",
    "perception.sensorium.status.subscribe",
    "--provider",
    "soma.provider.sensorium.jetsorano",
    "--topic",
    "sensor/jetsorano/status",
    "--reason",
    "Need node liveness.",
    "--max-seconds",
    "30",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: {
          id: "proposal-sensorium-status",
          status: "pending",
          capability: "perception.sensorium.status.subscribe",
          requested_scope: "session",
          review_context: {
            provider: "soma.provider.sensorium.jetsorano",
            topic: "sensor/jetsorano/status",
            stream_type: "status",
          },
        },
        review: {
          provider: "soma.provider.sensorium.jetsorano",
          topic: "sensor/jetsorano/status",
          stream_type: "status",
        },
        activation_performed: false,
        grant_written: false,
        subscription_activated: false,
        provenance_id: "prov-sensorium-status",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/sensorium/proposals");
  assert.deepEqual(captured.body, {
    capability: "perception.sensorium.status.subscribe",
    provider: "soma.provider.sensorium.jetsorano",
    topic: "sensor/jetsorano/status",
    requested_scope: "session",
    reason: "Need node liveness.",
    constraints: {
      max_seconds: 30,
    },
  });
  assert.match(writes.join(""), /Sensorium proposal created/);
  assert.match(writes.join(""), /proposal: proposal-sensorium-status/);
  assert.match(writes.join(""), /activation performed: no/);
  assert.match(writes.join(""), /grant written: no/);
  assert.match(writes.join(""), /subscription activated: no/);
  assert.match(writes.join(""), /show: soma proposals show proposal-sensorium-status/);
});

test("runCli sensorium grant-create creates grant without subscription activation", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "grant-create",
    "proposal-sensorium-status",
    "--by",
    "user",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        grant: {
          id: "grant-sensorium-status",
          capability: "perception.sensorium.status.subscribe",
          provider: "soma.provider.sensorium.jetsorano",
          scope: "session",
          constraints: {
            topic: "sensor/jetsorano/status",
            max_seconds: 30,
          },
        },
        source_proposal_id: "proposal-sensorium-status",
        activation_performed: false,
        subscription_activated: false,
        file_written: false,
        provenance_id: "prov-grant",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/sensorium/grants");
  assert.deepEqual(captured.body, {
    proposal_id: "proposal-sensorium-status",
    actor: "user",
  });
  assert.match(writes.join(""), /Sensorium grant created/);
  assert.match(writes.join(""), /grant: grant-sensorium-status/);
  assert.match(writes.join(""), /proposal: proposal-sensorium-status/);
  assert.match(writes.join(""), /topic: sensor\/jetsorano\/status/);
  assert.match(writes.join(""), /activation performed: no/);
  assert.match(writes.join(""), /subscription activated: no/);
  assert.match(writes.join(""), /file written: no/);
});

test("runCli sensorium grant-revoke revokes grant and reports stopped subscriptions", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "grant-revoke",
    "grant-sensorium-status",
    "--by",
    "user",
    "--reason",
    "No longer need status updates.",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        grant: {
          id: "grant-sensorium-status",
          status: "revoked",
          revoked_by: "user",
          revocation_reason: "No longer need status updates.",
        },
        changed: true,
        stopped_subscription_count: 1,
        activation_performed: false,
        subscription_activated: false,
        file_written: false,
        provenance_id: "prov-revoke",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/sensorium/grants/grant-sensorium-status/revoke");
  assert.deepEqual(captured.body, {
    actor: "user",
    reason: "No longer need status updates.",
  });
  assert.match(writes.join(""), /Sensorium grant revoked/);
  assert.match(writes.join(""), /grant: grant-sensorium-status/);
  assert.match(writes.join(""), /changed: yes/);
  assert.match(writes.join(""), /status: revoked/);
  assert.match(writes.join(""), /stopped subscriptions: 1/);
  assert.match(writes.join(""), /subscription activated: no/);
  assert.match(writes.join(""), /file written: no/);
});

test("runCli sensorium subscribe-start starts a granted subscription", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "subscribe-start",
    "--capability",
    "perception.sensorium.color.subscribe",
    "--topic",
    "sensor/jetsorano/realsense/color",
    "--max-seconds",
    "30",
    "--max-fps",
    "5",
    "--format",
    "jpeg",
    "--downsample",
    "320x240",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        subscription_id: "sub-color-1",
        topic: "sensor/jetsorano/realsense/color",
        started_at: 1_700_000_000,
        grant_id: "grant-color",
        activation_performed: true,
        provenance_id: "prov-start",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/sensorium/subscriptions");
  assert.deepEqual(captured.body, {
    capability: "perception.sensorium.color.subscribe",
    topic: "sensor/jetsorano/realsense/color",
    scope: "session",
    constraints: {
      max_seconds: 30,
      max_fps: 5,
      format_required: "jpeg",
      downsample_to: [320, 240],
    },
  });
  assert.match(writes.join(""), /Sensorium subscription started/);
  assert.match(writes.join(""), /subscription: sub-color-1/);
  assert.match(writes.join(""), /grant: grant-color/);
  assert.match(writes.join(""), /activation performed: yes/);
});

test("runCli sensorium subscribe-stop stops a subscription", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "subscribe-stop",
    "sub-color-1",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        subscription_id: "sub-color-1",
        end_summary: {
          subscription_id: "sub-color-1",
          termination_reason: "clean_stop",
          frames_consumed: 3,
          duration_seconds: 12,
          frames_recorded: false,
        },
        provenance_id: "prov-stop",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "DELETE");
  assert.equal(captured.path, "/sensorium/subscriptions/sub-color-1");
  assert.equal(captured.body, undefined);
  assert.match(writes.join(""), /Sensorium subscription stopped/);
  assert.match(writes.join(""), /subscription: sub-color-1/);
  assert.match(writes.join(""), /termination: clean_stop/);
  assert.match(writes.join(""), /frames consumed: 3/);
});

test("runCli sensorium subscriptions lists active disclosure", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "subscriptions",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        family: "perception.sensorium",
        active_count: 1,
        summary: "1 Sensorium subscription active",
        frames_recorded: false,
        streams: [
          {
            subscription_id: "sub-color-1",
            capability: "perception.sensorium.color.subscribe",
            topic: "sensor/jetsorano/realsense/color",
            grant_id: "grant-color",
            expires_in_seconds: 30,
          },
        ],
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "GET");
  assert.equal(captured.path, "/sensorium/subscriptions");
  assert.equal(captured.body, undefined);
  assert.match(writes.join(""), /Sensorium subscriptions/);
  assert.match(writes.join(""), /active: 1/);
  assert.match(writes.join(""), /sub-color-1/);
  assert.match(writes.join(""), /frames recorded: no/);
});

test("runCli sensorium status prints bounded status summaries only", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "status",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        family: "perception.sensorium",
        active_count: 2,
        summary: "perception via Sensorium: 2 streams active",
        frames_recorded: false,
        streams: [
          {
            subscription_id: "sub-color-1",
            capability: "perception.sensorium.color.subscribe",
            topic: "sensor/jetsorano/realsense/color",
            grant_id: "grant-color",
            frames_consumed_so_far: 20,
            frame_content: "must-not-print",
          },
          {
            subscription_id: "sub-status-1",
            capability: "perception.sensorium.status.subscribe",
            topic: "sensor/jetsorano/status",
            grant_id: "grant-status",
            host: "jetsorano",
            frames_consumed_so_far: 2,
            status_summary_observed: {
              schema_version: 1,
              hostname: "jetsorano",
              uptime_seconds: 42.5,
              node_version: "0.1.0",
              enabled_streams: [
                "realsense/color",
                "realsense/depth",
              ],
              stream_profiles: [
                {
                  stream: "realsense/color",
                  width: 1280,
                  height: 720,
                  fps: 30,
                  format: "jpeg",
                  jpeg_quality: 85,
                },
              ],
            },
          },
        ],
      };
    },
  });

  const output = writes.join("");
  assert.equal(code, 0);
  assert.equal(captured.method, "GET");
  assert.equal(captured.path, "/sensorium/subscriptions");
  assert.equal(captured.body, undefined);
  assert.match(output, /Sensorium status/);
  assert.match(output, /active status subscriptions: 1/);
  assert.match(output, /sub-status-1/);
  assert.match(output, /host: jetsorano/);
  assert.match(output, /enabled streams: realsense\/color, realsense\/depth/);
  assert.match(output, /native profiles: realsense\/color 1280x720 @ 30fps jpeg q85/);
  assert.doesNotMatch(output, /sub-color-1/);
  assert.doesNotMatch(output, /must-not-print/);
});

test("runCli sensorium status json returns filtered status view", async () => {
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "sensorium",
    "status",
    "--json",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => ({
      streams: [
        {
          subscription_id: "sub-color-1",
          capability: "perception.sensorium.color.subscribe",
          status_summary_observed: { hostname: "should-not-appear" },
        },
        {
          subscription_id: "sub-status-1",
          capability: "perception.sensorium.status.subscribe",
          topic: "sensor/jetsorano/status",
          status_summary_observed: {
            schema_version: 1,
            hostname: "jetsorano",
            uptime_seconds: 42.5,
            node_version: "0.1.0",
            enabled_streams: ["realsense/color"],
            stream_profiles: [
              {
                stream: "realsense/color",
                width: 1280,
                height: 720,
                fps: 30,
                format: "jpeg",
              },
            ],
          },
        },
      ],
      frames_recorded: false,
    }),
  });

  const payload = JSON.parse(writes.join(""));
  assert.equal(code, 0);
  assert.equal(payload.active_status_count, 1);
  assert.equal(payload.statuses.length, 1);
  assert.equal(payload.statuses[0].subscription_id, "sub-status-1");
  assert.equal(payload.statuses[0].status_summary_observed.hostname, "jetsorano");
  assert.equal(payload.statuses[0].status_summary_observed.stream_profiles[0].width, 1280);
  assert.equal(JSON.stringify(payload).includes("should-not-appear"), false);
});

test("runCli proposals deny sends decision request", async () => {
  let captured;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "proposals",
    "deny",
    "proposal-1",
    "--reason",
    "Not needed.",
    "--feedback",
    "Try later.",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, path, body) => {
      captured = { method, path, body };
      return {
        proposal: { id: "proposal-1", status: "denied", capability: "desktop.inspect.focus" },
        decision: {
          decision: "denied",
          denial_reason: "Not needed.",
          feedback: "Try later.",
        },
        activation_performed: false,
        provenance_id: "prov-1",
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(captured.method, "POST");
  assert.equal(captured.path, "/capability-proposals/proposal-1/deny");
  assert.deepEqual(captured.body, {
    reason: "Not needed.",
    decided_by: "user",
    feedback: "Try later.",
  });
  assert.match(writes.join(""), /status: denied/);
  assert.match(writes.join(""), /denial reason: Not needed\./);
  assert.match(writes.join(""), /feedback: Try later\./);
});

test("runCli files read sends expected request body", async () => {
  let captured;
  const writes = [];

  const code = await runCli(parseCli(["node", "soma", "files", "read", "README.md"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return { content: "readme text" };
    },
  });

  assert.equal(code, 0);
  assert.equal(writes.join(""), "readme text\n");
  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/files/read");
  assert.deepEqual(captured.body, { root_id: "root-1", relative_path: "README.md" });
});

test("runCli desktop inspect calls accessibility-tree endpoint", async () => {
  let captured;
  const writes = [];

  await runCli(parseCli([
    "node",
    "soma",
    "desktop",
    "inspect",
    "--mode",
    "atspi",
    "--max-apps",
    "2",
    "--max-children",
    "1",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return {
        provenance_id: "prov-1",
        inspection: {
          mode: "read_only_atspi_probe",
          broker_source: "rust_helper",
          platform_family: "linux",
          application_count: 2,
          root_object_available_count: 1,
          window_count: 0,
          tree_available: true,
          tree: {
            text_content_included: false,
            applications: [
              {
                root_object: {
                  child_metadata_sample: [
                    { role: "frame", child_count: 0 },
                  ],
                },
              },
              { root_object: null },
            ],
          },
        },
      };
    },
  });

  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/desktop/inspect/accessibility-tree");
  assert.deepEqual(captured.body, { mode: "atspi", max_apps: 2, max_children: 1 });
  assert.match(writes.join(""), /Desktop inspection/);
  assert.match(writes.join(""), /applications: 2/);
  assert.match(writes.join(""), /root objects: 1/);
  assert.match(writes.join(""), /shallow child metadata: 1/);
  assert.match(writes.join(""), /text content included: no/);
  assert.match(writes.join(""), /provenance: prov-1/);
});

test("runCli desktop inspect rejects invalid flags before request", async () => {
  for (const [name, argv] of Object.entries({
    invalid_mode: ["node", "soma", "desktop", "inspect", "--mode", "focus"],
    invalid_max_apps: ["node", "soma", "desktop", "inspect", "--max-apps", "0"],
    invalid_max_children: ["node", "soma", "desktop", "inspect", "--max-children", "9"],
    non_integer_max_apps: ["node", "soma", "desktop", "inspect", "--max-apps", "1.5"],
    non_numeric_max_children: ["node", "soma", "desktop", "inspect", "--max-children", "many"],
  })) {
    let called = false;

    await assert.rejects(
      () => runCli(parseCli(argv), {
        stdout: { write: () => {} },
        request: async () => {
          called = true;
          return {};
        },
      }),
      { code: "usage_error", statusCode: 2 },
      name,
    );

    assert.equal(called, false, name);
  }
});

test("runCli desktop focus calls focused inspection endpoint", async () => {
  let captured;
  const writes = [];

  await runCli(parseCli(["node", "soma", "desktop", "focus", "grant-focus"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return {
        provenance_id: "prov-focus",
        inspection: {
          mode: "read_only_focused_object_probe",
          broker_source: "rust_helper",
          platform_family: "linux",
          focus_available: true,
          focused_object: {
            role: "frame",
            child_count: 2,
          },
          text_content_included: false,
        },
      };
    },
  });

  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/desktop/inspect/focus");
  assert.deepEqual(captured.body, {
    grant_id: "grant-focus",
    provider: undefined,
    scope: undefined,
    include_text: undefined,
  });
  assert.match(writes.join(""), /Focused desktop object/);
  assert.match(writes.join(""), /available: yes/);
  assert.match(writes.join(""), /role: frame/);
  assert.match(writes.join(""), /child count: 2/);
  assert.match(writes.join(""), /text content included: no/);
  assert.match(writes.join(""), /provenance: prov-focus/);
});

test("runCli desktop focus sends include-text to server refusal path", async () => {
  let captured;

  await runCli(parseCli([
    "node",
    "soma",
    "desktop",
    "focus",
    "--grant-id",
    "grant-focus",
    "--provider",
    "desktop-broker",
    "--scope",
    "session",
    "--include-text",
  ]), {
    stdout: { write: () => {} },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return {
        provenance_id: "prov-focus",
        inspection: {
          mode: "read_only_focused_object_probe",
          broker_source: "rust_helper",
          platform_family: "linux",
          focus_available: false,
          focused_object: null,
          text_content_included: false,
        },
      };
    },
  });

  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/desktop/inspect/focus");
  assert.deepEqual(captured.body, {
    grant_id: "grant-focus",
    provider: "desktop-broker",
    scope: "session",
    include_text: true,
  });
});

test("runCli desktop windows calls window inspection endpoint", async () => {
  let captured;
  const writes = [];

  await runCli(parseCli(["node", "soma", "desktop", "windows", "grant-windows"]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return {
        provenance_id: "prov-windows",
        inspection: {
          mode: "read_only_window_probe",
          broker_source: "rust_helper",
          platform_family: "linux",
          window_count: 2,
          applications: [{ service: ":1.42" }],
          text_content_included: false,
          titles_included: false,
        },
      };
    },
  });

  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/desktop/inspect/windows");
  assert.deepEqual(captured.body, {
    grant_id: "grant-windows",
    provider: undefined,
    scope: undefined,
    include_text: undefined,
    include_titles: undefined,
  });
  assert.match(writes.join(""), /Desktop windows/);
  assert.match(writes.join(""), /windows: 2/);
  assert.match(writes.join(""), /applications: 1/);
  assert.match(writes.join(""), /text content included: no/);
  assert.match(writes.join(""), /titles included: no/);
  assert.match(writes.join(""), /provenance: prov-windows/);
});

test("runCli memory durable-add calls durable memory endpoint", async () => {
  let captured;
  const writes = [];

  await runCli(parseCli([
    "node",
    "soma",
    "memory",
    "durable-add",
    "--grant-id",
    "grant-memory",
    "--mutation-id",
    "memory-write-1",
    "Remember this selected fact.",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return {
        ok: true,
        mutation_kind: "memory.durable.written",
        entry: { id: "memory-1" },
        receipt: { memory_id: "memory-1" },
        durable: true,
        file_written: true,
        provenance_appended: true,
        runtime_writes_enabled: true,
        activation_performed: false,
      };
    },
  });

  assert.equal(captured.method, "POST");
  assert.equal(captured.requestPath, "/durable-memory");
  assert.equal(captured.body.content, "Remember this selected fact.");
  assert.equal(captured.body.grant_id, "grant-memory");
  assert.equal(captured.body.actor, "user");
  assert.equal(captured.body.mutation_id, "memory-write-1");
  assert.match(writes.join(""), /Durable memory mutation/);
  assert.match(writes.join(""), /memory id: memory-1/);
});

test("runCli memory durable-remove calls durable memory removal endpoint", async () => {
  let captured;

  await runCli(parseCli([
    "node",
    "soma",
    "memory",
    "durable-remove",
    "memory-1",
    "--grant-id",
    "grant-memory",
    "--reason",
    "No longer needed.",
  ]), {
    stdout: { write: () => {} },
    request: async (_baseUrl, method, requestPath, body) => {
      captured = { method, requestPath, body };
      return {
        ok: true,
        mutation_kind: "memory.durable.removed",
        entry: { id: "memory-1" },
        receipt: { memory_id: "memory-1" },
        durable: true,
        file_written: true,
        provenance_appended: true,
        runtime_writes_enabled: true,
        activation_performed: false,
      };
    },
  });

  assert.equal(captured.method, "DELETE");
  assert.equal(captured.requestPath, "/durable-memory/memory-1");
  assert.equal(captured.body.grant_id, "grant-memory");
  assert.equal(captured.body.actor, "user");
  assert.equal(captured.body.reason, "No longer needed.");
});

function makeRemoteGraphicalSessionOpenFixtureResponse() {
  return {
    type: "remote_graphical_session_open_result",
    source_grant_id: "grant-remote-video",
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    requested_by: "assistant",
    broker_action: "open_session",
    refused: false,
    status: "opened",
    state: "open",
    session_id: "fixture-session-1",
    fixture_only: true,
    activation_performed: true,
    broker_called: true,
    session_opened: true,
    durable: false,
    grant_written: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
    model_delivery: false,
    live_transport_used: false,
    provenance_appended: true,
    provenance_preview: {
      event_type: "remote_graphical.session_open.fixture",
      outcome: "success",
      source_grant_id: "grant-remote-video",
      capability: "perception.remote_desktop.video.subscribe",
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      requested_by: "assistant",
      broker_action: "open_session",
      status: "opened",
      state: "open",
      session_id: "fixture-session-1",
      error: "",
      cause_code: "",
      fixture_only: true,
      activation_performed: true,
      broker_called: true,
      session_opened: true,
      durable: false,
      grant_written: false,
      pairing_performed: false,
      video_attached: false,
      input_dispatched: false,
      recording_started: false,
      provider_session_stopped: false,
      model_delivery: false,
      live_transport_used: false,
      payload_bytes_included: false,
      frames_included: false,
      screenshots_included: false,
      recognized_text_included: false,
      clipboard_included: false,
      input_events_included: false,
      window_metadata_included: false,
      file_metadata_included: false,
      audio_payload_included: false,
      transport_diagnostics_included: false,
    },
  };
}

async function createJsonServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
