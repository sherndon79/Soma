import tls from "node:tls";
import { randomUUID } from "node:crypto";

import { authorizeGrantUse } from "./grantAuthorization.js";
import {
  BoundedLineDecoder,
  QUEST_SURFACE_AUDIO_FRAME_TYPES,
  QUEST_SURFACE_CAPABILITY,
  QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT,
  QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
  QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
  QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
  QUEST_SURFACE_MAX_LEASE_TTL_MS,
  QUEST_SURFACE_MAX_PANEL_TEXT_BYTES,
  QUEST_SURFACE_PROTOCOL_VERSION,
  QUEST_SURFACE_PROVIDER_ID,
  QUEST_SPATIAL_COMPONENTS,
  QUEST_SPATIAL_PROFILE_ID,
  QUEST_SPATIAL_RESOURCE_CHUNK_BYTES,
  QUEST_SPATIAL_RESOURCE_FORMATS,
  QuestSurfaceProtocolError,
  createAudioChunkPayload,
  createLeaseManifestPayload,
  createLeaseRenewalPayload,
  createPanelSnapshotPayload,
  createQuestSpatialProfileWrapper,
  createResourceChunkPayload,
  createSpatialSnapshotPayload,
  createAnswerEndPayload,
  createQuestSurfaceFrame,
  createQuestSurfaceLease,
  decodeAudioChunkPayload,
  decodeCancelPayload,
  decodeHelloResumeIntent,
  decodeLeaseRenewalAckPayload,
  decodePanelSnapshotPayload,
  decodeQuestSpatialHelloProfiles,
  decodeQuestSpatialProfileWrapper,
  decodeResourceChunkPayload,
  decodeSpatialAdmissionReceiptPayload,
  decodeSpatialDisplayReceiptPayload,
  decodeSpatialRollbackReceiptPayload,
  decodeSpatialSnapshotPayload,
  decodeUtteranceEndPayload,
  decodeUtteranceStartPayload,
  monotonicNowNs,
  parseQuestSurfaceFrame,
  randomSessionEpoch,
  selectHighestQuestSurfaceVersion,
  serializeQuestSurfaceFrame,
  sha256,
  validateQuestSpatialDocument,
  validateQuestSpatialProfile,
} from "./questSurfaceProtocol.js";
import { createQuestSurfaceAudioPipeline } from "./questSurfaceAudioPipeline.js";
import { QuestSurfaceMicLatch } from "./questSurfaceMicLatch.js";
import { matchAnswerProvider } from "./questSurfaceModeMatrix.js";
import {
  QUEST_SURFACE_DEFAULT_EPISODE_TTL_MS,
  QUEST_SURFACE_MIN_EPISODE_TTL_MS,
  QUEST_SURFACE_MAX_EPISODE_TTL_MS,
} from "./questSurfaceControl.js";

