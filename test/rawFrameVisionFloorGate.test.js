import assert from "node:assert/strict";
import test from "node:test";

import {
  RAW_FRAME_VISION_FLOOR_REASONS,
  decideRawFrameVisionFloorGate,
} from "../src/rawFrameVisionFloorGate.js";

const NOW = new Date("2026-07-09T18:00:00.000Z");

function green(overrides = {}) {
  return {
    now: NOW,
    modality: "color",
    sourceHost: "jetsorano",
    episodeStatus: "active",
    runPosture: {
      status: "active",
      seth_present: true,
      seth_consented_to_visual_egress: true,
    },
    visualGrant: {
      id: "grant-visual-color",
      status: "active",
      capability: "model.context.visual.color.attach",
      scope: "once",
      constraints: {
        source_subscription_ids: ["sub-color-1"],
        source_host: "jetsorano",
        payload_type: "color",
        model_target: "local.vision",
        retention_mode: "none",
      },
    },
    grantRecoveryReport: { ok: true, degraded: false },
    sourceSubscription: {
      id: "sub-color-1",
      status: "active",
      source_host: "jetsorano",
      modality: "color",
      started_at: "2026-07-09T17:59:00.000Z",
    },
    soloAttestation: {
      input_origin: "steward",
      issued_at: "2026-07-09T17:59:30.000Z",
      expires_at: "2026-07-09T18:00:30.000Z",
      seth_present: true,
      seth_consented: true,
      active_control: true,
      no_other_person_in_frame: true,
      occupant_writable: false,
      occupant_refreshed: false,
      occupant_influenced: false,
    },
    presenceState: {
      status: "available",
      source_host: "jetsorano",
      person_count: 1,
      count_bucket: "1",
      additional_person_present: "not_detected",
      confidence_bucket: "high",
      observed_at: "2026-07-09T17:59:59.000Z",
      expires_at: "2026-07-09T18:00:01.000Z",
    },
    profile: {
      id: "local-vision",
      vision_input_supported: true,
      allowed_data_classes: ["submitted_text", "raw_visual_frame"],
    },
    ...overrides,
  };
}

test("raw-frame vision floor gate allows only all-green inputs", () => {
  const decision = decideRawFrameVisionFloorGate(green());

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, RAW_FRAME_VISION_FLOOR_REASONS.ALLOWED);
  assert.equal(decision.checks.presence_person_count_exactly_one, true);
  assert.equal(decision.checks.solo_attestation_non_occupant_writable, true);
  assert.equal(decision.checks.retention_none, true);
  assert.equal(decision.checks.profile_vision_capable, true);
});

test("raw-frame vision floor gate refuses unknown and stale presence", () => {
  assertDecision(
    { presenceState: { status: "unavailable", unavailable_reason: "not_armed_or_cleared" } },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_UNAVAILABLE,
  );
  assertDecision(
    {
      presenceState: {
        ...green().presenceState,
        observed_at: "2026-07-09T17:59:57.999Z",
        expires_at: "2026-07-09T18:00:10.000Z",
      },
    },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_STALE,
  );
  assertDecision(
    {
      presenceState: {
        ...green().presenceState,
        observed_at: "2026-07-09T17:59:59.500Z",
        expires_at: "2026-07-09T18:00:00.000Z",
      },
    },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_STALE,
  );
});

test("raw-frame vision floor gate refuses non-solo presence interpretations", () => {
  assertDecision(
    { presenceState: { ...green().presenceState, additional_person_present: "detected" } },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_ADDITIONAL_PERSON_DETECTED,
  );
  assertDecision(
    { presenceState: { ...green().presenceState, additional_person_present: "unknown" } },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_ADDITIONAL_PERSON_DETECTED,
  );
  for (const person_count of [0, 2, null, undefined]) {
    assertDecision(
      { presenceState: { ...green().presenceState, person_count, count_bucket: "1" } },
      RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_COUNT_NOT_EXACTLY_ONE,
    );
  }
  assertDecision(
    { presenceState: { ...green().presenceState, confidence_bucket: "low" } },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_CONFIDENCE_INSUFFICIENT,
  );
  assertDecision(
    { presenceState: { ...green().presenceState, confidence_bucket: "unknown" } },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_CONFIDENCE_INSUFFICIENT,
  );
});

test("raw-frame vision floor gate refuses host mismatch", () => {
  assertDecision(
    { presenceState: { ...green().presenceState, source_host: "other-host" } },
    RAW_FRAME_VISION_FLOOR_REASONS.PRESENCE_HOST_MISMATCH,
  );
  assertDecision(
    { sourceSubscription: { ...green().sourceSubscription, source_host: "other-host" } },
    RAW_FRAME_VISION_FLOOR_REASONS.SOURCE_SUBSCRIPTION_HOST_MISMATCH,
  );
});

