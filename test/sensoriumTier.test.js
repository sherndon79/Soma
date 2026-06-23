import assert from "node:assert/strict";
import test from "node:test";

import {
  createScreenStructureSemanticEvent,
  localAudienceContext,
  scoreSensoriumOutputAct,
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

test("screen structure event reason codes use normalized audience context", () => {
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

test("unknown copresence blocks private audio but allows occupant-owned visual output", () => {
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
  assert.equal(audio.allowed, false);
  assert.equal(audio.refusal_reason, "audio_private_content_requires_exclusive_audience");
  assert.equal(audio.reconciled_output_mode, "visual.occupant_owned");

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
  assert.equal(visual.reconciliation_reason, "visual_mode_allowed_under_unknown_copresence");
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
  assert.equal(scored.reconciliation_reason, "exclusive_audience_observed");
});