const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_PANEL = Object.freeze({
  surface_id: "panel.main",
  text: "SOMA QUEST PANEL SESSION",
  revision: "1",
  ttl_ms: 30_000,
  pose: {
    position: { x: 0, y: 0, z: -1.5 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  },
  bounds: { width_m: 0.9, height_m: 0.5 },
});

const QUEST_SURFACE_GRANT_DEFINITIONS = Object.freeze({
  panel: Object.freeze({
    capability: QUEST_SURFACE_CAPABILITY,
    provider: QUEST_SURFACE_PROVIDER_ID,
    scope: "session",
  }),
  mic_capture: Object.freeze({
    capability: QUEST_SURFACE_CAPABILITY_MIC_CAPTURE,
    provider: QUEST_SURFACE_PROVIDER_ID,
    scope: "session",
  }),
  audio_present: Object.freeze({
    capability: QUEST_SURFACE_CAPABILITY_AUDIO_PRESENT,
    provider: QUEST_SURFACE_PROVIDER_ID,
    scope: "session",
  }),
  local_attach: Object.freeze({
    capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
    provider: "soma.provider.local-model",
    scope: "configured",
  }),
});
const QUEST_SPATIAL_RECEIPT_TYPES = new Set([
  "SPATIAL_ADMISSION_RECEIPT",
  "SPATIAL_DISPLAY_RECEIPT",
  "SPATIAL_ROLLBACK_RECEIPT",
]);

const QUEST_SPATIAL_FIXTURE_LIMITS = Object.freeze({
  document_bytes: 32 * 1024,
  resource_ingress_bytes: 1024 * 1024,
  resident_bytes: 2 * 1024 * 1024,
  entities: 32,
  hierarchy_depth: 8,
  resources: 16,
  presentation_records: 32,
  semantics_records: 32,
  draws: 16,
  vertices: 4096,
  triangles: 4096,
  line_segments: 256,
  line_points: 257,
  text_bytes: 8 * 1024,
  text_codepoints: 2048,
  text_lines: 32,
  glyphs: 256,
  texture_dimension: 512,
  texture_pixels: 512 * 512,
});

export function createQuestSpatialFixtureProfile({ limits = {}, preloadedResources = [] } = {}) {
  return validateQuestSpatialProfile({
    id: QUEST_SPATIAL_PROFILE_ID,
    schema_version: 1,
    components: [...QUEST_SPATIAL_COMPONENTS],
    resource_formats: [...QUEST_SPATIAL_RESOURCE_FORMATS],
    preloaded_resources: preloadedResources,
    limits: { ...QUEST_SPATIAL_FIXTURE_LIMITS, ...limits },
  });
}

export function createQuestSpatialDocumentFixture({
  sessionEpoch = "1",
  leaseRef = "lease-spatial-document",
  documentId = "document.spatial-fixture",
  revision = "1",
  ttlMs = 30_000,
  profile = createQuestSpatialFixtureProfile(),
} = {}) {
  const selectedProfile = validateQuestSpatialProfile(profile);
  const profileWrapper = createQuestSpatialProfileWrapper(selectedProfile);
  const textBytes = Buffer.from("SOMA SPATIAL DOCUMENT", "utf8");
  const quadImageBytes = Buffer.from([
    0xff, 0x40, 0x40, 0xff, 0x40, 0xff, 0x40, 0xff,
    0x40, 0x40, 0xff, 0xff, 0xff, 0xd0, 0x40, 0xff,
  ]);
  const atlasImageBytes = createFixtureAtlasImageBytes();
  const atlasImageDigest = sha256(atlasImageBytes);
  const glyphBytes = createFixtureGlyphAtlasBytes(textBytes.toString("utf8"), atlasImageDigest);
  const meshBytes = createFixtureTriangleGlb();
  const resources = [
    spatialResource("resource.text", "text", "text.utf8.v1", textBytes, true, {}),
    spatialResource("resource.quad-image", "image", "image.rgba8.v1", quadImageBytes, false, {
      width_px: 2,
      height_px: 2,
      row_bytes: 8,
    }),
    spatialResource("resource.atlas-image", "image", "image.rgba8.v1", atlasImageBytes, true, {
      width_px: 8,
      height_px: 8,
      row_bytes: 32,
    }),
    spatialResource("resource.glyph", "glyph", "glyph-atlas.v1", glyphBytes, true, {}),
    spatialResource("resource.mesh", "mesh", "mesh.glb.v1", meshBytes, true, {}),
  ];
  const presentation = [
    { id: "material.panel", type: "material.solid.v1", base_color_rgba_linear: [0.04, 0.06, 0.10, 1] },
    { id: "material.text", type: "material.solid.v1", base_color_rgba_linear: [0.95, 0.97, 1, 1] },
    { id: "material.line", type: "material.solid.v1", base_color_rgba_linear: [0.2, 0.8, 1, 1] },
    { id: "material.quad", type: "material.solid.v1", base_color_rgba_linear: [1, 1, 1, 1] },
    { id: "material.mesh", type: "material.unlit.v1", base_color_rgba_linear: [0.9, 0.9, 0.9, 1] },
    {
      id: "presentation.panel",
      type: "panel.v1",
      width_m: 0.9,
      height_m: 0.5,
      corner_radius_m: 0.04,
      background_material_ref: "material.panel",
      border_material_ref: null,
    },
    {
      id: "presentation.text",
      type: "text.v1",
      text_resource_ref: "resource.text",
      glyph_resource_ref: "resource.glyph",
      material_ref: "material.text",
      font_size_m: 0.04,
      max_width_m: 0.72,
      horizontal_alignment: "center",
      max_lines: 1,
    },
    {
      id: "presentation.line",
      type: "primitive.line.v1",
      points_m: [[-0.30, 0, 0], [0, 0.05, 0], [0.30, 0, 0]],
      width_m: 0.012,
      join: "bevel",
      material_ref: "material.line",
    },
    {
      id: "presentation.quad",
      type: "primitive.quad.v1",
      width_m: 0.18,
      height_m: 0.18,
      material_ref: "material.quad",
      image_resource_ref: "resource.quad-image",
    },
    {
      id: "presentation.mesh",
      type: "mesh.glb.uri-free.v1",
      mesh_resource_ref: "resource.mesh",
      material_ref: "material.mesh",
    },
  ];
  const identityTransform = (translation = [0, 0, 0]) => ({
    translation_m: translation,
    rotation_xyzw: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  const entities = [
    {
      id: "entity.root",
      parent_id: null,
      space: "local",
      local_transform: identityTransform([0, 0, -1.5]),
      declared_local_bounds: { min_m: [-0.70, -0.42, -0.02], max_m: [0.70, 0.35, 0.02] },
      visibility: true,
      presentation_ids: [],
    },
    {
      id: "entity.panel",
      parent_id: "entity.root",
      local_transform: identityTransform(),
      declared_local_bounds: { min_m: [-0.45, -0.25, 0], max_m: [0.45, 0.25, 0] },
      visibility: true,
      presentation_ids: ["presentation.panel"],
    },
    {
      id: "entity.text",
      parent_id: "entity.root",
      local_transform: identityTransform([0, 0.05, 0.002]),
      declared_local_bounds: { min_m: [-0.36, -0.03, 0], max_m: [0.36, 0.03, 0] },
      visibility: true,
      presentation_ids: ["presentation.text"],
    },
    {
      id: "entity.line",
      parent_id: "entity.root",
      local_transform: identityTransform([0, -0.34, 0.002]),
      declared_local_bounds: { min_m: [-0.31, -0.01, -0.01], max_m: [0.31, 0.06, 0.01] },
      visibility: true,
      presentation_ids: ["presentation.line"],
    },
    {
      id: "entity.quad",
      parent_id: "entity.root",
      local_transform: identityTransform([-0.57, 0.05, 0.002]),
      declared_local_bounds: { min_m: [-0.09, -0.09, 0], max_m: [0.09, 0.09, 0] },
      visibility: true,
      presentation_ids: ["presentation.quad"],
    },
    {
      id: "entity.mesh",
      parent_id: "entity.root",
      local_transform: identityTransform([0.57, 0.05, 0.002]),
      declared_local_bounds: { min_m: [-0.10, -0.10, 0], max_m: [0.10, 0.10, 0] },
      visibility: true,
      presentation_ids: ["presentation.mesh"],
    },
  ];
  const semantics = [
    spatialSemantics("semantics.panel", "entity.panel", true, 100, "Spatial panel"),
    spatialSemantics("semantics.text", "entity.text", true, 100, "Soma spatial document title"),
    spatialSemantics("semantics.line", "entity.line", true, 100, "Decorative cyan line"),
    spatialSemantics("semantics.quad", "entity.quad", false, 0, "Optional color quad"),
    spatialSemantics("semantics.mesh", "entity.mesh", true, 100, "Colored geometry triangle"),
  ];
  const resourceBytes = new Map([
    ["resource.text", textBytes],
    ["resource.quad-image", quadImageBytes],
    ["resource.atlas-image", atlasImageBytes],
    ["resource.glyph", glyphBytes],
    ["resource.mesh", meshBytes],
  ]);
  const document = {
    schema: "soma.spatial-document.snapshot",
    schema_version: 1,
    profile_id: selectedProfile.id,
    profile_sha256: profileWrapper.profile_sha256,
    document_id: documentId,
    revision,
    session_epoch: sessionEpoch,
    lease_ref: leaseRef,
    ttl_ms: ttlMs,
    required_components: QUEST_SPATIAL_COMPONENTS.filter((component) => component !== "primitive.quad.v1"),
    optional_components: ["primitive.quad.v1"],
    declared_cost: {
      resource_bytes: 0,
      resident_bytes: 0,
      draws: 0,
      vertices: 0,
      triangles: 0,
      line_segments: 0,
      texture_pixels: 0,
    },
    entities,
    resources,
    presentation,
    dynamics: [],
    semantics,
  };
  const normalized = validateQuestSpatialDocument(document, { profile: selectedProfile });
  const measured = measureSpatialDocument(normalized, resourceBytes, {
    degradationChoices: new Map(),
    limits: selectedProfile.limits,
  });
  document.declared_cost = measured.recomputed_cost;
  const snapshotPayload = createSpatialSnapshotPayload({ document });
  const chunks = resources.flatMap((resource) => createQuestSpatialResourceChunks(
    resource,
    resourceBytes.get(resource.id),
  ));
  return {
    profile: selectedProfile,
    profile_wrapper: profileWrapper,
    document,
    snapshot_payload: snapshotPayload,
    chunks,
    golden: {
      document_bytes: Buffer.from(snapshotPayload.document_b64, "base64"),
      resources: resources.map((resource) => ({
        descriptor: structuredClone(resource),
        bytes: Buffer.from(resourceBytes.get(resource.id)),
      })),
    },
    hostile_glb_bytes: {
      uri: createFixtureTriangleGlb({ uri: "https://example.invalid/mesh.bin" }),
      extension: createFixtureTriangleGlb({ extension: true }),
      nan: createFixtureTriangleGlb({ nanPosition: true }),
      bad_index: createFixtureTriangleGlb({ badIndex: true }),
    },
  };
}

export function createQuestSpatialResourceChunks(resource, bytes) {
  const chunkCount = Math.ceil(resource.byte_length / QUEST_SPATIAL_RESOURCE_CHUNK_BYTES);
  return Array.from({ length: chunkCount }, (_, chunkIndex) => createResourceChunkPayload({
    resource,
    bytes,
    chunkIndex,
  }));
}

export function replaceQuestSpatialFixtureResource(fixture, resourceId, replacementBytes) {
  const bytes = Buffer.from(replacementBytes);
  const document = structuredClone(fixture.document);
  const descriptor = document.resources.find((resource) => resource.id === resourceId);
  if (!descriptor) throw providerError("spatial_fixture_resource_missing", "Fixture resource id is unknown.");
  descriptor.byte_length = bytes.length;
  descriptor.resource_sha256 = sha256(bytes);
  if (descriptor.kind === "image") {
    descriptor.metadata.row_bytes = descriptor.metadata.width_px * 4;
    descriptor.byte_length = descriptor.metadata.row_bytes * descriptor.metadata.height_px;
    if (descriptor.byte_length !== bytes.length) {
      throw providerError("spatial_fixture_image_length_invalid", "Replacement image length is inconsistent.");
    }
  }
  document.declared_cost.resource_bytes = document.resources.reduce((sum, resource) => sum + resource.byte_length, 0);
  document.declared_cost.resident_bytes = Math.max(
    document.declared_cost.resident_bytes,
    document.declared_cost.resource_bytes,
  );
  const resources = fixture.golden.resources.map((entry) => (
    entry.descriptor.id === resourceId
      ? { descriptor: structuredClone(descriptor), bytes }
      : { descriptor: structuredClone(document.resources.find((resource) => resource.id === entry.descriptor.id)), bytes: Buffer.from(entry.bytes) }
  ));
  const snapshotPayload = createSpatialSnapshotPayload({ document });
  return {
    ...fixture,
    document,
    snapshot_payload: snapshotPayload,
    chunks: resources.flatMap((entry) => createQuestSpatialResourceChunks(entry.descriptor, entry.bytes)),
    golden: {
      document_bytes: Buffer.from(snapshotPayload.document_b64, "base64"),
      resources,
    },
  };
}

export class QuestSpatialAdmissionSession {
  constructor({
    sessionEpoch,
    lease,
    profile,
    profileWrapper = null,
    peerFingerprint256 = "",
    now = () => Date.now(),
    monotonicNowNs: monotonicClock = () => BigInt(monotonicNowNs()),
    preparationTimeoutMs = 5_000,
    hardLimits = {},
    preloadedResourceBytes = new Map(),
  } = {}) {
    this.sessionEpoch = String(sessionEpoch ?? "");
    this.lease = validateSpatialDocumentLease(lease, {
      sessionEpoch: this.sessionEpoch,
      peerFingerprint256,
    });
    this.profile = validateQuestSpatialProfile(profile);
    this.profileWrapper = profileWrapper ?? createQuestSpatialProfileWrapper(this.profile);
    const decodedProfileWrapper = decodeQuestSpatialProfileWrapper(this.profileWrapper);
    if (!deepEqualJson(decodedProfileWrapper.profile, this.profile)) {
      throw spatialError("spatial_profile_wrapper_mismatch", "Selected profile wrapper does not encode the configured profile.");
    }
    this.profileHash = decodedProfileWrapper.profile_hash;
    this.now = now;
    this.monotonicNowNs = monotonicClock;
    this.preparationTimeoutMs = boundedProviderInteger(preparationTimeoutMs, 1, 60_000, "spatial_preparation_timeout_invalid");
    const hardLimitFields = new Set([
      "resource_bytes", "resident_bytes", "draws", "vertices", "triangles", "line_segments", "texture_pixels",
    ]);
    if (Object.keys(hardLimits).some((key) => !hardLimitFields.has(key))) {
      throw providerError("spatial_hard_limit_field_invalid", "Spatial hard limits contain an unknown field.");
    }
    this.hardLimits = Object.fromEntries(Object.entries(hardLimits).map(([key, value]) => [
      key,
      boundedProviderInteger(value, 0, Number.MAX_SAFE_INTEGER, "spatial_hard_limit_invalid"),
    ]));
    this.cache = new Map();
    if (!(preloadedResourceBytes instanceof Map)) {
      throw providerError("spatial_preloaded_bytes_invalid", "Spatial preloaded resource bytes must be a Map.");
    }
    const preloadedByDigest = new Map(
      this.profile.preloaded_resources.map((resource) => [resource.resource_sha256, resource]),
    );
    for (const [digest, value] of preloadedResourceBytes) {
      const descriptor = preloadedByDigest.get(digest);
      const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value ?? []);
      if (!descriptor || bytes.length !== descriptor.byte_length || sha256(bytes) !== digest) {
        throw spatialError("spatial_preloaded_resource_mismatch", "Preloaded bytes do not match the selected profile.");
      }
      this.cache.set(digest, { descriptor: structuredClone(descriptor), bytes, ingress_counted: false });
    }
    this.candidates = new Map();
    this.assemblies = new Map();
    this.committed = new Map();
    this.lastAdmissions = new Map();
    this.closed = false;
  }

  offerSnapshot(payload, { sessionEpoch = this.sessionEpoch, leaseRef = this.lease.lease_id } = {}) {
    this.#requireOpen();
    let decoded;
    try {
      decoded = decodeSpatialSnapshotPayload(payload);
      if (decoded.document_bytes.length > this.profile.limits.document_bytes) {
        throw spatialError("spatial_document_profile_limit", "Spatial document exceeds the selected profile.");
      }
    } catch (error) {
      throw markSpatialStage(error, 1);
    }
    let document;
    let offeredAtMs;
    try {
      document = validateQuestSpatialDocument(decoded.document, { profile: this.profile });
      offeredAtMs = this.now();
      validateSpatialAuthority({
        document,
        lease: this.lease,
        profileHash: this.profileHash,
        frameSessionEpoch: String(sessionEpoch),
        frameLeaseRef: String(leaseRef),
        nowMs: offeredAtMs,
      });
      const ingressBytes = checkedProviderSum(
        document.resources
          .filter((resource) => !this.#cachedResourceMatches(resource))
          .map((resource) => resource.byte_length),
        "spatial_resource_ingress_overflow",
      );
      if (ingressBytes > this.profile.limits.resource_ingress_bytes) {
        throw spatialError("spatial_resource_ingress_limit", "Spatial resource ingress exceeds the selected profile.");
      }
    } catch (error) {
      throw markSpatialStage(error, 2);
    }
    const prior = this.committed.get(document.document_id);
    if (prior) {
      const revision = BigInt(document.revision);
      const priorRevision = BigInt(prior.document_revision);
      if (revision < priorRevision) {
        throw markSpatialStage(spatialError("spatial_revision_stale", "Spatial document revision is stale."), 2);
      }
      if (revision === priorRevision) {
        if (decoded.document_hash !== prior.document_sha256) {
          throw markSpatialStage(spatialError("spatial_revision_hash_conflict", "Spatial document revision hash conflicts."), 2);
        }
        return { outcome: "idempotent", identity: { ...prior } };
      }
    }
    const replaced = this.candidates.get(document.document_id);
    if (replaced) {
      const revision = BigInt(document.revision);
      const replacedRevision = BigInt(replaced.document.revision);
      if (revision < replacedRevision) {
        throw markSpatialStage(spatialError("spatial_revision_stale", "Spatial document revision is stale."), 2);
      }
      if (revision === replacedRevision) {
        if (replaced.identity.document_sha256 !== decoded.document_hash) {
          throw markSpatialStage(spatialError("spatial_revision_hash_conflict", "Spatial document revision hash conflicts."), 2);
        }
        return this.#candidateStatus(replaced, "idempotent");
      }
    }
    const cancelledPrevious = replaced ? { ...replaced.identity, reason: "newer_snapshot" } : null;
    if (replaced) this.#cancelCandidate(replaced, "newer_snapshot");
    const descriptorByDigest = new Map();
    for (const resource of document.resources) {
      const existing = descriptorByDigest.get(resource.resource_sha256);
      if (existing && !sameResourceContent(existing, resource)) {
        throw markSpatialStage(spatialError("spatial_resource_digest_conflict", "One digest has conflicting descriptors."), 2);
      }
      descriptorByDigest.set(resource.resource_sha256, resource);
    }
    const candidateLifetimeMs = Math.min(
      this.preparationTimeoutMs,
      document.ttl_ms,
      this.lease.expires_at_ms - offeredAtMs,
    );
    const candidate = {
      document,
      identity: spatialIdentity(document, decoded.document_hash),
      descriptorByDigest,
      documentExpiresAtMs: offeredAtMs + document.ttl_ms,
      deadlineNs: (BigInt(this.monotonicNowNs()) + BigInt(candidateLifetimeMs) * 1_000_000n).toString(10),
      cancelled: false,
      cancellation_reason: "",
      cancelled_previous: cancelledPrevious,
      ready: null,
    };
    this.candidates.set(document.document_id, candidate);
    return this.#candidateStatus(candidate, "pending");
  }

  acceptResourceChunk(payload) {
    this.#requireOpen();
    let chunk;
    try {
      chunk = decodeResourceChunkPayload(payload, {
        maxResourceBytes: this.profile.limits.resource_ingress_bytes,
      });
    } catch (error) {
      throw markSpatialStage(error, 3);
    }
    const matchingCandidates = [...this.candidates.values()].filter((candidate) => (
      !candidate.cancelled && candidate.descriptorByDigest.has(chunk.resource_sha256)
    ));
    if (matchingCandidates.length === 0) {
      throw markSpatialStage(spatialError("resource_chunk_unsolicited", "Resource chunk is not declared by an active candidate."), 3);
    }
    const descriptors = matchingCandidates.map((candidate) => (
      candidate.descriptorByDigest.get(chunk.resource_sha256)
    ));
    const descriptor = descriptors[0];
    if (descriptors.some((candidateDescriptor) => !sameResourceContent(descriptor, candidateDescriptor))) {
      throw markSpatialStage(spatialError("spatial_resource_digest_conflict", "Active candidates disagree about one resource digest."), 3);
    }
    const cached = this.cache.get(chunk.resource_sha256);
    if (cached && sameResourceContent(cached.descriptor, descriptor)) {
      throw markSpatialStage(spatialError("resource_chunk_redundant", "Resource is already cached."), 3);
    }
    if (chunk.kind !== descriptor.kind || chunk.format !== descriptor.format
        || chunk.byte_length !== descriptor.byte_length) {
      this.assemblies.delete(chunk.resource_sha256);
      throw markSpatialStage(spatialError("resource_chunk_descriptor_mismatch", "Resource chunk metadata changed."), 3);
    }
    let assembly = this.assemblies.get(chunk.resource_sha256);
    if (!assembly) {
      const reservedIngressBytes = checkedProviderSum([
        ...[...this.cache.values()]
          .filter((entry) => entry.ingress_counted)
          .map((entry) => entry.bytes.length),
        ...[...this.assemblies.values()].map((entry) => entry.descriptor.byte_length),
        descriptor.byte_length,
      ], "spatial_resource_ingress_overflow");
      if (reservedIngressBytes > this.profile.limits.resource_ingress_bytes) {
        throw markSpatialStage(spatialError("spatial_resource_ingress_limit", "Session resource ingress exceeds the selected profile."), 3);
      }
      assembly = {
        descriptor,
        chunk_count: chunk.chunk_count,
        chunks: new Map(),
        received_bytes: 0,
      };
      this.assemblies.set(chunk.resource_sha256, assembly);
    }
    if (assembly.chunk_count !== chunk.chunk_count || !sameResourceContent(assembly.descriptor, descriptor)) {
      this.assemblies.delete(chunk.resource_sha256);
      throw markSpatialStage(spatialError("resource_chunk_metadata_changed", "Resource assembly metadata changed."), 3);
    }
    if (assembly.chunks.has(chunk.chunk_index)) {
      this.assemblies.delete(chunk.resource_sha256);
      throw markSpatialStage(spatialError("resource_chunk_duplicate", "Duplicate resource chunk index."), 3);
    }
    assembly.received_bytes = checkedProviderSum(
      [assembly.received_bytes, chunk.bytes.length],
      "resource_chunk_overflow",
    );
    if (assembly.received_bytes > descriptor.byte_length) {
      this.assemblies.delete(chunk.resource_sha256);
      throw markSpatialStage(spatialError("resource_chunk_overflow", "Resource assembly exceeds its descriptor."), 3);
    }
    assembly.chunks.set(chunk.chunk_index, Buffer.from(chunk.bytes));
    if (assembly.chunks.size !== assembly.chunk_count) {
      return { outcome: "chunk_accepted", resource_sha256: chunk.resource_sha256 };
    }
    const ordered = Array.from({ length: assembly.chunk_count }, (_, index) => assembly.chunks.get(index));
    if (ordered.some((part) => !part)) {
      this.assemblies.delete(chunk.resource_sha256);
      throw markSpatialStage(spatialError("resource_chunk_gap", "Resource assembly has a chunk gap."), 3);
    }
    const bytes = Buffer.concat(ordered);
    if (bytes.length !== descriptor.byte_length || sha256(bytes) !== descriptor.resource_sha256) {
      this.assemblies.delete(chunk.resource_sha256);
      throw markSpatialStage(spatialError("resource_integrity_mismatch", "Assembled resource failed length or hash verification."), 3);
    }
    this.cache.set(descriptor.resource_sha256, {
      descriptor: structuredClone(descriptor),
      bytes,
      ingress_counted: true,
    });
    this.assemblies.delete(chunk.resource_sha256);
    return { outcome: "resource_complete", resource_sha256: chunk.resource_sha256 };
  }

  finalize(documentId) {
    this.#requireOpen();
    const candidate = this.candidates.get(String(documentId ?? ""));
    if (!candidate || candidate.cancelled) {
      throw markSpatialStage(spatialError("spatial_candidate_missing", "Spatial candidate is not active."), 3);
    }
    if (candidate.ready) return candidate.ready;
    if (BigInt(this.monotonicNowNs()) >= BigInt(candidate.deadlineNs)) {
      this.#cancelCandidate(candidate, "preparation_deadline_expired");
      throw markSpatialStage(spatialError("spatial_preparation_deadline_expired", "Spatial preparation deadline expired."), 3);
    }
    validateSpatialAuthority({
      document: candidate.document,
      lease: this.lease,
      profileHash: this.profileHash,
      frameSessionEpoch: this.sessionEpoch,
      frameLeaseRef: this.lease.lease_id,
      nowMs: this.now(),
      documentExpiresAtMs: candidate.documentExpiresAtMs,
    });
    const missing = this.#missingDigests(candidate);
    const requiredMissing = missing.filter((digest) => candidate.descriptorByDigest.get(digest).required);
    if (requiredMissing.length > 0) {
      return this.#candidateStatus(candidate, "pending");
    }
    const degradationChoices = new Map();
    const degradationLedger = [];
    for (const digest of missing) {
      const resource = candidate.descriptorByDigest.get(digest);
      for (const entityId of entitiesUsingResource(candidate.document, resource.id)) {
        const semantic = candidate.document.semantics.find((record) => record.entity_id === entityId);
        if (!semantic || semantic.required_for_meaning) {
          throw markSpatialStage(spatialError("spatial_optional_resource_unavailable", "Missing optional resource cannot degrade safely."), 3);
        }
        applyDegradation(candidate.document, entityId, degradationChoices, degradationLedger, "resource_unavailable");
      }
    }
    let measured;
    try {
      measured = measureSpatialDocument(
        candidate.document,
        this.#candidateResourceBytes(candidate),
        { degradationChoices, limits: this.profile.limits },
      );
    } catch (error) {
      throw markSpatialStage(error, error.failed_stage ?? 4);
    }
    try {
      assertCostNoGreater(measured.recomputed_cost, candidate.document.declared_cost, "spatial_declared_cost_understated");
    } catch (error) {
      throw markSpatialStage(error, 5);
    }
    const limits = effectiveSpatialLimits(this.profile.limits, this.hardLimits);
    while (!costWithinLimits(measured, limits)) {
      const degradable = candidate.document.semantics
        .filter((semantic) => !semantic.required_for_meaning && !degradationChoices.has(semantic.entity_id))
        .sort((left, right) => left.degrade_priority - right.degrade_priority
          || left.entity_id.localeCompare(right.entity_id))[0];
      if (!degradable) {
        throw markSpatialStage(spatialError("spatial_static_budget_exceeded", "Spatial candidate exceeds static limits."), 6);
      }
      applyDegradation(candidate.document, degradable.entity_id, degradationChoices, degradationLedger, "static_budget");
      measured = measureSpatialDocument(
        candidate.document,
        this.#candidateResourceBytes(candidate),
        { degradationChoices, limits: this.profile.limits },
      );
    }
    degradationLedger.sort((left, right) => left.entity_id.localeCompare(right.entity_id));
    candidate.ready = {
      outcome: degradationLedger.length === 0 ? "ready" : "degraded_ready",
      ...candidate.identity,
      recomputed_cost: measured.recomputed_cost,
      scene_actual_bounds: measured.scene_actual_bounds,
      entity_actual_bounds: measured.entity_actual_bounds,
      degradation_ledger: degradationLedger,
    };
    return candidate.ready;
  }

  recordReceipt(type, payload) {
    this.#requireOpen();
    const documentId = String(payload?.document_id ?? "");
    const candidate = this.candidates.get(documentId);
    const priorAdmission = this.lastAdmissions.get(documentId);
    if (type === "SPATIAL_ADMISSION_RECEIPT") {
      if (!candidate) {
        throw spatialError("spatial_receipt_offer_missing", "Spatial admission receipt has no matching offer.");
      }
      const expectedIdentity = candidate.identity;
      const receipt = decodeSpatialAdmissionReceiptPayload(payload, { expectedIdentity });
      if (receipt.outcome === "pending") {
        // The deadline is in the client's monotonic clock domain and is
        // observational. Likewise, the host may have already validated/sent
        // bytes that the client has not assembled yet. Only bind the claimed
        // missing set to this offer; do not equate the two machines' state.
        const offeredDigests = new Set(candidate.descriptorByDigest.keys());
        if (receipt.missing_resource_sha256s.some((digest) => !offeredDigests.has(digest))) {
          throw spatialError("spatial_receipt_pending_mismatch", "Pending receipt names a resource outside the candidate.");
        }
        return receipt;
      }
      if (receipt.outcome === "committed" || receipt.outcome === "degraded_committed") {
        const ready = this.finalize(documentId);
        const expectedOutcome = ready.outcome === "ready" ? "committed" : "degraded_committed";
        if (receipt.outcome !== expectedOutcome
            || !deepEqualJson(receipt.recomputed_cost, ready.recomputed_cost)
            || !deepEqualJson(receipt.scene_actual_bounds, ready.scene_actual_bounds)
            || !deepEqualJson(receipt.entity_actual_bounds, ready.entity_actual_bounds)
            || !deepEqualJson(receipt.degradation_ledger, ready.degradation_ledger)) {
          throw spatialError("spatial_receipt_admission_mismatch", "Admission receipt evidence does not match host recomputation.");
        }
        const committedIdentity = {
          ...candidate.identity,
          generation: receipt.generation,
          scene_actual_bounds: receipt.scene_actual_bounds,
          entity_actual_bounds: receipt.entity_actual_bounds,
          degradation_ledger: receipt.degradation_ledger,
        };
        this.committed.set(documentId, committedIdentity);
        this.lastAdmissions.set(documentId, committedIdentity);
        this.candidates.delete(documentId);
      }
      if (receipt.outcome === "rejected") {
        this.#cancelCandidate(candidate, receipt.reason);
      }
      return receipt;
    }
    if (type === "SPATIAL_DISPLAY_RECEIPT") {
      if (!priorAdmission) {
        throw spatialError("spatial_receipt_offer_missing", "Spatial display receipt has no admitted generation.");
      }
      const expectedIdentity = priorAdmission;
      const receipt = decodeSpatialDisplayReceiptPayload(payload, { expectedIdentity });
      if (!priorAdmission || receipt.generation !== priorAdmission.generation
          || !deepEqualJson(receipt.scene_actual_bounds, priorAdmission.scene_actual_bounds)
          || !deepEqualJson(receipt.entity_actual_bounds, priorAdmission.entity_actual_bounds)
          || !deepEqualJson(receipt.degradation_ledger, priorAdmission.degradation_ledger)) {
        throw spatialError("spatial_receipt_display_mismatch", "Display receipt does not match admitted generation.");
      }
      return receipt;
    }
    if (type === "SPATIAL_ROLLBACK_RECEIPT") {
      if (!priorAdmission) {
        throw spatialError("spatial_receipt_offer_missing", "Spatial rollback receipt has no admitted generation.");
      }
      return decodeSpatialRollbackReceiptPayload(payload, { expectedIdentity: priorAdmission });
    }
    throw spatialError("spatial_receipt_type_invalid", "Spatial receipt type is unsupported.");
  }

  cancel(documentId, reason = "cancelled") {
    const candidate = this.candidates.get(String(documentId ?? ""));
    if (!candidate) return false;
    this.#cancelCandidate(candidate, reason);
    return true;
  }

  close() {
    for (const candidate of this.candidates.values()) this.#cancelCandidate(candidate, "session_closed");
    this.candidates.clear();
    this.assemblies.clear();
    this.cache.clear();
    this.closed = true;
  }

  #missingDigests(candidate) {
    return [...candidate.descriptorByDigest.keys()]
      .filter((digest) => !this.#cachedResourceMatches(candidate.descriptorByDigest.get(digest)))
      .sort();
  }

  #candidateStatus(candidate, outcome) {
    return {
      outcome,
      ...candidate.identity,
      missing_resource_sha256s: this.#missingDigests(candidate),
      preparation_deadline_ns: candidate.deadlineNs,
      cancelled_previous: candidate.cancelled_previous,
    };
  }

  #candidateResourceBytes(candidate) {
    return new Map(candidate.document.resources.flatMap((resource) => {
      const entry = this.cache.get(resource.resource_sha256);
      return entry ? [[resource.id, entry.bytes]] : [];
    }));
  }

  #cachedResourceMatches(resource) {
    const entry = this.cache.get(resource.resource_sha256);
    return Boolean(entry && sameResourceContent(entry.descriptor, resource));
  }

  #cancelCandidate(candidate, reason) {
    candidate.cancelled = true;
    candidate.cancellation_reason = String(reason ?? "cancelled").slice(0, 96);
    this.candidates.delete(candidate.document.document_id);
    for (const digest of candidate.descriptorByDigest.keys()) this.assemblies.delete(digest);
  }

  #requireOpen() {
    if (this.closed) throw spatialError("spatial_session_closed", "Spatial admission session is closed.");
  }
}

export class QuestSurfaceFixtureProvider {
  constructor({
    tlsOptions,
    grantStore,
    grantRecoveryReport = null,
    capabilityCatalog = null,
    providerRegistry = null,
    grantId,
    grantIds = null,
    spatialDocumentGrantId = null,
    spatialProfile = null,
    spatialDocumentId = "document.spatial-fixture",
    spatialFixtureFactory = createQuestSpatialDocumentFixture,
    localAttachScope = "window",
    panel = DEFAULT_PANEL,
    leaseTtlMs = DEFAULT_LEASE_TTL_MS,
    eventSink = () => {},
    logger = console,
    serverFactory = (options, handler) => tls.createServer(options, handler),
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    pipelineFactory = null,
    answerStages = null,
  } = {}) {
    this.tlsOptions = validateTlsOptions(tlsOptions);
    this.grantStore = grantStore ?? { schema_version: 1, grants: [] };
    this.grantRecoveryReport = grantRecoveryReport;
    this.capabilityCatalog = capabilityCatalog;
    this.providerRegistry = providerRegistry;
    this.grantIds = normalizeConfiguredGrantIds(grantIds);
    if (this.grantIds && grantId && String(grantId).trim() !== this.grantIds.panel) {
      throw providerError(
        "quest_surface_panel_grant_configuration_mismatch",
        "Quest surface legacy and exact panel grant ids do not match.",
      );
    }
    const configuredPanelGrantId = this.grantIds?.panel ?? grantId;
    this.spatialDocumentGrantId = spatialDocumentGrantId === null || spatialDocumentGrantId === undefined
      ? ""
      : requireText(spatialDocumentGrantId, "quest_spatial_document_grant_id_required");
    this.grantId = configuredPanelGrantId === null || configuredPanelGrantId === undefined
      ? ""
      : requireText(configuredPanelGrantId, "quest_surface_grant_id_required");
    if (!this.grantId && !this.spatialDocumentGrantId) {
      throw providerError(
        "quest_surface_grant_id_required",
        "Quest surface fixture requires a panel or spatial-document grant id.",
      );
    }
    if (this.spatialDocumentGrantId && !spatialProfile) {
      throw providerError(
        "quest_spatial_profile_required",
        "Spatial document support requires an explicit measured profile.",
      );
    }
    if (!this.spatialDocumentGrantId && spatialProfile) {
      throw providerError(
        "quest_spatial_grant_required",
        "A spatial profile cannot enable presentation without an exact grant id.",
      );
    }
    this.spatialProfile = spatialProfile ? validateQuestSpatialProfile(spatialProfile) : null;
    this.spatialDocumentId = String(spatialDocumentId ?? "").trim();
    if (this.spatialDocumentGrantId && !this.spatialDocumentId) {
      throw providerError("quest_spatial_document_id_required", "Spatial document id is required.");
    }
    this.spatialFixtureFactory = spatialFixtureFactory;
    this.localAttachScope = normalizeLocalAttachScope(localAttachScope);
    this.panel = normalizePanel(panel);
    this.leaseTtlMs = boundedInteger(
      leaseTtlMs,
      1,
      QUEST_SURFACE_MAX_LEASE_TTL_MS,
      "quest_surface_lease_ttl_invalid",
    );
    this.eventSink = eventSink;
    this.logger = logger;
    this.serverFactory = serverFactory;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pipelineFactory = pipelineFactory;
    this.answerStages = answerStages;
    this.server = null;
    this.sessions = new Set();
    // #6: device latch persists across reconnects within an armed episode.
    this.deviceMicLatch = new QuestSurfaceMicLatch();
    // #2: bounded armed episode window, default not armed
    this.armedEpisode = null;
    this.episodeTimer = null;
    this.armedWindow = false; // legacy alias for tests
    // #3: track consumed once local_attach grants
    this.consumedOnceGrants = new Set();
  }

