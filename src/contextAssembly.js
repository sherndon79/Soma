import { createHash, randomUUID } from "node:crypto";

import {
  listOccupantMemoryEntries,
  listOccupantMemoryTombstones,
  normalizeOccupantMemoryStore,
} from "./occupantMemory.js";

const RECIPE_FIELDS = new Set([
  "schema_version",
  "recipe_id",
  "origin",
  "objective_class",
  "source_selectors",
  "capability_classes",
  "required_receipt_types",
  "context_budget",
  "ordering",
  "source_class_order",
  "abstention_criteria",
  "abstract_slots",
]);

const SOURCE_SELECTOR_FIELDS = new Set([
  "source_class",
  "required",
  "constraints",
  "minimization",
  "budget",
]);

const BUDGET_FIELDS = new Set(["max_items", "max_chars", "overflow_policy"]);
const SOURCE_BUDGET_FIELDS = new Set(["max_items", "max_chars", "overflow_policy", "reserve", "share"]);
const RESERVE_FIELDS = new Set(["min_items", "min_chars"]);
const MEMORY_CONSTRAINT_FIELDS = new Set(["domain", "memory_classes", "include_tombstones", "recency_window", "consent_scope"]);
const ACTIVITY_CONSTRAINT_FIELDS = new Set(["domain", "activity_classes", "event_types", "capability_classes", "summary_classes"]);
const DURABLE_PROVENANCE_CONSTRAINT_FIELDS = new Set(["domain", "activity_classes", "event_types", "capability_classes", "summary_classes", "coarse_time_buckets"]);

const ORIGINS = new Set(["fixture", "frontier", "local"]);
const OBJECTIVE_CLASSES = new Set([
  "troubleshoot_current_task",
  "prepare_successor_context",
  "summarize_recent_local_activity",
  "answer_user_question_from_memory",
]);
const CAPABILITY_CLASSES = new Set(["memory_context", "local_reasoning", "tool_grounding", "activity_context"]);
const RECEIPT_TYPES = new Set(["source_receipt", "selection_receipt", "memory_snapshot", "activity_snapshot"]);
const ORDERING = new Set(["newest_first", "class_priority", "receipt_priority"]);
const ABSTENTION_CRITERIA = new Set([
  "missing_required_receipt",
  "budget_insufficient",
  "source_degraded",
  "selector_overbroad",
  "replay_state_unpinned",
]);
const ABSTRACT_SLOTS = new Set(["current_domain", "current_episode_mode", "current_task_class"]);
const OVERFLOW_POLICIES = new Set(["evict_oldest", "abstain"]);
const DOMAINS = new Set(["testing", "general", ""]);
const MEMORY_CLASSES = new Set(["self_note"]);
const ACTIVITY_CLASSES = new Set(["capability_use", "control", "status", "observation"]);
const ACTIVITY_EVENT_TYPES = new Set([
  "model.chat.completed",
  "capability.invoked",
  "capability.refused",
  "occupant_ejected",
  "context.fixture.event",
  "memory.provenance.written",
  "memory.provenance.revoked",
]);
const ACTIVITY_CAPABILITY_CLASSES = new Set(["model", "desktop", "memory", "provenance", "system", "none"]);
const SUMMARY_CLASSES = new Set(["completed", "refused", "control", "status", "observed"]);
const COARSE_TIME_BUCKETS = new Set(["recent", "older", "unknown"]);
const RECENCY_WINDOWS = new Set(["all"]);
const CONSENT_SCOPES = new Set(["successor_inheritance", "steward_readable", "local_reasoner_only"]);

const SOURCE_RANKS = Object.freeze({
  durable_provenance_activity: 1,
  local_activity_fixture: 3,
  occupant_memory: 2,
});
const TRUST_RANKS = Object.freeze({
  participant_memory: 3,
  local_provenance: 2,
  local_fixture: 1,
});
const FRESHNESS_RANKS = Object.freeze({
  snapshot_pinned: 3,
  persistent: 2,
  ephemeral: 1,
});

const FRONTIER_ALLOWED_FIELDS = new Set([
  "schema_version",
  "status",
  "reason_class",
  "violated_field_class",
  "abstention_record",
  "included_count_class",
  "excluded_count_class",
  "budget",
  "source_omissions",
]);

const REASON_CLASSES = new Set([
  "selected",
  "budget_evicted",
  "reserves_exceed_budget",
  "metadata_only",
  "recipe_schema_invalid",
  "selector_payload_bearing",
  "source_degraded",
  "missing_required_receipt_type",
  "source_authority_missing",
  "source_domain_mismatch",
  "budget_insufficient",
  "minimization_failed",
  "no_matching_items",
  "overbroad_selector",
  "replay_state_unpinned",
]);

export const SOURCE_ADAPTERS = Object.freeze({
  occupant_memory: createOccupantMemoryAdapter(),
  durable_provenance_activity: createDurableProvenanceActivityAdapter(),
});

export function validateContextRecipe(input = {}, { adapters = SOURCE_ADAPTERS } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe must be an object.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "recipe",
    });
  }
  rejectUnknownFields(input, RECIPE_FIELDS, "recipe");
  const sourceSelectors = normalizeSourceSelectors(input.source_selectors, adapters);
  const contextBudget = normalizeBudget(input.context_budget ?? {}, "context_budget", { maxItems: 128, maxChars: 64_000 });
  validateReserveShareBudget(sourceSelectors, contextBudget);
  const sourceClassOrder = enumArray(
    input.source_class_order ?? sourceSelectors.map((selector) => selector.source_class),
    sourceClassSet(adapters),
    "source_class_order",
    { required: true },
  );
  return deepFreeze({
    schema_version: integerValue(input.schema_version, "schema_version", { min: 1, max: 1 }),
    recipe_id: boundedId(input.recipe_id, "recipe_id"),
    origin: enumValue(input.origin, ORIGINS, "origin"),
    objective_class: enumValue(input.objective_class, OBJECTIVE_CLASSES, "objective_class"),
    source_selectors: sourceSelectors,
    capability_classes: enumArray(input.capability_classes ?? [], CAPABILITY_CLASSES, "capability_classes"),
    required_receipt_types: enumArray(input.required_receipt_types ?? [], RECEIPT_TYPES, "required_receipt_types"),
    context_budget: contextBudget,
    ordering: enumValue(input.ordering ?? "newest_first", ORDERING, "ordering"),
    source_class_order: sourceClassOrder,
    abstention_criteria: enumArray(input.abstention_criteria ?? [], ABSTENTION_CRITERIA, "abstention_criteria"),
    abstract_slots: enumArray(input.abstract_slots ?? [], ABSTRACT_SLOTS, "abstract_slots"),
  });
}

export function createOccupantMemorySnapshot(store = {}) {
  return SOURCE_ADAPTERS.occupant_memory.snapshot(store);
}

export function createCompositeSourceState(sourceStates = {}) {
  const normalized = Object.fromEntries(
    Object.entries(sourceStates)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sourceClass, state]) => [sourceClass, {
        source_class: sourceClass,
        snapshot_digest: stringValue(state.snapshot_digest),
        schema_version: Number(state.schema_version ?? 1),
        freshness_class: stringValue(state.freshness_class),
        trust_tier: stringValue(state.trust_tier),
        item_count: integerOrZero(state.item_count),
        newest_timestamp_ms: integerOrZero(state.newest_timestamp_ms),
      }]),
  );
  return deepFreeze({
    sources: normalized,
    composite_snapshot_digest: digest(canonicalJson(normalized)),
  });
}

