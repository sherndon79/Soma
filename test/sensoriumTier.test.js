import assert from "node:assert/strict";
import test from "node:test";

import {
  createDepthPresenceSemanticEvent,
  createScreenStructureSemanticEvent,
  deriveOccupantSessionContext,
  localAudienceContext,
  scoreSensoriumOutputAct,
  validateBrokerDepthPresenceEvent,
} from "../src/sensoriumTier.js";

test("screen structure semantic event is minimized and short lived", () => {
  const event = createScreenStructureSemanticEvent({
    inspection: {
      focus_available: true,
      focused_object: { role: "entry", child_count: 2, name: "must not copy" },
    },
    sourceGrant: { id: "grant-focus", provider: "desktop-broker" },
    now: () => new Date("2026-06-23T18:00:00.000Z"),
    idFactory: () => "sem-1",
  });

  assert.equal(event.event_id, "sem-1");
  assert.equal(event.expires_at, "2026-06-23T18:00:10.000Z");
  assert.equal(event.minimization.raw_retained, false);
  assert.equal(event.minimization.raw_egressed, false);
  assert.equal(event.minimization.content_included, false);
  assert.equal(event.payload.focus.role, "entry");
  assert.equal(event.payload.focus.child_count_bucket, "1_5");
  assert.equal("name" in event.payload.focus, false);
  assert.deepEqual(event.policy_effects.allowed_output_modes, ["visual.occupant_owned"]);
});

test("screen structure event does not degrade policy effects for copresence", () => {
  const event = createScreenStructureSemanticEvent({
    inspection: { focus_available: false },
    audienceContext: {
      sethPresent: "present",
      additionalPersonPresent: "not_detected",
      copresenceSource: "camera",
    },
    now: () => new Date("2026-06-23T18:00:00.000Z"),
    idFactory: () => "sem-2",
  });

  assert.equal(event.audience_context.additional_person_present, "not_detected");
  assert.deepEqual(event.policy_effects.reason_codes, []);
  assert.deepEqual(event.policy_effects.blocked_output_modes, []);
});

test("output act consequence class is locally derived and caller class is ignored", () => {
  const scored = scoreSensoriumOutputAct({
    proposal: {
      act_kind: "visual_cue.show",
      substrate: "occupant_panel",
      principal: "occupant",
      audience_scope: "seth_only",
      output_mode: "visual.occupant_owned",
      consequence_class: "C4",
    },
    grant: { id: "grant-visual", provider: "soma.provider.sensorium-tier" },
    liveAudienceContext: localAudienceContext(),
    idFactory: () => "act-1",
  });

  assert.equal(scored.act_id, "act-1");
  assert.equal(scored.allowed, true);
  assert.equal(scored.consequence_class, "C0");
  assert.equal(scored.consequence_class_source, "local_gate_derived");
  assert.equal(scored.caller_supplied_consequence_class_ignored, true);
  assert.equal(scored.authority.requires_lca, false);
});

test("unknown copresence does not block local output by itself", () => {
  const audio = scoreSensoriumOutputAct({
    proposal: {
      act_kind: "visual_cue.show",
      substrate: "occupant_panel",
      principal: "occupant",
      audience_scope: "seth_only",
      output_mode: "audio.private_content",
    },
    liveAudienceContext: localAudienceContext(),
  });
  assert.equal(audio.allowed, true);
  assert.equal(audio.refusal_reason, "");
  assert.equal(audio.reconciled_output_mode, "audio.private_content");

  const visual = scoreSensoriumOutputAct({
    proposal: {
      act_kind: "surface.present",
      substrate: "occupant_panel",
      principal: "occupant",
      audience_scope: "seth_only",
      output_mode: "visual.occupant_owned",
    },
    liveAudienceContext: localAudienceContext(),
  });
  assert.equal(visual.allowed, true);
  assert.equal(visual.reconciliation_reason, "local_perception_sink_guarded");
});

test("normalized audience context preserves explicit not-detected copresence", () => {
  const normalized = localAudienceContext({
    sethPresent: "present",
    additionalPersonPresent: "not_detected",
    copresenceSource: "camera",
  });
  const scored = scoreSensoriumOutputAct({
    proposal: {
      act_kind: "visual_cue.show",
      substrate: "occupant_panel",
      principal: "occupant",
      audience_scope: "seth_only",
      output_mode: "audio.private_content",
    },
    liveAudienceContext: normalized,
  });

  assert.equal(scored.audience_context.additional_person_present, "not_detected");
  assert.equal(scored.allowed, true);
  assert.equal(scored.reconciliation_reason, "local_perception_sink_guarded");
});