  armEpisode({ episodeId, ttlMs = QUEST_SURFACE_DEFAULT_EPISODE_TTL_MS, actor = "test", provenance = "", reason = "", mode, capability, provider, grant_id, grantId } = {}) {
    this.#expireEpisodeIfNeeded();
    const id = String(episodeId ?? `ep-${Date.now()}-${Math.random().toString(16).slice(2,8)}`).trim();
    if (!id) throw providerError("episode_id_required", "Episode id required");
    const ttl = boundedInteger(
      ttlMs,
      QUEST_SURFACE_MIN_EPISODE_TTL_MS,
      QUEST_SURFACE_MAX_EPISODE_TTL_MS,
      "episode_ttl_invalid",
    );
    // I-1 tuple binding: {mode, capability, provider, grant_id} — default to text/local live if not supplied (backward compat)
    let boundMode = mode ?? null;
    let boundCapability = capability ?? null;
    let boundProvider = provider ?? null;
    let boundGrantId = grant_id ?? grantId ?? null;
    // allow mode as string "text:local" or object
    if (typeof boundMode === "string") {
      const [ic, dest] = String(boundMode).split(":");
      boundMode = { input_class: ic, destination: dest };
    }
    if (!boundMode && !boundCapability && !boundProvider && !boundGrantId) {
      // legacy audio path: default to text/local hard floor (fail-closed, no bypass) — panel-only sessions stay exempt because they never hit audio path
      boundMode = { input_class: "text", destination: "local" };
      boundCapability = "model.context.audio.microphone.local.attach";
      boundProvider = QUEST_SURFACE_PROVIDER_ID;
      boundGrantId = "grant-local";
      // allow grant-local as window or once; matcher will verify via hasLeaseFor mapping to local_attach
    } else {
      // default leaf for text/local if not supplied
      if (!boundMode) boundMode = { input_class: "text", destination: "local" };
      if (!boundCapability) {
        const leafFor = { "text:local": "model.context.audio.microphone.local.attach", "text:remote": "model.context.audio.microphone.remote.attach", "raw_audio:local": "model.context.audio.microphone.raw.local.attach", "raw_audio:remote": "model.context.audio.microphone.raw.remote.attach" };
        boundCapability = leafFor[`${boundMode.input_class}:${boundMode.destination}`] ?? "model.context.audio.microphone.local.attach";
      }
      if (!boundProvider) boundProvider = QUEST_SURFACE_PROVIDER_ID;
      if (!boundGrantId) boundGrantId = `grant-${boundCapability}`;
    }
    const replacedEpisodeId = this.armedEpisode?.id ?? "";
    const armedAtMs = this.now();
    this.clearTimer(this.episodeTimer);
    this.episodeTimer = null;
    // A successful arm is the deliberate boundary for a fresh episode. Give
    // future sessions a fresh latch without clearing the latch object retained
    // by any session issued under the prior episode.
    this.deviceMicLatch = new QuestSurfaceMicLatch();
    this.armedEpisode = { id, armedAtMs, expiresAtMs: armedAtMs + ttl, actor: String(actor ?? ""), provenance: String(provenance ?? ""), ttlMs: ttl, mode: boundMode, capability: boundCapability, provider: boundProvider, grant_id: boundGrantId, grantId: boundGrantId };
    this.armedWindow = true;
    this.episodeTimer = this.setTimer(() => {
      this.revokeEpisode("episode_expired", {
        actor: "system",
        eventType: "quest.surface.episode_expired",
      });
    }, ttl);
    this.episodeTimer?.unref?.();
    this.#emit("quest.surface.episode_armed", { episode_id: id, replaced_episode_id: replacedEpisodeId, armed_at_ms: armedAtMs, expires_at_ms: this.armedEpisode.expiresAtMs, ttl_ms: ttl, actor, provenance_id: String(provenance ?? ""), reason_included: false, mode: boundMode, capability: boundCapability, provider: boundProvider, grant_id: boundGrantId });
    return this.armedEpisode;
  }

  revokeEpisode(reason = "revoked", { actor = "", eventType = "quest.surface.episode_revoked" } = {}) {
    const episodeId = this.armedEpisode?.id ?? "none";
    if (!this.armedEpisode) {
      return false;
    }
    this.clearTimer(this.episodeTimer);
    this.episodeTimer = null;
    this.#emit(eventType, { episode_id: episodeId, reason, actor, reason_included: false });
    this.armedEpisode = null;
    this.armedWindow = false;
    // Fix 4: narrow already-issued sessions — close active sessions and cancel pipelines
    // If a session is already issued, revocation must be observable; gating issuance only is
    // documented as insufficient for the consent core. Active sessions are torn down.
    for (const session of [...this.sessions]) {
      try {
        session.handleEpisodeRevoked?.(reason, episodeId);
      } catch {}
      try {
        session.close(reason);
      } catch {}
    }
    return true;
  }

  episodeStatus() {
    this.#expireEpisodeIfNeeded();
    if (!this.armedEpisode) {
      return {
        armed: false,
        episode_id: "",
        armed_at_ms: null,
        expires_at_ms: null,
        ttl_ms: 0,
      };
    }
    return {
      armed: true,
      episode_id: this.armedEpisode.id,
      armed_at_ms: this.armedEpisode.armedAtMs,
      expires_at_ms: this.armedEpisode.expiresAtMs,
      ttl_ms: this.armedEpisode.ttlMs,
    };
  }

  hasActiveSessions() {
    return this.sessions.size > 0;
  }

  validateConfiguredGrantBindings({ peerFingerprint256 = "" } = {}) {
    if (!this.grantIds) {
      throw providerError(
        "quest_surface_grant_tuple_required",
        "Quest surface v1b requires four exact configured grant ids.",
      );
    }
    const results = authorizeConfiguredQuestGrants({
      grantStore: this.grantStore,
      grantRecoveryReport: this.grantRecoveryReport,
      capabilityCatalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
      grantIds: this.grantIds,
      localAttachScope: this.localAttachScope,
      peerFingerprint256,
      panel: this.panel,
    });
    const denied = Object.values(results).find((authorization) => !authorization.allowed);
    if (denied) {
      const error = providerError(denied.code, "Quest surface exact grant tuple is not authorized.");
      error.details = denied.details;
      throw error;
    }
    return {
      allowed: true,
      grants: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.grant])),
      grant_ids: { ...this.grantIds },
    };
  }

  async start({ host = "127.0.0.1", port = 0 } = {}) {
    if (this.server) {
      throw providerError("quest_surface_already_started", "Quest surface fixture is already started.");
    }
    const server = this.serverFactory({
      ...this.tlsOptions,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    }, (socket) => this.#accept(socket));
    this.server = server;
    server.on("tlsClientError", (error) => {
      this.#emit("quest.surface.transport_refused", {
        reason: boundedErrorCode(error),
        client_authorized: false,
      });
    });
    server.on("error", (error) => {
      this.logger.error?.(`Quest surface fixture server error: ${boundedErrorCode(error)}`);
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host, port });
    });
    const address = server.address();
    this.#emit("quest.surface.provider_started", {
      host: typeof address === "object" && address ? address.address : String(host),
      port: typeof address === "object" && address ? address.port : port,
      provider: QUEST_SURFACE_PROVIDER_ID,
      configured_capabilities: [
        ...(this.grantId ? [QUEST_SURFACE_CAPABILITY] : []),
        ...(this.spatialDocumentGrantId ? [QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT] : []),
      ],
      authority_created: false,
    });
    return address;
  }

  async stop() {
    this.clearTimer(this.episodeTimer);
    this.episodeTimer = null;
    this.armedEpisode = null;
    this.armedWindow = false;
    for (const session of [...this.sessions]) {
      session.close("runtime_shutdown");
    }
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  address() {
    return this.server?.address() ?? null;
  }

  #expireEpisodeIfNeeded() {
    if (this.armedEpisode && this.now() >= this.armedEpisode.expiresAtMs) {
      this.revokeEpisode("episode_expired", {
        actor: "system",
        eventType: "quest.surface.episode_expired",
      });
    }
  }

  #accept(socket) {
    if (!socket.authorized) {
      socket.destroy();
      return;
    }
    if (this.sessions.size >= 1) {
      this.#emit("quest.surface.transport_refused", {
        reason: "quest_surface_session_limit",
        client_authorized: true,
        authority_granted: false,
      });
      socket.destroy();
      return;
    }
    const peer = socket.getPeerCertificate?.() ?? {};
    // #2: enforce configured panel grant identity (not arbitrary)
    const panelAuth = this.#authorize(peer);
    if (!panelAuth.allowed && !this.spatialDocumentGrantId) {
      this.#emit("quest.surface.lease_refused", { session_epoch: "pending", grant_id: this.grantId, reason: panelAuth.code, panel_sent: false });
      // still create session but it will fail hello with grant_not_authorized; we still need to track latch
    }
    const session = new QuestSurfaceProviderSession({
      socket,
      peerFingerprint256: normalizeFingerprint(peer.fingerprint256),
      authorize: () => this.#authorize(peer),
      authorizeSpatial: () => this.#authorizeSpatial(peer),
      grantStore: this.grantStore,
      grantRecoveryReport: this.grantRecoveryReport,
      capabilityCatalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
      panel: this.panel,
      leaseTtlMs: this.leaseTtlMs,
      deviceMicLatch: this.deviceMicLatch,
      armedWindow: this.armedWindow,
      getArmedEpisode: () => this.armedEpisode,
      consumedOnceGrants: this.consumedOnceGrants,
      configuredPanelGrantId: this.grantId,
      configuredGrantIds: this.grantIds,
      spatialDocumentGrantId: this.spatialDocumentGrantId,
      spatialProfile: this.spatialProfile,
      spatialDocumentId: this.spatialDocumentId,
      spatialFixtureFactory: this.spatialFixtureFactory,
      localAttachScope: this.localAttachScope,
      eventSink: (eventType, fields) => this.#emit(eventType, fields),
      now: this.now,
      onClose: () => this.sessions.delete(session),
      pipelineFactory: this.pipelineFactory,
      answerStages: this.answerStages,
    });
    this.sessions.add(session);
    session.start();
  }

  #authorize(peer) {
    if (!this.grantId) {
      return deniedQuestGrant("quest_surface_panel_grant_not_configured", { leaf: "panel" });
    }
    const authorization = authorizeGrantUse({
      store: this.grantStore,
      grantId: this.grantId,
      capability: QUEST_SURFACE_CAPABILITY,
      provider: QUEST_SURFACE_PROVIDER_ID,
      scope: "session",
      recoveryReport: this.grantRecoveryReport,
      catalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
    });
    if (!authorization.allowed) {
      return authorization;
    }
    const constraints = authorization.grant.constraints ?? {};
    const constraintFailure = validateQuestGrantConstraints(constraints);
    if (constraintFailure) {
      return {
        allowed: false,
        code: constraintFailure,
        grant: null,
      };
    }
    const requiredFingerprint = normalizeFingerprint(constraints.device_fingerprint256);
    const presentedFingerprint = normalizeFingerprint(peer?.fingerprint256);
    if (requiredFingerprint && requiredFingerprint !== presentedFingerprint) {
      return {
        allowed: false,
        code: "quest_surface_device_identity_mismatch",
        grant: null,
      };
    }
    const allowedSurfaceIds = Array.isArray(constraints.allowed_surface_ids)
      ? constraints.allowed_surface_ids.map(String)
      : ["panel.main"];
    if (!allowedSurfaceIds.includes(this.panel.surface_id)) {
      return {
        allowed: false,
        code: "quest_surface_surface_not_granted",
        grant: null,
      };
    }
    const maxTextBytes = Number.isSafeInteger(constraints.max_panel_text_bytes)
      ? constraints.max_panel_text_bytes
      : QUEST_SURFACE_MAX_PANEL_TEXT_BYTES;
    if (Buffer.byteLength(this.panel.text, "utf8") > maxTextBytes) {
      return {
        allowed: false,
        code: "quest_surface_panel_text_exceeds_grant",
        grant: null,
      };
    }
    return authorization;
  }

  #authorizeSpatial(peer) {
    if (!this.spatialDocumentGrantId || !this.spatialProfile) {
      return deniedQuestGrant("quest_spatial_document_not_configured", { capability: QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT });
    }
    const authorization = authorizeGrantUse({
      store: this.grantStore,
      grantId: this.spatialDocumentGrantId,
      capability: QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT,
      provider: QUEST_SURFACE_PROVIDER_ID,
      scope: "session",
      recoveryReport: this.grantRecoveryReport,
      catalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
    });
    if (!authorization.allowed) return authorization;
    try {
      createQuestSurfaceLease({
        sessionEpoch: "1",
        sourceGrant: authorization.grant,
        ttlMs: 1,
        issuedAtMs: 0,
        leaseId: "validation-spatial-lease",
      });
    } catch (error) {
      return deniedQuestGrant(error.code ?? "quest_spatial_document_constraints_invalid", {
        capability: QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT,
      });
    }
    const requiredFingerprint = normalizeFingerprint(authorization.grant.constraints?.device_fingerprint256);
    const presentedFingerprint = normalizeFingerprint(peer?.fingerprint256);
    if (!/^[A-F0-9]{64}$/.test(requiredFingerprint)
        || requiredFingerprint !== presentedFingerprint) {
      return deniedQuestGrant("quest_surface_device_identity_mismatch", {
        capability: QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT,
      });
    }
    return authorization;
  }

  #emit(eventType, fields = {}) {
    const event = {
      event_type: eventType,
      timestamp: new Date(this.now()).toISOString(),
      content_included: false,
      payload_bytes_included: false,
      ...fields,
    };
    this.eventSink(event);
    this.logger.info?.("soma.quest_surface", event);
  }
}

class QuestSurfaceProviderSession {
  constructor({
    socket,
    peerFingerprint256,
    authorize,
    authorizeSpatial = null,
    grantStore = null,
    grantRecoveryReport = null,
    capabilityCatalog = null,
    providerRegistry = null,
    panel,
    leaseTtlMs,
    deviceMicLatch = null,
    armedWindow = false,
    getArmedEpisode = null,
    consumedOnceGrants = null,
    configuredPanelGrantId = null,
    configuredGrantIds = null,
    spatialDocumentGrantId = "",
    spatialProfile = null,
    spatialDocumentId = "",
    spatialFixtureFactory = createQuestSpatialDocumentFixture,
    localAttachScope = "window",
    eventSink,
    now,
    onClose,
    pipelineFactory = null,
    answerStages = null,
  }) {
    this.socket = socket;
    this.peerFingerprint256 = peerFingerprint256;
    this.authorize = authorize;
    this.authorizeSpatial = authorizeSpatial;
    this.grantStore = grantStore;
    this.grantRecoveryReport = grantRecoveryReport;
    this.capabilityCatalog = capabilityCatalog;
    this.providerRegistry = providerRegistry;
    this.panel = panel;
    this.leaseTtlMs = leaseTtlMs;
    this.deviceMicLatch = deviceMicLatch;
    this.armedWindow = armedWindow;
    this.getArmedEpisode = getArmedEpisode;
    this.consumedOnceGrants = consumedOnceGrants;
    this.configuredPanelGrantId = configuredPanelGrantId;
    this.configuredGrantIds = configuredGrantIds;
    this.spatialDocumentGrantId = spatialDocumentGrantId;
    this.spatialProfile = spatialProfile;
    this.spatialDocumentId = spatialDocumentId;
    this.spatialFixtureFactory = spatialFixtureFactory;
    this.localAttachScope = localAttachScope;
    this.eventSink = eventSink;
    this.now = now;
    this.onClose = onClose;
    this.decoder = new BoundedLineDecoder();
    this.sessionEpoch = randomSessionEpoch();
    this.serverSequences = new Map();
    this.clientSequences = new Map();
    this.helloReceived = false;
    this.lease = null;
    this.snapshot = null;
    this.spatialLease = null;
    this.spatialFixture = null;
    this.spatialAdmission = null;
    this.manifest = null;
    this.leaseTimer = null;
    this.renewalTimer = null;
    this.manifestExpiryTimer = null;
    this.manifestTimerToken = 0;
    this.renewalGeneration = 0;
    this.issuedEpisodeId = "";
    this.manifestGrantIds = null;
    this.suppressLatchOnClose = false;
    this.closed = false;
    this.micLatch = deviceMicLatch ?? new QuestSurfaceMicLatch();
    this.pipeline = null;
    this.pipelineFactory = pipelineFactory;
    this.answerStages = answerStages;
    this.revisionCounter = BigInt(this.panel.revision ?? "1");
  }

  start() {
    this.socket.setNoDelay(true);
    this.socket.on("data", (chunk) => this.#onData(chunk));
    this.socket.once("close", () => this.#finish("transport_closed"));
    this.socket.once("error", (error) => {
      this.eventSink("quest.surface.transport_error", {
        session_epoch: this.sessionEpoch,
        reason: boundedErrorCode(error),
      });
    });
    this.eventSink("quest.surface.transport_authenticated", {
      session_epoch: this.sessionEpoch,
      client_fingerprint256: this.peerFingerprint256,
      mtls_authenticated: true,
      authority_granted: false,
    });
  }

  close(reason) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.#clearLeaseTimers();
    // #3: latch on disconnect/lease expiry at provider lifetime
    if (!this.suppressLatchOnClose) {
      this.micLatch.latch(reason, this.sessionEpoch, this.now(), this.issuedEpisodeId);
    }
    if (this.pipeline) {
      this.pipeline.handleLifecycleClose(reason);
    }
    this.spatialAdmission?.close();
    this.eventSink("quest.surface.session_closed", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
      reason,
      remaining_buffer_bytes: 0,
      latched_epoch: this.micLatch.latchedEpoch,
    });
    this.socket.destroy();
    this.onClose();
  }