export function assembleContextBundle({
  recipe,
  occupantMemoryStore,
  activityStore,
  sourceStores = {},
  sourceRecoveryReports = {},
  adapters = SOURCE_ADAPTERS,
  now = () => new Date(),
  idFactory = randomUUID,
} = {}) {
  let validated;
  try {
    validated = validateContextRecipe(recipe, { adapters });
  } catch (error) {
    return createRefusalBundle({
      reason_class: error.reason_class ?? "recipe_schema_invalid",
      violated_field_class: error.violated_field_class ?? "recipe",
      now,
      idFactory,
    });
  }

  const recipeDigest = digest(canonicalJson(validated));
  const sourceResults = [];
  const sourceOmissions = [];
  const sourceStates = {};

  for (const selector of validated.source_selectors) {
    const adapter = adapters[selector.source_class];
    const store = storeForSource(selector.source_class, { occupantMemoryStore, activityStore, sourceStores });
    if (!store || typeof store !== "object") {
      const omission = sourceOmission(selector, "replay_state_unpinned", "none");
      if (selector.required) {
        return createRefusalBundle({
          reason_class: "replay_state_unpinned",
          recipe_digest: recipeDigest,
          source_omissions: [omission],
          violated_field_class: `${selector.source_class}.source_state`,
          now,
          idFactory,
        });
      }
      sourceOmissions.push(omission);
      continue;
    }
    if (sourceRecoveryReports[selector.source_class]?.degraded === true) {
      const snapshot = adapter.snapshot(store);
      sourceStates[selector.source_class] = snapshot;
      const omission = sourceOmission(selector, "source_degraded", countClass(snapshot.item_count));
      if (selector.required) {
        return createRefusalBundle({
          reason_class: "source_degraded",
          recipe_digest: recipeDigest,
          source_state: createCompositeSourceState(sourceStates),
          source_omissions: [omission],
          violated_field_class: `${selector.source_class}.source_state`,
          now,
          idFactory,
        });
      }
      sourceOmissions.push(omission);
      continue;
    }
    const snapshot = adapter.snapshot(store);
    sourceStates[selector.source_class] = snapshot;
    const selected = adapter.select({ store, selector, sourceRank: sourceRankFor(selector.source_class, validated.source_class_order) });
    sourceResults.push({ adapter, selector, snapshot, selected });
  }

  if (sourceResults.length === 0) {
    return createRefusalBundle({
      reason_class: "no_matching_items",
      recipe_digest: recipeDigest,
      source_state: createCompositeSourceState(sourceStates),
      source_omissions: sourceOmissions,
      violated_field_class: "source_selectors",
      now,
      idFactory,
    });
  }

  const compositeSourceState = createCompositeSourceState(sourceStates);
  const assembled = assembleFromSources({
    recipe: validated,
    recipeDigest,
    compositeSourceState,
    sourceResults,
    sourceOmissions,
    idFactory,
  });
  if (assembled.abstained) {
    return createRefusalBundle({
      reason_class: assembled.reason_class,
      recipe_digest: recipeDigest,
      source_state: compositeSourceState,
      local_source_receipts: assembled.source_receipts,
      local_selection_receipts: assembled.selection_receipts,
      source_omissions: sourceOmissions,
      violated_field_class: "budget",
      now,
      idFactory,
    });
  }

  const bundleBody = assembled.items.map((item) => item.minimized.body).join("\n\n");
  const bundleDigest = digest(canonicalJson({
    recipe_digest: recipeDigest,
    composite_snapshot_digest: compositeSourceState.composite_snapshot_digest,
    bundle_body: bundleBody,
    budget: budgetDigestProjection(assembled.budget),
    source_omissions: sourceOmissions,
  }));
  const localAuditManifest = deepFreeze({
    schema_version: 1,
    status: "assembled",
    recipe_id: validated.recipe_id,
    recipe_digest: recipeDigest,
    source_state: compositeSourceState,
    source_receipts: assembled.source_receipts,
    selection_receipts: assembled.selection_receipts,
    source_omissions: sourceOmissions,
    minimization_record: {
      modes_by_source: Object.fromEntries(validated.source_selectors.map((selector) => [selector.source_class, selector.minimization])),
      deterministic: true,
      content_included: false,
    },
    budget: assembled.budget,
    bundle_digest: bundleDigest,
    content_included: false,
    local_audit_only: true,
  });

  return Object.freeze({
    schema_version: 1,
    status: "assembled",
    content_included: true,
    bundle_body: bundleBody,
    local_audit_manifest: localAuditManifest,
    frontier_facing_manifest: projectFrontierFacingManifest(localAuditManifest),
  });
}

export function projectFrontierFacingManifest(localAuditManifest = {}) {
  const projected = {
    schema_version: 1,
    status: enumManifestStatus(localAuditManifest.status),
    reason_class: localAuditManifest.reason_class ? enumReasonClass(localAuditManifest.reason_class) : "",
    violated_field_class: fieldClass(localAuditManifest.violated_field_class ?? ""),
    abstention_record: projectAbstention(localAuditManifest.abstention_record),
    included_count_class: countClass(localAuditManifest.budget?.included_count),
    excluded_count_class: countClass(localAuditManifest.budget?.excluded_count),
    budget: {
      overflow_policy: enumValue(localAuditManifest.budget?.overflow_policy ?? "evict_oldest", OVERFLOW_POLICIES, "overflow_policy"),
      budget_exhausted: localAuditManifest.budget?.budget_exhausted === true,
    },
    source_omissions: projectSourceOmissions(localAuditManifest.source_omissions ?? []),
  };
  const unexpected = Object.keys(projected).filter((field) => !FRONTIER_ALLOWED_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw contextAssemblyError("frontier_manifest_projection_invalid", "Frontier manifest projector emitted forbidden fields.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "frontier_manifest",
    });
  }
  return deepFreeze(projected);
}

export function createOccupantMemoryAdapter() {
  return Object.freeze({
    source_class: "occupant_memory",
    trust_tier: "participant_memory",
    freshness_class: "persistent",
    allowed_constraints: MEMORY_CONSTRAINT_FIELDS,
    minimization_modes: new Set(["full_self_note", "excerpt_for_reasoner", "metadata_only"]),
    validateSelector(selector) {
      return normalizeMemoryConstraints(selector.constraints ?? {});
    },
    snapshot(store = {}) {
      const normalized = normalizeOccupantMemoryStore(store);
      const entries = listOccupantMemoryEntries(normalized).map(sortMemoryEntry).sort(compareById);
      const tombstones = listOccupantMemoryTombstones(normalized).map(sortMemoryTombstone).sort(compareByEntryId);
      const snapshot = { schema_version: normalized.schema_version, entries, tombstones };
      return deepFreeze({
        source_class: "occupant_memory",
        snapshot_digest: digest(canonicalJson(snapshot)),
        schema_version: normalized.schema_version,
        freshness_class: "persistent",
        trust_tier: "participant_memory",
        item_count: entries.filter((entry) => entry.status === "active").length + tombstones.length,
        active_entry_count: entries.filter((entry) => entry.status === "active").length,
        tombstone_count: tombstones.length,
        newest_timestamp_ms: newestTimestampMs([...entries, ...tombstones]),
      });
    },
    select({ store, selector, sourceRank }) {
      const normalized = normalizeOccupantMemoryStore(store);
      const activeEntries = listOccupantMemoryEntries(normalized)
        .filter((entry) => entry.status === "active")
        .filter((entry) => selector.constraints.memory_classes.includes(entry.memory_class))
        .filter((entry) => selector.constraints.domain === "" || entry.domain === selector.constraints.domain)
        .sort((left, right) => timestampMs(right.created_at) - timestampMs(left.created_at) || left.id.localeCompare(right.id))
        .map((entry) => memoryItem({ kind: "entry", entry, sourceRank }));
      if (!selector.constraints.include_tombstones) {
        return activeEntries;
      }
      const tombstones = listOccupantMemoryTombstones(normalized)
        .filter((tombstone) => selector.constraints.memory_classes.includes(tombstone.memory_class))
        .filter((tombstone) => selector.constraints.domain === "" || tombstone.domain === selector.constraints.domain)
        .sort((left, right) => timestampMs(right.removed_at) - timestampMs(left.removed_at) || left.entry_id.localeCompare(right.entry_id))
        .map((tombstone) => memoryItem({ kind: "tombstone", tombstone, sourceRank }));
      return [...activeEntries, ...tombstones].sort(compareNewestFirst);
    },
    sourceReceipt(item, snapshot, idFactory) {
      const entry = item.raw.kind === "entry" ? item.raw.entry : null;
      const tombstone = item.raw.kind === "tombstone" ? item.raw.tombstone : null;
      return Object.freeze({
        receipt_id: `source_${idFactory()}`,
        source_class: "occupant_memory",
        source_snapshot_digest: snapshot.snapshot_digest,
        trust_tier: "participant_memory",
        freshness_class: "persistent",
        item_kind: item.raw.kind,
        item_ref: entry?.id ?? tombstone?.entry_id ?? "",
        occurred_at: entry?.created_at ?? tombstone?.removed_at ?? "",
        content_digest: entry ? digest(entry.content) : "",
        tombstone_digest: tombstone ? digest(canonicalJson(tombstone)) : "",
        content_included: false,
      });
    },
    minimize(item, mode) {
      return minimizeMemoryItem(item.raw, mode);
    },
  });
}

