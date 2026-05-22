import test from "node:test";
import assert from "node:assert/strict";

import { grantMutationPreviewReviewText } from "../src/grantMutationPreviewReviewSurface.js";

test("grantMutationPreviewReviewText formats accepted create preview as non-writing review", () => {
  const text = grantMutationPreviewReviewText({
    ok: true,
    dry_run: true,
    mutation_kind: "grant.created",
    grant: {
      id: "grant-preview",
      status: "active",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
      constraints: { include_text: false },
    },
    event: { event_type: "grant.created" },
    receipt_preview: { status: "preview" },
    next_store_summary: { grant_count: 1, changed: true },
    durable: false,
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
  });

  assert.match(text, /Grant mutation preview/);
  assert.match(text, /result: accepted for preview/);
  assert.match(text, /mutation: grant\.created/);
  assert.match(text, /durable write: no/);
  assert.match(text, /grant written: no/);
  assert.match(text, /provenance appended: no/);
  assert.match(text, /activation performed: no/);
  assert.match(text, /preview is not grant creation, revocation, activation, or repair/);
  assert.doesNotMatch(text, /include_text/);
});

test("grantMutationPreviewReviewText formats accepted revoke preview", () => {
  const text = grantMutationPreviewReviewText({
    ok: true,
    dry_run: true,
    mutation_kind: "grant.revoked",
    grant: {
      id: "grant-active",
      status: "revoked",
      capability: "desktop.inspect.focus",
      provider: "soma.provider.desktop-broker",
      scope: "session",
    },
    event: { event_type: "grant.revoked" },
    receipt_preview: { status: "preview" },
    next_store_summary: { grant_count: 1, changed: true },
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
  });

  assert.match(text, /mutation: grant\.revoked/);
  assert.match(text, /status after preview: revoked/);
  assert.match(text, /state change previewed: yes/);
});

test("grantMutationPreviewReviewText formats failed preview without implying mutation success", () => {
  const text = grantMutationPreviewReviewText({
    ok: false,
    dry_run: true,
    code: "unknown_provider",
    message: "Grant creation requires a known provider.",
    mutation_kind: "grant.created",
    receipt_preview: {
      status: "failed",
      error_code: "unknown_provider",
    },
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
  });

  assert.match(text, /result: not accepted/);
  assert.match(text, /refusal code: unknown_provider/);
  assert.match(text, /grant written: no/);
  assert.match(text, /activation performed: no/);
});

test("grantMutationPreviewReviewText rejects payload and mismatch value fields", () => {
  assert.throws(
    () => grantMutationPreviewReviewText({
      ok: true,
      event_value: "sensitive reason text",
      payload_bytes: "forbidden",
    }),
    /response.event_value, response.payload_bytes/,
  );
});
