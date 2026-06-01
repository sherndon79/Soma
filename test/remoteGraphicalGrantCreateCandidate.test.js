import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRemoteGraphicalGrantCreateCandidateFromProposal,
} from "../src/remoteGraphicalGrantCreateCandidate.js";

const catalog = {
  schema_version: 1,
  capabilities: [
    {
      key: "perception.remote_desktop.video.subscribe",
      activation_policy: "explicit_grant",
      allowed_scopes: ["once", "session"],
    },
    {
      key: "desktop.remote.input.pointer",
      activation_policy: "explicit_grant",
      allowed_scopes: ["once", "session"],
    },
  ],
};

const providerRegistry = {
  schema_version: 1,
  providers: [
    {
      id: "soma.provider.remote_desktop.sunshine",
      capabilities: [
        { key: "perception.remote_desktop.video.subscribe" },
        { key: "desktop.remote.input.pointer" },
      ],
    },
  ],
};

const approvedProposal = {
  id: "proposal-remote-video",
  status: "approved",
  type: "capability_proposal",
  requested_by: "assistant",
  capability: "perception.remote_desktop.video.subscribe",
  requested_scope: "session",
  reason: "Need a bounded view of the graphical lab.",
  decision: {
    decision: "approved",
    approved_scope: "session",
    decided_by: "user",
    decided_at: "2026-05-24T12:00:00.000Z",
    provenance_id: "prov-remote-approval",
    activation_performed: false,
  },
  review_context: {
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    mode: "view_only",
    authority: "video",
    risk_class: "high",
    scope: "session",
    locality: "lan",
    attended: true,
    constraints: {
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "view_only",
      locality: "lan",
      attended: true,
      requested_channels: ["video"],
      max_seconds: 120,
      max_fps: 30,
      max_width: 1280,
      max_height: 720,
    },
    requested_channels: ["video"],
    excluded_channels: ["keyboard", "pointer", "recording"],
    active_disclosure: "remote graphical video authority for soma-agent-desktop.local.sthnet.org, expires in 120 seconds",
    revocation: {
      summary: "Revoking this grant stops video authority for soma-agent-desktop.local.sthnet.org.",
      immediate_stop: true,
    },
    recording_posture: "No screenshots or frames are retained by default.",
    model_boundary_warning: "Remote desktop frames can be stopped later.",
    provenance_posture: "Record metadata only.",
  },
  grant_intent: {
    capability: "perception.remote_desktop.video.subscribe",
    provider: "soma.provider.remote_desktop.sunshine",
    scope: "session",
    constraints: {
      target_host: "soma-agent-desktop.local.sthnet.org",
      mode: "view_only",
      locality: "lan",
      attended: true,
      requested_channels: ["video"],
      max_seconds: 120,
      max_fps: 30,
      max_width: 1280,
      max_height: 720,
    },
    reason: "Need a bounded view of the graphical lab.",
    activation_performed: false,
  },
};

const context = {
  catalog,
  providerRegistry,
  now: () => "2026-05-24T12:10:00.000Z",
  createId: () => "grant-remote-video",
};

test("buildRemoteGraphicalGrantCreateCandidateFromProposal returns validated grant input without activation", () => {
  const result = buildRemoteGraphicalGrantCreateCandidateFromProposal(approvedProposal, context);

  assert.equal(result.source_proposal_id, "proposal-remote-video");
  assert.equal(result.activation_performed, false);
  assert.equal(result.grant_written, false);
  assert.equal(result.session_opened, false);
  assert.equal(result.pairing_performed, false);
  assert.equal(result.video_attached, false);
  assert.equal(result.input_dispatched, false);
  assert.equal(result.recording_started, false);

  assert.equal(result.grant_create_input.id, "grant-remote-video");
  assert.equal(result.grant_create_input.status, "active");
  assert.equal(result.grant_create_input.capability, "perception.remote_desktop.video.subscribe");
  assert.equal(result.grant_create_input.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(result.grant_create_input.scope, "session");
  assert.equal(result.grant_create_input.approved_by, "user");
  assert.equal(result.grant_create_input.approval_provenance_id, "prov-remote-approval");
  assert.equal(result.grant_create_input.activation_performed, false);
  assert.deepEqual(result.grant_create_input.constraints, approvedProposal.grant_intent.constraints);
});

test("buildRemoteGraphicalGrantCreateCandidateFromProposal rejects pending and denied proposals", () => {
  assertRemoteGraphicalCandidateError(
    () => buildRemoteGraphicalGrantCreateCandidateFromProposal({
      ...approvedProposal,
      status: "pending",
      decision: undefined,
    }, context),
  );

  assertRemoteGraphicalCandidateError(
    () => buildRemoteGraphicalGrantCreateCandidateFromProposal({
      ...approvedProposal,
      status: "denied",
      decision: {
        decision: "denied",
        decided_by: "user",
        provenance_id: "prov-denial",
      },
    }, context),
  );
});

test("buildRemoteGraphicalGrantCreateCandidateFromProposal rejects capability design proposals", () => {
  assertRemoteGraphicalCandidateError(
    () => buildRemoteGraphicalGrantCreateCandidateFromProposal({
      ...approvedProposal,
      type: "capability_design",
    }, context),
    "remote_graphical_grant_candidate_rejects_capability_design",
  );
});

test("buildRemoteGraphicalGrantCreateCandidateFromProposal requires approval provenance", () => {
  assertRemoteGraphicalCandidateError(
    () => buildRemoteGraphicalGrantCreateCandidateFromProposal({
      ...approvedProposal,
      decision: {
        ...approvedProposal.decision,
        provenance_id: "",
      },
    }, context),
  );
});

test("buildRemoteGraphicalGrantCreateCandidateFromProposal rejects provider drift", () => {
  assertRemoteGraphicalCandidateError(
    () => buildRemoteGraphicalGrantCreateCandidateFromProposal({
      ...approvedProposal,
      grant_intent: {
        ...approvedProposal.grant_intent,
        provider: "soma.provider.other",
      },
    }, context),
  );
});

test("buildRemoteGraphicalGrantCreateCandidateFromProposal rejects target host drift", () => {
  assertRemoteGraphicalCandidateError(
    () => buildRemoteGraphicalGrantCreateCandidateFromProposal({
      ...approvedProposal,
      grant_intent: {
        ...approvedProposal.grant_intent,
        constraints: {
          ...approvedProposal.grant_intent.constraints,
          target_host: "other-host.local",
        },
      },
    }, context),
  );
});

test("buildRemoteGraphicalGrantCreateCandidateFromProposal rejects mode drift", () => {
  assertRemoteGraphicalCandidateError(
    () => buildRemoteGraphicalGrantCreateCandidateFromProposal({
      ...approvedProposal,
      review_context: {
        ...approvedProposal.review_context,
        mode: "keyboard_input",
      },
    }, context),
  );
});

function assertRemoteGraphicalCandidateError(fn, code = "invalid_remote_graphical_grant_candidate") {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    assert.equal(Array.isArray(error.validation_errors), true);
    return true;
  });
}