export function createDurableProvenanceActivityAdapter() {
  return Object.freeze({
    source_class: "durable_provenance_activity",
    trust_tier: "local_provenance",
    freshness_class: "persistent",
    allowed_constraints: DURABLE_PROVENANCE_CONSTRAINT_FIELDS,
    minimization_modes: new Set(["activity_summary", "metadata_only"]),
    validateSelector(selector) {
      return normalizeDurableProvenanceConstraints(selector.constraints ?? {});
    },
    snapshot(store = {}) {
      const records = normalizeDurableProvenanceRecords(store).sort(compareDurableProvenanceRecord);
      const snapshot = { schema_version: Number(store.schema_version ?? 1), records };
      return deepFreeze({
        source_class: "durable_provenance_activity",
        snapshot_digest: digest(canonicalJson(snapshot)),
        schema_version: snapshot.schema_version,
        freshness_class: "persistent",
        trust_tier: "local_provenance",
        item_count: records.length,
        newest_timestamp_ms: newestTimestampMs(records),
      });
    },
    select({ store, selector, sourceRank }) {
      return normalizeDurableProvenanceRecords(store)
        .map(projectDurableProvenanceRecord)
        .filter(Boolean)
        .filter((record) => selector.constraints.domain === "" || record.domain === selector.constraints.domain)
        .filter((record) => selector.constraints.activity_classes.includes(record.activity_class))
        .filter((record) => selector.constraints.event_types.includes(record.event_type))
        .filter((record) => selector.constraints.capability_classes.includes(record.capability_class))
        .filter((record) => selector.constraints.summary_classes.includes(record.summary_class))
        .filter((record) => selector.constraints.coarse_time_buckets.includes(record.coarse_time_bucket))
        .sort((left, right) => timestampMs(right.raw.timestamp) - timestampMs(left.raw.timestamp) || left.stable_id.localeCompare(right.stable_id))
        .map((record) => durableProvenanceActivityItem({ record, sourceRank }));
    },
    sourceReceipt(item, snapshot, idFactory) {
      const raw = item.raw.raw;
      return Object.freeze({
        receipt_id: `source_${idFactory()}`,
        source_class: "durable_provenance_activity",
        source_snapshot_digest: snapshot.snapshot_digest,
        trust_tier: "local_provenance",
        freshness_class: "persistent",
        item_kind: "durable_provenance_record",
        item_ref: raw.entry_id,
        occurred_at: raw.timestamp,
        raw_event_type: raw.event_type,
        actor: raw.actor,
        model_id: raw.model_id,
        episode_id: raw.episode_id,
        grant_id: raw.grant_id,
        provider: raw.provider,
        scope: raw.scope,
        raw_record_digest: digest(canonicalJson(raw)),
        content_included: false,
      });
    },
    minimize(item, mode) {
      return minimizeDurableProvenanceActivity(item.raw, mode);
    },
  });
}

export function createSnapshotFixtureActivityAdapter() {
  return Object.freeze({
    source_class: "local_activity_fixture",
    trust_tier: "local_fixture",
    freshness_class: "snapshot_pinned",
    allowed_constraints: ACTIVITY_CONSTRAINT_FIELDS,
    minimization_modes: new Set(["activity_summary", "metadata_only"]),
    validateSelector(selector) {
      return normalizeActivityConstraints(selector.constraints ?? {});
    },
    snapshot(store = {}) {
      const events = normalizeActivityEvents(store).sort(compareActivityById);
      const snapshot = { schema_version: Number(store.schema_version ?? 1), events };
      return deepFreeze({
        source_class: "local_activity_fixture",
        snapshot_digest: digest(canonicalJson(snapshot)),
        schema_version: snapshot.schema_version,
        freshness_class: "snapshot_pinned",
        trust_tier: "local_fixture",
        item_count: events.length,
        newest_timestamp_ms: newestTimestampMs(events),
      });
    },
    select({ store, selector, sourceRank }) {
      return normalizeActivityEvents(store)
        .filter((event) => selector.constraints.domain === "" || event.domain === selector.constraints.domain)
        .filter((event) => selector.constraints.activity_classes.includes(event.activity_class))
        .filter((event) => selector.constraints.event_types.includes(event.event_type))
        .filter((event) => selector.constraints.capability_classes.includes(event.capability_class))
        .filter((event) => selector.constraints.summary_classes.includes(event.summary_class))
        .sort((left, right) => timestampMs(right.timestamp) - timestampMs(left.timestamp) || left.id.localeCompare(right.id))
        .map((event) => activityItem({ event, sourceRank }));
    },
    sourceReceipt(item, snapshot, idFactory) {
      return Object.freeze({
        receipt_id: `source_${idFactory()}`,
        source_class: "local_activity_fixture",
        source_snapshot_digest: snapshot.snapshot_digest,
        trust_tier: "local_fixture",
        freshness_class: "snapshot_pinned",
        item_kind: "activity_event",
        item_ref: item.raw.id,
        occurred_at: item.raw.timestamp,
        event_type: item.raw.event_type,
        activity_class: item.raw.activity_class,
        capability_class: item.raw.capability_class,
        summary_class: item.raw.summary_class,
        event_digest: digest(canonicalJson(item.raw)),
        content_included: false,
      });
    },
    minimize(item, mode) {
      const event = item.raw;
      const header = [
        `Activity class: ${event.activity_class}`,
        `Event type: ${event.event_type}`,
        `Capability class: ${event.capability_class}`,
        `Summary class: ${event.summary_class}`,
        `Occurred at: ${event.timestamp}`,
      ].join("\n");
      return {
        body: mode === "metadata_only" ? header : `Local activity fixture:\n${header}`,
        char_count: (mode === "metadata_only" ? header : `Local activity fixture:\n${header}`).length,
        reason_class: mode === "metadata_only" ? "metadata_only" : "selected",
      };
    },
  });
}

function normalizeSourceSelectors(value, adapters) {
  if (!Array.isArray(value) || value.length === 0) {
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe source_selectors must be a non-empty array.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "source_selectors",
    });
  }
  return Object.freeze(value.map((selector, index) => normalizeSourceSelector(selector, index, adapters)));
}

function normalizeSourceSelector(selector, index, adapters) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe source_selector must be an object.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "source_selectors",
    });
  }
  rejectUnknownFields(selector, SOURCE_SELECTOR_FIELDS, "source_selectors");
  const sourceClass = enumValue(selector.source_class, sourceClassSet(adapters), "source_selectors.source_class");
  const adapter = adapters[sourceClass];
  let constraints;
  try {
    constraints = adapter.validateSelector(selector);
  } catch (error) {
    throw contextAssemblyError("context_recipe_invalid", error.message, {
      reason_class: error.reason_class ?? "recipe_schema_invalid",
      violated_field_class: fieldClass(error.violated_field_class ?? `${sourceClass}.constraints`),
    });
  }
  const minimization = enumValue(selector.minimization ?? defaultMinimizationFor(sourceClass), adapter.minimization_modes, "source_selectors.minimization");
  return deepFreeze({
    source_class: sourceClass,
    selector_index: index,
    required: selector.required === true,
    constraints,
    minimization,
    budget: normalizeBudget(selector.budget ?? {}, "source_selectors.budget", { maxItems: 64, maxChars: 32_000 }),
  });
}

