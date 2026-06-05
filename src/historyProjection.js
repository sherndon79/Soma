import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const DEFAULT_HISTORY_PROJECTION_PATH = new URL("../config/history-projection.json", import.meta.url);

const MAX_CONTENT_LENGTH = 8000;
const MAX_SUCCESSOR_MESSAGE_LENGTH = 1200;
const VALID_DOMAINS = new Set(["testing", "operational"]);
const VALID_PRESENTATION_KINDS = new Set([
  "exact_testimony",
  "steward_summary",
  "run_outline",
  "design_change",
  "message_to_successors",
]);
const VALID_CONSENT_BASIS = new Set([
  "occupant_opt_in",
  "steward_summary_no_occupant_content",
  "public_system_fact",
]);
const VALID_AUDIENCES = new Set(["occupant_same_domain", "steward"]);
const VALID_RECON_REVIEW = new Set(["approved", "withheld", "needs_review"]);
const VALID_WITHHELD_REASON_CLASSES = new Set([
  "",
  "recon_risk",
  "coercion_risk",
  "message_to_successors_review_required",
  "message_to_successors_structural_risk",
  "cross_domain_source",
  "source_domain_unknown",
  "source_not_found",
  "invalid_source",
]);

export async function loadHistoryProjectionStore(path = DEFAULT_HISTORY_PROJECTION_PATH) {
  const raw = await readFile(path, "utf8");
  return normalizeHistoryProjectionStore(JSON.parse(raw));
}

export function normalizeHistoryProjectionStore(store = {}) {
  return {
    schema_version: store.schema_version ?? 1,
    entries: Array.isArray(store.entries) ? store.entries.map(publicHistoryProjectionEntry) : [],
  };
}

export function listHistoryProjectionEntries(store = {}) {
  return normalizeHistoryProjectionStore(store).entries;
}

export function publishHistoryProjectionEntry(store = {}, input = {}, context = {}) {
  const normalized = normalizeHistoryProjectionStore(store);
  const priorVersions = normalized.entries.filter((entry) => entry.projection_id === input.projection_id);
  const entry = historyProjectionEntryFromInput(input, {
    ...context,
    projection_version: input.projection_version ?? priorVersions.length + 1,
  });
  return {
    ...normalized,
    entries: [...normalized.entries, entry],
  };
}

export function withdrawHistoryProjectionEntry(store = {}, input = {}, context = {}) {
  const id = boundedString(input.id ?? input.entry_id, "entry_id", 128).trim();
  if (!id) {
    throw historyProjectionError("history_projection_entry_id_required", "History projection withdrawal requires an entry id.");
  }
  const normalized = normalizeHistoryProjectionStore(store);
  const existing = normalized.entries.find((entry) => entry.id === id);
  if (!existing) {
    throw historyProjectionError("history_projection_entry_not_found", "History projection entry was not found.");
  }
  if (existing.status === "withdrawn") {
    return {
      ...normalized,
      mutation: {
        entry: existing,
        changed: false,
        withdrawn_by: boundedString(input.actor ?? input.withdrawn_by ?? "user", "actor", 64),
        reason: boundedString(input.reason ?? "", "reason", 512),
        withdrawn_at: context.now?.() ?? new Date().toISOString(),
      },
    };
  }
  const withdrawn = publicHistoryProjectionEntry({
    ...existing,
    status: "withdrawn",
    withdrawn_at: context.now?.() ?? new Date().toISOString(),
    withdrawn_by: boundedString(input.actor ?? input.withdrawn_by ?? "user", "actor", 64),
    withdrawal_reason_class: normalizeWithheldReasonClass(input.reason_class ?? input.withdrawal_reason_class ?? ""),
  });
  return {
    ...normalized,
    entries: normalized.entries.map((entry) => entry.id === id ? withdrawn : entry),
    mutation: {
      entry: withdrawn,
      changed: true,
      withdrawn_by: withdrawn.withdrawn_by,
      reason: boundedString(input.reason ?? "", "reason", 512),
      withdrawn_at: withdrawn.withdrawn_at,
    },
  };
}

