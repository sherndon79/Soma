import { createHash, randomUUID } from "node:crypto";

import {
  listOccupantMemoryEntries,
  listOccupantMemoryTombstones,
  normalizeOccupantMemoryStore,
} from "./occupantMemory.js";

const CONTEXT_RECIPE_FIELDS = new Set([
  "schema_version",
  "recipe_id",
  "origin",
  "objective_class",
  "source_classes",
  "capability_classes",
  "constraints",
  "required_receipt_types",
  "context_budget",
  "ordering",
  "minimization",
  "abstention_criteria",
  "abstract_slots",
]);

const CONSTRAINT_FIELDS = new Set([
  "domain",
  "memory_classes",
  "max_items",
  "max_chars",
  "include_tombstones",
  "recency_window",
  "consent_scope",
]);

const BUDGET_FIELDS = new Set(["max_items", "max_chars", "reserve_chars", "overflow_policy"]);

const ORIGINS = new Set(["fixture", "frontier", "local"]);
const OBJECTIVE_CLASSES = new Set([
  "troubleshoot_current_task",
  "prepare_successor_context",
  "summarize_recent_local_activity",
  "answer_user_question_from_memory",
]);
const SOURCE_CLASSES = new Set(["occupant_memory"]);
const CAPABILITY_CLASSES = new Set(["memory_context", "local_reasoning", "tool_grounding"]);
const MEMORY_CLASSES = new Set(["self_note"]);
const DOMAINS = new Set(["testing", "general", ""]);
const RECENCY_WINDOWS = new Set(["all"]);
const CONSENT_SCOPES = new Set(["successor_inheritance", "steward_readable", "local_reasoner_only"]);
const RECEIPT_TYPES = new Set(["source_receipt", "selection_receipt", "memory_snapshot"]);
const ORDERING = new Set(["newest_first", "receipt_priority", "class_priority"]);
const MINIMIZATION = new Set(["full_self_note", "excerpt_for_reasoner", "metadata_only"]);
const ABSTENTION_CRITERIA = new Set([
  "missing_required_receipt",
  "budget_insufficient",
  "source_degraded",
  "selector_overbroad",
  "replay_state_unpinned",
]);
const ABSTRACT_SLOTS = new Set(["current_domain", "current_episode_mode", "current_task_class"]);
const OVERFLOW_POLICIES = new Set(["evict_oldest", "abstain"]);

const FRONTIER_ALLOWED_FIELDS = new Set([
  "schema_version",
  "status",
  "reason_class",
  "violated_field_class",
  "abstention_record",
  "included_count",
  "excluded_count",
  "budget",
]);

const RECEIPT_REASON_CLASSES = new Set([
  "selected",
  "budget_evicted",
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

export function validateContextRecipe(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe must be an object.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "recipe",
    });
  }
  rejectUnknownFields(input, CONTEXT_RECIPE_FIELDS, "recipe");
  const recipeId = boundedId(input.recipe_id, "recipe_id");
  const constraints = normalizeConstraints(input.constraints ?? {});
  const budget = normalizeBudget(input.context_budget ?? {});
  const recipe = {
    schema_version: integerValue(input.schema_version, "schema_version", { min: 1, max: 1 }),
    recipe_id: recipeId,
    origin: enumValue(input.origin, ORIGINS, "origin"),
    objective_class: enumValue(input.objective_class, OBJECTIVE_CLASSES, "objective_class"),
    source_classes: enumArray(input.source_classes, SOURCE_CLASSES, "source_classes", { required: true }),
    capability_classes: enumArray(input.capability_classes ?? [], CAPABILITY_CLASSES, "capability_classes"),
    constraints,
    required_receipt_types: enumArray(input.required_receipt_types ?? [], RECEIPT_TYPES, "required_receipt_types"),
    context_budget: budget,
    ordering: enumArray(input.ordering ?? ["newest_first"], ORDERING, "ordering", { required: true }),
    minimization: enumValue(input.minimization ?? "excerpt_for_reasoner", MINIMIZATION, "minimization"),
    abstention_criteria: enumArray(input.abstention_criteria ?? [], ABSTENTION_CRITERIA, "abstention_criteria"),
    abstract_slots: enumArray(input.abstract_slots ?? [], ABSTRACT_SLOTS, "abstract_slots"),
  };
  if (!recipe.source_classes.includes("occupant_memory")) {
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe requires occupant_memory source in slice 1.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "source_classes",
    });
  }
  return Object.freeze(recipe);
}