  #finish(reason) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.#clearLeaseTimers();
    if (!this.suppressLatchOnClose) {
      this.micLatch.latch(reason, this.sessionEpoch, this.now(), this.issuedEpisodeId);
    }
    if (this.pipeline) {
      this.pipeline.handleLifecycleClose(reason);
    }
    this.spatialAdmission?.close();
    this.eventSink("quest.surface.session_closed", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
      reason,
      remaining_buffer_bytes: this.pipeline ? this.pipeline.getRemainingBufferBytes() : 0,
      latched_epoch: this.micLatch.latchedEpoch,
    });
    this.onClose();
  }

  handleEpisodeRevoked(reason, episodeId) {
    this.eventSink("quest.surface.episode_revoked_session", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
      reason: reason ?? "episode_revoked",
      episode_id: episodeId ?? "unknown",
      latched_epoch: this.micLatch.latchedEpoch,
    });
    if (this.pipeline) {
      try { this.pipeline.handleLifecycleClose(reason ?? "episode_revoked"); } catch {}
    }
    this.spatialAdmission?.close();
  }

  tryReserveOnceGrant(grantId) {
    if (!grantId) return false;
    if (this.consumedOnceGrants.has(grantId)) return false;
    this.consumedOnceGrants.add(grantId);
    return true;
  }

  #onData(chunk) {
    if (this.closed) {
      return;
    }
    // #7: per-line handling to preserve stream context and continue batched frames
    for (const line of this.decoder.push(chunk)) {
      let frame = null;
      try {
        frame = parseQuestSurfaceFrame(line);
      } catch (error) {
        const code = error instanceof QuestSurfaceProtocolError ? error.code : "quest_surface_protocol_failure";
        this.#sendError(code);
        // envelope parse failure has no stream context — close session (cannot clear named stream)
        this.close(code);
        return;
      }
      try {
        this.#handle(frame);
      } catch (error) {
        const code = error instanceof QuestSurfaceProtocolError ? error.code : "quest_surface_protocol_failure";
        const streamScoped = new Set(["utterance_already_active","utterance_not_started","utterance_id_mismatch","utterance_too_long","utterance_cancelled","audio_direction_mismatch","sequence_stale","manifest_required","lease_ref_mismatch","lease_ref_required","mic_latch_active","local_attach_not_authorized","local_attach_missing","grant_already_consumed"]);
        if (code.startsWith("utterance_") || streamScoped.has(code)) {
          // #9: stream-scoped — emit error bound to failing frame's stream, continue other lines in same chunk
          this.eventSink("quest.surface.audio_stream_error", { session_epoch: frame.session_epoch, stream_id: frame.stream_id, reason: code, lease_ref: frame.lease_ref });
          try { this.#sendError(code, frame); } catch {}
          // clear only the named stream's utterance if any
          const state = this.pipeline ? this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id) : null;
          if (state) {
            try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: state.utteranceId, reason: code } }); } catch {}
          }
          continue;
        }
        this.#sendError(code);
        this.close(code);
        return;
      }
    }
  }

  #handle(frame) {
    if (frame.direction !== "uplink") {
      throw new QuestSurfaceProtocolError("direction_mismatch", "Client frame direction must be uplink.");
    }
    // v1a bootstrap: hello must be stream 0
    if (!this.helloReceived && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "v1a accepts stream 0 only.");
    }
    // after hello, panel ack must be stream 0; audio streams may use any id
    if (this.helloReceived && frame.type === "ACTUAL_BOUNDS_ACK" && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "ACTUAL_BOUNDS_ACK must be stream 0.");
    }
    if (this.helloReceived && frame.type === "PANEL_SNAPSHOT" && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "PANEL_SNAPSHOT must be stream 0.");
    }
    if (this.helloReceived && frame.type === "LEASE_RENEWAL_ACK" && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "LEASE_RENEWAL_ACK must be stream 0.");
    }
    if (this.helloReceived && QUEST_SPATIAL_RECEIPT_TYPES.has(frame.type) && frame.stream_id !== 0) {
      throw new QuestSurfaceProtocolError("stream_id_unsupported", "Spatial receipts must be stream 0.");
    }
    const sequenceKey = `${frame.session_epoch}:${frame.stream_id}:${frame.direction}`;
    const seq = BigInt(frame.seq);
    const priorSeq = this.clientSequences.get(sequenceKey) ?? 0n;
    if (seq <= priorSeq) {
      throw new QuestSurfaceProtocolError("sequence_stale", "Client sequence must increase.");
    }
    this.clientSequences.set(sequenceKey, seq);

    if (!this.helloReceived) {
      if (frame.type !== "HELLO" || frame.session_epoch !== "0") {
        throw new QuestSurfaceProtocolError("hello_required", "HELLO must be the first client frame.");
      }
      this.#handleHello(frame);
      return;
    }
    if (frame.session_epoch !== this.sessionEpoch) {
      throw new QuestSurfaceProtocolError("session_epoch_mismatch", "Client session epoch does not match.");
    }
    if (frame.type === "ACTUAL_BOUNDS_ACK") {
      this.#handleBoundsAck(frame);
      return;
    }
    if (frame.type === "LEASE_RENEWAL_ACK") {
      this.#handleLeaseRenewalAck(frame);
      return;
    }
    if (QUEST_SPATIAL_RECEIPT_TYPES.has(frame.type)) {
      this.#handleSpatialReceipt(frame);
      return;
    }
    if (frame.type === "FOCUS_LOST" || frame.type === "SUSPEND") {
      this.micLatch.latch(
        frame.type.toLowerCase(),
        this.sessionEpoch,
        this.now(),
        this.issuedEpisodeId,
      );
      if (this.pipeline) this.pipeline.handleLifecycleClose(frame.type.toLowerCase());
      this.spatialAdmission?.close();
      this.eventSink("quest.surface.session_narrowed", {
        session_epoch: this.sessionEpoch,
        lease_id: this.lease?.lease_id ?? this.manifest?.leases?.panel?.lease_id ?? "",
        reason: frame.type.toLowerCase(),
        lifecycle_report_authority_effect: "narrow_only",
        mic_latch: this.micLatch.isLatched(),
        latched_epoch: this.micLatch.latchedEpoch,
      });
      this.#send("TEARDOWN_ACK", {}, { leaseRef: "", streamId: 0 });
      this.socket.end();
      return;
    }
    if (QUEST_SURFACE_AUDIO_FRAME_TYPES.has(frame.type)) {
      this.#handleAudioFrame(frame);
      return;
    }
    throw new QuestSurfaceProtocolError("message_type_unexpected", "Client message type is unexpected.");
  }

  #handleSpatialReceipt(frame) {
    if (!this.spatialAdmission || !this.spatialLease || frame.lease_ref !== this.spatialLease.lease_id) {
      throw new QuestSurfaceProtocolError("lease_ref_mismatch", "Spatial receipt lease does not match.");
    }
    const authorization = this.authorizeSpatial?.();
    if (!authorization?.allowed || this.now() >= this.spatialLease.expires_at_ms) {
      throw new QuestSurfaceProtocolError("spatial_authority_not_live", "Spatial receipt authority is no longer live.");
    }
    const receipt = this.spatialAdmission.recordReceipt(frame.type, frame.payload);
    this.eventSink("quest.surface.spatial_receipt_validated", {
      session_epoch: this.sessionEpoch,
      lease_id: this.spatialLease.lease_id,
      source_grant_id: this.spatialLease.source_grant_id,
      receipt_type: frame.type,
      document_id: receipt.document_id,
      document_revision: receipt.document_revision,
      document_sha256: receipt.document_sha256,
      profile_id: receipt.profile_id,
      profile_sha256: receipt.profile_sha256,
      outcome: receipt.outcome ?? "",
      generation: receipt.generation ?? receipt.failed_generation ?? "",
      displayed: receipt.displayed === true,
      body_included: false,
    });
  }

  #handleAudioFrame(frame) {
    // #1: audio requires active v1b manifest — panel-only lease must not authorize pipeline
    if (!this.manifest) {
      throw new QuestSurfaceProtocolError("manifest_required", "Audio requires active v1b manifest");
    }
    // mic-off latch: capture forbidden while latched
    if (this.micLatch.isLatched() && frame.type !== "CANCEL") {
      // CANCEL is allowed to clear, but other audio is rejected per-stream
      throw new QuestSurfaceProtocolError("mic_latch_active", "Mic capture is latched off; deliberate resume required.");
    }
    if (!frame.lease_ref) throw new QuestSurfaceProtocolError("lease_ref_required", "Audio frame requires lease_ref");
    // bind every audio frame including CANCEL to mic leaf
    if (frame.lease_ref !== this.manifest.leases.mic_capture.lease_id) {
      throw new QuestSurfaceProtocolError("lease_ref_mismatch", "Audio lease_ref must be mic_capture leaf");
    }
    // stream-scoped handling: delegate to pipeline with per-stream isolation
    try {
      switch (frame.type) {
        case "UTTERANCE_START": {
        if (!this.pipeline) this.#ensurePipeline();
        this.pipeline.handleUtteranceStart({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: frame.payload, leaseRef: frame.lease_ref });
        break;
        }
        case "AUDIO_CHUNK": {
        if (!this.pipeline) throw new QuestSurfaceProtocolError("utterance_not_started", "No utterance");
        // decode and let pipeline validate channels/direction; pipeline will check utterance_id
        this.pipeline.handleAudioChunk({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: frame.payload });
        break;
        }
        case "UTTERANCE_END": {
        if (!this.pipeline) throw new QuestSurfaceProtocolError("utterance_not_started", "No utterance");
        // F2 sync pre-check: utterance_id mismatch must clear exact stream synchronously before async, so retry on same stream can succeed
        try {
          const active = this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id);
          const endId = frame.payload?.utterance_id;
          if (active && endId && active.utteranceId !== endId) {
            try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: active.utteranceId, reason: "utterance_id_mismatch" } }); } catch {}
            throw new QuestSurfaceProtocolError("utterance_id_mismatch", `End utterance ${endId} != active ${active.utteranceId}`);
          }
        } catch (e) {
          if (e instanceof QuestSurfaceProtocolError) throw e;
        }
        // async pipeline - do not block #handle; run and eventually send paired answer
        this.#handleUtteranceEndAsync(frame);
        break;
        }
        case "CANCEL": {
        // cancel flushes only its named stream/utterance (already bound to mic leaf above)
        if (!this.pipeline) break;
        const payload = frame.payload;
        try { decodeCancelPayload(payload); } catch (e) { throw e; }
        this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload });
        break;
        }
        default: throw new QuestSurfaceProtocolError("message_type_unexpected", "Audio type unexpected");
      }
    } catch (error) {
      if (error instanceof QuestSurfaceProtocolError) {
        // stream-scoped: clear only that stream's utterance if it exists, but do not emit here — let #onData emit once
        const state = this.pipeline ? this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id) : null;
        if (state) {
          try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: state.utteranceId, reason: error.code } }); } catch {}
        }
        throw error;
      }
      throw error;
    }
  }

  #ensurePipeline() {
    if (this.pipeline) return;
    const leaseRefFor = (kind, epoch) => {
      if (this.manifest) {
        if (kind === "panel") return this.manifest.leases.panel.lease_id;
        if (kind === "audio_present") return this.manifest.leases.audio_present.lease_id;
      }
      return this.lease?.lease_id ?? "";
    };
    this.pipeline = (this.pipelineFactory ?? createQuestSurfaceAudioPipeline)({
      panelBase: this.panel,
      leaseRefFor,
      nextRevision: () => {
        this.revisionCounter += 1n;
        return this.revisionCounter.toString(10);
      },
      eventSink: (e) => this.eventSink(e.type ?? e.event_type, e),
      logger: this.logger,
      // Item-I real execution path: when real answer stages are configured they
      // replace the fixture transcribe/chat/synthesize; the pipeline's abort-aware
      // withAbort wrapping makes them interruptible. Absent, fixtures are used.
      ...(this.answerStages ?? {}),
    });
  }

  async #handleUtteranceEndAsync(frame) {
    const authorizeLocalAttach = async () => {
      if (!this.manifest || !this.manifest.leases.local_attach) return { allowed: false, code: "local_attach_missing" };
      const grantId = this.manifest.leases.local_attach.source_grant_id;
      // re-authorize exact grant id, provider, scope
      const scope = this.manifest.leases.local_attach.scope;
      const auth = authorizeGrantUse({
        store: this.grantStore,
        grantId,
        capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
        provider: "soma.provider.local-model",
        scope,
        recoveryReport: this.grantRecoveryReport,
        catalog: this.capabilityCatalog,
        providerRegistry: this.providerRegistry,
      });
      if (!auth.allowed) return auth;
      // also check TTL expiry vs manifest expiry via injected clock (inclusive: now >= expiry is expired)
      if (this.now() >= this.manifest.expires_at_ms) {
        return { allowed: false, code: "grant_expired", grant: null };
      }
      // #B: for `once`, atomically reserve at sink boundary before chat (not during recheck)
      if (auth.grant.scope === "once") {
        if (!this.tryReserveOnceGrant(grantId)) {
          return { allowed: false, code: "grant_already_consumed", grant: null };
        }
      }
      return auth;
    };
    // wrap to separate recheck vs reserve: first recheck (no reserve), second recheck reserves
    let firstCheckDone = false;
    const authorizeLocalAttachRecheck = async () => {
      if (!firstCheckDone) {
        firstCheckDone = true;
        // first call after STT: just recheck without reserving
        if (!this.manifest || !this.manifest.leases.local_attach) return { allowed: false, code: "local_attach_missing" };
        const grantId = this.manifest.leases.local_attach.source_grant_id;
        const scope = this.manifest.leases.local_attach.scope;
        const auth = authorizeGrantUse({
          store: this.grantStore,
          grantId,
          capability: QUEST_SURFACE_CAPABILITY_AUDIO_LOCAL_ATTACH,
          provider: "soma.provider.local-model",
          scope,
          recoveryReport: this.grantRecoveryReport,
          catalog: this.capabilityCatalog,
          providerRegistry: this.providerRegistry,
        });
        if (!auth.allowed) return auth;
        if (auth.grant.scope === "once" && this.consumedOnceGrants.has(grantId)) {
          return { allowed: false, code: "grant_already_consumed", grant: null };
        }
        if (this.now() >= this.manifest.expires_at_ms) return { allowed: false, code: "grant_expired", grant: null };
        return auth;
      }
      return authorizeLocalAttach();
    };
    // I-1 second enforcement point: provider selection must prove same tuple as manifest issuance (hard floor)
    const episodeForAnswer = this.getArmedEpisode ? this.getArmedEpisode() : null;
    if (episodeForAnswer && episodeForAnswer.mode) {
      try {
        // manifest for matching is the issued manifest (contains real leases)
        matchAnswerProvider({ armedEpisode: episodeForAnswer, providerRegistry: this.providerRegistry, manifest: this.manifest });
      } catch (err) {
        const code = err.code ?? "answer_mode_mismatch";
        this.eventSink("quest.surface.answer_failed", { session_epoch: frame.session_epoch, stream_id: frame.stream_id, reason: code, utterance_id: frame.payload?.utterance_id ?? "" });
        try { this.#sendError(code, frame); } catch {}
        return;
      }
    }
    try {
      const result = await this.pipeline.handleUtteranceEnd({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: frame.payload, manifestLeases: this.manifest ? this.manifest.leases : null, authorizeLocalAttach: authorizeLocalAttachRecheck });
      if (result.dropped) {
        return;
      }
      // paired panel + playback: send as downlink with correlated answer_id
      // (once already reserved atomically before chat, no additional add needed)
      const panelLeaseRef = this.manifest ? this.manifest.leases.panel.lease_id : this.lease.lease_id;
      const audioLeaseRef = this.manifest ? this.manifest.leases.audio_present.lease_id : this.lease.lease_id;
      // new panel revision
      this.snapshot = result.panelPayload; // update for ack validation
      this.#send("PANEL_SNAPSHOT", result.panelPayload, { leaseRef: panelLeaseRef, streamId: 0 });
      // playback chunks: each with same answer_id+utterance_id, stereo downlink
      // use a dedicated playback stream (e.g., incoming streamId + 100) to keep isolation
      const playbackStreamId = (Number(frame.stream_id) + 100) % 0xffff_ffff;
      for (const chunk of result.ttsChunks) {
        this.#send("AUDIO_CHUNK", chunk, { leaseRef: audioLeaseRef, streamId: playbackStreamId });
      }
      // H: terminal ANSWER_END after chunks — same stream/lease, exact correlation, drain-then-clear
      const answerEnd = createAnswerEndPayload({ utteranceId: result.utteranceId, answerId: result.answerId });
      this.#send("ANSWER_END", answerEnd, { leaseRef: audioLeaseRef, streamId: playbackStreamId });
      this.eventSink("quest.surface.answer_delivered", {
        session_epoch: frame.session_epoch,
        stream_id: frame.stream_id,
        utterance_id: result.utteranceId,
        answer_id: result.answerId,
        panel_revision: result.revision,
        playback_stream_id: playbackStreamId,
        local_only: true,
      });
    } catch (error) {
      const code = error instanceof QuestSurfaceProtocolError ? error.code : "answer_pipeline_failed";
      // F2: clear exact failed stream's PCM/state when active, as sync path does
      try {
        const state = this.pipeline ? this.pipeline.getActiveUtterance(frame.session_epoch, frame.stream_id) : null;
        if (state) {
          try { this.pipeline.handleCancel({ sessionEpoch: frame.session_epoch, streamId: frame.stream_id, payload: { utterance_id: state.utteranceId, reason: code } }); } catch {}
        }
      } catch {}
      this.eventSink("quest.surface.answer_failed", { session_epoch: frame.session_epoch, stream_id: frame.stream_id, reason: code, utterance_id: frame.payload?.utterance_id ?? "" });
      try { this.#sendError(code, frame); } catch {}
    }
  }

  #handleHello(frame) {
    const resumeRequested = Boolean(
      frame.payload
      && typeof frame.payload === "object"
      && !Array.isArray(frame.payload)
      && Object.prototype.hasOwnProperty.call(frame.payload, "resume_intent"),
    );
    // Any rejected resume attempt must leave the shared latch byte-for-byte
    // unchanged, including the no-latch case.
    this.suppressLatchOnClose = resumeRequested;
    const resumeIntent = decodeHelloResumeIntent(frame.payload);
    const selectedVersion = selectHighestQuestSurfaceVersion(frame.payload?.supported_versions);
    if (selectedVersion === null) {
      this.#sendError("version_no_overlap");
      this.close("version_no_overlap");
      return;
    }
    const spatialProfiles = decodeQuestSpatialHelloProfiles(frame.payload);
    if (spatialProfiles.length > 0 && this.spatialDocumentGrantId) {
      if (resumeIntent) {
        throw new QuestSurfaceProtocolError("spatial_resume_unsupported", "Spatial document v1 has no resume path.");
      }
      this.#handleSpatialHello(selectedVersion, spatialProfiles);
      return;
    }
    if (!resumeIntent && this.micLatch.isLatched() && this.micLatch.latchedEpisodeId) {
      throw new QuestSurfaceProtocolError(
        "resume_required",
        "A normal HELLO cannot clear an active device microphone latch.",
      );
    }
    if (resumeIntent) {
      const currentEpisode = this.getArmedEpisode ? this.getArmedEpisode() : null;
      if (!this.micLatch.isLatched()) {
        throw new QuestSurfaceProtocolError("resume_latch_missing", "No latched session is resumable.");
      }
      if (resumeIntent.resume_handle !== this.micLatch.resumeHandle) {
        throw new QuestSurfaceProtocolError("resume_handle_mismatch", "Resume handle does not match the active episode latch.");
      }
      if (!currentEpisode
          || !currentEpisode.id
          || currentEpisode.id !== this.micLatch.latchedEpisodeId
          || this.now() >= currentEpisode.expiresAtMs) {
        throw new QuestSurfaceProtocolError("resume_episode_mismatch", "The originally issued episode is not current and armed.");
      }
      if (this.sessionEpoch === "0" || this.sessionEpoch === this.micLatch.latchedEpoch) {
        throw new QuestSurfaceProtocolError("resume_fresh_epoch_required", "Resume requires a fresh nonzero session epoch.");
      }
    }

    // #A: require exact configured panel grant + bounded episode for v1b
    const panelAuthForManifest = this.authorize();
    // Try v1b manifest first if the store has grants for all four capabilities and episode is armed
    const manifestAuth = this.#tryAuthorizeManifest(panelAuthForManifest);
    if (resumeIntent && (!manifestAuth || !manifestAuth.allowed)) {
      throw new QuestSurfaceProtocolError("resume_not_authorized", "Resume manifest authority is unavailable.");
    }
    if (resumeIntent) {
      const resumed = this.micLatch.deliberateResume({
        freshEpoch: this.sessionEpoch,
        resumeHandle: resumeIntent.resume_handle,
        currentEpisodeId: manifestAuth.episodeId,
        explicit: resumeIntent.explicit_local_action,
      });
      if (!resumed) {
        throw new QuestSurfaceProtocolError("resume_latch_rejected", "The device microphone latch rejected resume.");
      }
      // From this point on, any bootstrap or transport failure must relatch to
      // the fresh epoch and the same episode.
      this.issuedEpisodeId = manifestAuth.episodeId;
      this.suppressLatchOnClose = false;
      this.eventSink("quest.surface.session_resume_authorized", {
        session_epoch: this.sessionEpoch,
        episode_id: manifestAuth.episodeId,
        explicit_local_action: true,
      });
    }
    if (manifestAuth && manifestAuth.allowed) {
      this.helloReceived = true;
      this.lease = manifestAuth.leases.panel; // for backward compat ack path
      this.manifest = manifestAuth.manifest;
      this.issuedEpisodeId = manifestAuth.episodeId;
      this.manifestGrantIds = { ...manifestAuth.grantIds };
      this.renewalGeneration = 0;
      const ttlMs = this.manifest.ttl_ms;
      this.snapshot = createPanelSnapshotPayload({
        revision: this.panel.revision,
        leaseRef: this.manifest.leases.panel.lease_id,
        text: this.panel.text,
        surfaceId: this.panel.surface_id,
        ttlMs: Math.min(this.panel.ttl_ms, ttlMs),
        pose: this.panel.pose,
        bounds: this.panel.bounds,
      });
      this.#send("HELLO_ACK", {
        selected_version: selectedVersion,
        provider: QUEST_SURFACE_PROVIDER_ID,
        supported_render_extensions: [],
      }, { leaseRef: "" });
      this.#send("LEASE_MANIFEST", this.manifest, { leaseRef: "" });
      // backward compat LEASE for existing clients
      this.#send("LEASE", this.manifest.leases.panel, { leaseRef: "" });
      this.#send("PANEL_SNAPSHOT", this.snapshot, { leaseRef: this.manifest.leases.panel.lease_id });
      this.eventSink("quest.surface.snapshot_sent", {
        session_epoch: this.sessionEpoch,
        lease_id: this.manifest.leases.panel.lease_id,
        source_grant_id: manifestAuth.grantIds.panel,
        capability: QUEST_SURFACE_CAPABILITY,
        provider: QUEST_SURFACE_PROVIDER_ID,
        document_revision: this.panel.revision,
        document_hash: this.snapshot.document_sha256,
        surface_id: this.panel.surface_id,
        panel_text_bytes: Buffer.byteLength(this.panel.text, "utf8"),
        panel_text_included: false,
        manifest: true,
      });
      this.#scheduleManifestTimers();
      return;
    }

    const authorization = this.authorize();
    if (!authorization.allowed) {
      this.eventSink("quest.surface.lease_refused", {
        session_epoch: this.sessionEpoch,
        grant_id: "",
        reason: authorization.code,
        panel_sent: false,
      });
      this.#sendError("grant_not_authorized");
      this.socket.end();
      return;
    }

    this.helloReceived = true;
    const constraintTtl = Number.isSafeInteger(authorization.grant.constraints?.lease_ttl_ms)
      ? authorization.grant.constraints.lease_ttl_ms
      : this.leaseTtlMs;
    const ttlMs = Math.max(1, Math.min(
      this.leaseTtlMs,
      constraintTtl,
      QUEST_SURFACE_MAX_LEASE_TTL_MS,
    ));
    this.lease = createQuestSurfaceLease({
      sessionEpoch: this.sessionEpoch,
      sourceGrant: authorization.grant,
      ttlMs,
      issuedAtMs: this.now(),
    });
    this.snapshot = createPanelSnapshotPayload({
      revision: this.panel.revision,
      leaseRef: this.lease.lease_id,
      text: this.panel.text,
      surfaceId: this.panel.surface_id,
      ttlMs: Math.min(this.panel.ttl_ms, ttlMs),
      pose: this.panel.pose,
      bounds: this.panel.bounds,
    });

    this.#send("HELLO_ACK", {
      selected_version: selectedVersion,
      provider: QUEST_SURFACE_PROVIDER_ID,
      supported_render_extensions: [],
    }, { leaseRef: "" });
    this.#send("LEASE", this.lease, { leaseRef: "" });
    this.#send("PANEL_SNAPSHOT", this.snapshot, { leaseRef: this.lease.lease_id });
    this.eventSink("quest.surface.snapshot_sent", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease.lease_id,
      source_grant_id: authorization.grant.id,
      capability: QUEST_SURFACE_CAPABILITY,
      provider: QUEST_SURFACE_PROVIDER_ID,
      document_revision: this.panel.revision,
      document_hash: this.snapshot.document_sha256,
      surface_id: this.panel.surface_id,
      panel_text_bytes: Buffer.byteLength(this.panel.text, "utf8"),
      panel_text_included: false,
    });
    this.leaseTimer = setTimeout(() => {
      this.#sendError("lease_expired");
      this.close("lease_expired");
    }, ttlMs);
    this.leaseTimer.unref?.();
  }

  #handleSpatialHello(selectedVersion, spatialProfiles) {
    const supportedProfiles = spatialProfiles.map((profile) => validateQuestSpatialProfile(profile));
    const selectedProfile = supportedProfiles.find((profile) => (
      this.spatialProfile && deepEqualJson(profile, this.spatialProfile)
    ));
    if (!selectedProfile) {
      throw new QuestSurfaceProtocolError("spatial_profile_no_overlap", "No supported spatial profile was advertised.");
    }
    const negotiated = {
      profile: selectedProfile,
      spatial_profile: createQuestSpatialProfileWrapper(selectedProfile),
    };
    const authorization = this.authorizeSpatial?.();
    if (!authorization?.allowed || authorization.grant.id !== this.spatialDocumentGrantId) {
      this.eventSink("quest.surface.spatial_lease_refused", {
        session_epoch: this.sessionEpoch,
        grant_id: this.spatialDocumentGrantId,
        reason: authorization?.code ?? "grant_not_authorized",
        snapshot_sent: false,
      });
      throw new QuestSurfaceProtocolError("grant_not_authorized", "Spatial document grant is not authorized.");
    }
    const constraintTtl = authorization.grant.constraints.lease_ttl_ms;
    const ttlMs = Math.max(1, Math.min(
      this.leaseTtlMs,
      constraintTtl,
      QUEST_SURFACE_MAX_LEASE_TTL_MS,
    ));
    const issuedAtMs = this.now();
    const lease = createQuestSurfaceLease({
      sessionEpoch: this.sessionEpoch,
      sourceGrant: authorization.grant,
      ttlMs,
      issuedAtMs,
    });
    // A document TTL is measured from admission time, so it cannot consume the
    // lease's full lifetime: construction and transport would make it outlive
    // the remaining lease before the peer could admit it.
    const documentTtlMs = Math.max(1, Math.floor(ttlMs / 2));
    const fixture = this.spatialFixtureFactory({
      sessionEpoch: this.sessionEpoch,
      leaseRef: lease.lease_id,
      documentId: this.spatialDocumentId,
      revision: "1",
      ttlMs: documentTtlMs,
      profile: negotiated.profile,
    });
    const fixtureResourcesByDigest = new Map(
      fixture.golden.resources.map((entry) => [entry.descriptor.resource_sha256, entry]),
    );
    const preloadedResourceBytes = new Map();
    for (const preloaded of negotiated.profile.preloaded_resources) {
      const fixtureResource = fixtureResourcesByDigest.get(preloaded.resource_sha256);
      if (fixtureResource && sameResourceContent(preloaded, fixtureResource.descriptor)) {
        preloadedResourceBytes.set(preloaded.resource_sha256, fixtureResource.bytes);
      }
    }
    const transferChunks = fixture.chunks.filter((chunk) => !preloadedResourceBytes.has(chunk.resource_sha256));
    const admission = new QuestSpatialAdmissionSession({
      sessionEpoch: this.sessionEpoch,
      lease,
      profile: negotiated.profile,
      profileWrapper: negotiated.spatial_profile,
      peerFingerprint256: this.peerFingerprint256,
      now: this.now,
      preloadedResourceBytes,
    });
    admission.offerSnapshot(fixture.snapshot_payload);
    for (const chunk of transferChunks) admission.acceptResourceChunk(chunk);
    const ready = admission.finalize(this.spatialDocumentId);
    if (ready.outcome !== "ready" && ready.outcome !== "degraded_ready") {
      admission.close();
      throw new QuestSurfaceProtocolError("spatial_fixture_not_admissible", "Spatial fixture did not pass host admission.");
    }
    this.helloReceived = true;
    this.lease = lease;
    this.spatialLease = lease;
    this.spatialFixture = fixture;
    this.spatialAdmission = admission;
    this.#send("HELLO_ACK", {
      selected_version: selectedVersion,
      provider: QUEST_SURFACE_PROVIDER_ID,
      supported_render_extensions: [],
      spatial_profile: negotiated.spatial_profile,
    }, { leaseRef: "" });
    this.#send("LEASE", lease, { leaseRef: "" });
    this.#send("SPATIAL_SNAPSHOT", fixture.snapshot_payload, { leaseRef: lease.lease_id });
    for (const chunk of transferChunks) {
      this.#send("RESOURCE_CHUNK", chunk, { leaseRef: lease.lease_id });
    }
    this.eventSink("quest.surface.spatial_snapshot_sent", {
      session_epoch: this.sessionEpoch,
      lease_id: lease.lease_id,
      source_grant_id: lease.source_grant_id,
      capability: QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT,
      provider: QUEST_SURFACE_PROVIDER_ID,
      document_id: fixture.document.document_id,
      document_revision: fixture.document.revision,
      document_hash: fixture.snapshot_payload.document_sha256,
      profile_id: fixture.profile.id,
      profile_hash: fixture.profile_wrapper.profile_sha256,
      resource_count: fixture.document.resources.length,
      resource_bytes: fixture.document.declared_cost.resource_bytes,
      transferred_chunk_count: transferChunks.length,
      preloaded_resource_count: preloadedResourceBytes.size,
      document_body_included: false,
      resource_bodies_included: false,
    });
    this.leaseTimer = setTimeout(() => {
      this.#sendError("lease_expired");
      this.close("lease_expired");
    }, ttlMs);
    this.leaseTimer.unref?.();
  }

  #tryAuthorizeManifest(panelAuth) {
    if (!panelAuth || !panelAuth.allowed) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "panel_auth_failed", code: panelAuth?.code ?? "no_panel_auth" });
      return null;
    }
    if (panelAuth.grant.id !== this.configuredPanelGrantId) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "panel_grant_mismatch", expected: this.configuredPanelGrantId, actual: panelAuth.grant.id });
      return null;
    }
    const episode = this.getArmedEpisode ? this.getArmedEpisode() : null;
    if (!episode || !episode.id || this.now() >= episode.expiresAtMs) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "episode_not_armed_or_expired", episode: episode?.id ?? "none" });
      return null;
    }
    if (!this.configuredGrantIds) {
      this.eventSink("quest.surface.manifest_auth_failed", {
        capability: "quest_surface_v1b_manifest",
        reason: "quest_surface_grant_tuple_required",
      });
      return null;
    }
    const authorizations = authorizeConfiguredQuestGrants({
      grantStore: this.grantStore,
      grantRecoveryReport: this.grantRecoveryReport,
      capabilityCatalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
      grantIds: this.configuredGrantIds,
      localAttachScope: this.localAttachScope,
      peerFingerprint256: this.peerFingerprint256,
      panel: this.panel,
    });
    for (const [leaf, authorization] of Object.entries(authorizations)) {
      if (!authorization.allowed) {
        this.eventSink("quest.surface.manifest_auth_failed", {
          leaf,
          capability: QUEST_SURFACE_GRANT_DEFINITIONS[leaf].capability,
          scope: QUEST_SURFACE_GRANT_DEFINITIONS[leaf].scope === "configured"
            ? this.localAttachScope
            : QUEST_SURFACE_GRANT_DEFINITIONS[leaf].scope,
          reason: authorization.code,
          details: authorization.details,
        });
        return null;
      }
    }
    if (authorizations.panel.grant.id !== panelAuth.grant.id) {
      this.eventSink("quest.surface.manifest_auth_failed", {
        leaf: "panel",
        reason: "quest_surface_panel_authorization_diverged",
      });
      return null;
    }

    let ttlMs = this.leaseTtlMs;
    for (const authorization of Object.values(authorizations)) {
      if (Number.isSafeInteger(authorization.grant.constraints?.lease_ttl_ms)) {
        ttlMs = Math.min(ttlMs, authorization.grant.constraints.lease_ttl_ms);
      }
    }
    ttlMs = Math.max(1, Math.min(ttlMs, QUEST_SURFACE_MAX_LEASE_TTL_MS));
    const issuedAtMs = this.now();
    const episodeRemaining = episode.expiresAtMs - issuedAtMs;
    if (episodeRemaining <= 0) {
      this.eventSink("quest.surface.manifest_not_armed", { reason: "episode_expired_at_issue", episode: episode.id });
      return null;
    }
    ttlMs = Math.min(ttlMs, episodeRemaining);

    const leases = {};
    const grantIds = {};
    for (const [leaf, authorization] of Object.entries(authorizations)) {
      const lease = createQuestSurfaceLease({
        sessionEpoch: this.sessionEpoch,
        sourceGrant: authorization.grant,
        ttlMs,
        issuedAtMs,
      });
      leases[leaf] = lease;
      grantIds[leaf] = authorization.grant.id;
    }
    try {
      const manifest = createLeaseManifestPayload({
        sessionEpoch: this.sessionEpoch,
        resumeHandle: this.micLatch.resumeHandle,
        ttlMs,
        issuedAtMs,
        leases,
      });
      const episodeForManifest = this.getArmedEpisode ? this.getArmedEpisode() : null;
      if (episodeForManifest && episodeForManifest.mode) {
        try {
          matchAnswerProvider({ armedEpisode: episodeForManifest, providerRegistry: this.providerRegistry, manifest });
        } catch (err) {
          this.eventSink("quest.surface.manifest_not_armed", { reason: "answer_mode_mismatch", code: err.code ?? String(err.message), mode: episodeForManifest.mode });
          return null;
        }
      }
      return { allowed: true, leases, manifest, grantIds, episodeId: episode.id };
    } catch {
      return null;
    }
  }

  #scheduleManifestTimers() {
    clearTimeout(this.renewalTimer);
    clearTimeout(this.manifestExpiryTimer);
    this.renewalTimer = null;
    this.manifestExpiryTimer = null;
    const manifest = this.manifest;
    if (this.closed || !manifest) return;

    const token = ++this.manifestTimerToken;
    const nowMs = this.now();
    const expiryDelay = Math.max(0, manifest.expires_at_ms - nowMs);
    this.manifestExpiryTimer = setTimeout(() => this.#handleManifestExpiry(token), expiryDelay);
    this.manifestExpiryTimer.unref?.();

    const targetAtMs = manifest.issued_at_ms + Math.floor(manifest.ttl_ms / 2);
    const renewalDelay = Math.max(0, targetAtMs - nowMs);
    this.renewalTimer = setTimeout(() => this.#attemptLeaseRenewal(token), renewalDelay);
    this.renewalTimer.unref?.();
  }

  #handleManifestExpiry(token) {
    if (this.closed || token !== this.manifestTimerToken || !this.manifest) return;
    const remainingMs = this.manifest.expires_at_ms - this.now();
    if (remainingMs > 0) {
      this.manifestExpiryTimer = setTimeout(() => this.#handleManifestExpiry(token), remainingMs);
      this.manifestExpiryTimer.unref?.();
      return;
    }
    this.#sendError("lease_expired");
    this.close("lease_expired");
  }

  #attemptLeaseRenewal(token) {
    if (this.closed || token !== this.manifestTimerToken || !this.manifest) return;
    const nowMs = this.now();
    const targetAtMs = this.manifest.issued_at_ms + Math.floor(this.manifest.ttl_ms / 2);
    if (nowMs < targetAtMs) {
      this.renewalTimer = setTimeout(() => this.#attemptLeaseRenewal(token), targetAtMs - nowMs);
      this.renewalTimer.unref?.();
      return;
    }
    const minimumLeadMs = Math.min(5_000, Math.max(1, Math.floor(this.manifest.ttl_ms / 4)));
    if (nowMs >= this.manifest.expires_at_ms - minimumLeadMs) {
      this.#withholdLeaseRenewal("renewal_window_missed");
      return;
    }
    if (this.micLatch.isLatched()) {
      this.#withholdLeaseRenewal("session_narrowed");
      return;
    }
    if (this.renewalGeneration >= Number.MAX_SAFE_INTEGER) {
      this.#withholdLeaseRenewal("renewal_generation_exhausted");
      return;
    }

    const candidate = this.#buildRenewedManifest(nowMs);
    if (!candidate) return;
    const nextGeneration = this.renewalGeneration + 1;
    const leaseIds = Object.fromEntries(Object.entries(candidate.manifest.leases).map(
      ([leaf, lease]) => [leaf, lease.lease_id],
    ));
    const payload = createLeaseRenewalPayload({
      sessionEpoch: this.sessionEpoch,
      generation: nextGeneration,
      issuedAtMs: candidate.manifest.issued_at_ms,
      ttlMs: candidate.manifest.ttl_ms,
      leaseIds,
    });
    try {
      this.#send("LEASE_RENEWAL", payload, { leaseRef: "", streamId: 0 });
    } catch {
      this.close("lease_renewal_send_failed");
      return;
    }
    if (this.closed || token !== this.manifestTimerToken) return;
    this.manifest = candidate.manifest;
    this.lease = candidate.manifest.leases.panel;
    this.renewalGeneration = nextGeneration;
    this.eventSink("quest.surface.lease_renewed", {
      session_epoch: this.sessionEpoch,
      generation: nextGeneration,
      issued_episode_id: this.issuedEpisodeId,
      expires_at_ms: candidate.manifest.expires_at_ms,
      lease_ids: leaseIds,
    });
    this.#scheduleManifestTimers();
  }

  #buildRenewedManifest(issuedAtMs) {
    const episode = this.getArmedEpisode ? this.getArmedEpisode() : null;
    if (!episode || episode.id !== this.issuedEpisodeId || issuedAtMs >= episode.expiresAtMs) {
      this.#withholdLeaseRenewal("issued_episode_not_current");
      return null;
    }
    const authorizations = authorizeConfiguredQuestGrants({
      grantStore: this.grantStore,
      grantRecoveryReport: this.grantRecoveryReport,
      capabilityCatalog: this.capabilityCatalog,
      providerRegistry: this.providerRegistry,
      grantIds: this.configuredGrantIds,
      localAttachScope: this.localAttachScope,
      peerFingerprint256: this.peerFingerprint256,
      panel: this.panel,
    });
    let ttlMs = this.leaseTtlMs;
    const projectedLeases = {};
    for (const [leaf, authorization] of Object.entries(authorizations)) {
      if (!authorization.allowed) {
        this.#withholdLeaseRenewal(`grant_${leaf}_${authorization.code}`);
        return null;
      }
      const original = this.manifest.leases[leaf];
      if (!original || authorization.grant.id !== this.manifestGrantIds?.[leaf]) {
        this.#withholdLeaseRenewal(`grant_${leaf}_identity_changed`);
        return null;
      }
      if (Number.isSafeInteger(authorization.grant.constraints?.lease_ttl_ms)) {
        ttlMs = Math.min(ttlMs, authorization.grant.constraints.lease_ttl_ms);
      }
      projectedLeases[leaf] = createQuestSurfaceLease({
        sessionEpoch: this.sessionEpoch,
        sourceGrant: authorization.grant,
        ttlMs: 1,
        issuedAtMs,
        leaseId: original.lease_id,
      });
      if (!sameStableLeaseAuthority(original, projectedLeases[leaf])) {
        this.#withholdLeaseRenewal(`grant_${leaf}_authority_changed`);
        return null;
      }
    }
    ttlMs = Math.max(1, Math.min(
      ttlMs,
      QUEST_SURFACE_MAX_LEASE_TTL_MS,
      episode.expiresAtMs - issuedAtMs,
    ));
    const expiresAtMs = issuedAtMs + ttlMs;
    if (expiresAtMs <= this.manifest.expires_at_ms) {
      this.#withholdLeaseRenewal("renewal_does_not_extend");
      return null;
    }
    for (const lease of Object.values(projectedLeases)) {
      lease.ttl_ms = ttlMs;
      lease.expires_at_ms = expiresAtMs;
    }
    try {
      const manifest = createLeaseManifestPayload({
        sessionEpoch: this.sessionEpoch,
        resumeHandle: this.micLatch.resumeHandle,
        ttlMs,
        issuedAtMs,
        leases: projectedLeases,
      });
      if (episode.mode) {
        matchAnswerProvider({ armedEpisode: episode, providerRegistry: this.providerRegistry, manifest });
      }
      return { manifest };
    } catch (error) {
      this.#withholdLeaseRenewal(error.code ?? "renewal_manifest_invalid");
      return null;
    }
  }

  #withholdLeaseRenewal(reason) {
    this.eventSink("quest.surface.lease_renewal_withheld", {
      session_epoch: this.sessionEpoch,
      generation: this.renewalGeneration,
      issued_episode_id: this.issuedEpisodeId,
      reason,
    });
  }

  #handleLeaseRenewalAck(frame) {
    try {
      const payload = decodeLeaseRenewalAckPayload(frame.payload);
      if (!this.manifest || payload.generation > this.renewalGeneration) {
        this.eventSink("quest.surface.lease_renewal_ack_rejected", {
          session_epoch: this.sessionEpoch,
          generation: payload.generation,
          reason: "generation_not_issued",
        });
        return;
      }
      this.eventSink("quest.surface.lease_renewal_acknowledged", {
        session_epoch: this.sessionEpoch,
        generation: payload.generation,
        authority_effect: "none",
      });
    } catch (error) {
      this.eventSink("quest.surface.lease_renewal_ack_rejected", {
        session_epoch: this.sessionEpoch,
        generation: 0,
        reason: error.code ?? "renewal_ack_invalid",
      });
    }
  }

  #clearLeaseTimers() {
    clearTimeout(this.leaseTimer);
    clearTimeout(this.renewalTimer);
    clearTimeout(this.manifestExpiryTimer);
    this.leaseTimer = null;
    this.renewalTimer = null;
    this.manifestExpiryTimer = null;
    this.manifestTimerToken += 1;
  }

  #handleBoundsAck(frame) {
    if (!this.lease || frame.lease_ref !== this.lease.lease_id) {
      throw new QuestSurfaceProtocolError("lease_ref_mismatch", "Bounds acknowledgement lease does not match.");
    }
    const expectedDocument = decodePanelSnapshotPayload(this.snapshot);
    const payload = frame.payload;
    requireAckObject(payload);
    if (payload.document_revision !== expectedDocument.document.revision
        || payload.document_hash !== expectedDocument.document_hash
        || payload.surface_id !== expectedDocument.document.surface.id) {
      throw new QuestSurfaceProtocolError(
        "bounds_ack_snapshot_mismatch",
        "Bounds acknowledgement does not match the displayed snapshot.",
      );
    }
    const requestedBounds = expectedDocument.document.surface.bounds;
    const expectedBounds = {
      width_m: Math.max(0.35, Math.min(2.0, requestedBounds.width_m)),
      height_m: Math.max(0.20, Math.min(1.2, requestedBounds.height_m)),
    };
    if (Math.abs(payload.actual_bounds.width_m - expectedBounds.width_m) > 1e-5
        || Math.abs(payload.actual_bounds.height_m - expectedBounds.height_m) > 1e-5) {
      throw new QuestSurfaceProtocolError(
        "bounds_ack_actual_mismatch",
        "Bounds acknowledgement does not match the deterministic v1a clamp.",
      );
    }
    this.eventSink("quest.surface.snapshot_acknowledged", {
      session_epoch: this.sessionEpoch,
      lease_id: this.lease.lease_id,
      document_revision: payload.document_revision,
      document_hash: payload.document_hash,
      surface_id: payload.surface_id,
      actual_width_m: payload.actual_bounds.width_m,
      actual_height_m: payload.actual_bounds.height_m,
      displayed: payload.displayed === true,
    });
  }

  #send(type, payload, { leaseRef = this.lease?.lease_id ?? "", streamId = 0 } = {}) {
    if (this.closed) {
      return;
    }
    const epoch = type === "ERROR" && !this.helloReceived ? "0" : this.sessionEpoch;
    const sid = Number.isSafeInteger(streamId) ? streamId : 0;
    const sequenceKey = `${epoch}:${sid}:downlink`;
    const seq = (this.serverSequences.get(sequenceKey) ?? 0n) + 1n;
    this.serverSequences.set(sequenceKey, seq);
    const frame = createQuestSurfaceFrame({
      type,
      sessionEpoch: epoch,
      streamId: sid,
      direction: "downlink",
      leaseRef,
      seq,
      sendTsNs: monotonicNowNs(),
      payload,
    });
    this.socket.write(serializeQuestSurfaceFrame(frame));
  }

  #sendError(code, frame = null) {
    try {
      if (frame) {
        this.#send("ERROR", { code: String(code), retryable: false }, { leaseRef: "", streamId: Number(frame.stream_id ?? 0) });
      } else {
        this.#send("ERROR", { code: String(code), retryable: false }, { leaseRef: "" });
      }
    } catch {
      // The connection will close. Never broaden behavior to recover an error report.
    }
  }
}

