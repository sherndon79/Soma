import assert from "node:assert/strict";
import test from "node:test";

import {
  QUEST_SPATIAL_PROFILE_ID,
  QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT,
  QUEST_SURFACE_PROVIDER_ID,
  createQuestSpatialProfileWrapper,
  createQuestSurfaceLease,
  createSpatialSnapshotPayload,
  decodeQuestSpatialHelloProfiles,
  decodeQuestSpatialProfileWrapper,
  decodeSpatialAdmissionReceiptPayload,
  decodeSpatialDisplayReceiptPayload,
  decodeSpatialRollbackReceiptPayload,
  negotiateQuestSpatialProfile,
} from "../src/questSurfaceProtocol.js";
import {
  QuestSpatialAdmissionSession,
  createQuestSpatialDocumentFixture,
  createQuestSpatialFixtureProfile,
  replaceQuestSpatialFixtureResource,
} from "../src/questSurfaceFixtureProvider.js";

const EPOCH = "42";
const LEASE_ID = "lease-spatial-test";
const DOCUMENT_ID = "document.spatial-fixture";
const FINGERPRINT = "AB".repeat(32);
const NOW_MS = 1_000_000;

test("spatial profile negotiation uses the additive HELLO/HELLO_ACK carriers without changing old HELLO", () => {
  const profile = createQuestSpatialFixtureProfile();
  assert.deepEqual(decodeQuestSpatialHelloProfiles({ supported_versions: [1], client: "old-panel" }), []);

  const advertised = decodeQuestSpatialHelloProfiles({
    supported_versions: [1],
    client: "spatial-client",
    spatial_profiles: [profile],
  });
  const negotiated = negotiateQuestSpatialProfile(advertised);
  assert.equal(negotiated.profile.id, QUEST_SPATIAL_PROFILE_ID);
  assert.deepEqual(
    decodeQuestSpatialProfileWrapper(negotiated.spatial_profile).profile,
    profile,
  );
  assert.deepEqual(Object.keys(negotiated.spatial_profile), [
    "profile_encoding",
    "profile_byte_length",
    "profile_sha256",
    "profile_b64",
  ]);
});

test("spatial document lease is a separate exact disabled-first authority surface", () => {
  const profile = createQuestSpatialFixtureProfile();
  const sourceGrant = createSourceGrant(profile);
  const lease = createQuestSurfaceLease({
    sessionEpoch: EPOCH,
    sourceGrant,
    ttlMs: 60_000,
    issuedAtMs: NOW_MS,
    leaseId: LEASE_ID,
  });
  assert.equal(lease.capability, QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT);
  assert.equal(lease.source_grant_id, "grant-spatial-test");
  assert.deepEqual(Object.keys(lease.constraints), [
    "device_fingerprint256",
    "lease_ttl_ms",
    "allowed_document_ids",
    "components",
    "resource_classes",
    "spaces",
  ]);
  assert.throws(
    () => createQuestSurfaceLease({
      sessionEpoch: EPOCH,
      sourceGrant: {
        ...sourceGrant,
        constraints: { ...sourceGrant.constraints, unknown_budget: 1 },
      },
      ttlMs: 60_000,
      issuedAtMs: NOW_MS,
    }),
    (error) => error.code === "lease_constraints_fields_invalid",
  );
  assert.throws(
    () => createQuestSurfaceLease({
      sessionEpoch: EPOCH,
      sourceGrant,
      ttlMs: 60_001,
      issuedAtMs: NOW_MS,
    }),
    (error) => error.code === "lease_ttl_exceeds_grant",
  );
  assert.throws(
    () => new QuestSpatialAdmissionSession({
      sessionEpoch: EPOCH,
      lease,
      profile,
      peerFingerprint256: "",
    }),
    (error) => error.code === "spatial_lease_device_mismatch",
  );
  const differentProfile = createQuestSpatialFixtureProfile({ limits: { draws: profile.limits.draws - 1 } });
  assert.throws(
    () => new QuestSpatialAdmissionSession({
      sessionEpoch: EPOCH,
      lease,
      profile,
      profileWrapper: createQuestSpatialProfileWrapper(differentProfile),
      peerFingerprint256: FINGERPRINT,
    }),
    (error) => error.code === "spatial_profile_wrapper_mismatch",
  );
});