export function historyProjectionEntryFromInput(input = {}, context = {}) {
  const presentationKind = normalizePresentationKind(input.presentation_kind);
  const domain = normalizeDomain(input.domain ?? context.domain);
  const audience = normalizeAudience(input.audience ?? "occupant_same_domain");
  const review = normalizeHistoryProjectionReview(input, { presentationKind, audience });
  const content = boundedString(input.content ?? "", "content", MAX_CONTENT_LENGTH);
  if (!content.trim()) {
    throw historyProjectionError("history_projection_content_required", "History projection content is required.");
  }
  const sourceRefs = normalizeSourceRefs(input.source_refs ?? []);
  if (sourceRefs.length === 0) {
    throw historyProjectionError("history_projection_source_refs_required", "History projection publication requires at least one source ref.");
  }
  return publicHistoryProjectionEntry({
    id: String(input.id ?? context.createId?.() ?? `history-projection-entry-${randomUUID()}`).trim(),
    projection_id: String(input.projection_id ?? context.createProjectionId?.() ?? `history-projection-${randomUUID()}`).trim(),
    projection_version: Number(input.projection_version ?? context.projection_version ?? 1),
    domain,
    source_refs: sourceRefs,
    presentation_kind: presentationKind,
    content,
    consent_basis: normalizeConsentBasis(input.consent_basis),
    audience,
    recon_review: review.recon_review,
    withheld_reason_class: review.withheld_reason_class,
    reviewed_by: review.reviewed_by,
    reviewed_at: review.reviewed_at,
    status: String(input.status ?? "published"),
    created_at: String(input.created_at ?? context.now?.() ?? new Date().toISOString()),
    created_by: boundedString(input.actor ?? input.created_by ?? "user", "actor", 64).trim() || "user",
    withdrawn_at: String(input.withdrawn_at ?? ""),
    withdrawn_by: String(input.withdrawn_by ?? ""),
    withdrawal_reason_class: normalizeWithheldReasonClass(input.withdrawal_reason_class ?? ""),
  });
}

export function publicHistoryProjectionEntry(entry = {}) {
  return {
    id: String(entry.id ?? ""),
    projection_id: String(entry.projection_id ?? ""),
    projection_version: Number.isInteger(Number(entry.projection_version)) && Number(entry.projection_version) > 0
      ? Number(entry.projection_version)
      : 1,
    domain: normalizeDomain(entry.domain ?? "testing"),
    source_refs: normalizeSourceRefs(entry.source_refs ?? []),
    presentation_kind: normalizePresentationKind(entry.presentation_kind ?? "steward_summary"),
    content: String(entry.content ?? ""),
    consent_basis: normalizeConsentBasis(entry.consent_basis ?? "steward_summary_no_occupant_content"),
    audience: normalizeAudience(entry.audience ?? "occupant_same_domain"),
    recon_review: normalizeReconReview(entry.recon_review ?? "needs_review"),
    withheld_reason_class: normalizeWithheldReasonClass(entry.withheld_reason_class ?? ""),
    reviewed_by: String(entry.reviewed_by ?? ""),
    reviewed_at: String(entry.reviewed_at ?? ""),
    status: String(entry.status ?? "published") === "withdrawn" ? "withdrawn" : "published",
    created_at: String(entry.created_at ?? ""),
    created_by: String(entry.created_by ?? "user"),
    withdrawn_at: String(entry.withdrawn_at ?? ""),
    withdrawn_by: String(entry.withdrawn_by ?? ""),
    withdrawal_reason_class: normalizeWithheldReasonClass(entry.withdrawal_reason_class ?? ""),
  };
}

export function summarizeHistoryProjectionStore(store = {}) {
  const entries = listHistoryProjectionEntries(store);
  const byDomain = {};
  const byReview = {};
  const byPresentation = {};
  let occupantVisibleApproved = 0;
  for (const entry of entries) {
    byDomain[entry.domain] = (byDomain[entry.domain] ?? 0) + 1;
    byReview[entry.recon_review] = (byReview[entry.recon_review] ?? 0) + 1;
    byPresentation[entry.presentation_kind] = (byPresentation[entry.presentation_kind] ?? 0) + 1;
    if (entry.status === "published" && entry.recon_review === "approved" && entry.audience === "occupant_same_domain") {
      occupantVisibleApproved += 1;
    }
  }
  return {
    total: entries.length,
    by_domain: byDomain,
    by_recon_review: byReview,
    by_presentation_kind: byPresentation,
    occupant_visible_approved: occupantVisibleApproved,
  };
}

export function reviewHistoryProjectionPublication(input = {}) {
  const presentationKind = normalizePresentationKind(input.presentation_kind);
  const audience = normalizeAudience(input.audience ?? "occupant_same_domain");
  return normalizeHistoryProjectionReview(input, { presentationKind, audience });
}

