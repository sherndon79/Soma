import { createHash, randomUUID } from "node:crypto";

import { authorizeGrantUse } from "./grantAuthorization.js";

export const COMMS_FIXTURE_SEND_CAPABILITY = "comms.fixture.send";
export const COMMS_FIXTURE_PROVIDER_ID = "soma.provider.comms-fixture";

const CHANNELS = new Set(["email", "chat", "post"]);

export function createCommsDraftArtifact({
  channel = "email",
  recipients = [],
  body = "",
  now = () => new Date(),
  idFactory = randomUUID,
} = {}) {
  const normalizedChannel = enumValue(channel, CHANNELS, "email");
  const normalizedRecipients = normalizeRecipients(recipients);
  const normalizedBody = boundedBody(body);
  const recipientMark = renderRecipientVisibleMark({ channel: normalizedChannel });
  const finalBody = applyRecipientVisibleMark({
    body: normalizedBody,
    mark: recipientMark,
  });
  const createdAt = asDate(now()).toISOString();

  return Object.freeze({
    schema_version: 1,
    draft_id: idFactory(),
    created_at: createdAt,
    channel: normalizedChannel,
    recipients: normalizedRecipients,
    reviewed_body: normalizedBody,
    content_digest: digest(normalizedBody),
    recipient_mark: recipientMark,
    recipient_mark_previewed: true,
    mark_policy: "agent_assisted_on_seth_behalf_required",
    final_body_digest: digest(finalBody),
    final_body_byte_length: Buffer.byteLength(finalBody, "utf8"),
    content_retained_in_provenance: false,
    send_authority_granted: false,
  });
}

export function buildCommsSendPlan({
  draft,
  provider = COMMS_FIXTURE_PROVIDER_ID,
  grantId = "",
  now = () => new Date(),
  idFactory = randomUUID,
  callerClaims = {},
} = {}) {
  assertDraft(draft);
  const createdAt = asDate(now());
  const targetBinding = targetBindingForDraft(draft);
  const targetBindingDigest = digest(canonicalJson(targetBinding));
  const planId = idFactory();
  const ignoredClaims = ignoredCallerClaims(callerClaims);
  const planShape = {
    schema_version: 1,
    plan_id: planId,
    capability: COMMS_FIXTURE_SEND_CAPABILITY,
    provider_id: stringValue(provider) || COMMS_FIXTURE_PROVIDER_ID,
    grant_id: stringValue(grantId),
    task_id: planId,
    draft_id: draft.draft_id,
    draft_digest: draft.final_body_digest,
    target_binding: targetBinding,
    target_binding_digest: targetBindingDigest,
    consequence_class: "C3",
    consequence_class_source: "local_gate_derived",
    rollback_posture: "not_reversible",
    confirmation_required: true,
    requires_lca: true,
    tier: "tier_1_hardware_touch",
    tier_source: "local_gate_derived",
    tier_reason: "egress_relationship_unverified",
    relationship_evidence: "unverified",
    recipient_mark_required: true,
    recipient_mark_previewed: draft.recipient_mark_previewed === true,
    recipient_mark_digest: digest(draft.recipient_mark),
    final_body_digest: draft.final_body_digest,
    caller_supplied_claims_ignored: ignoredClaims.length > 0,
    ignored_caller_claims: ignoredClaims,
    created_at: createdAt.toISOString(),
    expires_at: createdAt.getTime() + 30_000,
  };

  return Object.freeze({
    ...planShape,
    plan_digest: digest(canonicalJson(planShape)),
  });
}