test("deterministic fixture carries text, panel, line, quad, raw RGBA, glyph atlas, and real URI-free GLB", () => {
  const { fixture } = setup();
  assert.equal(fixture.document.entities[0].space, "local");
  assert.ok(fixture.document.presentation.some((record) => record.type === "panel.v1"));
  assert.ok(fixture.document.presentation.some((record) => record.type === "text.v1"));
  assert.ok(fixture.document.presentation.some((record) => record.type === "primitive.line.v1"));
  assert.ok(fixture.document.presentation.some((record) => record.type === "primitive.quad.v1"));
  assert.ok(fixture.document.presentation.some((record) => record.type === "mesh.glb.uri-free.v1"));
  assert.ok(fixture.document.resources.some((resource) => resource.format === "mesh.glb.v1"));
  assert.equal(fixture.golden.document_bytes.length, fixture.snapshot_payload.document_byte_length);
  for (const resource of fixture.golden.resources) {
    assert.equal(resource.bytes.length, resource.descriptor.byte_length);
  }
});

test("snapshot stays pending until its content-addressed resource closure arrives, then admits", () => {
  const { fixture, session } = setup();
  const pending = session.offerSnapshot(fixture.snapshot_payload);
  assert.equal(pending.outcome, "pending");
  assert.equal(pending.missing_resource_sha256s.length, fixture.document.resources.length);
  assert.equal(session.finalize(DOCUMENT_ID).outcome, "pending");

  for (const chunk of fixture.chunks) session.acceptResourceChunk(chunk);
  const ready = session.finalize(DOCUMENT_ID);
  assert.equal(ready.outcome, "ready");
  assert.equal(ready.recomputed_cost.draws, 5);
  assert.equal(ready.recomputed_cost.triangles, 51);
  assert.equal(ready.degradation_ledger.length, 0);
  assert.ok(ready.scene_actual_bounds);
});

test("exact advertised preloads satisfy closure and make matching chunks redundant", () => {
  const baseProfile = createQuestSpatialFixtureProfile();
  const baseFixture = createQuestSpatialDocumentFixture({
    sessionEpoch: EPOCH,
    leaseRef: LEASE_ID,
    documentId: DOCUMENT_ID,
    profile: baseProfile,
    ttlMs: 30_000,
  });
  const baseResource = baseFixture.golden.resources.find(
    (entry) => entry.descriptor.id === "resource.atlas-image",
  );
  const preloadedDescriptor = structuredClone(baseResource.descriptor);
  delete preloadedDescriptor.id;
  delete preloadedDescriptor.required;
  const profile = createQuestSpatialFixtureProfile({ preloadedResources: [preloadedDescriptor] });
  const lease = createLease(profile);
  const fixture = createQuestSpatialDocumentFixture({
    sessionEpoch: EPOCH,
    leaseRef: LEASE_ID,
    documentId: DOCUMENT_ID,
    profile,
    ttlMs: 30_000,
  });
  const preloadedResource = fixture.golden.resources.find(
    (entry) => entry.descriptor.resource_sha256 === preloadedDescriptor.resource_sha256,
  );
  const session = new QuestSpatialAdmissionSession({
    sessionEpoch: EPOCH,
    lease,
    profile,
    profileWrapper: createQuestSpatialProfileWrapper(profile),
    peerFingerprint256: FINGERPRINT,
    now: () => NOW_MS,
    monotonicNowNs: () => 5_000_000_000n,
    preloadedResourceBytes: new Map([[
      preloadedDescriptor.resource_sha256,
      preloadedResource.bytes,
    ]]),
  });
  const pending = session.offerSnapshot(fixture.snapshot_payload);
  assert.equal(pending.missing_resource_sha256s.length, fixture.document.resources.length - 1);
  const redundant = fixture.chunks.find(
    (chunk) => chunk.resource_sha256 === preloadedDescriptor.resource_sha256,
  );
  assertSpatialFailure(() => session.acceptResourceChunk(redundant), "resource_chunk_redundant", 3);
  for (const chunk of fixture.chunks) {
    if (chunk.resource_sha256 !== preloadedDescriptor.resource_sha256) {
      session.acceptResourceChunk(chunk);
    }
  }
  assert.equal(session.finalize(DOCUMENT_ID).outcome, "ready");
});