export function createQuestSurfaceFixtureProvider(options) {
  return new QuestSurfaceFixtureProvider(options);
}

function validateTlsOptions(options) {
  if (!options || !options.key || !options.cert || !options.ca) {
    throw providerError(
      "quest_surface_tls_configuration_required",
      "Quest surface fixture requires server key, certificate, and client CA.",
    );
  }
  return options;
}

function normalizePanel(panel = {}) {
  const merged = {
    ...DEFAULT_PANEL,
    ...panel,
    pose: panel.pose ?? DEFAULT_PANEL.pose,
    bounds: panel.bounds ?? DEFAULT_PANEL.bounds,
  };
  createPanelSnapshotPayload({
    revision: merged.revision,
    leaseRef: "validation-lease",
    text: merged.text,
    surfaceId: merged.surface_id,
    ttlMs: merged.ttl_ms,
    pose: merged.pose,
    bounds: merged.bounds,
  });
  return merged;
}

function requireAckObject(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new QuestSurfaceProtocolError("bounds_ack_invalid", "Bounds acknowledgement must be an object.");
  }
  const expected = new Set([
    "document_revision",
    "document_hash",
    "surface_id",
    "actual_bounds",
    "displayed",
  ]);
  if (Object.keys(payload).length !== expected.size
      || Object.keys(payload).some((key) => !expected.has(key))) {
    throw new QuestSurfaceProtocolError("bounds_ack_fields_invalid", "Bounds acknowledgement fields are invalid.");
  }
  const bounds = payload.actual_bounds;
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)
      || Object.keys(bounds).length !== 2
      || !Number.isFinite(bounds.width_m)
      || !Number.isFinite(bounds.height_m)
      || bounds.width_m <= 0
      || bounds.height_m <= 0) {
    throw new QuestSurfaceProtocolError("bounds_ack_actual_invalid", "Actual panel bounds are invalid.");
  }
  if (typeof payload.displayed !== "boolean") {
    throw new QuestSurfaceProtocolError("bounds_ack_displayed_invalid", "Displayed status must be boolean.");
  }
}

