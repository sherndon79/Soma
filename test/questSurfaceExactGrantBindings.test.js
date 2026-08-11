import assert from "node:assert/strict";
import test from "node:test";

import { createQuestSurfaceFixtureProvider } from "../src/questSurfaceFixtureProvider.js";
import {
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
  QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
  QUEST_SURFACE_PROVIDER_ID,
} from "../src/questSurfaceProtocol.js";

const DEVICE_FP = "AA".repeat(32);
const OTHER_FP = "BB".repeat(32);
const grantIds = Object.freeze({
  panel: "grant-panel",
  mic_capture: "grant-mic",
  audio_present: "grant-audio",
  local_attach: "grant-local",
});

function grants() {
  return [
    grant("grant-panel", QUEST_SURFACE_CAPABILITY, QUEST_SURFACE_PROVIDER_ID, "session", {
      allowed_surface_ids: ["panel.main"],
      max_panel_text_bytes: 512,
      lease_ttl_ms: 60_000,
      device_fingerprint256: DEVICE_FP,
    }),
    grant("grant-mic", QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, QUEST_SURFACE_PROVIDER_ID, "session"),
    grant("grant-audio", QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, QUEST_SURFACE_PROVIDER_ID, "session"),
    grant("grant-local", QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, "soma.provider.local-model", "window"),
  ];
}

function grant(id, capability, provider, scope, constraints = { device_fingerprint256: DEVICE_FP }) {
  return {
    id,
    status: "active",
    capability,
    provider,
    scope,
    constraints,
    approved_by: "user",
    reason: "Quest exact binding test.",
    created_at: "2026-08-11T00:00:00.000Z",
  };
}

function provider(grantStore, options = {}) {
  return createQuestSurfaceFixtureProvider({
    tlsOptions: { key: Buffer.from("key"), cert: Buffer.from("cert"), ca: Buffer.from("ca") },
    grantStore: { schema_version: 1, grants: grantStore },
    grantId: "grant-panel",
    grantIds,
    capabilityCatalog: {
      capabilities: [
        { key: QUEST_SURFACE_CAPABILITY },
        { key: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE },
        { key: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT },
        { key: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH },
      ],
    },
    providerRegistry: {
      providers: [
        {
          id: QUEST_SURFACE_PROVIDER_ID,
          capabilities: [
            QUEST_SURFACE_CAPABILITY,
            QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
            QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
          ],
        },
        {
          id: "soma.provider.local-model",
          capabilities: [QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH],
        },
      ],
    },
    panel: { surface_id: "panel.main", revision: "1", ttl_ms: 30_000, text: "HELLO" },
    logger: { info() {}, error() {} },
    ...options,
  });
}

test("exact Quest grant tuple ignores earlier matching grants and returns only pinned IDs", () => {
  const misleading = [
    grant("other-panel", QUEST_SURFACE_CAPABILITY, QUEST_SURFACE_PROVIDER_ID, "session", {
      allowed_surface_ids: ["panel.main"],
      max_panel_text_bytes: 512,
      device_fingerprint256: DEVICE_FP,
    }),
    grant("other-mic", QUEST_SURFACE_CAPABILITY_MIC_CAPTURE, QUEST_SURFACE_PROVIDER_ID, "session"),
    grant("other-audio", QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT, QUEST_SURFACE_PROVIDER_ID, "session"),
    grant("other-local", QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH, "soma.provider.local-model", "window"),
  ];
  const result = provider([...misleading, ...grants()]).validateConfiguredGrantBindings({
    peerFingerprint256: DEVICE_FP,
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.grant_ids, grantIds);
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.grants).map(([leaf, value]) => [leaf, value.id])),
    grantIds,
  );
});

test("every Quest manifest leaf requires the same exact presented device fingerprint", () => {
  for (const [leaf, grantId] of Object.entries(grantIds)) {
    const store = grants().map((entry) => entry.id === grantId
      ? { ...entry, constraints: { ...entry.constraints, device_fingerprint256: OTHER_FP } }
      : entry);
    assert.throws(
      () => provider(store).validateConfiguredGrantBindings({ peerFingerprint256: DEVICE_FP }),
      (error) => error.code === "quest_surface_device_identity_mismatch"
        && error.details.leaf === leaf,
      leaf,
    );
  }
});

test("arming preflight requires a valid fingerprint constraint on every exact leaf", () => {
  for (const [leaf, grantId] of Object.entries(grantIds)) {
    const store = grants().map((entry) => entry.id === grantId
      ? { ...entry, constraints: { ...entry.constraints, device_fingerprint256: "" } }
      : entry);
    assert.throws(
      () => provider(store).validateConfiguredGrantBindings(),
      (error) => error.code === "quest_surface_device_identity_constraint_required"
        && error.details.leaf === leaf,
      leaf,
    );
  }
});

test("arming preflight requires one shared device fingerprint across all four exact leaves", () => {
  const store = grants().map((entry) => entry.id === "grant-audio"
    ? { ...entry, constraints: { ...entry.constraints, device_fingerprint256: OTHER_FP } }
    : entry);
  assert.throws(
    () => provider(store).validateConfiguredGrantBindings(),
    (error) => error.code === "quest_surface_device_identity_configuration_mismatch",
  );
});

test("missing, wrong-provider, and wrong-scope exact grants fail closed", () => {
  const cases = [
    grants().filter((entry) => entry.id !== "grant-mic"),
    grants().map((entry) => entry.id === "grant-local"
      ? { ...entry, provider: QUEST_SURFACE_PROVIDER_ID }
      : entry),
    grants().map((entry) => entry.id === "grant-local"
      ? { ...entry, scope: "once" }
      : entry),
  ];
  for (const store of cases) {
    assert.throws(
      () => provider(store).validateConfiguredGrantBindings({ peerFingerprint256: DEVICE_FP }),
      (error) => error.code === "grant_not_found",
    );
  }
});

test("duplicate configured grant IDs are rejected before provider activation", () => {
  assert.throws(
    () => provider(grants(), {
      grantIds: { ...grantIds, local_attach: "grant-mic" },
    }),
    (error) => error.code === "quest_surface_grant_tuple_duplicate",
  );
});