test("stage 1 rejects a wrong document hash before document parsing", () => {
  const { fixture, session } = setup();
  assertSpatialFailure(
    () => session.offerSnapshot({ ...fixture.snapshot_payload, document_sha256: "0".repeat(64) }),
    "spatial_document_hash_mismatch",
    1,
  );
});

test("stage 2 rejects wrong outer/inner epoch, lease, and selected-profile hash", () => {
  for (const [mutate, outer, code] of [
    [(document) => { document.session_epoch = "43"; }, {}, "spatial_session_epoch_mismatch"],
    [(document) => { document.lease_ref = "lease-other"; }, {}, "spatial_lease_ref_mismatch"],
    [(document) => { document.profile_sha256 = "0".repeat(64); }, {}, "spatial_profile_hash_mismatch"],
    [(document) => document, { sessionEpoch: "43" }, "spatial_session_epoch_mismatch"],
    [(document) => document, { leaseRef: "lease-other" }, "spatial_lease_ref_mismatch"],
  ]) {
    const { fixture, session } = setup();
    const payload = mutate === undefined ? fixture.snapshot_payload : rewriteDocument(fixture, mutate);
    assertSpatialFailure(
      () => session.offerSnapshot(payload, outer),
      code,
      2,
    );
  }
});

test("stage 2 rejects non-topological cycles and hierarchy depth overflow", () => {
  {
    const { fixture, session } = setup();
    const payload = rewriteDocument(fixture, (document) => {
      document.entities[0].parent_id = "entity.mesh";
      delete document.entities[0].space;
    });
    assertSpatialFailure(
      () => session.offerSnapshot(payload),
      "spatial_graph_parent_order_invalid",
      2,
    );
  }
  {
    const profile = createQuestSpatialFixtureProfile({ limits: { hierarchy_depth: 2 } });
    const { fixture, session } = setup({ profile });
    const payload = rewriteDocument(fixture, (document) => {
      document.entities[2].parent_id = "entity.panel";
    });
    assertSpatialFailure(
      () => session.offerSnapshot(payload),
      "spatial_graph_depth_exceeded",
      2,
    );
  }
});

test("resource assembly rejects unsolicited, duplicate, and metadata-changing chunks", () => {
  const { fixture, session } = setup();
  assertSpatialFailure(
    () => session.acceptResourceChunk(fixture.chunks[0]),
    "resource_chunk_unsolicited",
    3,
  );
  session.offerSnapshot(fixture.snapshot_payload);
  session.acceptResourceChunk(fixture.chunks[0]);
  assertSpatialFailure(
    () => session.acceptResourceChunk(fixture.chunks[0]),
    "resource_chunk_redundant",
    3,
  );

  const next = fixture.chunks[1];
  assertSpatialFailure(
    () => session.acceptResourceChunk({ ...next, kind: "mesh" }),
    "resource_chunk_descriptor_mismatch",
    3,
  );
});

test("stage 4 rejects URI, extension, NaN, and out-of-range index hostile GLBs", () => {
  for (const [mutation, expectedCode] of [
    ["uri", "spatial_glb_buffer_invalid"],
    ["extension", "spatial_glb_fields_invalid"],
    ["nan", "spatial_glb_float_invalid"],
    ["bad_index", "spatial_glb_index_out_of_range"],
  ]) {
    const base = setup();
    const fixture = replaceQuestSpatialFixtureResource(
      base.fixture,
      "resource.mesh",
      base.fixture.hostile_glb_bytes[mutation],
    );
    const session = createSession(base.profile, base.lease);
    session.offerSnapshot(fixture.snapshot_payload);
    for (const chunk of fixture.chunks) session.acceptResourceChunk(chunk);
    assertSpatialFailure(
      () => session.finalize(DOCUMENT_ID),
      expectedCode,
      4,
    );
  }
});