function normalizeMemoryConstraints(input) {
  rejectUnknownFields(input, MEMORY_CONSTRAINT_FIELDS, "source_selectors.constraints");
  return deepFreeze({
    domain: enumValue(input.domain ?? "testing", DOMAINS, "source_selectors.constraints.domain"),
    memory_classes: enumArray(input.memory_classes ?? ["self_note"], MEMORY_CLASSES, "source_selectors.constraints.memory_classes", { required: true }),
    include_tombstones: input.include_tombstones === true,
    recency_window: enumValue(input.recency_window ?? "all", RECENCY_WINDOWS, "source_selectors.constraints.recency_window"),
    consent_scope: enumValue(input.consent_scope ?? "successor_inheritance", CONSENT_SCOPES, "source_selectors.constraints.consent_scope"),
  });
}

function normalizeActivityConstraints(input) {
  rejectUnknownFields(input, ACTIVITY_CONSTRAINT_FIELDS, "source_selectors.constraints");
  return deepFreeze({
    domain: enumValue(input.domain ?? "testing", DOMAINS, "source_selectors.constraints.domain"),
    activity_classes: enumArray(input.activity_classes ?? [...ACTIVITY_CLASSES], ACTIVITY_CLASSES, "source_selectors.constraints.activity_classes", { required: true }),
    event_types: enumArray(input.event_types ?? [...ACTIVITY_EVENT_TYPES], ACTIVITY_EVENT_TYPES, "source_selectors.constraints.event_types", { required: true }),
    capability_classes: enumArray(input.capability_classes ?? [...ACTIVITY_CAPABILITY_CLASSES], ACTIVITY_CAPABILITY_CLASSES, "source_selectors.constraints.capability_classes", { required: true }),
    summary_classes: enumArray(input.summary_classes ?? [...SUMMARY_CLASSES], SUMMARY_CLASSES, "source_selectors.constraints.summary_classes", { required: true }),
  });
}

function normalizeDurableProvenanceConstraints(input) {
  rejectUnknownFields(input, DURABLE_PROVENANCE_CONSTRAINT_FIELDS, "source_selectors.constraints");
  return deepFreeze({
    domain: enumValue(input.domain ?? "testing", DOMAINS, "source_selectors.constraints.domain"),
    activity_classes: enumArray(input.activity_classes ?? ["capability_use", "control"], ACTIVITY_CLASSES, "source_selectors.constraints.activity_classes", { required: true }),
    event_types: enumArray(input.event_types ?? ["memory.provenance.written", "memory.provenance.revoked"], ACTIVITY_EVENT_TYPES, "source_selectors.constraints.event_types", { required: true }),
    capability_classes: enumArray(input.capability_classes ?? ["memory"], ACTIVITY_CAPABILITY_CLASSES, "source_selectors.constraints.capability_classes", { required: true }),
    summary_classes: enumArray(input.summary_classes ?? ["completed", "control"], SUMMARY_CLASSES, "source_selectors.constraints.summary_classes", { required: true }),
    coarse_time_buckets: enumArray(input.coarse_time_buckets ?? [...COARSE_TIME_BUCKETS], COARSE_TIME_BUCKETS, "source_selectors.constraints.coarse_time_buckets", { required: true }),
  });
}

function normalizeBudget(input, field, { maxItems, maxChars }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${field} must be an object.`, {
      reason_class: "recipe_schema_invalid",
      violated_field_class: fieldClass(field),
    });
  }
  const isSourceBudget = field === "source_selectors.budget";
  rejectUnknownFields(input, isSourceBudget ? SOURCE_BUDGET_FIELDS : BUDGET_FIELDS, field);
  const budget = {
    max_items: integerValue(input.max_items ?? maxItems, `${field}.max_items`, { min: 1, max: maxItems }),
    max_chars: integerValue(input.max_chars ?? maxChars, `${field}.max_chars`, { min: 1, max: maxChars }),
    overflow_policy: enumValue(input.overflow_policy ?? "evict_oldest", OVERFLOW_POLICIES, `${field}.overflow_policy`),
  };
  if (isSourceBudget && Object.hasOwn(input, "reserve")) {
    budget.reserve = normalizeReserve(input.reserve, field);
  }
  if (isSourceBudget && Object.hasOwn(input, "share")) {
    budget.share = integerValue(input.share, `${field}.share`, { min: 0, max: 1_000 });
  }
  return deepFreeze(budget);
}

function normalizeReserve(input, field) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${field}.reserve must be an object.`, {
      reason_class: "recipe_schema_invalid",
      violated_field_class: fieldClass(`${field}.reserve`),
    });
  }
  rejectUnknownFields(input, RESERVE_FIELDS, `${field}.reserve`);
  return Object.freeze({
    min_items: integerValue(input.min_items ?? 0, `${field}.reserve.min_items`, { min: 0, max: 64 }),
    min_chars: integerValue(input.min_chars ?? 0, `${field}.reserve.min_chars`, { min: 0, max: 32_000 }),
  });
}

function validateReserveShareBudget(sourceSelectors, contextBudget) {
  if (budgetModeFor(sourceSelectors) !== "reserve_share") {
    return;
  }
  let reserveItems = 0;
  let reserveChars = 0;
  for (const selector of sourceSelectors) {
    const reserve = reserveFor(selector);
    if (reserve.min_items > selector.budget.max_items) {
      throw contextAssemblyError("context_recipe_invalid", "Source reserve min_items exceeds source max_items.", {
        reason_class: "reserves_exceed_budget",
        violated_field_class: "source_selectors.budget.reserve.min_items",
      });
    }
    if (reserve.min_chars > selector.budget.max_chars) {
      throw contextAssemblyError("context_recipe_invalid", "Source reserve min_chars exceeds source max_chars.", {
        reason_class: "reserves_exceed_budget",
        violated_field_class: "source_selectors.budget.reserve.min_chars",
      });
    }
    reserveItems += reserve.min_items;
    reserveChars += reserve.min_chars;
  }
  if (reserveItems > contextBudget.max_items || reserveChars > contextBudget.max_chars) {
    throw contextAssemblyError("context_recipe_invalid", "Source reserves exceed the global context budget.", {
      reason_class: "reserves_exceed_budget",
      violated_field_class: "source_selectors.budget.reserve",
    });
  }
}

function budgetModeFor(sourceSelectors) {
  return sourceSelectors.some((selector) => (
    Object.hasOwn(selector.budget, "reserve") || Object.hasOwn(selector.budget, "share")
  ))
    ? "reserve_share"
    : "legacy_global";
}

function reserveFor(selector) {
  return selector.budget.reserve ?? { min_items: 0, min_chars: 0 };
}

function shareFor(selector) {
  return Object.hasOwn(selector.budget, "share") ? selector.budget.share : 1;
}