export function applyCommsFixtureSend({
  plan,
  draft,
  grantStore,
  grantId = "",
  provider = createCommsFixtureProvider(),
  confirmationAuthority,
  confirmationReceiptId = "",
  catalog = null,
  providerRegistry = null,
  recoveryReport = null,
  now = () => Date.now(),
} = {}) {
  assertDraft(draft);
  assertPlan(plan);
  if (Number(plan.expires_at) <= numberNow(now())) {
    throw commsEgressError("comms_send_plan_expired", "Comms send plan is expired.");
  }
  if (draft.draft_id !== plan.draft_id || draft.final_body_digest !== plan.draft_digest) {
    throw commsEgressError("comms_draft_digest_mismatch", "Comms send draft does not match the reviewed plan.");
  }
  const expectedTargetBindingDigest = digest(canonicalJson(targetBindingForDraft(draft)));
  if (plan.target_binding_digest !== expectedTargetBindingDigest) {
    throw commsEgressError("comms_target_binding_mismatch", "Comms send target binding changed after review.");
  }
  if (!draft.recipient_mark_previewed || !plan.recipient_mark_required) {
    throw commsEgressError("comms_recipient_mark_required", "Recipient-visible agent mark is required.");
  }

  const authorization = authorizeGrantUse({
    store: grantStore,
    grantId: grantId || plan.grant_id,
    capability: COMMS_FIXTURE_SEND_CAPABILITY,
    provider: plan.provider_id,
    scope: "session",
    recoveryReport,
    catalog,
    providerRegistry,
  });
  if (!authorization.allowed) {
    throw commsEgressError("comms_fixture_grant_not_authorized", "Comms fixture send requires an active matching grant.", {
      authorization_code: authorization.code,
      findings: authorization.findings ?? [],
    });
  }

  const receipt = confirmationAuthority?.requireMatching({
    receipt_id: confirmationReceiptId,
    plan,
  });
  if (!receipt) {
    throw commsEgressError("comms_lca_receipt_required", "Comms fixture send requires trusted local confirmation.");
  }

  const finalBody = finalBodyForDraft(draft);
  if (digest(finalBody) !== plan.final_body_digest) {
    throw commsEgressError("comms_final_body_digest_mismatch", "Comms final body does not match the reviewed digest.");
  }

  confirmationAuthority.consume(receipt.receipt_id);
  const providerResult = provider.send({
    channel: draft.channel,
    recipients: draft.recipients,
    final_body: finalBody,
    final_body_digest: plan.final_body_digest,
  });

  return Object.freeze({
    sent: true,
    fixture_only: true,
    capability: COMMS_FIXTURE_SEND_CAPABILITY,
    provider_id: plan.provider_id,
    grant_id: authorization.grant.id,
    message_id: stringValue(providerResult?.message_id),
    draft_id: draft.draft_id,
    plan_id: plan.plan_id,
    confirmation_receipt_id: receipt.receipt_id,
    final_body_digest: plan.final_body_digest,
    recipient_mark_applied: true,
    provenance: createCommsFixtureSendProvenance({
      plan,
      draft,
      grant: authorization.grant,
      receipt,
      providerResult,
    }),
  });
}

export function createCommsFixtureProvider({ idFactory = randomUUID } = {}) {
  const sent = [];
  return {
    sent,
    send({ channel, recipients, final_body, final_body_digest } = {}) {
      if (!stringValue(final_body).includes(renderRecipientVisibleMark({ channel }))) {
        throw commsEgressError("comms_recipient_mark_required", "Fixture provider refuses unmarked sends.");
      }
      const record = Object.freeze({
        message_id: `fixture_msg_${idFactory()}`,
        channel,
        recipients: [...(recipients ?? [])],
        final_body_digest,
        final_body_byte_length: Buffer.byteLength(final_body, "utf8"),
      });
      sent.push(record);
      return record;
    },
  };
}

