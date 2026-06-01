import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapabilityProposalDesktopNotification,
  createDesktopNotificationAdapter,
  createDesktopNotificationProvenanceEvent,
  DESKTOP_NOTIFICATION_REASON_MAX_CHARS,
  DESKTOP_NOTIFICATION_TITLE,
  sanitizeNotificationText,
} from "../src/desktopNotificationAdapter.js";

test("desktop notification adapter is disabled by default and does not invoke notify-send", async () => {
  const calls = [];
  const adapter = createDesktopNotificationAdapter({
    enabled: false,
    execFileFn(command, args, options, callback) {
      calls.push({ command, args, options });
      callback();
    },
  });

  const result = await adapter.emitCapabilityProposal(proposalFixture(), {
    catalog: catalogFixture(),
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "disabled");
  assert.equal(result.proposal_id, "proposal-focus");
  assert.equal(result.requested_capability, "desktop.inspect.focus");
  assert.equal(result.risk_class, "sensitive");
  assert.deepEqual(calls, []);
});

test("desktop notification adapter invokes notify-send with fixed title and bounded body", async () => {
  const calls = [];
  const adapter = createDesktopNotificationAdapter({
    enabled: true,
    command: "/usr/bin/notify-send",
    execFileFn(command, args, options, callback) {
      calls.push({ command, args, options });
      callback();
    },
  });

  const result = await adapter.emitCapabilityProposal({
    ...proposalFixture(),
    reason: `Need role before advising.\u0000\u001b ${"x".repeat(220)}`,
  }, {
    catalog: catalogFixture(),
  });

  assert.equal(result.status, "emitted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/bin/notify-send");
  assert.equal(calls[0].args[0], "--");
  assert.equal(calls[0].args[1], DESKTOP_NOTIFICATION_TITLE);
  assert.match(calls[0].args[2], /capability: desktop\.inspect\.focus/);
  assert.match(calls[0].args[2], /risk_class: sensitive/);
  assert.match(calls[0].args[2], /approve: soma proposals approve proposal-focus --scope session/);
  assert.equal(calls[0].args[2].includes("\u0000"), false);
  assert.equal(calls[0].args[2].includes("\u001b"), false);
  assert.equal(result.reason_preview.length, DESKTOP_NOTIFICATION_REASON_MAX_CHARS);
  assert.equal(result.reason_truncated, true);
});

test("desktop notification adapter treats missing notify-send and command failure as non-fatal", async () => {
  for (const [name, error, expectedReason] of [
    ["missing", Object.assign(new Error("spawn notify-send ENOENT"), { code: "ENOENT" }), "notify_send_unavailable"],
    ["failed", Object.assign(new Error("notify failed"), { code: "EFAIL" }), "notify_send_failed"],
  ]) {
    const adapter = createDesktopNotificationAdapter({
      enabled: true,
      execFileFn(_command, _args, _options, callback) {
        callback(error);
      },
    });

    const result = await adapter.emitCapabilityProposal(proposalFixture(), {
      catalog: catalogFixture(),
    });

    assert.equal(result.status, "failed", name);
    assert.equal(result.reason, expectedReason, name);
    assert.equal(result.proposal_id, "proposal-focus", name);
  }
});

test("desktop notification template uses fixed structure and sanitized reason", () => {
  const notification = buildCapabilityProposalDesktopNotification({
    ...proposalFixture(),
    notification: { title: "Model supplied title must not be used" },
    reason: "line one\nline two\t\u0007",
  }, {
    catalog: catalogFixture(),
  });

  assert.equal(notification.title, DESKTOP_NOTIFICATION_TITLE);
  assert.equal(notification.body.startsWith("capability: desktop.inspect.focus\nrisk_class: sensitive"), true);
  assert.match(notification.body, /reason: line one line two/);
  assert.equal(notification.body.includes("Model supplied title"), false);
  assert.equal(notification.body.includes("\u0007"), false);
});

test("desktop notification template neutralizes markup in reason and capability", () => {
  const notification = buildCapabilityProposalDesktopNotification({
    ...proposalFixture(),
    capability: 'desktop.inspect.<a href="http://evil">focus</a>&x',
    reason: 'click <a href="http://evil">here</a> & approve',
  });

  assert.equal(notification.capability, 'desktop.inspect.a href="http://evil"focus/ax');
  assert.match(notification.body, /capability: desktop\.inspect\.a href="http:\/\/evil"focus\/ax/);
  assert.match(notification.body, /reason: click a href="http:\/\/evil"here\/a approve/);
  assert.equal(notification.body.includes("<"), false);
  assert.equal(notification.body.includes(">"), false);
  assert.equal(notification.body.includes("&"), false);
});

test("desktop notification provenance is non-authorizing", () => {
  const event = createDesktopNotificationProvenanceEvent({
    status: "emitted",
    proposal_id: "proposal-focus",
    requested_capability: "desktop.inspect.focus",
    risk_class: "sensitive",
    reason_preview: "bounded reason",
  }, {
    caller: "test",
  });

  assert.equal(event.event_type, "desktop.notification.emitted");
  assert.equal(event.notification_status, "emitted");
  assert.equal(event.proposal_id, "proposal-focus");
  assert.equal(event.requested_capability, "desktop.inspect.focus");
  assert.equal(event.approval_performed, false);
  assert.equal(event.activation_performed, false);
  assert.equal(event.grant_written, false);
});

test("sanitizeNotificationText strips controls, collapses whitespace, and truncates", () => {
  assert.equal(sanitizeNotificationText("a\nb\tc\u0000d", 5), "a b c");
  assert.equal(sanitizeNotificationText('click <a href="http://evil">here</a> & approve'), 'click a href="http://evil"here/a approve');
});

function proposalFixture() {
  return {
    id: "proposal-focus",
    capability: "desktop.inspect.focus",
    reason: "Need focused object role.",
    requested_scope: "session",
  };
}

function catalogFixture() {
  return {
    schema_version: 1,
    capabilities: [
      {
        key: "desktop.inspect.focus",
        risk_class: "sensitive",
      },
    ],
  };
}
