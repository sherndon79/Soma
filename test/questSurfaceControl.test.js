import assert from "node:assert/strict";
import test from "node:test";

import {
  QUEST_SURFACE_DEFAULT_EPISODE_TTL_MS,
  QUEST_SURFACE_MIN_EPISODE_TTL_MS,
  QUEST_SURFACE_MAX_EPISODE_TTL_MS,
  createDisabledQuestSurfaceControl,
  createQuestSurfaceControl,
} from "../src/questSurfaceControl.js";
import { createQuestSurfaceFixtureProvider } from "../src/questSurfaceFixtureProvider.js";

const grantIds = Object.freeze({
  panel: "grant-panel",
  mic_capture: "grant-mic",
  audio_present: "grant-audio",
  local_attach: "grant-local",
});

function fakeProvider() {
  let armed = null;
  let sessions = 0;
  let validationError = null;
  const calls = [];
  return {
    calls,
    setSessionCount(value) {
      sessions = value;
    },
    setValidationError(error) {
      validationError = error;
    },
    hasActiveSessions() {
      return sessions > 0;
    },
    validateConfiguredGrantBindings() {
      calls.push(["validate"]);
      if (validationError) throw validationError;
      return { allowed: true, grant_ids: grantIds };
    },
    armEpisode(input) {
      calls.push(["arm", input]);
      armed = {
        id: input.episodeId,
        armedAtMs: 1_000,
        expiresAtMs: 1_000 + input.ttlMs,
        ttlMs: input.ttlMs,
        actor: input.actor,
        mode: input.mode,
        capability: input.capability,
        provider: input.provider,
        grant_id: input.grant_id,
      };
      return armed;
    },
    revokeEpisode(reason, options) {
      calls.push(["revoke", reason, options]);
      const changed = armed !== null;
      armed = null;
      return changed;
    },
    episodeStatus() {
      calls.push(["status"]);
      return armed
        ? {
            armed: true,
            episode_id: armed.id,
            armed_at_ms: armed.armedAtMs,
            expires_at_ms: armed.expiresAtMs,
            ttl_ms: armed.ttlMs,
          }
        : {
            armed: false,
            episode_id: "",
            armed_at_ms: null,
            expires_at_ms: null,
            ttl_ms: 0,
          };
    },
  };
}

function validArm(overrides = {}) {
  return {
    actor: "user",
    episode_id: "quest-worn-1",
    ttl_ms: 15 * 60 * 1000,
    reason: "Authorize one bounded worn Quest voice test.",
    provenance_id: "gate/quest-v1b-arm/approval-1",
    ...overrides,
  };
}

test("disabled Quest control reports disarmed and refuses arm without constructing authority", () => {
  const control = createDisabledQuestSurfaceControl();
  assert.deepEqual(control.status(), {
    enabled: false,
    armed: false,
    episode_id: "",
    armed_at_ms: null,
    expires_at_ms: null,
    ttl_ms: 0,
    session_active: false,
    mode: null,
    capability: "",
    answer_provider_id: "",
    grant_ids: null,
    content_included: false,
    payload_bytes_included: false,
    durable: false,
  });
  assert.throws(
    () => control.armTextLocal(validArm()),
    (error) => error.code === "quest_surface_runtime_disabled" && error.statusCode === 503,
  );
  assert.equal(control.disarm({ actor: "user" }).changed, false);
});

test("Quest control arms only the pinned text/local tuple and status does not extend it", () => {
  const provider = fakeProvider();
  const control = createQuestSurfaceControl({ provider, grantIds });

  const result = control.armTextLocal(validArm());
  assert.equal(result.changed, true);
  assert.equal(result.status.armed, true);
  assert.equal(result.status.expires_at_ms, 901_000);
  assert.deepEqual(result.status.grant_ids, grantIds);
  assert.equal(result.status.answer_provider_id, "soma.provider.quest-surface-fixture");
  assert.equal(result.status.capability, "model.context.audio.microphone.local.attach");
  assert.deepEqual(result.status.mode, { input_class: "text", destination: "local" });
  assert.equal(result.status.content_included, false);
  assert.equal(result.status.payload_bytes_included, false);

  const armCall = provider.calls.find(([name]) => name === "arm");
  assert.deepEqual(armCall[1].mode, { input_class: "text", destination: "local" });
  assert.equal(armCall[1].provider, "soma.provider.quest-surface-fixture");
  assert.equal(armCall[1].grant_id, "grant-local");

  const before = control.status().expires_at_ms;
  const after = control.status().expires_at_ms;
  assert.equal(after, before, "status must not refresh or extend the arm TTL");
});