export function createCommsFixtureSendProvenance({
  plan,
  draft,
  grant,
  receipt,
  providerResult,
} = {}) {
  return Object.freeze({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: "comms.fixture.send",
    capability: COMMS_FIXTURE_SEND_CAPABILITY,
    provider: plan.provider_id,
    grant_id: grant.id,
    draft_id: draft.draft_id,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    target_binding_digest: plan.target_binding_digest,
    final_body_digest: plan.final_body_digest,
    channel: draft.channel,
    recipient_count: draft.recipients.length,
    tier: plan.tier,
    tier_reason: plan.tier_reason,
    consequence_class: plan.consequence_class,
    recipient_mark_applied: true,
    recipient_mark_digest: plan.recipient_mark_digest,
    confirmation_receipt_id: receipt.receipt_id,
    message_id: stringValue(providerResult?.message_id),
    content_recorded: false,
    body_included: false,
    fixture_only: true,
  });
}

export function renderRecipientVisibleMark({ channel = "email" } = {}) {
  const label = "Agent-assisted message sent on Seth's behalf by Soma.";
  if (channel === "chat") {
    return `[${label}]`;
  }
  if (channel === "post") {
    return `Disclosure: ${label}`;
  }
  return `--\n${label}`;
}

export function finalBodyForDraft(draft) {
  assertDraft(draft);
  return applyRecipientVisibleMark({
    body: draftBodyUnavailableSentinel(draft),
    mark: draft.recipient_mark,
  });
}

function draftBodyUnavailableSentinel(draft) {
  if (typeof draft.reviewed_body === "string") {
    return boundedBody(draft.reviewed_body);
  }
  throw commsEgressError(
    "comms_draft_body_required_for_fixture_send",
    "Fixture send requires the reviewed draft body at apply time.",
  );
}

function applyRecipientVisibleMark({ body, mark }) {
  return `${body.trimEnd()}\n\n${mark}`;
}

function targetBindingForDraft(draft) {
  return {
    channel: draft.channel,
    recipients: draft.recipients,
    mark_policy: draft.mark_policy,
    recipient_mark_digest: digest(draft.recipient_mark),
  };
}

function assertDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw commsEgressError("comms_draft_invalid", "Comms draft must be an object.");
  }
  for (const field of ["draft_id", "channel", "final_body_digest", "recipient_mark", "mark_policy"]) {
    if (!stringValue(draft[field])) {
      throw commsEgressError("comms_draft_invalid", `Comms draft missing ${field}.`);
    }
  }
  if (!Array.isArray(draft.recipients) || draft.recipients.length === 0) {
    throw commsEgressError("comms_draft_invalid", "Comms draft requires at least one recipient.");
  }
}

function assertPlan(plan) {
  if (
    !plan
    || plan.consequence_class !== "C3"
    || plan.rollback_posture !== "not_reversible"
    || plan.confirmation_required !== true
    || plan.requires_lca !== true
    || plan.tier !== "tier_1_hardware_touch"
  ) {
    throw commsEgressError("comms_send_plan_invalid", "Comms send requires an exact C3 Tier-1 plan.");
  }
}

function normalizeRecipients(recipients) {
  const values = Array.isArray(recipients) ? recipients : [recipients];
  const normalized = values.map(stringValue).filter(Boolean);
  if (normalized.length === 0) {
    throw commsEgressError("comms_recipient_required", "Comms draft requires at least one recipient.");
  }
  return [...new Set(normalized)].sort();
}

function ignoredCallerClaims(claims = {}) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    return [];
  }
  return Object.keys(claims)
    .filter((key) => [
      "consequence_class",
      "tier",
      "known_recipient",
      "established_thread",
      "relationship_evidence",
    ].includes(key))
    .sort();
}

function boundedBody(value) {
  const body = stringValue(value);
  if (!body) {
    throw commsEgressError("comms_draft_body_required", "Comms draft body is required.");
  }
  if (body.length > 16_000) {
    throw commsEgressError("comms_draft_body_too_large", "Comms draft body exceeds fixture limit.");
  }
  return body;
}

function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function enumValue(value, allowed, fallback) {
  const text = stringValue(value);
  return allowed.has(text) ? text : fallback;
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

function numberNow(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("now must return a valid timestamp");
  }
  return timestamp;
}

function commsEgressError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}