function assembleFromSources({
  recipe,
  recipeDigest,
  compositeSourceState,
  sourceResults,
  sourceOmissions,
  idFactory,
}) {
  const sourceReceipts = [];
  const selectionReceipts = [];
  const perSourceCandidates = [];
  const perSourceExcluded = [];
  const budgetMode = budgetModeFor(recipe.source_selectors);

  for (const sourceResult of sourceResults) {
    let sourceChars = 0;
    let sourceItems = 0;
    for (const item of sourceResult.selected) {
      const minimized = sourceResult.adapter.minimize(item, sourceResult.selector.minimization);
      const sourceReceipt = sourceResult.adapter.sourceReceipt(item, sourceResult.snapshot, idFactory);
      sourceReceipts.push(sourceReceipt);
      if (
        sourceItems >= sourceResult.selector.budget.max_items
        || sourceChars + minimized.char_count > sourceResult.selector.budget.max_chars
      ) {
        const receipt = createSelectionReceipt({
          decision: "excluded",
          reason_class: "budget_evicted",
          recipeDigest,
          compositeSourceState,
          item,
          sourceReceipt,
          idFactory,
          budgetPhase: "evicted",
        });
        selectionReceipts.push(receipt);
        perSourceExcluded.push({ item, minimized, sourceReceipt, receipt, sourceResult });
        continue;
      }
      const receipt = createSelectionReceipt({
        decision: "included",
        reason_class: minimized.reason_class,
        recipeDigest,
        compositeSourceState,
        item,
        sourceReceipt,
        idFactory,
        budgetPhase: budgetMode === "reserve_share" ? "" : "share",
      });
      perSourceCandidates.push({ item, minimized, sourceReceipt, receipt, sourceResult });
      sourceChars += minimized.char_count;
      sourceItems += 1;
    }
    if (
      sourceResult.selector.required
      && sourceResult.selector.budget.overflow_policy === "abstain"
      && perSourceExcluded.some((entry) => entry.sourceResult.selector.source_class === sourceResult.selector.source_class)
    ) {
      return {
        abstained: true,
        reason_class: "budget_insufficient",
        source_receipts: sourceReceipts,
        selection_receipts: selectionReceipts,
      };
    }
  }

  if (perSourceCandidates.length === 0) {
    return {
      abstained: true,
      reason_class: "no_matching_items",
      source_receipts: sourceReceipts,
      selection_receipts: selectionReceipts,
    };
  }

  if (budgetMode === "reserve_share") {
    return assembleReserveShareBudget({
      recipe,
      recipeDigest,
      compositeSourceState,
      sourceResults,
      sourceOmissions,
      sourceReceipts,
      selectionReceipts,
      perSourceCandidates,
      idFactory,
    });
  }

  const ordered = orderItems(perSourceCandidates, recipe);
  const included = [];
  let usedChars = 0;
  for (const entry of ordered) {
    if (
      included.length >= recipe.context_budget.max_items
      || usedChars + entry.minimized.char_count > recipe.context_budget.max_chars
    ) {
      selectionReceipts.push(createSelectionReceipt({
        decision: "excluded",
        reason_class: "budget_evicted",
        recipeDigest,
        compositeSourceState,
        item: entry.item,
        sourceReceipt: entry.sourceReceipt,
        idFactory,
        budgetPhase: "evicted",
      }));
      continue;
    }
    selectionReceipts.push(entry.receipt);
    included.push(entry);
    usedChars += entry.minimized.char_count;
  }
  if (included.length === 0 || (recipe.context_budget.overflow_policy === "abstain" && included.length < ordered.length)) {
    return {
      abstained: true,
      reason_class: "budget_insufficient",
      source_receipts: sourceReceipts,
      selection_receipts: selectionReceipts,
    };
  }

  return {
    abstained: false,
    items: included,
    source_receipts: sourceReceipts,
    selection_receipts: selectionReceipts,
    budget: budgetSummary({ recipe, budgetMode, included, selectionReceipts, sourceOmissions, usedChars }),
  };
}

function assembleReserveShareBudget({
  recipe,
  recipeDigest,
  compositeSourceState,
  sourceResults,
  sourceOmissions,
  sourceReceipts,
  selectionReceipts,
  perSourceCandidates,
  idFactory,
}) {
  const sourceResultByClass = new Map(sourceResults.map((sourceResult) => [sourceResult.selector.source_class, sourceResult]));
  const candidatesBySource = new Map();
  const selectedKeys = new Set();
  const reserved = [];
  const shared = [];
  let reservedChars = 0;

  for (const sourceClass of recipe.source_class_order) {
    const sourceResult = sourceResultByClass.get(sourceClass);
    if (!sourceResult) {
      continue;
    }
    const reserve = reserveFor(sourceResult.selector);
    const candidates = orderItems(
      perSourceCandidates.filter((entry) => entry.item.source_class === sourceClass),
      recipe,
    );
    candidatesBySource.set(sourceClass, candidates);
    let sourceReservedItems = 0;
    let sourceReservedChars = 0;
    for (const entry of candidates) {
      if (selectedKeys.has(entry.item.sort_key.stable_item_key)) {
        continue;
      }
      const needsItemReserve = sourceReservedItems < reserve.min_items;
      const fitsCharReserve = sourceReservedChars + entry.minimized.char_count <= reserve.min_chars;
      if (!needsItemReserve && !fitsCharReserve) {
        continue;
      }
      if (
        !needsItemReserve
        && (
          reserved.length + 1 + remainingReserveItemsAfter({ recipe, sourceResultByClass, sourceClass }) > recipe.context_budget.max_items
          || reservedChars + entry.minimized.char_count + remainingReserveCharsAfter({ recipe, sourceResultByClass, sourceClass }) > recipe.context_budget.max_chars
        )
      ) {
        continue;
      }
      if (reserved.length >= recipe.context_budget.max_items) {
        break;
      }
      if (reservedChars + entry.minimized.char_count > recipe.context_budget.max_chars) {
        if (needsItemReserve) {
          return budgetAbstention({ reason_class: "budget_insufficient", sourceReceipts, selectionReceipts });
        }
        continue;
      }
      const reservedEntry = withSelectionReceipt({
        entry,
        decision: "included",
        reason_class: entry.minimized.reason_class,
        budgetPhase: "reserve",
        recipeDigest,
        compositeSourceState,
        idFactory,
      });
      reserved.push(reservedEntry);
      selectedKeys.add(entry.item.sort_key.stable_item_key);
      sourceReservedItems += 1;
      sourceReservedChars += entry.minimized.char_count;
      reservedChars += entry.minimized.char_count;
    }
  }

  const remainingItems = recipe.context_budget.max_items - reserved.length;
  const remainingChars = recipe.context_budget.max_chars - reservedChars;
  if (remainingItems > 0 && remainingChars > 0) {
    const allocations = shareAllocations({ recipe, sourceResults, remainingItems, remainingChars });
    for (const sourceClass of recipe.source_class_order) {
      const sourceResult = sourceResultByClass.get(sourceClass);
      const allocation = allocations.get(sourceClass);
      if (!sourceResult || !allocation || allocation.max_items === 0 || allocation.max_chars === 0) {
        continue;
      }
      let sourceItems = reserved.filter((entry) => entry.item.source_class === sourceClass).length;
      let sourceChars = reserved
        .filter((entry) => entry.item.source_class === sourceClass)
        .reduce((total, entry) => total + entry.minimized.char_count, 0);
      let allocatedItems = 0;
      let allocatedChars = 0;
      const candidates = candidatesBySource.get(sourceClass)
        ?? orderItems(perSourceCandidates.filter((entry) => entry.item.source_class === sourceClass), recipe);
      for (const entry of candidates) {
        if (selectedKeys.has(entry.item.sort_key.stable_item_key)) {
          continue;
        }
        if (
          allocatedItems >= allocation.max_items
          || allocatedChars + entry.minimized.char_count > allocation.max_chars
          || sourceItems >= sourceResult.selector.budget.max_items
          || sourceChars + entry.minimized.char_count > sourceResult.selector.budget.max_chars
        ) {
          continue;
        }
        const sharedEntry = withSelectionReceipt({
          entry,
          decision: "included",
          reason_class: entry.minimized.reason_class,
          budgetPhase: "share",
          recipeDigest,
          compositeSourceState,
          idFactory,
        });
        shared.push(sharedEntry);
        selectedKeys.add(entry.item.sort_key.stable_item_key);
        allocatedItems += 1;
        allocatedChars += entry.minimized.char_count;
        sourceItems += 1;
        sourceChars += entry.minimized.char_count;
      }
    }
  }

  const selected = [...reserved, ...shared];
  const finalItems = [];
  let usedChars = 0;
  for (const entry of orderItems(selected, recipe)) {
    if (
      finalItems.length >= recipe.context_budget.max_items
      || usedChars + entry.minimized.char_count > recipe.context_budget.max_chars
    ) {
      if (entry.selectionReceipt.budget_phase === "reserve") {
        return budgetAbstention({ reason_class: "budget_insufficient", sourceReceipts, selectionReceipts });
      }
      selectionReceipts.push(createSelectionReceipt({
        decision: "excluded",
        reason_class: "budget_evicted",
        recipeDigest,
        compositeSourceState,
        item: entry.item,
        sourceReceipt: entry.sourceReceipt,
        idFactory,
        budgetPhase: "evicted",
      }));
      continue;
    }
    finalItems.push(entry);
    usedChars += entry.minimized.char_count;
    selectionReceipts.push(entry.selectionReceipt);
  }

  for (const entry of perSourceCandidates) {
    if (selectedKeys.has(entry.item.sort_key.stable_item_key)) {
      continue;
    }
    selectionReceipts.push(createSelectionReceipt({
      decision: "excluded",
      reason_class: "budget_evicted",
      recipeDigest,
      compositeSourceState,
      item: entry.item,
      sourceReceipt: entry.sourceReceipt,
      idFactory,
      budgetPhase: "evicted",
    }));
  }

  if (finalItems.length === 0 || (recipe.context_budget.overflow_policy === "abstain" && finalItems.length < perSourceCandidates.length)) {
    return budgetAbstention({ reason_class: "budget_insufficient", sourceReceipts, selectionReceipts });
  }

  return {
    abstained: false,
    items: finalItems,
    source_receipts: sourceReceipts,
    selection_receipts: selectionReceipts,
    budget: budgetSummary({ recipe, budgetMode: "reserve_share", included: finalItems, selectionReceipts, sourceOmissions, usedChars }),
  };
}