test("Quest control rejects invalid authority inputs before touching provider state", () => {
  const invalidCases = [
    [validArm({ actor: "assistant" }), "quest_surface_arm_requires_user_actor"],
    [validArm({ episode_id: "" }), "quest_surface_episode_id_required"],
    [validArm({ reason: "" }), "quest_surface_arm_reason_required"],
    [validArm({ provenance_id: "" }), "quest_surface_arm_provenance_required"],
    [validArm({ ttl_ms: QUEST_SURFACE_MIN_EPISODE_TTL_MS - 1 }), "quest_surface_episode_ttl_invalid"],
    [validArm({ ttl_ms: QUEST_SURFACE_MAX_EPISODE_TTL_MS + 1 }), "quest_surface_episode_ttl_invalid"],
    [validArm({ mode: "raw_audio:remote" }), "quest_surface_arm_request_invalid"],
  ];

  for (const [input, code] of invalidCases) {
    const provider = fakeProvider();
    const control = createQuestSurfaceControl({ provider, grantIds });
    assert.throws(() => control.armTextLocal(input), (error) => error.code === code);
    assert.equal(provider.calls.some(([name]) => name === "arm"), false, code);
  }
});

test("Quest control atomically replaces an arm without adding a separate attention gate", () => {
  const provider = fakeProvider();
  provider.setSessionCount(1);
  const control = createQuestSurfaceControl({ provider, grantIds });
  const first = control.armTextLocal(validArm());
  assert.equal(first.replaced, false);
  assert.equal(first.status.session_active, true);

  const second = control.armTextLocal(validArm({ episode_id: "quest-worn-2" }));
  assert.equal(second.replaced, true);
  assert.equal(second.status.episode_id, "quest-worn-2");

  const failure = Object.assign(new Error("wrong fingerprint"), {
    code: "quest_surface_device_identity_configuration_mismatch",
  });
  provider.setValidationError(failure);
  assert.throws(
    () => control.armTextLocal(validArm({ episode_id: "quest-worn-3" })),
    (error) => error === failure,
  );
  assert.equal(control.status().episode_id, "quest-worn-2", "failed replacement preserves old arm");
});

test("Quest provider validates a replacement before cancelling the existing expiry timer", () => {
  const cleared = [];
  let nextTimer = 0;
  const provider = createQuestSurfaceFixtureProvider({
    tlsOptions: { key: Buffer.from("key"), cert: Buffer.from("cert"), ca: Buffer.from("ca") },
    grantId: "grant-panel",
    grantIds,
    setTimer() {
      nextTimer += 1;
      return { id: nextTimer, unref() {} };
    },
    clearTimer(timer) {
      if (timer) cleared.push(timer.id);
    },
    logger: { info() {}, error() {} },
  });

  provider.armEpisode({ episodeId: "quest-worn-1", ttlMs: 60_000 });
  assert.throws(
    () => provider.armEpisode({ episodeId: "quest-worn-invalid", ttlMs: 999 }),
    (error) => error.code === "episode_ttl_invalid",
  );
  assert.equal(provider.episodeStatus().episode_id, "quest-worn-1");
  assert.deepEqual(cleared, [], "failed replacement must leave the old timer armed");

  provider.armEpisode({ episodeId: "quest-worn-2", ttlMs: 60_000 });
  assert.equal(provider.episodeStatus().episode_id, "quest-worn-2");
  assert.deepEqual(cleared, [1], "successful replacement cancels the old timer exactly once");
});

test("Quest disarm is idempotent, narrowing-only, and reuses provider revocation", () => {
  const provider = fakeProvider();
  const control = createQuestSurfaceControl({ provider, grantIds });
  control.armTextLocal(validArm());

  const first = control.disarm({ actor: "user", reason: "operator_disarmed" });
  assert.equal(first.changed, true);
  assert.equal(first.status.armed, false);
  const revoke = provider.calls.find(([name]) => name === "revoke");
  assert.deepEqual(revoke, [
    "revoke",
    "operator_disarmed",
    { actor: "user", eventType: "quest.surface.episode_disarmed" },
  ]);

  const second = control.disarm({ actor: "assistant" });
  assert.equal(second.changed, false, "any local caller may repeat the narrowing action safely");
});

test("episode TTL constants preserve the W-arc boundary independently from lease TTL", () => {
  assert.equal(QUEST_SURFACE_DEFAULT_EPISODE_TTL_MS, 60 * 60 * 1000);
  assert.equal(QUEST_SURFACE_MIN_EPISODE_TTL_MS, 1000);
  assert.equal(QUEST_SURFACE_MAX_EPISODE_TTL_MS, 24 * 60 * 60 * 1000);
});