test("stage 2 catches checked metadata overflow and stage 5 catches escaping geometry bounds", () => {
  {
    const { fixture, session } = setup();
    const payload = rewriteDocument(fixture, (document) => {
      const image = document.resources.find((resource) => resource.id === "resource.quad-image");
      image.metadata.width_px = Number.MAX_SAFE_INTEGER;
      image.metadata.row_bytes = Number.MAX_SAFE_INTEGER;
    });
    assertSpatialFailure(
      () => session.offerSnapshot(payload),
      "spatial_resource_overflow",
      2,
    );
  }
  {
    const { fixture, session } = setup();
    const payload = rewriteDocument(fixture, (document) => {
      const mesh = document.entities.find((entity) => entity.id === "entity.mesh");
      mesh.declared_local_bounds = { min_m: [-0.01, -0.01, 0], max_m: [0.01, 0.01, 0] };
    });
    session.offerSnapshot(payload);
    for (const chunk of fixture.chunks) session.acceptResourceChunk(chunk);
    assertSpatialFailure(
      () => session.finalize(DOCUMENT_ID),
      "spatial_geometry_escapes_declared_bounds",
      5,
    );
  }
});

test("stage 6 applies only the authored optional omission in stable budget order", () => {
  const { fixture, session } = setup({ hardLimits: { draws: 4 } });
  session.offerSnapshot(fixture.snapshot_payload);
  for (const chunk of fixture.chunks) session.acceptResourceChunk(chunk);
  const ready = session.finalize(DOCUMENT_ID);
  assert.equal(ready.outcome, "degraded_ready");
  assert.equal(ready.recomputed_cost.draws, 4);
  assert.deepEqual(ready.degradation_ledger, [{
    entity_id: "entity.quad",
    from_presentation_id: "presentation.quad",
    to_presentation_id: null,
    reason: "static_budget",
  }]);
});

test("newer candidate cancels the older offer and same offer is idempotent", () => {
  const { fixture, session } = setup();
  const first = session.offerSnapshot(fixture.snapshot_payload);
  const duplicate = session.offerSnapshot(fixture.snapshot_payload);
  assert.equal(duplicate.outcome, "idempotent");
  assert.equal(duplicate.document_sha256, first.document_sha256);

  const secondPayload = rewriteDocument(fixture, (document) => {
    document.revision = "2";
  });
  const second = session.offerSnapshot(secondPayload);
  assert.equal(second.outcome, "pending");
  assert.equal(second.cancelled_previous.document_revision, "1");
  assert.equal(second.cancelled_previous.reason, "newer_snapshot");

  assertSpatialFailure(
    () => session.offerSnapshot(fixture.snapshot_payload),
    "spatial_revision_stale",
    2,
  );
  const conflictingSecond = rewriteDocument(fixture, (document) => {
    document.revision = "2";
    document.entities.find((entity) => entity.id === "entity.panel").visibility = false;
  });
  assertSpatialFailure(
    () => session.offerSnapshot(conflictingSecond),
    "spatial_revision_hash_conflict",
    2,
  );
});

test("candidate deadline is the earliest preparation/document/lease boundary", () => {
  const profile = createQuestSpatialFixtureProfile();
  const lease = createLease(profile);
  const fixture = createQuestSpatialDocumentFixture({
    sessionEpoch: EPOCH,
    leaseRef: LEASE_ID,
    documentId: DOCUMENT_ID,
    profile,
    ttlMs: 30_000,
  });
  let monotonic = 5_000_000_000n;
  const session = new QuestSpatialAdmissionSession({
    sessionEpoch: EPOCH,
    lease,
    profile,
    profileWrapper: createQuestSpatialProfileWrapper(profile),
    peerFingerprint256: FINGERPRINT,
    now: () => NOW_MS,
    monotonicNowNs: () => monotonic,
    preparationTimeoutMs: 5_000,
  });
  const pending = session.offerSnapshot(fixture.snapshot_payload);
  monotonic = BigInt(pending.preparation_deadline_ns);
  assertSpatialFailure(
    () => session.finalize(DOCUMENT_ID),
    "spatial_preparation_deadline_expired",
    3,
  );
});

