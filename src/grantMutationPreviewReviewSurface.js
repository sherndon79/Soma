const FORBIDDEN_PREVIEW_REVIEW_KEYS = new Set([
  "payload",
  "payload_bytes",
  "provider_output",
  "raw_payload",
  "screenshot",
  "image_bytes",
  "frame_bytes",
  "audio_bytes",
  "text_content",
  "grant_value",
  "event_value",
]);

export function grantMutationPreviewReviewText(response = {}) {
  assertNoForbiddenReviewFields(response, "response");

  const receipt = response.receipt_preview ?? {};
  const event = response.event ?? {};
  const grant = response.grant ?? {};
  const summary = response.next_store_summary ?? {};

  const lines = [
    "Grant mutation preview",
    `  result: ${response.ok === false ? "not accepted" : "accepted for preview"}`,
    `  dry run: ${booleanText(response.dry_run)}`,
    `  mutation: ${response.mutation_kind ?? receipt.mutation_kind ?? "unknown"}`,
    `  grant: ${grant.id ?? receipt.grant_id ?? "unknown"}`,
    `  status after preview: ${grant.status ?? "unknown"}`,
    `  capability: ${grant.capability ?? event.capability ?? "unknown"}`,
    `  provider: ${grant.provider ?? event.provider ?? "unknown"}`,
    `  scope: ${grant.scope ?? event.scope ?? "unknown"}`,
    `  event preview: ${event.event_type ?? receipt.event_type ?? "none"}`,
    `  receipt status: ${receipt.status ?? "unknown"}`,
    `  next grant count: ${summary.grant_count ?? "unknown"}`,
    `  state change previewed: ${booleanText(summary.changed)}`,
    "  durable write: no",
    `  grant written: ${booleanText(response.grant_written)}`,
    `  provenance appended: ${booleanText(response.provenance_appended)}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  subscription activated: ${booleanText(response.subscription_activated)}`,
    `  model delivery performed: ${booleanText(response.model_delivery_performed)}`,
    "  approval boundary: preview is not grant creation, revocation, activation, or repair",
  ];

  if (response.ok === false) {
    lines.push(`  refusal code: ${response.code ?? response.error ?? receipt.error_code ?? "unknown"}`);
    if (response.message) {
      lines.push(`  refusal message: ${response.message}`);
    }
  }

  return lines.join("\n");
}

function assertNoForbiddenReviewFields(value, path) {
  const forbidden = forbiddenReviewPaths(value, path);
  if (forbidden.length === 0) {
    return;
  }
  const error = new Error(`Grant mutation preview review rejects forbidden fields: ${forbidden.join(", ")}`);
  error.code = "grant_mutation_preview_review_forbidden_field";
  error.statusCode = 400;
  error.validation_errors = forbidden;
  throw error;
}

function forbiddenReviewPaths(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenReviewPaths(entry, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_PREVIEW_REVIEW_KEYS.has(key)) {
      paths.push(childPath);
    }
    paths.push(...forbiddenReviewPaths(child, childPath));
  }
  return paths;
}

function booleanText(value) {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "unknown";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