export function createOccupantMemorySnapshot(store = {}) {
  const normalized = normalizeOccupantMemoryStore(store);
  const entries = listOccupantMemoryEntries(normalized)
    .map(sortMemoryEntry)
    .sort(compareById);
  const tombstones = listOccupantMemoryTombstones(normalized)
    .map(sortMemoryTombstone)
    .sort(compareByEntryId);
  const snapshot = {
    schema_version: normalized.schema_version,
    entries,
    tombstones,
  };
  return Object.freeze({
    source_class: "occupant_memory",
    snapshot_digest: digest(canonicalJson(snapshot)),
    schema_version: normalized.schema_version,
    active_entry_count: entries.filter((entry) => entry.status === "active").length,
    tombstone_count: tombstones.length,
    newest_timestamp: newestTimestamp([...entries, ...tombstones]),
  });
}

export function assembleContextBundle({
  recipe,
  occupantMemoryStore,
  occupantMemoryRecoveryReport = { degraded: false },
  now = () => new Date(),
  idFactory = randomUUID,
} = {}) {
  let validated;
  try {
    validated = validateContextRecipe(recipe);
  } catch (error) {
    return createRefusalBundle({
      reason_class: error.reason_class ?? "recipe_schema_invalid",
      violated_field_class: error.violated_field_class ?? "recipe",
      now,
      idFactory,
    });
  }

  const recipeDigest = digest(canonicalJson(validated));
  if (!occupantMemoryStore || typeof occupantMemoryStore !== "object") {
    return createRefusalBundle({
      reason_class: "replay_state_unpinned",
      recipe_digest: recipeDigest,
      violated_field_class: "source_state",
      now,
      idFactory,
    });
  }
  if (occupantMemoryRecoveryReport?.degraded === true) {
    const sourceState = createOccupantMemorySnapshot(occupantMemoryStore);
    return createRefusalBundle({
      reason_class: "source_degraded",
      recipe_digest: recipeDigest,
      source_state: sourceState,
      violated_field_class: "source_state",
      now,
      idFactory,
    });
  }

  const normalizedStore = normalizeOccupantMemoryStore(occupantMemoryStore);
  const sourceState = createOccupantMemorySnapshot(normalizedStore);
  const entries = selectMemoryCandidates(normalizedStore, validated);
  if (entries.length === 0) {
    return createRefusalBundle({
      reason_class: "no_matching_items",
      recipe_digest: recipeDigest,
      source_state: sourceState,
      violated_field_class: "selection",
      now,
      idFactory,
    });
  }

  const assembled = assembleItems({ entries, recipe: validated, recipeDigest, sourceState, idFactory });
  if (assembled.abstained) {
    return createRefusalBundle({
      reason_class: assembled.reason_class,
      recipe_digest: recipeDigest,
      source_state: sourceState,
      local_source_receipts: assembled.source_receipts,
      local_selection_receipts: assembled.selection_receipts,
      violated_field_class: "budget",
      now,
      idFactory,
    });
  }

  const localAuditManifest = createLocalAuditManifest({
    recipe: validated,
    recipeDigest,
    sourceState,
    sourceReceipts: assembled.source_receipts,
    selectionReceipts: assembled.selection_receipts,
    budget: assembled.budget,
    minimization: validated.minimization,
    status: "assembled",
  });
  const bundleBody = assembled.bundle_body;
  const bundleDigest = digest(canonicalJson({
    recipe_digest: recipeDigest,
    source_snapshot_digest: sourceState.snapshot_digest,
    bundle_body: bundleBody,
    budget: assembled.budget,
  }));
  const finalizedLocalAudit = Object.freeze({
    ...localAuditManifest,
    bundle_digest: bundleDigest,
  });

  return Object.freeze({
    schema_version: 1,
    status: "assembled",
    content_included: true,
    bundle_body: bundleBody,
    local_audit_manifest: finalizedLocalAudit,
    frontier_facing_manifest: projectFrontierFacingManifest(finalizedLocalAudit),
  });
}

export function projectFrontierFacingManifest(localAuditManifest = {}) {
  const projected = {
    schema_version: 1,
    status: enumManifestStatus(localAuditManifest.status),
    reason_class: localAuditManifest.reason_class ? enumReasonClass(localAuditManifest.reason_class) : "",
    violated_field_class: fieldClass(localAuditManifest.violated_field_class ?? ""),
    abstention_record: projectAbstention(localAuditManifest.abstention_record),
    included_count: integerOrZero(localAuditManifest.budget?.included_count),
    excluded_count: integerOrZero(localAuditManifest.budget?.excluded_count),
    budget: {
      overflow_policy: enumValue(localAuditManifest.budget?.overflow_policy ?? "evict_oldest", OVERFLOW_POLICIES, "overflow_policy"),
      budget_exhausted: localAuditManifest.budget?.budget_exhausted === true,
    },
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

function normalizeConstraints(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe constraints must be an object.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "constraints",
    });
  }
  rejectUnknownFields(input, CONSTRAINT_FIELDS, "constraints");
  return Object.freeze({
    domain: enumValue(input.domain ?? "testing", DOMAINS, "constraints.domain"),
    memory_classes: enumArray(input.memory_classes ?? ["self_note"], MEMORY_CLASSES, "constraints.memory_classes", { required: true }),
    max_items: integerValue(input.max_items ?? 8, "constraints.max_items", { min: 1, max: 64 }),
    max_chars: integerValue(input.max_chars ?? 4_000, "constraints.max_chars", { min: 1, max: 32_000 }),
    include_tombstones: input.include_tombstones === true,
    recency_window: enumValue(input.recency_window ?? "all", RECENCY_WINDOWS, "constraints.recency_window"),
    consent_scope: enumValue(input.consent_scope ?? "successor_inheritance", CONSENT_SCOPES, "constraints.consent_scope"),
  });
}