test("committed revision is idempotent by hash and rejects stale/conflicting revisions", () => {
  const { fixture, session } = setup();
  const ready = admitFixture(session, fixture);
  const admission = committedReceipt(ready, "7");
  session.recordReceipt("SPATIAL_ADMISSION_RECEIPT", admission);

  assert.equal(session.offerSnapshot(fixture.snapshot_payload).outcome, "idempotent");
  const stale = rewriteDocument(fixture, (document) => { document.revision = "0"; });
  assertSpatialFailure(() => session.offerSnapshot(stale), "spatial_revision_stale", 2);
  const conflict = rewriteDocument(fixture, (document) => {
    document.presentation.find((record) => record.id === "material.panel").base_color_rgba_linear[0] = 0.05;
  });
  assertSpatialFailure(() => session.offerSnapshot(conflict), "spatial_revision_hash_conflict", 2);
});

test("semantic receipts are exact, body-free, identity-bound, and distinct", () => {
  const { fixture, session } = setup();
  const ready = admitFixture(session, fixture);
  const pending = {
    ...commonIdentity(ready),
    outcome: "pending",
    missing_resource_sha256s: fixture.document.resources
      .map((resource) => resource.resource_sha256)
      .sort(),
    preparation_deadline_ns: "987654321",
  };
  assert.deepEqual(session.recordReceipt("SPATIAL_ADMISSION_RECEIPT", pending), pending);
  const admission = committedReceipt(ready, "7");
  assert.deepEqual(session.recordReceipt("SPATIAL_ADMISSION_RECEIPT", admission), admission);

  const display = {
    ...commonIdentity(ready),
    generation: "7",
    displayed: true,
    scene_actual_bounds: ready.scene_actual_bounds,
    entity_actual_bounds: ready.entity_actual_bounds,
    degradation_ledger: ready.degradation_ledger,
  };
  session.offerSnapshot(rewriteDocument(fixture, (document) => { document.revision = "2"; }));
  assert.deepEqual(session.recordReceipt("SPATIAL_DISPLAY_RECEIPT", display), display);
  assert.deepEqual(decodeSpatialDisplayReceiptPayload(display), display);

  const rollback = {
    ...commonIdentity(ready),
    failed_generation: "7",
    restored_generation: null,
    restored_target: "local_shell",
    reason: "first_frame_failed",
  };
  assert.deepEqual(session.recordReceipt("SPATIAL_ROLLBACK_RECEIPT", rollback), rollback);
  assert.deepEqual(decodeSpatialRollbackReceiptPayload(rollback), rollback);

  assert.throws(
    () => decodeSpatialAdmissionReceiptPayload({ ...admission, text: "must not persist" }),
    (error) => error.code === "spatial_admission_receipt_fields_invalid",
  );
  assert.throws(
    () => decodeSpatialDisplayReceiptPayload({ ...display, mesh_bytes: "forbidden" }),
    (error) => error.code === "spatial_display_receipt_fields_invalid",
  );
  assert.throws(
    () => decodeSpatialRollbackReceiptPayload({ ...rollback, reason: "lease_expired" }),
    (error) => error.code === "spatial_rollback_reason_invalid",
  );
});