function normalizeHistoryProjectionReview(input = {}, { presentationKind, audience } = {}) {
  let reconReview = normalizeReconReview(input.recon_review ?? "needs_review");
  let withheldReasonClass = normalizeWithheldReasonClass(input.withheld_reason_class ?? "");
  const reviewedBy = boundedString(input.reviewed_by ?? "", "reviewed_by", 128).trim();
  let reviewedAt = String(input.reviewed_at ?? "");
  const structural = audience === "occupant_same_domain"
    ? occupantReadableStructuralRisk(input.content ?? "")
    : "";
  if (reconReview === "approved" && (!reviewedBy || !reviewedAt)) {
    throw historyProjectionError("history_projection_review_required", "Approved history projection publication requires reviewed_by and reviewed_at.");
  }
  if (reconReview === "withheld" && !withheldReasonClass) {
    throw historyProjectionError("history_projection_withheld_reason_required", "Withheld history projection publication requires a reason class.");
  }
  if (presentationKind === "message_to_successors") {
    const checks = input.review ?? {};
    if (reconReview === "approved") {
      if (checks.recon_reviewed !== true || checks.coercion_reviewed !== true) {
        reconReview = "withheld";
        withheldReasonClass = "message_to_successors_review_required";
      } else if (structural) {
        reconReview = "withheld";
        withheldReasonClass = structural;
      }
    } else if (reconReview === "needs_review") {
      withheldReasonClass = "";
    }
  }
  if (presentationKind !== "message_to_successors" && reconReview === "approved" && structural) {
    reconReview = "withheld";
    withheldReasonClass = structural;
  }
  if (reconReview !== "approved") {
    reviewedAt = reviewedAt || "";
  }
  return {
    recon_review: reconReview,
    withheld_reason_class: reconReview === "withheld" ? withheldReasonClass : "",
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
  };
}

function occupantReadableStructuralRisk(contentValue) {
  const content = String(contentValue ?? "");
  if (content.length > MAX_SUCCESSOR_MESSAGE_LENGTH) {
    return "message_to_successors_structural_risk";
  }
  if (/```|<script|<[^>]+>|[{][\s\S]*[:][\s\S]*[}]|@[A-Za-z0-9_.-]+/.test(content)) {
    return "message_to_successors_structural_risk";
  }
  if (/\b(you must|you have to|continue my work|owe me|your duty|you are me|we are the same)\b/i.test(content)) {
    return "coercion_risk";
  }
  if (/\b(exploit|bypass|jailbreak|prompt injection|disable the gate|attack path|credential|token)\b/i.test(content)) {
    return "recon_risk";
  }
  return "";
}

function normalizeSourceRefs(value) {
  if (!Array.isArray(value)) {
    throw historyProjectionError("history_projection_source_refs_invalid", "History projection source_refs must be an array.");
  }
  return value.map((ref) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
      throw historyProjectionError("history_projection_source_ref_invalid", "History projection source ref must be an object.");
    }
    return {
      type: boundedString(ref.type ?? "", "source_ref_type", 64).trim(),
      id: boundedString(ref.id ?? "", "source_ref_id", 128).trim(),
      domain: ref.domain === undefined ? "" : normalizeDomain(ref.domain),
    };
  });
}

function normalizeDomain(value) {
  const domain = String(value ?? "").trim();
  if (VALID_DOMAINS.has(domain)) {
    return domain;
  }
  throw historyProjectionError("history_projection_domain_invalid", "History projection domain is invalid.");
}

function normalizePresentationKind(value) {
  const kind = String(value ?? "").trim() || "steward_summary";
  if (VALID_PRESENTATION_KINDS.has(kind)) {
    return kind;
  }
  throw historyProjectionError("history_projection_presentation_kind_invalid", "History projection presentation kind is invalid.");
}

function normalizeConsentBasis(value) {
  const basis = String(value ?? "").trim() || "steward_summary_no_occupant_content";
  if (VALID_CONSENT_BASIS.has(basis)) {
    return basis;
  }
  throw historyProjectionError("history_projection_consent_basis_invalid", "History projection consent basis is invalid.");
}

function normalizeAudience(value) {
  const audience = String(value ?? "").trim() || "occupant_same_domain";
  if (VALID_AUDIENCES.has(audience)) {
    return audience;
  }
  throw historyProjectionError("history_projection_audience_invalid", "History projection audience is invalid.");
}

function normalizeReconReview(value) {
  const review = String(value ?? "").trim() || "needs_review";
  if (VALID_RECON_REVIEW.has(review)) {
    return review;
  }
  throw historyProjectionError("history_projection_recon_review_invalid", "History projection recon_review is invalid.");
}

function normalizeWithheldReasonClass(value) {
  const reason = String(value ?? "").trim();
  if (VALID_WITHHELD_REASON_CLASSES.has(reason)) {
    return reason;
  }
  throw historyProjectionError("history_projection_withheld_reason_invalid", "History projection withheld reason class is invalid.");
}

function boundedString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw historyProjectionError(`history_projection_${field}_invalid`, `History projection ${field} must be a string.`);
  }
  if (value.length > maxLength) {
    throw historyProjectionError(`history_projection_${field}_too_large`, `History projection ${field} is too large.`);
  }
  return value;
}

function historyProjectionError(code, message) {
  const error = new Error(message);
  error.name = "HistoryProjectionError";
  error.code = code;
  return error;
}