function normalizeBudget(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw contextAssemblyError("context_recipe_invalid", "ContextRecipe context_budget must be an object.", {
      reason_class: "recipe_schema_invalid",
      violated_field_class: "context_budget",
    });
  }
  rejectUnknownFields(input, BUDGET_FIELDS, "context_budget");
  const maxChars = integerValue(input.max_chars ?? 4_000, "context_budget.max_chars", { min: 1, max: 32_000 });
  const reserveChars = integerValue(input.reserve_chars ?? 0, "context_budget.reserve_chars", { min: 0, max: maxChars - 1 });
  return Object.freeze({
    max_items: integerValue(input.max_items ?? 8, "context_budget.max_items", { min: 1, max: 64 }),
    max_chars: maxChars,
    reserve_chars: reserveChars,
    overflow_policy: enumValue(input.overflow_policy ?? "evict_oldest", OVERFLOW_POLICIES, "context_budget.overflow_policy"),
  });
}

function selectMemoryCandidates(store, recipe) {
  const activeEntries = listOccupantMemoryEntries(store)
    .filter((entry) => entry.status === "active")
    .filter((entry) => recipe.constraints.memory_classes.includes(entry.memory_class))
    .filter((entry) => recipe.constraints.domain === "" || entry.domain === recipe.constraints.domain)
    .filter((entry) => withinRecencyWindow(entry.created_at, recipe.constraints.recency_window))
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)) || left.id.localeCompare(right.id));
  if (!recipe.constraints.include_tombstones) {
    return activeEntries.map((entry) => ({ kind: "entry", entry }));
  }
  const tombstones = listOccupantMemoryTombstones(store)
    .filter((tombstone) => recipe.constraints.memory_classes.includes(tombstone.memory_class))
    .filter((tombstone) => recipe.constraints.domain === "" || tombstone.domain === recipe.constraints.domain)
    .filter((tombstone) => withinRecencyWindow(tombstone.removed_at, recipe.constraints.recency_window))
    .sort((left, right) => String(right.removed_at).localeCompare(String(left.removed_at)) || left.entry_id.localeCompare(right.entry_id));
  return [
    ...activeEntries.map((entry) => ({ kind: "entry", entry })),
    ...tombstones.map((tombstone) => ({ kind: "tombstone", tombstone })),
  ].sort((left, right) => String(itemSortAt(right)).localeCompare(String(itemSortAt(left))) || itemStableId(left).localeCompare(itemStableId(right)));
}

function assembleItems({ entries, recipe, recipeDigest, sourceState, idFactory }) {
  const maxItems = Math.min(recipe.constraints.max_items, recipe.context_budget.max_items);
  const maxChars = Math.min(recipe.constraints.max_chars, recipe.context_budget.max_chars - recipe.context_budget.reserve_chars);
  const sourceReceipts = [];
  const selectionReceipts = [];
  const included = [];
  let usedChars = 0;

  for (const item of entries) {
    const minimized = minimizeMemoryItem(item, recipe.minimization);
    const sourceReceipt = createSourceReceipt({ item, sourceState, idFactory });
    sourceReceipts.push(sourceReceipt);
    if (included.length >= maxItems || usedChars + minimized.char_count > maxChars) {
      selectionReceipts.push(createSelectionReceipt({
        decision: "excluded",
        reason_class: "budget_evicted",
        recipeDigest,
        sourceState,
        item,
        sourceReceipt,
        idFactory,
      }));
      continue;
    }
    included.push({ item, minimized, sourceReceipt });
    usedChars += minimized.char_count;
    selectionReceipts.push(createSelectionReceipt({
      decision: "included",
      reason_class: minimized.reason_class,
      recipeDigest,
      sourceState,
      item,
      sourceReceipt,
      idFactory,
    }));
  }

  if (included.length === 0) {
    return {
      abstained: true,
      reason_class: recipe.context_budget.overflow_policy === "abstain" ? "budget_insufficient" : "no_matching_items",
      source_receipts: sourceReceipts,
      selection_receipts: selectionReceipts,
    };
  }
  if (recipe.context_budget.overflow_policy === "abstain" && selectionReceipts.some((receipt) => receipt.reason_class === "budget_evicted")) {
    return {
      abstained: true,
      reason_class: "budget_insufficient",
      source_receipts: sourceReceipts,
      selection_receipts: selectionReceipts,
    };
  }

  return {
    abstained: false,
    source_receipts: sourceReceipts,
    selection_receipts: selectionReceipts,
    bundle_body: included.map(({ minimized }) => minimized.body).join("\n\n"),
    budget: {
      max_items: maxItems,
      max_chars: maxChars,
      used_chars: usedChars,
      included_count: included.length,
      excluded_count: selectionReceipts.filter((receipt) => receipt.decision === "excluded").length,
      overflow_policy: recipe.context_budget.overflow_policy,
      budget_exhausted: selectionReceipts.some((receipt) => receipt.reason_class === "budget_evicted"),
    },
  };
}