test("rejection cancels its candidate and content-addressed cache survives document-local id changes", () => {
  {
    const { fixture, session } = setup();
    const pending = session.offerSnapshot(fixture.snapshot_payload);
    const rejected = {
      ...commonIdentity(pending),
      outcome: "rejected",
      failed_stage: 4,
      reason: "spatial_glb_invalid",
    };
    assert.deepEqual(session.recordReceipt("SPATIAL_ADMISSION_RECEIPT", rejected), rejected);
    assertSpatialFailure(() => session.finalize(DOCUMENT_ID), "spatial_candidate_missing", 3);
  }

  {
    const { fixture, session } = setup();
    const ready = admitFixture(session, fixture);
    session.recordReceipt("SPATIAL_ADMISSION_RECEIPT", committedReceipt(ready, "1"));
    const aliased = rewriteDocument(fixture, (document) => {
      document.revision = "2";
      document.resources.find((resource) => resource.id === "resource.text").id = "resource.text.aliased";
      document.presentation.find((record) => record.id === "presentation.text").text_resource_ref = "resource.text.aliased";
    });
    session.offerSnapshot(aliased);
    assert.equal(session.finalize(DOCUMENT_ID).outcome, "ready");
  }
});

test("session close cancels preparation and clears the same-session resource cache", () => {
  const { fixture, session } = setup();
  session.offerSnapshot(fixture.snapshot_payload);
  session.acceptResourceChunk(fixture.chunks[0]);
  session.close();
  assertSpatialFailure(
    () => session.finalize(DOCUMENT_ID),
    "spatial_session_closed",
    undefined,
  );
});

function setup({ profile = createQuestSpatialFixtureProfile(), hardLimits = {} } = {}) {
  const lease = createLease(profile);
  const fixture = createQuestSpatialDocumentFixture({
    sessionEpoch: EPOCH,
    leaseRef: LEASE_ID,
    documentId: DOCUMENT_ID,
    profile,
    ttlMs: 30_000,
  });
  return {
    profile,
    lease,
    fixture,
    session: createSession(profile, lease, hardLimits),
  };
}

function createSourceGrant(profile) {
  return {
    id: "grant-spatial-test",
    capability: QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT,
    provider: QUEST_SURFACE_PROVIDER_ID,
    scope: "session",
    constraints: {
      device_fingerprint256: FINGERPRINT,
      lease_ttl_ms: 60_000,
      allowed_document_ids: [DOCUMENT_ID],
      components: [...profile.components],
      resource_classes: ["text", "image", "glyph", "mesh"],
      spaces: ["local", "view"],
    },
  };
}

function createLease(profile) {
  return createQuestSurfaceLease({
    sessionEpoch: EPOCH,
    sourceGrant: createSourceGrant(profile),
    ttlMs: 60_000,
    issuedAtMs: NOW_MS,
    leaseId: LEASE_ID,
  });
}

function createSession(profile, lease, hardLimits = {}) {
  return new QuestSpatialAdmissionSession({
    sessionEpoch: EPOCH,
    lease,
    profile,
    profileWrapper: createQuestSpatialProfileWrapper(profile),
    peerFingerprint256: FINGERPRINT,
    now: () => NOW_MS,
    monotonicNowNs: () => 5_000_000_000n,
    preparationTimeoutMs: 5_000,
    hardLimits,
  });
}

function rewriteDocument(fixture, mutate) {
  const document = structuredClone(fixture.document);
  mutate(document);
  return createSpatialSnapshotPayload({ document });
}

function admitFixture(session, fixture) {
  session.offerSnapshot(fixture.snapshot_payload);
  for (const chunk of fixture.chunks) session.acceptResourceChunk(chunk);
  return session.finalize(DOCUMENT_ID);
}

function commonIdentity(value) {
  return {
    schema_version: 1,
    session_epoch: value.session_epoch,
    lease_ref: value.lease_ref,
    document_id: value.document_id,
    document_revision: value.document_revision,
    document_sha256: value.document_sha256,
    profile_id: value.profile_id,
    profile_sha256: value.profile_sha256,
  };
}

function committedReceipt(ready, generation) {
  return {
    ...commonIdentity(ready),
    outcome: ready.outcome === "ready" ? "committed" : "degraded_committed",
    generation,
    recomputed_cost: ready.recomputed_cost,
    scene_actual_bounds: ready.scene_actual_bounds,
    entity_actual_bounds: ready.entity_actual_bounds,
    degradation_ledger: ready.degradation_ledger,
  };
}

function assertSpatialFailure(fn, code, failedStage) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    if (failedStage !== undefined) assert.equal(error.failed_stage, failedStage);
    return true;
  });
}