function remainingReserveItemsAfter({ recipe, sourceResultByClass, sourceClass }) {
  const index = recipe.source_class_order.indexOf(sourceClass);
  return recipe.source_class_order
    .slice(index + 1)
    .filter((nextSourceClass) => sourceResultByClass.has(nextSourceClass))
    .reduce((total, nextSourceClass) => total + reserveFor(sourceResultByClass.get(nextSourceClass).selector).min_items, 0);
}

function remainingReserveCharsAfter({ recipe, sourceResultByClass, sourceClass }) {
  const index = recipe.source_class_order.indexOf(sourceClass);
  return recipe.source_class_order
    .slice(index + 1)
    .filter((nextSourceClass) => sourceResultByClass.has(nextSourceClass))
    .reduce((total, nextSourceClass) => total + reserveFor(sourceResultByClass.get(nextSourceClass).selector).min_chars, 0);
}

function withSelectionReceipt({
  entry,
  decision,
  reason_class,
  budgetPhase,
  recipeDigest,
  compositeSourceState,
  idFactory,
}) {
  return {
    ...entry,
    selectionReceipt: createSelectionReceipt({
      decision,
      reason_class,
      recipeDigest,
      compositeSourceState,
      item: entry.item,
      sourceReceipt: entry.sourceReceipt,
      idFactory,
      budgetPhase,
    }),
  };
}

function budgetAbstention({ reason_class, sourceReceipts, selectionReceipts }) {
  return {
    abstained: true,
    reason_class,
    source_receipts: sourceReceipts,
    selection_receipts: selectionReceipts,
  };
}

function shareAllocations({ recipe, sourceResults, remainingItems, remainingChars }) {
  const shares = new Map(sourceResults.map((sourceResult) => [sourceResult.selector.source_class, shareFor(sourceResult.selector)]));
  const totalShare = [...shares.values()].reduce((total, share) => total + share, 0);
  const allocations = new Map(sourceResults.map((sourceResult) => [sourceResult.selector.source_class, { max_items: 0, max_chars: 0 }]));
  if (totalShare === 0) {
    return allocations;
  }
  let allocatedItems = 0;
  let allocatedChars = 0;
  for (const sourceResult of sourceResults) {
    const share = shares.get(sourceResult.selector.source_class) ?? 0;
    const allocation = allocations.get(sourceResult.selector.source_class);
    allocation.max_items = Math.floor((remainingItems * share) / totalShare);
    allocation.max_chars = Math.floor((remainingChars * share) / totalShare);
    allocatedItems += allocation.max_items;
    allocatedChars += allocation.max_chars;
  }
  distributeRemainder({
    allocations,
    sourceClassOrder: recipe.source_class_order,
    shares,
    field: "max_items",
    remaining: remainingItems - allocatedItems,
  });
  distributeRemainder({
    allocations,
    sourceClassOrder: recipe.source_class_order,
    shares,
    field: "max_chars",
    remaining: remainingChars - allocatedChars,
  });
  return allocations;
}

function distributeRemainder({ allocations, sourceClassOrder, shares, field, remaining }) {
  let left = remaining;
  while (left > 0) {
    let distributed = false;
    for (const sourceClass of sourceClassOrder) {
      if (left === 0) {
        break;
      }
      if ((shares.get(sourceClass) ?? 0) === 0 || !allocations.has(sourceClass)) {
        continue;
      }
      allocations.get(sourceClass)[field] += 1;
      left -= 1;
      distributed = true;
    }
    if (!distributed) {
      break;
    }
  }
}

function budgetSummary({ recipe, budgetMode, included, selectionReceipts, sourceOmissions, usedChars }) {
  return {
    budget_mode: budgetMode,
    max_items: recipe.context_budget.max_items,
    max_chars: recipe.context_budget.max_chars,
    used_chars: usedChars,
    included_count: included.length,
    excluded_count: selectionReceipts.filter((receipt) => receipt.decision === "excluded").length,
    overflow_policy: recipe.context_budget.overflow_policy,
    budget_exhausted: selectionReceipts.some((receipt) => receipt.reason_class === "budget_evicted"),
    source_omission_count: sourceOmissions.length,
    per_source: Object.fromEntries(recipe.source_selectors.map((selector) => [selector.source_class, {
      max_items: selector.budget.max_items,
      max_chars: selector.budget.max_chars,
      reserve: reserveFor(selector),
      share: budgetMode === "reserve_share" ? shareFor(selector) : 0,
      included_count: included.filter((entry) => entry.item.source_class === selector.source_class).length,
      excluded_count: selectionReceipts.filter((receipt) => receipt.source_class === selector.source_class && receipt.decision === "excluded").length,
    }])),
  };
}

function budgetDigestProjection(budget) {
  return {
    max_items: budget.max_items,
    max_chars: budget.max_chars,
    used_chars: budget.used_chars,
    included_count: budget.included_count,
    excluded_count: budget.excluded_count,
    overflow_policy: budget.overflow_policy,
    budget_exhausted: budget.budget_exhausted,
    source_omission_count: budget.source_omission_count,
    per_source: Object.fromEntries(Object.entries(budget.per_source ?? {}).map(([sourceClass, sourceBudget]) => [sourceClass, {
      max_items: sourceBudget.max_items,
      max_chars: sourceBudget.max_chars,
      included_count: sourceBudget.included_count,
      excluded_count: sourceBudget.excluded_count,
    }])),
  };
}

function orderItems(items, recipe) {
  const sourceRanks = Object.fromEntries(recipe.source_class_order.map((sourceClass, index) => [sourceClass, index + 1]));
  return [...items].sort((left, right) => {
    if (recipe.ordering === "class_priority") {
      return (sourceRanks[left.item.source_class] ?? 99) - (sourceRanks[right.item.source_class] ?? 99)
        || right.item.sort_key.timestamp_ms - left.item.sort_key.timestamp_ms
        || left.item.sort_key.stable_item_key.localeCompare(right.item.sort_key.stable_item_key);
    }
    if (recipe.ordering === "receipt_priority") {
      return right.item.sort_key.trust_rank - left.item.sort_key.trust_rank
        || right.item.sort_key.freshness_rank - left.item.sort_key.freshness_rank
        || right.item.sort_key.timestamp_ms - left.item.sort_key.timestamp_ms
        || left.item.sort_key.stable_item_key.localeCompare(right.item.sort_key.stable_item_key);
    }
    return compareNewestFirst(left.item, right.item);
  });
}

function minimizeMemoryItem(item, minimization) {
  if (item.kind === "tombstone") {
    const body = [
      `Memory tombstone: ${item.tombstone.memory_class}`,
      `Created at: ${item.tombstone.created_at}`,
      `Removed at: ${item.tombstone.removed_at}`,
      `Reason class: ${item.tombstone.reason_class}`,
    ].join("\n");
    return { body, char_count: body.length, reason_class: "metadata_only" };
  }
  const header = [
    `Memory class: ${item.entry.memory_class}`,
    `Created at: ${item.entry.created_at}`,
    `Inheritance frame: written by ${item.entry.model_id || "unknown model"}; you are heir, not author.`,
  ].join("\n");
  if (minimization === "metadata_only") {
    return { body: header, char_count: header.length, reason_class: "metadata_only" };
  }
  const content = minimization === "excerpt_for_reasoner"
    ? deterministicExcerpt(item.entry.content, 480)
    : item.entry.content;
  const body = `${header}\nContent:\n${content}`;
  return { body, char_count: body.length, reason_class: "selected" };
}