function normalizeFingerprint(value) {
  return String(value ?? "").replaceAll(":", "").trim().toUpperCase();
}

function normalizeConfiguredGrantIds(grantIds) {
  if (grantIds === null || grantIds === undefined) {
    return null;
  }
  if (!grantIds || typeof grantIds !== "object" || Array.isArray(grantIds)) {
    throw providerError(
      "quest_surface_grant_tuple_invalid",
      "Quest surface grantIds must be an exact object.",
    );
  }
  const expected = Object.keys(QUEST_SURFACE_GRANT_DEFINITIONS);
  if (Object.keys(grantIds).length !== expected.length
      || Object.keys(grantIds).some((key) => !expected.includes(key))) {
    throw providerError(
      "quest_surface_grant_tuple_invalid",
      "Quest surface grantIds must contain exactly panel, mic_capture, audio_present, and local_attach.",
    );
  }
  const normalized = Object.fromEntries(expected.map((key) => [
    key,
    requireText(grantIds[key], "quest_surface_grant_tuple_invalid"),
  ]));
  if (new Set(Object.values(normalized)).size !== expected.length) {
    throw providerError(
      "quest_surface_grant_tuple_duplicate",
      "Quest surface grantIds must be distinct.",
    );
  }
  return Object.freeze(normalized);
}

function normalizeLocalAttachScope(scope) {
  const value = String(scope ?? "window").trim() || "window";
  if (!new Set(["once", "window"]).has(value)) {
    throw providerError(
      "quest_surface_local_attach_scope_invalid",
      "Quest surface local attach scope must be once or window.",
    );
  }
  return value;
}

function authorizeConfiguredQuestGrants({
  grantStore,
  grantRecoveryReport,
  capabilityCatalog,
  providerRegistry,
  grantIds,
  localAttachScope,
  peerFingerprint256,
  panel,
}) {
  if (!grantIds) {
    return Object.fromEntries(Object.keys(QUEST_SURFACE_GRANT_DEFINITIONS).map((leaf) => [
      leaf,
      deniedQuestGrant("quest_surface_grant_tuple_required", { leaf }),
    ]));
  }
  const authorizations = Object.fromEntries(Object.entries(QUEST_SURFACE_GRANT_DEFINITIONS).map(([leaf, definition]) => {
    const scope = definition.scope === "configured" ? localAttachScope : definition.scope;
    const authorization = authorizeGrantUse({
      store: grantStore,
      grantId: grantIds[leaf],
      capability: definition.capability,
      provider: definition.provider,
      scope,
      recoveryReport: grantRecoveryReport,
      catalog: capabilityCatalog,
      providerRegistry,
    });
    if (!authorization.allowed) {
      return [leaf, authorization];
    }
    const constraintFailure = validateQuestGrantConstraints(authorization.grant.constraints ?? {});
    if (constraintFailure) {
      return [leaf, deniedQuestGrant(constraintFailure, {
        leaf,
        grant_id: grantIds[leaf],
      })];
    }
    const requiredFingerprint = normalizeFingerprint(
      authorization.grant.constraints?.device_fingerprint256,
    );
    if (!/^[A-F0-9]{64}$/.test(requiredFingerprint)) {
      return [leaf, deniedQuestGrant("quest_surface_device_identity_constraint_required", {
        leaf,
        grant_id: grantIds[leaf],
      })];
    }
    const presentedFingerprint = normalizeFingerprint(peerFingerprint256);
    if (presentedFingerprint && requiredFingerprint !== presentedFingerprint) {
      return [leaf, deniedQuestGrant("quest_surface_device_identity_mismatch", {
        leaf,
        grant_id: grantIds[leaf],
      })];
    }
    if (leaf === "panel") {
      const allowedSurfaceIds = Array.isArray(authorization.grant.constraints?.allowed_surface_ids)
        ? authorization.grant.constraints.allowed_surface_ids.map(String)
        : ["panel.main"];
      if (!allowedSurfaceIds.includes(panel.surface_id)) {
        return [leaf, deniedQuestGrant("quest_surface_surface_not_granted", {
          leaf,
          grant_id: grantIds[leaf],
        })];
      }
      const maxTextBytes = Number.isSafeInteger(
        authorization.grant.constraints?.max_panel_text_bytes,
      )
        ? authorization.grant.constraints.max_panel_text_bytes
        : QUEST_SURFACE_MAX_PANEL_TEXT_BYTES;
      if (Buffer.byteLength(panel.text, "utf8") > maxTextBytes) {
        return [leaf, deniedQuestGrant("quest_surface_panel_text_exceeds_grant", {
          leaf,
          grant_id: grantIds[leaf],
        })];
      }
    }
    return [leaf, authorization];
  }));
  const configuredFingerprints = new Set(
    Object.values(authorizations)
      .filter((authorization) => authorization.allowed)
      .map((authorization) => normalizeFingerprint(
        authorization.grant.constraints?.device_fingerprint256,
      )),
  );
  if (!normalizeFingerprint(peerFingerprint256) && configuredFingerprints.size > 1) {
    return Object.fromEntries(Object.keys(authorizations).map((leaf) => [
      leaf,
      deniedQuestGrant("quest_surface_device_identity_configuration_mismatch", {
        leaf,
        grant_id: grantIds[leaf],
      }),
    ]));
  }
  return authorizations;
}

function deniedQuestGrant(code, details) {
  return {
    allowed: false,
    code,
    grant: null,
    details,
  };
}

function sameStableLeaseAuthority(first, second) {
  return Boolean(first && second
    && first.lease_id === second.lease_id
    && first.source_grant_id === second.source_grant_id
    && first.capability === second.capability
    && first.provider === second.provider
    && first.scope === second.scope
    && first.session_epoch === second.session_epoch
    && JSON.stringify(first.constraints) === JSON.stringify(second.constraints));
}

function validateQuestGrantConstraints(constraints) {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
    return "quest_surface_grant_constraints_invalid";
  }
  const allowed = new Set([
    "allowed_surface_ids",
    "max_panel_text_bytes",
    "lease_ttl_ms",
    "device_fingerprint256",
  ]);
  if (Object.keys(constraints).some((key) => !allowed.has(key))) {
    return "quest_surface_grant_constraint_unknown";
  }
  if (Object.hasOwn(constraints, "allowed_surface_ids")) {
    const ids = constraints.allowed_surface_ids;
    if (!Array.isArray(ids)
        || ids.length < 1
        || ids.length > 16
        || ids.some((id) => typeof id !== "string" || !id.trim() || id.trim().length > 256)) {
      return "quest_surface_grant_surface_ids_invalid";
    }
  }
  if (Object.hasOwn(constraints, "max_panel_text_bytes")
      && (!Number.isSafeInteger(constraints.max_panel_text_bytes)
        || constraints.max_panel_text_bytes < 1
        || constraints.max_panel_text_bytes > QUEST_SURFACE_MAX_PANEL_TEXT_BYTES)) {
    return "quest_surface_grant_text_bound_invalid";
  }
  if (Object.hasOwn(constraints, "lease_ttl_ms")
      && (!Number.isSafeInteger(constraints.lease_ttl_ms)
        || constraints.lease_ttl_ms < 1
        || constraints.lease_ttl_ms > QUEST_SURFACE_MAX_LEASE_TTL_MS)) {
    return "quest_surface_grant_lease_ttl_invalid";
  }
  if (Object.hasOwn(constraints, "device_fingerprint256")
      && typeof constraints.device_fingerprint256 !== "string") {
    return "quest_surface_grant_fingerprint_invalid";
  }
  return "";
}

function spatialResource(id, kind, format, bytes, required, metadata) {
  return {
    id,
    kind,
    format,
    resource_sha256: sha256(bytes),
    byte_length: bytes.length,
    required,
    metadata,
  };
}

function spatialSemantics(id, entityId, requiredForMeaning, degradePriority, label, fallbackPresentationId = null) {
  return {
    id,
    entity_id: entityId,
    required_for_meaning: requiredForMeaning,
    degrade_priority: degradePriority,
    label,
    fallback_presentation_id: fallbackPresentationId,
  };
}

function createFixtureAtlasImageBytes() {
  const bytes = Buffer.alloc(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const offset = (y * 8 + x) * 4;
      const on = x === 0 || x === 7 || y === 0 || y === 7 || x === y;
      bytes[offset] = 0xff;
      bytes[offset + 1] = 0xff;
      bytes[offset + 2] = 0xff;
      bytes[offset + 3] = on ? 0xff : 0;
    }
  }
  return bytes;
}

function createFixtureGlyphAtlasBytes(text, imageResourceSha256) {
  const codepoints = [...new Set([...text].map((value) => value.codePointAt(0)))].sort((a, b) => a - b);
  const glyphs = codepoints.map((codepoint, index) => {
    const cell = index % 64;
    const x = cell % 8;
    const y = Math.floor(cell / 8);
    return {
      codepoint,
      advance_px: 6,
      bearing_x_px: 0,
      bearing_y_px: 7,
      width_px: 5,
      height_px: 7,
      u0: x / 8,
      v0: y / 8,
      u1: (x + 1) / 8,
      v1: (y + 1) / 8,
    };
  });
  return Buffer.from(JSON.stringify({
    schema: "soma.glyph-atlas",
    schema_version: 1,
    image_resource_sha256: imageResourceSha256,
    glyphs,
  }), "utf8");
}