test("raw-frame vision floor gate refuses stale solo attestation", () => {
  assertDecision(
    {
      soloAttestation: {
        ...green().soloAttestation,
        issued_at: "2026-07-09T17:58:59.999Z",
        expires_at: "2026-07-09T18:01:00.000Z",
      },
    },
    RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_STALE,
  );
  assertDecision(
    {
      soloAttestation: {
        ...green().soloAttestation,
        issued_at: "2026-07-09T17:59:30.000Z",
        expires_at: "2026-07-09T18:00:00.000Z",
      },
    },
    RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_STALE,
  );
});

test("raw-frame vision floor gate accepts active perception windows beyond one-shot ttl", () => {
  const decision = decideRawFrameVisionFloorGate(green({
    soloAttestation: {
      ...green().soloAttestation,
      input_origin: "trusted_run_control",
      issued_at: "2026-07-09T16:59:00.000Z",
      expires_at: "2026-07-09T19:00:00.000Z",
      perception_window_active: true,
    },
  }));

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, RAW_FRAME_VISION_FLOOR_REASONS.ALLOWED);
  assert.equal(decision.checks.solo_attestation_fresh, true);
});

test("raw-frame vision floor gate refuses expired perception windows", () => {
  assertDecision(
    {
      soloAttestation: {
        ...green().soloAttestation,
        input_origin: "trusted_run_control",
        issued_at: "2026-07-09T16:59:00.000Z",
        expires_at: "2026-07-09T17:59:59.000Z",
        perception_window_active: true,
      },
    },
    RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_STALE,
  );
});

test("raw-frame vision floor gate refuses occupant-writable attestation", () => {
  assertDecision(
    { soloAttestation: { ...green().soloAttestation, input_origin: "occupant" } },
    RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_OCCUPANT_WRITABLE,
  );
  assertDecision(
    { soloAttestation: { ...green().soloAttestation, refreshed_by: "occupant" } },
    RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_OCCUPANT_WRITABLE,
  );
  assertDecision(
    { soloAttestation: { ...green().soloAttestation, occupant_influenced: true } },
    RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_OCCUPANT_WRITABLE,
  );
  assertDecision(
    { soloAttestation: { ...green().soloAttestation, input_origin: "chat" } },
    RAW_FRAME_VISION_FLOOR_REASONS.SOLO_ATTESTATION_OCCUPANT_WRITABLE,
  );
});

test("raw-frame vision floor gate refuses non-vision profile", () => {
  assertDecision(
    { profile: { id: "text-only", allowed_data_classes: ["submitted_text"] } },
    RAW_FRAME_VISION_FLOOR_REASONS.PROFILE_NOT_VISION_CAPABLE,
  );
  assertDecision(
    { profile: { id: "text-only-with-egress-class", allowed_data_classes: ["submitted_text", "vision"] } },
    RAW_FRAME_VISION_FLOOR_REASONS.PROFILE_NOT_VISION_CAPABLE,
  );
});

test("raw-frame vision floor gate refuses degraded grant recovery", () => {
  assertDecision(
    { grantRecoveryReport: { ok: false, degraded: true } },
    RAW_FRAME_VISION_FLOOR_REASONS.GRANT_RECOVERY_DEGRADED,
  );
});

test("raw-frame vision floor gate refuses paused distressed and ejected episodes", () => {
  assertDecision(
    { episodeStatus: "", runPosture: { ...green().runPosture, status: "" } },
    RAW_FRAME_VISION_FLOOR_REASONS.EPISODE_NOT_LIVE,
  );
  for (const episodeStatus of ["paused", "distressed", "ejected"]) {
    assertDecision(
      { episodeStatus, runPosture: { ...green().runPosture, status: episodeStatus } },
      RAW_FRAME_VISION_FLOOR_REASONS.EPISODE_NOT_LIVE,
    );
  }
});

test("raw-frame vision floor gate refuses non-none retention and inactive source", () => {
  assertDecision(
    {
      visualGrant: {
        ...green().visualGrant,
        constraints: { ...green().visualGrant.constraints, retention_mode: "turn_only" },
      },
    },
    RAW_FRAME_VISION_FLOOR_REASONS.RETENTION_NOT_NONE,
  );
  assertDecision(
    { sourceSubscription: { ...green().sourceSubscription, status: "stopped" } },
    RAW_FRAME_VISION_FLOOR_REASONS.SOURCE_SUBSCRIPTION_NOT_ACTIVE,
  );
  assertDecision(
    {
      sourceSubscription: {
        id: green().sourceSubscription.id,
        source_host: green().sourceSubscription.source_host,
        modality: green().sourceSubscription.modality,
      },
    },
    RAW_FRAME_VISION_FLOOR_REASONS.SOURCE_SUBSCRIPTION_NOT_ACTIVE,
  );
});

function assertDecision(overrides, reason) {
  const decision = decideRawFrameVisionFloorGate(green(overrides));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, reason);
}