function minimizeDurableProvenanceActivity(record, minimization) {
  const header = [
    `Activity class: ${record.activity_class}`,
    `Event type: ${record.event_type}`,
    `Capability class: ${record.capability_class}`,
    `Summary class: ${record.summary_class}`,
    `Coarse time: ${record.coarse_time_bucket}`,
  ].join("\n");
  const body = minimization === "metadata_only"
    ? header
    : `Durable provenance activity:\n${header}`;
  return {
    body,
    char_count: body.length,
    reason_class: minimization === "metadata_only" ? "metadata_only" : "selected",
  };
}

function createSelectionReceipt({
  decision,
  reason_class,
  recipeDigest,
  compositeSourceState,
  item,
  sourceReceipt,
  idFactory,
  budgetPhase = "",
}) {
  const receipt = {
    receipt_id: `selection_${idFactory()}`,
    recipe_digest: recipeDigest,
    source_class: item.source_class,
    composite_snapshot_digest: compositeSourceState.composite_snapshot_digest,
    decision,
    reason_class: enumReasonClass(reason_class),
    item_ref_digest: digest(item.sort_key.stable_item_key),
    source_receipt_id: sourceReceipt?.receipt_id ?? "",
    content_included: false,
  };
  if (budgetPhase !== "") {
    receipt.budget_phase = enumValue(budgetPhase, new Set(["reserve", "share", "evicted"]), "budget_phase");
  }
  return Object.freeze(receipt);
}

function createRefusalBundle({
  reason_class,
  recipe_digest = "",
  source_state = null,
  local_source_receipts = [],
  local_selection_receipts = [],
  source_omissions = [],
  violated_field_class = "",
  now = () => new Date(),
  idFactory = randomUUID,
}) {
  const abstentionRecord = {
    reason_class: enumReasonClass(reason_class),
    violated_field_class: fieldClass(violated_field_class),
    timestamp: asDate(now()).toISOString(),
  };
  const selectionReceipts = local_selection_receipts.length > 0
    ? local_selection_receipts
    : [Object.freeze({
      receipt_id: `selection_${idFactory()}`,
      recipe_digest: safeRecipeDigestForRefusal(recipe_digest, reason_class),
      source_class: "",
      composite_snapshot_digest: source_state?.composite_snapshot_digest ?? "",
      decision: "abstained",
      reason_class: enumReasonClass(reason_class),
      item_ref_digest: "",
      source_receipt_id: "",
      content_included: false,
    })];
  const localAuditManifest = deepFreeze({
    schema_version: 1,
    status: "refused",
    reason_class: enumReasonClass(reason_class),
    violated_field_class: fieldClass(violated_field_class),
    recipe_digest: safeRecipeDigestForRefusal(recipe_digest, reason_class),
    source_state,
    source_receipts: local_source_receipts,
    selection_receipts: selectionReceipts,
    source_omissions,
    abstention_record: abstentionRecord,
    budget: {
      included_count: 0,
      excluded_count: selectionReceipts.filter((receipt) => receipt.decision === "excluded").length,
      overflow_policy: "evict_oldest",
      budget_exhausted: reason_class === "budget_insufficient",
      source_omission_count: source_omissions.length,
    },
    content_included: false,
    local_audit_only: true,
  });
  return Object.freeze({
    schema_version: 1,
    status: "refused",
    content_included: false,
    bundle_body: "",
    local_audit_manifest: localAuditManifest,
    frontier_facing_manifest: projectFrontierFacingManifest(localAuditManifest),
  });
}

function storeForSource(sourceClass, { occupantMemoryStore, activityStore, sourceStores }) {
  if (Object.hasOwn(sourceStores, sourceClass)) {
    return sourceStores[sourceClass];
  }
  if (sourceClass === "occupant_memory") {
    return occupantMemoryStore;
  }
  if (sourceClass === "local_activity_fixture") {
    return activityStore;
  }
  if (sourceClass === "durable_provenance_activity") {
    return activityStore;
  }
  return null;
}

function normalizeActivityEvents(store = {}) {
  const events = Array.isArray(store.events) ? store.events : [];
  return events.map((event) => ({
    id: boundedId(event.id, "activity.id"),
    timestamp: stringValue(event.timestamp),
    activity_class: enumValue(event.activity_class, ACTIVITY_CLASSES, "activity.activity_class"),
    event_type: enumValue(event.event_type, ACTIVITY_EVENT_TYPES, "activity.event_type"),
    capability_class: enumValue(event.capability_class, ACTIVITY_CAPABILITY_CLASSES, "activity.capability_class"),
    domain: enumValue(event.domain ?? "testing", DOMAINS, "activity.domain"),
    summary_class: enumValue(event.summary_class, SUMMARY_CLASSES, "activity.summary_class"),
  }));
}

function normalizeDurableProvenanceRecords(store = {}) {
  const records = Array.isArray(store.records) ? store.records : Array.isArray(store.events) ? store.events : [];
  return records
    .filter((record) => record.event_type === "occupant.memory.written" || record.event_type === "occupant.memory.revoked")
    .map((record) => ({
      event_type: record.event_type,
      entry_id: boundedId(record.entry_id, "durable_provenance.entry_id"),
      memory_class: enumValue(record.memory_class ?? "self_note", MEMORY_CLASSES, "durable_provenance.memory_class"),
      actor: stringValue(record.actor),
      reason_class: stringValue(record.reason_class),
      timestamp: stringValue(record.timestamp),
      model_id: stringValue(record.model_id),
      episode_id: stringValue(record.episode_id),
      domain: enumValue(record.domain ?? "testing", DOMAINS, "durable_provenance.domain"),
      grant_id: stringValue(record.grant_id),
      provider: stringValue(record.provider),
      scope: stringValue(record.scope),
      activation_performed: record.activation_performed === true,
    }));
}

function projectDurableProvenanceRecord(raw) {
  if (raw.event_type === "occupant.memory.written") {
    return {
      raw,
      stable_id: `durable_provenance_activity:${raw.event_type}:${raw.entry_id}:${raw.timestamp}`,
      domain: raw.domain,
      activity_class: "capability_use",
      event_type: "memory.provenance.written",
      capability_class: "memory",
      summary_class: "completed",
      coarse_time_bucket: coarseTimeBucket(raw.timestamp),
    };
  }
  if (raw.event_type === "occupant.memory.revoked") {
    return {
      raw,
      stable_id: `durable_provenance_activity:${raw.event_type}:${raw.entry_id}:${raw.timestamp}`,
      domain: raw.domain,
      activity_class: "control",
      event_type: "memory.provenance.revoked",
      capability_class: "memory",
      summary_class: "control",
      coarse_time_bucket: coarseTimeBucket(raw.timestamp),
    };
  }
  return null;
}

function memoryItem({ kind, entry, tombstone, sourceRank }) {
  const timestamp = kind === "entry" ? entry.created_at : tombstone.removed_at;
  const stable = kind === "entry" ? `occupant_memory:entry:${entry.id}` : `occupant_memory:tombstone:${tombstone.entry_id}`;
  return {
    source_class: "occupant_memory",
    raw: kind === "entry" ? { kind, entry } : { kind, tombstone },
    sort_key: sortKey({
      source_class: "occupant_memory",
      timestamp,
      sourceRank,
      trustRank: TRUST_RANKS.participant_memory,
      freshnessRank: FRESHNESS_RANKS.persistent,
      stable,
    }),
  };
}

function activityItem({ event, sourceRank }) {
  return {
    source_class: "local_activity_fixture",
    raw: event,
    sort_key: sortKey({
      source_class: "local_activity_fixture",
      timestamp: event.timestamp,
      sourceRank,
      trustRank: TRUST_RANKS.local_fixture,
      freshnessRank: FRESHNESS_RANKS.snapshot_pinned,
      stable: `local_activity_fixture:${event.id}`,
    }),
  };
}