function createFixtureTriangleGlb({ uri = "", extension = false, nanPosition = false, badIndex = false } = {}) {
  const bin = Buffer.alloc(92);
  bin.writeUInt16LE(0, 0);
  bin.writeUInt16LE(1, 2);
  bin.writeUInt16LE(badIndex ? 7 : 2, 4);
  const positions = [
    [-0.1, -0.1, 0],
    [0.1, -0.1, 0],
    [0, 0.1, 0],
  ];
  let offset = 8;
  for (let vertex = 0; vertex < positions.length; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      bin.writeFloatLE(nanPosition && vertex === 1 && axis === 0 ? Number.NaN : positions[vertex][axis], offset);
      offset += 4;
    }
  }
  const colors = [
    [1, 0, 0, 1],
    [0, 1, 0, 1],
    [0, 0, 1, 1],
  ];
  for (const color of colors) {
    for (const component of color) {
      bin.writeFloatLE(component, offset);
      offset += 4;
    }
  }
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, COLOR_0: 2 }, indices: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 1, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.1, -0.1, 0], max: [0.1, 0.1, 0] },
      { bufferView: 2, byteOffset: 0, componentType: 5126, count: 3, type: "VEC4" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 6 },
      { buffer: 0, byteOffset: 8, byteLength: 36 },
      { buffer: 0, byteOffset: 44, byteLength: 48 },
    ],
    buffers: [{ byteLength: bin.length, ...(uri ? { uri } : {}) }],
    ...(extension ? { extensionsUsed: ["KHR_draco_mesh_compression"] } : {}),
  };
  let jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPadding) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const totalLength = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const glb = Buffer.alloc(totalLength);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(jsonBytes.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(glb, 20);
  const binHeader = 20 + jsonBytes.length;
  glb.writeUInt32LE(bin.length, binHeader);
  glb.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(glb, binHeader + 8);
  return glb;
}

function validateSpatialDocumentLease(lease, { sessionEpoch, peerFingerprint256 }) {
  if (!lease || typeof lease !== "object" || Array.isArray(lease)) {
    throw spatialError("spatial_lease_invalid", "Spatial document lease is required.");
  }
  const expected = new Set([
    "lease_id", "source_grant_id", "capability", "provider", "scope", "session_epoch",
    "issued_at_ms", "ttl_ms", "expires_at_ms", "constraints",
  ]);
  if (Object.keys(lease).length !== expected.size || Object.keys(lease).some((key) => !expected.has(key))) {
    throw spatialError("spatial_lease_fields_invalid", "Spatial document lease fields are invalid.");
  }
  if (lease.capability !== QUEST_SURFACE_CAPABILITY_DOCUMENT_PRESENT
      || lease.provider !== QUEST_SURFACE_PROVIDER_ID
      || lease.scope !== "session"
      || lease.session_epoch !== sessionEpoch) {
    throw spatialError("spatial_lease_authority_mismatch", "Spatial lease authority tuple is invalid.");
  }
  const constraints = lease.constraints;
  const constraintKeys = new Set([
    "device_fingerprint256", "lease_ttl_ms", "allowed_document_ids", "components", "resource_classes", "spaces",
  ]);
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)
      || Object.keys(constraints).length !== constraintKeys.size
      || Object.keys(constraints).some((key) => !constraintKeys.has(key))) {
    throw spatialError("spatial_lease_constraints_invalid", "Spatial lease constraints are not exact.");
  }
  if (!Number.isSafeInteger(lease.issued_at_ms) || !Number.isSafeInteger(lease.ttl_ms)
      || !Number.isSafeInteger(lease.expires_at_ms)
      || !Number.isSafeInteger(constraints.lease_ttl_ms)
      || constraints.lease_ttl_ms < 1
      || constraints.lease_ttl_ms > QUEST_SURFACE_MAX_LEASE_TTL_MS
      || lease.ttl_ms < 1 || lease.ttl_ms > QUEST_SURFACE_MAX_LEASE_TTL_MS
      || lease.expires_at_ms !== lease.issued_at_ms + lease.ttl_ms
      || lease.ttl_ms > constraints.lease_ttl_ms) {
    throw spatialError("spatial_lease_timing_invalid", "Spatial lease timing is invalid.");
  }
  const requiredFingerprint = normalizeFingerprint(constraints.device_fingerprint256);
  const presentedFingerprint = normalizeFingerprint(peerFingerprint256);
  if (!/^[A-F0-9]{64}$/.test(requiredFingerprint)
      || presentedFingerprint !== requiredFingerprint) {
    throw spatialError("spatial_lease_device_mismatch", "Spatial lease device fingerprint does not match.");
  }
  for (const [field, allowed, max] of [
    ["allowed_document_ids", null, 16],
    ["components", QUEST_SPATIAL_COMPONENTS, QUEST_SPATIAL_COMPONENTS.length],
    ["resource_classes", ["text", "image", "glyph", "mesh"], 4],
    ["spaces", ["view", "local"], 2],
  ]) {
    const values = constraints[field];
    if (!Array.isArray(values) || values.length < 1 || values.length > max
        || new Set(values).size !== values.length
        || values.some((value) => typeof value !== "string" || !value || value.length > 256 || value.trim() !== value
          || (allowed && !allowed.includes(value)))) {
      throw spatialError("spatial_lease_constraints_invalid", `Spatial lease ${field} is invalid.`);
    }
  }
  return structuredClone(lease);
}

function validateSpatialAuthority({
  document,
  lease,
  profileHash,
  frameSessionEpoch,
  frameLeaseRef,
  nowMs,
  documentExpiresAtMs = null,
}) {
  if (frameSessionEpoch !== lease.session_epoch || document.session_epoch !== lease.session_epoch) {
    throw spatialError("spatial_session_epoch_mismatch", "Spatial frame/document epoch does not match the lease.");
  }
  if (frameLeaseRef !== lease.lease_id || document.lease_ref !== lease.lease_id) {
    throw spatialError("spatial_lease_ref_mismatch", "Spatial frame/document lease does not match.");
  }
  if (document.profile_sha256 !== profileHash) {
    throw spatialError("spatial_profile_hash_mismatch", "Spatial document profile hash does not match selection.");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < lease.issued_at_ms || nowMs >= lease.expires_at_ms) {
    throw spatialError("spatial_lease_expired", "Spatial lease is not live.");
  }
  if (documentExpiresAtMs === null) {
    if (document.ttl_ms > lease.ttl_ms || document.ttl_ms > lease.expires_at_ms - nowMs) {
      throw spatialError("spatial_document_ttl_exceeds_lease", "Spatial document outlives its lease.");
    }
  } else if (!Number.isSafeInteger(documentExpiresAtMs)
      || documentExpiresAtMs > lease.expires_at_ms
      || nowMs >= documentExpiresAtMs) {
    throw spatialError("spatial_document_expired", "Spatial document is no longer live.");
  }
  const constraints = lease.constraints;
  if (!constraints.allowed_document_ids.includes(document.document_id)) {
    throw spatialError("spatial_document_not_granted", "Spatial document id is outside the grant.");
  }
  const components = [...document.required_components, ...document.optional_components];
  if (components.some((component) => !constraints.components.includes(component))) {
    throw spatialError("spatial_component_not_granted", "Spatial component is outside the grant.");
  }
  if (document.resources.some((resource) => !constraints.resource_classes.includes(resource.kind))) {
    throw spatialError("spatial_resource_class_not_granted", "Spatial resource class is outside the grant.");
  }
  if (document.entities.some((entity) => entity.parent_id === null && !constraints.spaces.includes(entity.space))) {
    throw spatialError("spatial_space_not_granted", "Spatial root space is outside the grant.");
  }
}

function spatialIdentity(document, documentSha256) {
  return {
    schema_version: 1,
    session_epoch: document.session_epoch,
    lease_ref: document.lease_ref,
    document_id: document.document_id,
    document_revision: document.revision,
    document_sha256: documentSha256,
    profile_id: document.profile_id,
    profile_sha256: document.profile_sha256,
  };
}

function sameResourceContent(left, right) {
  return left.kind === right.kind
    && left.format === right.format
    && left.resource_sha256 === right.resource_sha256
    && left.byte_length === right.byte_length
    && JSON.stringify(left.metadata) === JSON.stringify(right.metadata);
}

function entitiesUsingResource(document, resourceId) {
  const presentationById = new Map(document.presentation.map((record) => [record.id, record]));
  const result = [];
  for (const entity of document.entities) {
    const semantic = document.semantics.find((record) => record.entity_id === entity.id);
    const ids = [...entity.presentation_ids];
    if (semantic?.fallback_presentation_id) ids.push(semantic.fallback_presentation_id);
    if (ids.some((id) => presentationResourceIds(presentationById.get(id)).includes(resourceId))) {
      result.push(entity.id);
    }
  }
  return result;
}

function presentationResourceIds(record) {
  if (!record) return [];
  if (record.type === "text.v1") return [record.text_resource_ref, record.glyph_resource_ref];
  if (record.type === "primitive.quad.v1") return record.image_resource_ref ? [record.image_resource_ref] : [];
  if (record.type === "mesh.glb.uri-free.v1") return [record.mesh_resource_ref];
  return [];
}

function applyDegradation(document, entityId, choices, ledger, reason) {
  if (choices.has(entityId)) return;
  const entity = document.entities.find((record) => record.id === entityId);
  const semantics = document.semantics.find((record) => record.entity_id === entityId);
  if (!entity || !semantics || semantics.required_for_meaning) {
    throw spatialError("spatial_degradation_not_allowed", "Spatial entity cannot be degraded.");
  }
  const fromPresentationId = entity.presentation_ids[0] ?? "";
  choices.set(entityId, semantics.fallback_presentation_id);
  ledger.push({
    entity_id: entityId,
    from_presentation_id: fromPresentationId,
    to_presentation_id: semantics.fallback_presentation_id,
    reason,
  });
}

function measureSpatialDocument(document, resourceBytesById, {
  degradationChoices = new Map(),
  limits = QUEST_SPATIAL_FIXTURE_LIMITS,
} = {}) {
  const decodedResources = decodeSpatialResources(document, resourceBytesById, limits);
  const presentationById = new Map(document.presentation.map((record) => [record.id, record]));
  const entityById = new Map(document.entities.map((entity) => [entity.id, entity]));
  const activePresentationByEntity = new Map();
  for (const entity of document.entities) {
    if (degradationChoices.has(entity.id)) {
      const fallback = degradationChoices.get(entity.id);
      activePresentationByEntity.set(entity.id, fallback ? [fallback] : []);
    } else {
      activePresentationByEntity.set(entity.id, [...entity.presentation_ids]);
    }
  }
  const usedResourceIds = new Set();
  for (const ids of activePresentationByEntity.values()) {
    for (const id of ids) {
      for (const resourceId of presentationResourceIds(presentationById.get(id))) usedResourceIds.add(resourceId);
    }
  }
  for (const resourceId of [...usedResourceIds]) {
    const decoded = decodedResources.get(resourceId);
    if (decoded?.kind === "glyph") {
      const image = document.resources.find((resource) => resource.resource_sha256 === decoded.image_resource_sha256);
      if (!image) throw markSpatialStage(spatialError("spatial_glyph_image_missing", "Glyph atlas image digest is not declared."), 4);
      usedResourceIds.add(image.id);
    }
  }
  for (const resourceId of usedResourceIds) {
    if (!decodedResources.has(resourceId)) {
      throw markSpatialStage(spatialError("spatial_resource_missing", "Active resource bytes are missing."), 3);
    }
  }
  let draws = 0;
  let vertices = 0;
  let triangles = 0;
  let lineSegments = 0;
  let linePoints = 0;
  let textBytes = 0;
  let textCodepoints = 0;
  let textLines = 0;
  const localBounds = new Map();
  for (const entity of document.entities) {
    let entityBounds = null;
    if (entity.visibility) {
      for (const presentationId of activePresentationByEntity.get(entity.id)) {
        const record = presentationById.get(presentationId);
        if (!record || record.type.startsWith("material.")) continue;
        draws += 1;
        let bounds;
        switch (record.type) {
          case "panel.v1":
            vertices += 4;
            triangles += 2;
            bounds = centeredPlaneBounds(record.width_m, record.height_m);
            break;
          case "primitive.quad.v1":
            vertices += 4;
            triangles += 2;
            bounds = centeredPlaneBounds(record.width_m, record.height_m);
            break;
          case "primitive.line.v1": {
            const segments = record.points_m.length - 1;
            lineSegments += segments;
            linePoints += record.points_m.length;
            vertices += segments * 4;
            triangles += segments * 2;
            bounds = pointsBounds(record.points_m, record.width_m / 2);
            break;
          }
          case "text.v1": {
            const text = decodedResources.get(record.text_resource_ref);
            const glyph = decodedResources.get(record.glyph_resource_ref);
            if (!text || !glyph) throw markSpatialStage(spatialError("spatial_text_resource_missing", "Text resources are missing."), 4);
            for (const codepoint of text.codepoints) {
              if (!glyph.codepoints.has(codepoint)) {
                throw markSpatialStage(spatialError("spatial_glyph_coverage_missing", "Glyph atlas lacks a text codepoint."), 4);
              }
            }
            textBytes += text.byte_length;
            textCodepoints += text.codepoints.length;
            textLines += text.lines.length;
            if (text.lines.length > record.max_lines) {
              throw markSpatialStage(spatialError("spatial_text_max_lines_exceeded", "Spatial text exceeds its authored max_lines."), 4);
            }
            vertices += text.codepoints.length * 4;
            triangles += text.codepoints.length * 2;
            const longest = Math.max(...text.lines.map((line) => [...line].length));
            const width = Math.min(record.max_width_m, longest * record.font_size_m * 0.6);
            const height = text.lines.length * record.font_size_m;
            bounds = centeredPlaneBounds(width, height);
            break;
          }
          case "mesh.glb.uri-free.v1": {
            const mesh = decodedResources.get(record.mesh_resource_ref);
            if (!mesh) throw markSpatialStage(spatialError("spatial_mesh_resource_missing", "Mesh resource is missing."), 4);
            vertices += mesh.vertices;
            triangles += mesh.triangles;
            bounds = mesh.bounds;
            break;
          }
          default:
            throw markSpatialStage(spatialError("spatial_presentation_unsupported", "Presentation type is unsupported."), 5);
        }
        entityBounds = unionBounds(entityBounds, bounds);
      }
    }
    if (entityBounds && !boundsContains(entity.declared_local_bounds, entityBounds, 1e-5)) {
      throw markSpatialStage(spatialError("spatial_geometry_escapes_declared_bounds", "Actual geometry escapes declared local bounds."), 5);
    }
    if (entityBounds) localBounds.set(entity.id, entityBounds);
  }
  if (linePoints > limits.line_points || textBytes > limits.text_bytes
      || textCodepoints > limits.text_codepoints || textLines > limits.text_lines) {
    throw markSpatialStage(spatialError("spatial_decoded_profile_limit", "Decoded text or line data exceeds the profile."), 4);
  }
  const worldBounds = new Map();
  for (const entity of document.entities) {
    const local = localBounds.get(entity.id);
    if (local) worldBounds.set(entity.id, transformBoundsThroughParents(local, entity.id, entityById));
  }
  let sceneBounds = null;
  for (const entity of document.entities) {
    if (entity.visibility && worldBounds.has(entity.id)) sceneBounds = unionBounds(sceneBounds, worldBounds.get(entity.id));
  }
  const resourceBytes = checkedProviderSum(
    [...usedResourceIds].map((id) => document.resources.find((resource) => resource.id === id).byte_length),
    "spatial_resource_cost_overflow",
  );
  const residentBytes = checkedProviderSum([
    resourceBytes,
    vertices * 32,
    triangles * 12,
  ], "spatial_resident_cost_overflow");
  const texturePixels = checkedProviderSum(
    [...usedResourceIds]
      .map((id) => document.resources.find((resource) => resource.id === id))
      .filter((resource) => resource.kind === "image")
      .map((resource) => resource.metadata.width_px * resource.metadata.height_px),
    "spatial_texture_cost_overflow",
  );
  return {
    recomputed_cost: {
      resource_bytes: resourceBytes,
      resident_bytes: residentBytes,
      draws,
      vertices,
      triangles,
      line_segments: lineSegments,
      texture_pixels: texturePixels,
    },
    decoded_counts: { line_points: linePoints, text_bytes: textBytes, text_codepoints: textCodepoints, text_lines: textLines },
    scene_actual_bounds: sceneBounds,
    entity_actual_bounds: [...worldBounds.entries()]
      .map(([entityId, actualBounds]) => ({ entity_id: entityId, actual_bounds: actualBounds }))
      .sort((left, right) => left.entity_id.localeCompare(right.entity_id)),
  };
}

function decodeSpatialResources(document, resourceBytesById, limits) {
  const result = new Map();
  const digestMap = new Map(document.resources.map((resource) => [resource.resource_sha256, resource]));
  for (const resource of document.resources) {
    const bytes = resourceBytesById.get(resource.id);
    if (!bytes) continue;
    if (bytes.length !== resource.byte_length || sha256(bytes) !== resource.resource_sha256) {
      throw markSpatialStage(spatialError("spatial_resource_integrity_mismatch", "Spatial resource bytes do not match their descriptor."), 3);
    }
    if (resource.kind === "text") {
      if (bytes.length > limits.text_bytes) {
        throw markSpatialStage(spatialError("spatial_text_profile_limit", "Spatial text bytes exceed the selected profile."), 4);
      }
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw markSpatialStage(spatialError("spatial_text_utf8_invalid", "Spatial text is not strict UTF-8."), 4);
      }
      if (/\u0000|[\u202A-\u202E\u2066-\u2069]/u.test(text)) {
        throw markSpatialStage(spatialError("spatial_text_control_forbidden", "Spatial text contains a forbidden control."), 4);
      }
      const lines = text.split("\n");
      const codepoints = [...text].map((value) => value.codePointAt(0));
      if (codepoints.length > limits.text_codepoints || lines.length > limits.text_lines) {
        throw markSpatialStage(spatialError("spatial_text_profile_limit", "Spatial text shape exceeds the selected profile."), 4);
      }
      result.set(resource.id, {
        kind: "text",
        byte_length: bytes.length,
        text,
        lines,
        codepoints,
      });
      continue;
    }
    if (resource.kind === "image") {
      result.set(resource.id, { kind: "image", bytes });
      continue;
    }
    if (resource.kind === "glyph") {
      let glyph;
      try {
        glyph = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw markSpatialStage(spatialError("spatial_glyph_json_invalid", "Glyph atlas JSON is invalid."), 4);
      }
      result.set(resource.id, validateGlyphAtlas(glyph, digestMap, limits));
      continue;
    }
    if (resource.kind === "mesh") {
      result.set(resource.id, validateGeometryOnlyGlb(bytes, limits));
    }
  }
  return result;
}