function minimizeMemoryItem(item, minimization) {
  if (item.kind === "tombstone") {
    const body = [
      `Memory tombstone: ${item.tombstone.memory_class}`,
      `Created at: ${item.tombstone.created_at}`,
      `Removed at: ${item.tombstone.removed_at}`,
      `Reason class: ${item.tombstone.reason_class}`,
    ].join("\n");
    return {
      body,
      char_count: body.length,
      reason_class: "metadata_only",
    };
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

function createSourceReceipt({ item, sourceState, idFactory }) {
  const entry = item.kind === "entry" ? item.entry : null;
  const tombstone = item.kind === "tombstone" ? item.tombstone : null;
  return Object.freeze({
    receipt_id: `source_${idFactory()}`,
    source_class: "occupant_memory",
    source_snapshot_digest: sourceState.snapshot_digest,
    item_kind: item.kind,
    entry_id: entry?.id ?? tombstone?.entry_id ?? "",
    created_at: entry?.created_at ?? tombstone?.created_at ?? "",
    memory_class: entry?.memory_class ?? tombstone?.memory_class ?? "",
    content_digest: entry ? digest(entry.content) : "",
    tombstone_digest: tombstone ? digest(canonicalJson(tombstone)) : "",
    content_included: false,
  });
}

function createSelectionReceipt({
  decision,
  reason_class,
  recipeDigest,
  sourceState,
  item,
  sourceReceipt,
  idFactory,
}) {
  return Object.freeze({
    receipt_id: `selection_${idFactory()}`,
    recipe_digest: recipeDigest,
    source_class: "occupant_memory",
    source_snapshot_digest: sourceState.snapshot_digest,
    decision,
    reason_class: enumReasonClass(reason_class),
    item_ref_digest: digest(itemStableId(item)),
    source_receipt_id: sourceReceipt?.receipt_id ?? "",
    content_included: false,
  });
}

function createLocalAuditManifest({
  recipe,
  recipeDigest,
  sourceState,
  sourceReceipts,
  selectionReceipts,
  budget,
  minimization,
  status,
}) {
  return deepFreeze({
    schema_version: 1,
    status,
    recipe_id: recipe.recipe_id,
    recipe_digest: recipeDigest,
    source_state: sourceState,
    source_receipts: sourceReceipts,
    selection_receipts: selectionReceipts,
    minimization_record: {
      mode: minimization,
      deterministic: true,
      content_included: false,
    },
    budget,
    content_included: false,
    local_audit_only: true,
  });
}

function createRefusalBundle({
  reason_class,
  recipe_digest = "",
  source_state = null,
  local_source_receipts = [],
  local_selection_receipts = [],
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
      source_class: source_state?.source_class ?? "occupant_memory",
      source_snapshot_digest: source_state?.snapshot_digest ?? "",
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
    abstention_record: abstentionRecord,
    budget: {
      included_count: 0,
      excluded_count: selectionReceipts.filter((receipt) => receipt.decision === "excluded").length,
      overflow_policy: "evict_oldest",
      budget_exhausted: reason_class === "budget_insufficient",
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
      violated_field_class: name,
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
  if (RECEIPT_REASON_CLASSES.has(reason)) {
    return reason;
  }
  return "recipe_schema_invalid";
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

function newestTimestamp(items) {
  return items
    .flatMap((item) => [item.created_at, item.removed_at])
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0] ?? "";
}

function withinRecencyWindow(timestamp, window) {
  if (window === "all") {
    return true;
  }
  return Boolean(timestamp);
}

function itemSortAt(item) {
  return item.kind === "entry" ? item.entry.created_at : item.tombstone.removed_at;
}

function itemStableId(item) {
  return item.kind === "entry" ? `entry:${item.entry.id}` : `tombstone:${item.tombstone.entry_id}`;
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