test("depth presence event is minimized and carries no raw broker fields", () => {
  const event = createDepthPresenceSemanticEvent({
    brokerEvent: depthBrokerEvent({ person_count: 2, count_bucket: "2_plus", additional_person_present: "present" }),
    episode: activeEpisode(),
    sourceGrant: { id: "grant-depth", provider: "depth-broker" },
    now: () => new Date("2026-06-25T19:00:00.000Z"),
    idFactory: () => "presence-1",
  });

  assert.equal(event.event_id, "presence-1");
  assert.equal(event.channel, "camera.depth");
  assert.equal(event.event_type, "presence.depth");
  assert.equal(event.expires_at, "2026-06-25T19:00:10.000Z");
  assert.deepEqual(event.minimization, {
    level: "semantic",
    raw_retained: false,
    raw_egressed: false,
    content_included: false,
  });
  assert.deepEqual(event.payload, {
    person_count: 2,
    count_bucket: "2_plus",
    identity: "not_performed",
    copresence_source: "depth",
  });
  assert.equal(JSON.stringify(event).includes("payload_bytes"), false);
  assert.equal(event.audience_context.additional_person_present, "present");
  assert.deepEqual(event.policy_effects.blocked_output_modes, []);
});

test("depth presence carries broker copresence without deriving visitor status", () => {
  const event = createDepthPresenceSemanticEvent({
    brokerEvent: depthBrokerEvent({
      count_bucket: "1",
      additional_person_present: "not_detected",
    }),
  });
  const scored = scorePrivateAudio(event.audience_context);

  assert.equal(event.audience_context.seth_present, "unknown");
  assert.equal(event.audience_context.additional_person_present, "not_detected");
  assert.equal(scored.allowed, true);
  assert.equal(scored.refusal_reason, "");
});

test("depth presence does not override broker copresence for active occupant", () => {
  const event = createDepthPresenceSemanticEvent({
    brokerEvent: depthBrokerEvent({ count_bucket: "1", additional_person_present: "present" }),
    episode: activeEpisode(),
  });
  const scored = scorePrivateAudio(event.audience_context);

  assert.equal(event.audience_context.seth_present, "session_assumed_present");
  assert.equal(event.audience_context.additional_person_present, "present");
  assert.equal(scored.allowed, true);
});

test("depth presence count unknown does not block local output by itself", () => {
  const event = createDepthPresenceSemanticEvent({
    brokerEvent: depthBrokerEvent({ count_bucket: "unknown" }),
    episode: activeEpisode(),
  });
  const scored = scorePrivateAudio(event.audience_context);

  assert.equal(event.audience_context.additional_person_present, "unknown");
  assert.equal(scored.allowed, true);
});

test("depth presence count zero carries broker audience without coverage assumption", () => {
  const event = createDepthPresenceSemanticEvent({
    brokerEvent: depthBrokerEvent({
      person_count: 0,
      count_bucket: "0",
      additional_person_present: "not_detected",
      confidence_bucket: "medium",
    }),
    episode: activeEpisode(),
  });
  const scored = scorePrivateAudio(event.audience_context);

  assert.equal(event.audience_context.additional_person_present, "not_detected");
  assert.equal(scored.allowed, true);
  assert.equal("coverage_assumption" in event.payload, false);
});

test("depth presence rejects raw broker fields", () => {
  assert.throws(
    () => validateBrokerDepthPresenceEvent({
      ...depthBrokerEvent(),
      payload_bytes: "raw must not cross into node",
    }),
    (error) => error.code === "sensorium_presence_event_invalid"
      && error.validation_errors.includes("raw broker field is forbidden: payload_bytes"),
  );
});

test("depth presence ejected episode yields unknown rather than private-safe audience", () => {
  const context = deriveOccupantSessionContext({ episode: { status: "ejected" } });
  const event = createDepthPresenceSemanticEvent({
    brokerEvent: depthBrokerEvent({ count_bucket: "1" }),
    episode: { status: "ejected" },
  });
  const scored = scorePrivateAudio(event.audience_context);

  assert.equal(context.occupant_assumed_present, false);
  assert.equal(context.basis, "episode_ejected");
  assert.equal(event.audience_context.additional_person_present, "unknown");
  assert.equal(scored.allowed, true);
});

function depthBrokerEvent(overrides = {}) {
  return {
    schema_version: 1,
    event_type: "presence.depth",
    person_count: 1,
    count_bucket: "1",
    additional_person_present: "unknown",
    confidence_bucket: "medium",
    identity: "not_performed",
    copresence_source: "depth",
    raw_payload_allowed_to_node: false,
    raw_payload_included: false,
    ...overrides,
  };
}

function activeEpisode() {
  return {
    status: "active",
    occupant_id: "seth",
    posture: {
      mode: "analysis_testing",
      trust_basis: "human_set_episode",
    },
  };
}

function scorePrivateAudio(liveAudienceContext) {
  return scoreSensoriumOutputAct({
    proposal: {
      act_kind: "visual_cue.show",
      substrate: "occupant_panel",
      principal: "occupant",
      audience_scope: "seth_only",
      output_mode: "audio.private_content",
    },
    liveAudienceContext,
  });
}