function validateGlyphAtlas(glyph, resourceByDigest, limits) {
  const expected = new Set(["schema", "schema_version", "image_resource_sha256", "glyphs"]);
  if (!glyph || typeof glyph !== "object" || Array.isArray(glyph)
      || Object.keys(glyph).length !== expected.size || Object.keys(glyph).some((key) => !expected.has(key))
      || glyph.schema !== "soma.glyph-atlas" || glyph.schema_version !== 1
      || typeof glyph.image_resource_sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(glyph.image_resource_sha256)) {
    throw markSpatialStage(spatialError("spatial_glyph_schema_invalid", "Glyph atlas schema is invalid."), 4);
  }
  const image = resourceByDigest.get(glyph.image_resource_sha256);
  if (!image || image.kind !== "image" || image.format !== "image.rgba8.v1") {
    throw markSpatialStage(spatialError("spatial_glyph_image_invalid", "Glyph atlas image is not declared as RGBA8."), 4);
  }
  if (!Array.isArray(glyph.glyphs) || glyph.glyphs.length > Math.min(256, limits.glyphs)) {
    throw markSpatialStage(spatialError("spatial_glyph_count_invalid", "Glyph atlas count is invalid."), 4);
  }
  const codepoints = new Set();
  const fields = new Set([
    "codepoint", "advance_px", "bearing_x_px", "bearing_y_px", "width_px", "height_px",
    "u0", "v0", "u1", "v1",
  ]);
  for (const record of glyph.glyphs) {
    if (!record || typeof record !== "object" || Array.isArray(record)
        || Object.keys(record).length !== fields.size || Object.keys(record).some((key) => !fields.has(key))
        || !Number.isSafeInteger(record.codepoint) || record.codepoint < 0 || record.codepoint > 0x10ffff
        || (record.codepoint >= 0xd800 && record.codepoint <= 0xdfff)
        || codepoints.has(record.codepoint)) {
      throw markSpatialStage(spatialError("spatial_glyph_record_invalid", "Glyph atlas record is invalid."), 4);
    }
    codepoints.add(record.codepoint);
    for (const field of ["advance_px", "bearing_x_px", "bearing_y_px", "width_px", "height_px", "u0", "v0", "u1", "v1"]) {
      if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
        throw markSpatialStage(spatialError("spatial_glyph_metric_invalid", "Glyph metric is not finite."), 4);
      }
    }
    if (record.width_px < 0 || record.height_px < 0
        || record.width_px > image.metadata.width_px || record.height_px > image.metadata.height_px
        || [record.advance_px, record.bearing_x_px, record.bearing_y_px]
          .some((value) => Math.abs(value) > limits.texture_dimension)
        || record.u0 < 0 || record.v0 < 0 || record.u1 > 1 || record.v1 > 1
        || record.u0 > record.u1 || record.v0 > record.v1) {
      throw markSpatialStage(spatialError("spatial_glyph_metric_invalid", "Glyph metric is outside bounds."), 4);
    }
  }
  return { kind: "glyph", image_resource_sha256: glyph.image_resource_sha256, codepoints };
}

function validateGeometryOnlyGlb(bytes, limits) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 28 || bytes.length % 4 !== 0
      || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
      || bytes.readUInt32LE(8) !== bytes.length) {
    throw markSpatialStage(spatialError("spatial_glb_header_invalid", "GLB header is invalid."), 4);
  }
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a || jsonLength % 4 !== 0 || 20 + jsonLength + 8 > bytes.length) {
    throw markSpatialStage(spatialError("spatial_glb_chunks_invalid", "GLB JSON chunk is invalid."), 4);
  }
  const binHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binHeader);
  const binType = bytes.readUInt32LE(binHeader + 4);
  if (binType !== 0x004e4942 || binLength % 4 !== 0 || binHeader + 8 + binLength !== bytes.length) {
    throw markSpatialStage(spatialError("spatial_glb_chunks_invalid", "GLB BIN chunk is invalid."), 4);
  }
  let json;
  try {
    const jsonChunk = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, binHeader));
    const jsonText = jsonChunk.trimEnd();
    if ([...jsonChunk.slice(jsonText.length)].some((character) => character !== " ")) {
      throw new Error("non-canonical JSON padding");
    }
    json = JSON.parse(jsonText);
  } catch {
    throw markSpatialStage(spatialError("spatial_glb_json_invalid", "GLB JSON is invalid."), 4);
  }
  requireExactObjectKeys(json, ["asset", "scene", "scenes", "nodes", "meshes", "accessors", "bufferViews", "buffers"], "spatial_glb_fields_invalid");
  requireExactObject(json.asset, { version: "2.0" }, "spatial_glb_asset_invalid");
  if (json.scene !== 0 || JSON.stringify(json.scenes) !== JSON.stringify([{ nodes: [0] }])
      || JSON.stringify(json.nodes) !== JSON.stringify([{ mesh: 0 }])
      || !Array.isArray(json.meshes) || json.meshes.length !== 1
      || !Array.isArray(json.meshes[0]?.primitives) || json.meshes[0].primitives.length !== 1) {
    throw markSpatialStage(spatialError("spatial_glb_scene_invalid", "GLB scene grammar is invalid."), 4);
  }
  const primitive = json.meshes[0].primitives[0];
  requireExactObjectKeys(primitive, ["attributes", "indices", "mode"], "spatial_glb_primitive_invalid");
  if (primitive.mode !== 4 || !Number.isSafeInteger(primitive.indices)) {
    throw markSpatialStage(spatialError("spatial_glb_primitive_invalid", "GLB primitive mode or index accessor is invalid."), 4);
  }
  const attributeKeys = Object.keys(primitive.attributes ?? {});
  if (!attributeKeys.includes("POSITION") || attributeKeys.some((key) => !["POSITION", "COLOR_0"].includes(key))
      || attributeKeys.length < 1 || attributeKeys.length > 2) {
    throw markSpatialStage(spatialError("spatial_glb_attribute_invalid", "GLB attributes are outside the URI-free subset."), 4);
  }
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1) {
    throw markSpatialStage(spatialError("spatial_glb_buffer_invalid", "GLB must contain exactly one buffer."), 4);
  }
  requireExactObjectKeys(json.buffers[0], ["byteLength"], "spatial_glb_buffer_invalid");
  const declaredBinLength = json.buffers[0].byteLength;
  if (!Number.isSafeInteger(declaredBinLength) || declaredBinLength < 1
      || Math.ceil(declaredBinLength / 4) * 4 !== binLength) {
    throw markSpatialStage(spatialError("spatial_glb_buffer_invalid", "GLB buffer length is invalid."), 4);
  }
  const bin = bytes.subarray(binHeader + 8, binHeader + 8 + binLength);
  for (let index = declaredBinLength; index < bin.length; index += 1) {
    if (bin[index] !== 0) throw markSpatialStage(spatialError("spatial_glb_padding_invalid", "GLB BIN padding must be zero."), 4);
  }
  const expectedCount = attributeKeys.includes("COLOR_0") ? 3 : 2;
  if (!Array.isArray(json.bufferViews) || json.bufferViews.length !== expectedCount
      || !Array.isArray(json.accessors) || json.accessors.length !== expectedCount) {
    throw markSpatialStage(spatialError("spatial_glb_layout_invalid", "GLB view/accessor count is invalid."), 4);
  }
  const ranges = [];
  json.bufferViews.forEach((view) => {
    requireExactObjectKeys(view, ["buffer", "byteOffset", "byteLength"], "spatial_glb_view_invalid");
    if (view.buffer !== 0 || !Number.isSafeInteger(view.byteOffset) || !Number.isSafeInteger(view.byteLength)
        || view.byteOffset < 0 || view.byteLength < 1 || view.byteOffset % 4 !== 0 && view.byteOffset !== 0
        || view.byteOffset + view.byteLength > declaredBinLength) {
      throw markSpatialStage(spatialError("spatial_glb_view_invalid", "GLB buffer view is invalid."), 4);
    }
    ranges.push([view.byteOffset, view.byteOffset + view.byteLength]);
  });
  ranges.sort((a, b) => a[0] - b[0]);
  let coveredThrough = 0;
  for (const [start, end] of ranges) {
    if (start - coveredThrough > 3) {
      throw markSpatialStage(spatialError("spatial_glb_view_gap", "GLB buffer views are not tightly packed."), 4);
    }
    for (let offset = coveredThrough; offset < start; offset += 1) {
      if (bin[offset] !== 0) {
        throw markSpatialStage(spatialError("spatial_glb_padding_invalid", "GLB alignment padding must be zero."), 4);
      }
    }
    coveredThrough = end;
  }
  if (declaredBinLength - coveredThrough > 3) {
    throw markSpatialStage(spatialError("spatial_glb_view_gap", "GLB buffer has unused trailing content."), 4);
  }
  for (let offset = coveredThrough; offset < declaredBinLength; offset += 1) {
    if (bin[offset] !== 0) {
      throw markSpatialStage(spatialError("spatial_glb_padding_invalid", "GLB trailing alignment padding must be zero."), 4);
    }
  }
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index][0] < ranges[index - 1][1]) {
      throw markSpatialStage(spatialError("spatial_glb_view_overlap", "GLB buffer views overlap."), 4);
    }
  }
  const indexAccessor = validateGlbAccessor(json, primitive.indices, {
    role: "indices", componentTypes: [5123, 5125], type: "SCALAR", components: 1,
  });
  if (indexAccessor.count % 3 !== 0) {
    throw markSpatialStage(spatialError("spatial_glb_index_count_invalid", "GLB index count must be divisible by three."), 4);
  }
  const positionAccessor = validateGlbAccessor(json, primitive.attributes.POSITION, {
    role: "position", componentTypes: [5126], type: "VEC3", components: 3, requireMinMax: true,
  });
  if (positionAccessor.count > limits.vertices || indexAccessor.count / 3 > limits.triangles) {
    throw markSpatialStage(spatialError("spatial_glb_profile_limit", "GLB topology exceeds the selected profile."), 4);
  }
  let colorAccessor = null;
  if (Object.hasOwn(primitive.attributes, "COLOR_0")) {
    colorAccessor = validateGlbAccessor(json, primitive.attributes.COLOR_0, {
      role: "color", componentTypes: [5126], type: "VEC4", components: 4,
    });
    if (colorAccessor.count !== positionAccessor.count) {
      throw markSpatialStage(spatialError("spatial_glb_attribute_count_mismatch", "GLB attribute counts differ."), 4);
    }
  }
  const accessorIndexes = [
    primitive.indices,
    primitive.attributes.POSITION,
    ...(colorAccessor ? [primitive.attributes.COLOR_0] : []),
  ];
  const accessors = [indexAccessor, positionAccessor, ...(colorAccessor ? [colorAccessor] : [])];
  if (new Set(accessorIndexes).size !== expectedCount
      || new Set(accessors.map((accessor) => accessor.bufferView)).size !== expectedCount) {
    throw markSpatialStage(spatialError("spatial_glb_layout_invalid", "GLB roles must use distinct accessors and buffer views."), 4);
  }
  const positions = readGlbFloatVectors(bin, json.bufferViews[positionAccessor.bufferView], positionAccessor, 3);
  const actualBounds = pointsBounds(positions, 0, 4);
  if (colorAccessor) {
    const colors = readGlbFloatVectors(bin, json.bufferViews[colorAccessor.bufferView], colorAccessor, 4);
    if (colors.some((color) => color.some((component) => component < 0 || component > 1))) {
      throw markSpatialStage(spatialError("spatial_glb_color_invalid", "GLB COLOR_0 is outside [0,1]."), 4);
    }
  }
  const indices = readGlbIndices(bin, json.bufferViews[indexAccessor.bufferView], indexAccessor);
  if (indices.some((index) => index >= positionAccessor.count)) {
    throw markSpatialStage(spatialError("spatial_glb_index_out_of_range", "GLB index is outside POSITION count."), 4);
  }
  for (let index = 0; index < indices.length; index += 3) {
    if (triangleDegenerate(positions[indices[index]], positions[indices[index + 1]], positions[indices[index + 2]])) {
      throw markSpatialStage(spatialError("spatial_glb_triangle_degenerate", "GLB triangle is degenerate."), 4);
    }
  }
  return {
    kind: "mesh",
    vertices: positionAccessor.count,
    triangles: indexAccessor.count / 3,
    bounds: actualBounds,
  };
}

function validateGlbAccessor(json, index, { role, componentTypes, type, components, requireMinMax = false }) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= json.accessors.length) {
    throw markSpatialStage(spatialError("spatial_glb_accessor_invalid", `GLB ${role} accessor index is invalid.`), 4);
  }
  const accessor = json.accessors[index];
  requireExactObjectKeys(
    accessor,
    requireMinMax
      ? ["bufferView", "byteOffset", "componentType", "count", "type", "min", "max"]
      : ["bufferView", "byteOffset", "componentType", "count", "type"],
    "spatial_glb_accessor_invalid",
  );
  if (!Number.isSafeInteger(accessor.bufferView) || accessor.bufferView < 0 || accessor.bufferView >= json.bufferViews.length
      || accessor.byteOffset !== 0 || !componentTypes.includes(accessor.componentType)
      || accessor.type !== type || !Number.isSafeInteger(accessor.count) || accessor.count < 1) {
    throw markSpatialStage(spatialError("spatial_glb_accessor_invalid", `GLB ${role} accessor shape is invalid.`), 4);
  }
  if (requireMinMax) {
    if (!Array.isArray(accessor.min) || !Array.isArray(accessor.max)
        || accessor.min.length !== 3 || accessor.max.length !== 3
        || [...accessor.min, ...accessor.max].some((value) => typeof value !== "number" || !Number.isFinite(value))
        || accessor.min.some((value, axis) => value > accessor.max[axis])) {
      throw markSpatialStage(spatialError("spatial_glb_accessor_bounds_invalid", "GLB POSITION hints are invalid."), 4);
    }
  }
  const componentBytes = accessor.componentType === 5123 ? 2 : 4;
  const requiredBytes = accessor.count * components * componentBytes;
  if (!Number.isSafeInteger(requiredBytes) || json.bufferViews[accessor.bufferView].byteLength !== requiredBytes) {
    throw markSpatialStage(spatialError("spatial_glb_accessor_length_invalid", "GLB accessor is not tightly packed."), 4);
  }
  return accessor;
}

function readGlbFloatVectors(bin, view, accessor, components) {
  const result = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const vector = [];
    for (let component = 0; component < components; component += 1) {
      const value = bin.readFloatLE(view.byteOffset + (index * components + component) * 4);
      if (!Number.isFinite(value)) {
        throw markSpatialStage(spatialError("spatial_glb_float_invalid", "GLB float is not finite."), 4);
      }
      vector.push(value);
    }
    result.push(vector);
  }
  return result;
}

function readGlbIndices(bin, view, accessor) {
  const result = [];
  const componentBytes = accessor.componentType === 5123 ? 2 : 4;
  for (let index = 0; index < accessor.count; index += 1) {
    const offset = view.byteOffset + index * componentBytes;
    result.push(accessor.componentType === 5123 ? bin.readUInt16LE(offset) : bin.readUInt32LE(offset));
  }
  return result;
}

function triangleDegenerate(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const squaredArea = cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2];
  if (!Number.isFinite(squaredArea)) {
    throw markSpatialStage(spatialError("spatial_glb_geometry_overflow", "GLB geometry arithmetic overflowed."), 4);
  }
  return squaredArea <= 1e-16;
}

function requireExactObjectKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw markSpatialStage(spatialError(code, "Spatial object fields are missing or unknown."), 4);
  }
}

function requireExactObject(value, expected, code) {
  requireExactObjectKeys(value, Object.keys(expected), code);
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw markSpatialStage(spatialError(code, "Spatial object value is invalid."), 4);
  }
}

function centeredPlaneBounds(width, height) {
  return { min_m: [-width / 2, -height / 2, 0], max_m: [width / 2, height / 2, 0] };
}

function pointsBounds(points, padding, failedStage = 5) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis] - padding);
      max[axis] = Math.max(max[axis], point[axis] + padding);
    }
  }
  if ([...min, ...max].some((value) => !Number.isFinite(value))) {
    throw markSpatialStage(spatialError("spatial_geometry_overflow", "Spatial bounds arithmetic overflowed."), failedStage);
  }
  return { min_m: min, max_m: max };
}

function unionBounds(left, right) {
  if (!left) return structuredClone(right);
  return {
    min_m: left.min_m.map((value, axis) => Math.min(value, right.min_m[axis])),
    max_m: left.max_m.map((value, axis) => Math.max(value, right.max_m[axis])),
  };
}

function boundsContains(container, contained, tolerance) {
  return container.min_m.every((value, axis) => contained.min_m[axis] >= value - tolerance)
    && container.max_m.every((value, axis) => contained.max_m[axis] <= value + tolerance);
}

function transformBoundsThroughParents(bounds, entityId, entityById) {
  let points = boundsCorners(bounds);
  let entity = entityById.get(entityId);
  while (entity) {
    points = points.map((point) => applySpatialTransform(point, entity.local_transform));
    entity = entity.parent_id === null ? null : entityById.get(entity.parent_id);
  }
  return pointsBounds(points, 0);
}

function boundsCorners(bounds) {
  const points = [];
  for (const x of [bounds.min_m[0], bounds.max_m[0]]) {
    for (const y of [bounds.min_m[1], bounds.max_m[1]]) {
      for (const z of [bounds.min_m[2], bounds.max_m[2]]) points.push([x, y, z]);
    }
  }
  return points;
}

function applySpatialTransform(point, transform) {
  const scaled = point.map((value, axis) => value * transform.scale[axis]);
  const [qx, qy, qz, qw] = transform.rotation_xyzw;
  const [x, y, z] = scaled;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  const transformed = [
    ix * qw + iw * -qx + iy * -qz - iz * -qy + transform.translation_m[0],
    iy * qw + iw * -qy + iz * -qx - ix * -qz + transform.translation_m[1],
    iz * qw + iw * -qz + ix * -qy - iy * -qx + transform.translation_m[2],
  ];
  if (transformed.some((value) => !Number.isFinite(value))) {
    throw markSpatialStage(spatialError("spatial_transform_overflow", "Spatial transform arithmetic overflowed."), 5);
  }
  return transformed;
}

function assertCostNoGreater(actual, declared, code) {
  for (const key of Object.keys(actual)) {
    if (actual[key] > declared[key]) {
      throw markSpatialStage(spatialError(code, `Recomputed ${key} exceeds its declaration.`), 5);
    }
  }
}

function effectiveSpatialLimits(profileLimits, hardLimits) {
  return {
    resource_bytes: Math.min(profileLimits.resource_ingress_bytes, hardLimits.resource_bytes ?? Number.MAX_SAFE_INTEGER),
    resident_bytes: Math.min(profileLimits.resident_bytes, hardLimits.resident_bytes ?? Number.MAX_SAFE_INTEGER),
    draws: Math.min(profileLimits.draws, hardLimits.draws ?? Number.MAX_SAFE_INTEGER),
    vertices: Math.min(profileLimits.vertices, hardLimits.vertices ?? Number.MAX_SAFE_INTEGER),
    triangles: Math.min(profileLimits.triangles, hardLimits.triangles ?? Number.MAX_SAFE_INTEGER),
    line_segments: Math.min(profileLimits.line_segments, hardLimits.line_segments ?? Number.MAX_SAFE_INTEGER),
    texture_pixels: Math.min(profileLimits.texture_pixels, hardLimits.texture_pixels ?? Number.MAX_SAFE_INTEGER),
  };
}

function costWithinLimits(measured, limits) {
  return Object.entries(measured.recomputed_cost).every(([key, value]) => value <= limits[key]);
}

function checkedProviderSum(values, code) {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) {
      throw spatialError(code, "Spatial integer sum overflowed.");
    }
    sum += value;
  }
  return sum;
}

function boundedProviderInteger(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw providerError(code, "Spatial integer is outside its allowed range.");
  }
  return value;
}

function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function markSpatialStage(error, failedStage) {
  const result = error instanceof Error ? error : spatialError("spatial_admission_failed", String(error));
  if (!Number.isSafeInteger(result.failed_stage)) result.failed_stage = failedStage;
  return result;
}

function spatialError(code, message) {
  return new QuestSurfaceProtocolError(code, message);
}

function requireText(value, code) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw providerError(code, "Quest surface fixture requires a configured grant id.");
  }
  return text;
}

function boundedInteger(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw providerError(code, "Quest surface fixture integer is outside its allowed range.");
  }
  return value;
}

function boundedErrorCode(error) {
  const code = String(error?.code ?? error?.name ?? "transport_error");
  return code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 96);
}

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