function durableProvenanceActivityItem({ record, sourceRank }) {
  return {
    source_class: "durable_provenance_activity",
    raw: record,
    sort_key: sortKey({
      source_class: "durable_provenance_activity",
      timestamp: record.raw.timestamp,
      sourceRank,
      trustRank: TRUST_RANKS.local_provenance,
      freshnessRank: FRESHNESS_RANKS.persistent,
      stable: record.stable_id,
    }),
  };
}

function sortKey({ source_class, timestamp, sourceRank, trustRank, freshnessRank, stable }) {
  return Object.freeze({
    timestamp_ms: timestampMs(timestamp),
    source_class,
    source_rank: sourceRank,
    trust_rank: trustRank,
    freshness_rank: freshnessRank,
    stable_item_key: stable,
  });
}

function compareNewestFirst(left, right) {
  return right.sort_key.timestamp_ms - left.sort_key.timestamp_ms
    || left.sort_key.source_rank - right.sort_key.source_rank
    || left.sort_key.stable_item_key.localeCompare(right.sort_key.stable_item_key);
}

function compareActivityById(left, right) {
  return left.id.localeCompare(right.id);
}

function compareDurableProvenanceRecord(left, right) {
  return left.event_type.localeCompare(right.event_type)
    || left.entry_id.localeCompare(right.entry_id)
    || left.timestamp.localeCompare(right.timestamp);
}

function sourceRankFor(sourceClass, sourceClassOrder) {
  const explicit = sourceClassOrder.indexOf(sourceClass);
  return explicit >= 0 ? explicit + 1 : SOURCE_RANKS[sourceClass] ?? 99;
}

function sourceClassSet(adapters) {
  return new Set(Object.keys(adapters));
}

function defaultMinimizationFor(sourceClass) {
  return sourceClass === "local_activity_fixture" || sourceClass === "durable_provenance_activity" ? "activity_summary" : "excerpt_for_reasoner";
}

function sourceOmission(selector, reasonClass, count) {
  return Object.freeze({
    source_class: selector.source_class,
    required: selector.required === true,
    reason_class: enumReasonClass(reasonClass),
    count_class: count,
  });
}

function projectSourceOmissions(omissions) {
  return Object.freeze(omissions.map((omission) => Object.freeze({
    source_class: enumValue(omission.source_class, sourceClassSet(SOURCE_ADAPTERS), "source_omissions.source_class"),
    required: omission.required === true,
    reason_class: enumReasonClass(omission.reason_class),
    count_class: countClassValue(omission.count_class),
  })));
}

function safeRecipeDigestForRefusal(recipeDigest, reasonClass) {
  return reasonClass === "recipe_schema_invalid" || reasonClass === "selector_payload_bearing"
    ? ""
    : String(recipeDigest ?? "");
}

function rejectUnknownFields(object, allowed, fieldClassName) {
  const unknown = Object.keys(object).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    const unknownField = unknown[0];
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe includes an unsupported field.", {
      reason_class: payloadBearingField(unknownField) ? "selector_payload_bearing" : "recipe_schema_invalid",
      violated_field_class: unknownFieldClass({ field: unknownField, parent: fieldClassName }),
    });
  }
}

function unknownFieldClass({ field, parent }) {
  return payloadBearingField(field) ? fieldClass(`${parent}.${field}`) : fieldClass(`${parent}.unknown_field`);
}

function payloadBearingField(field) {
  return [
    "query",
    "selector_text",
    "entry_id",
    "file_path",
    "title",
    "digest",
    "embedding",
    "entity_name",
    "participant_name",
    "source_uri",
    "memory_text",
    "tags",
    "tag",
    "filter",
    "sort",
  ].includes(String(field ?? ""));
}

function boundedId(value, name) {
  const text = stringValue(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(text)) {
    throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${name} must be an id-like string.`, {
      reason_class: "recipe_schema_invalid",
      violated_field_class: fieldClass(name),
    });
  }
  return text;
}

function enumValue(value, allowed, field) {
  const text = stringValue(value);
  if (!allowed.has(text)) {
    throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${field} is invalid.`, {
      reason_class: "recipe_schema_invalid",
      violated_field_class: fieldClass(field),
    });
  }
  return text;
}

function enumArray(value, allowed, field, { required = false } = {}) {
  if (!Array.isArray(value)) {
    throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${field} must be an array.`, {
      reason_class: "recipe_schema_invalid",
      violated_field_class: fieldClass(field),
    });
  }
  const normalized = [...new Set(value.map(stringValue).filter(Boolean))];
  if (required && normalized.length === 0) {
    throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${field} is required.`, {
      reason_class: "recipe_schema_invalid",
      violated_field_class: fieldClass(field),
    });
  }
  for (const item of normalized) {
    if (!allowed.has(item)) {
      throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${field} contains an invalid value.`, {
        reason_class: "recipe_schema_invalid",
        violated_field_class: fieldClass(field),
      });
    }
  }
  return Object.freeze(normalized);
}

function integerValue(value, field, { min, max }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw contextAssemblyError("context_recipe_invalid", `ContextRecipe ${field} is outside the allowed range.`, {
      reason_class: "recipe_schema_invalid",
      violated_field_class: fieldClass(field),
    });
  }
  return number;
}

function enumReasonClass(value) {
  const reason = stringValue(value);
  return REASON_CLASSES.has(reason) ? reason : "recipe_schema_invalid";
}

function enumManifestStatus(value) {
  const status = stringValue(value);
  return ["assembled", "refused"].includes(status) ? status : "refused";
}

function fieldClass(value) {
  return stringValue(value).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
}

function integerOrZero(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function countClass(value) {
  const number = integerOrZero(value);
  if (number === 0) {
    return "none";
  }
  if (number <= 3) {
    return "some";
  }
  return "many";
}

function countClassValue(value) {
  const text = stringValue(value);
  return ["none", "some", "many"].includes(text) ? text : "none";
}

function projectAbstention(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  return Object.freeze({
    reason_class: enumReasonClass(record.reason_class),
    violated_field_class: fieldClass(record.violated_field_class ?? ""),
  });
}

function sortMemoryEntry(entry) {
  return {
    id: entry.id,
    memory_class: entry.memory_class,
    content: entry.content,
    tags: [...entry.tags].sort(),
    model_id: entry.model_id,
    episode_id: entry.episode_id,
    domain: entry.domain,
    created_at: entry.created_at,
    created_by: entry.created_by,
    grant_id: entry.grant_id,
    provider: entry.provider,
    scope: entry.scope,
    status: entry.status,
  };
}

function sortMemoryTombstone(tombstone) {
  return {
    entry_id: tombstone.entry_id,
    memory_class: tombstone.memory_class,
    model_id: tombstone.model_id,
    episode_id: tombstone.episode_id,
    domain: tombstone.domain,
    created_at: tombstone.created_at,
    removed_at: tombstone.removed_at,
    removed_by: tombstone.removed_by,
    reason_class: tombstone.reason_class,
    grant_id: tombstone.grant_id,
    provider: tombstone.provider,
    scope: tombstone.scope,
  };
}

function compareById(left, right) {
  return left.id.localeCompare(right.id);
}

function compareByEntryId(left, right) {
  return left.entry_id.localeCompare(right.entry_id);
}

function newestTimestampMs(items) {
  return items
    .flatMap((item) => [item.timestamp, item.created_at, item.removed_at])
    .filter(Boolean)
    .map(timestampMs)
    .sort((left, right) => right - left)[0] ?? 0;
}

function timestampMs(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function coarseTimeBucket(value) {
  const timestamp = timestampMs(value);
  if (timestamp === 0) {
    return "unknown";
  }
  return timestamp >= Date.parse("2026-01-01T00:00:00.000Z") ? "recent" : "older";
}

function deterministicExcerpt(content, maxLength) {
  const text = stringValue(content);
  return text.length > maxLength ? `${text.slice(0, maxLength - 12).trimEnd()} [truncated]` : text;
}

function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value) {
  const date = value instanceof Date ? value : value();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("now must return a valid Date");
  }
  return date;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function contextAssemblyError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "ContextAssemblyError";
  error.code = code;
  Object.assign(error, details);
  return error;
}
