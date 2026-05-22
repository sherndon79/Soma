import {
  createGrantCreatedProvenanceEvent,
  createGrantRevokedProvenanceEvent,
} from "./grantMutationProvenance.js";
import { createGrant, normalizeGrantStore, revokeGrant } from "./grants.js";

const SUPPORTED_PREVIEW_KINDS = new Set(["grant.created", "grant.revoked"]);

export function previewGrantMutation({
  store = {},
  kind = "",
  input = {},
  context = {},
  mutationId = "",
} = {}) {
  const mutationKind = String(kind ?? "").trim();
  const mutation_id = String(mutationId ?? "").trim();

  if (!SUPPORTED_PREVIEW_KINDS.has(mutationKind)) {
    return previewFailure({
      mutationKind,
      mutationId: mutation_id,
      code: "grant_mutation_preview_unsupported_kind",
      message: "Grant mutation preview supports grant.created and grant.revoked only.",
    });
  }

  try {
    const normalizedStore = normalizeGrantStore(store);
    const preview = mutationKind === "grant.created"
      ? previewGrantCreate({ store: normalizedStore, input, context })
      : previewGrantRevoke({ store: normalizedStore, input, context });

    return {
      ok: true,
      dry_run: true,
      mutation_kind: mutationKind,
      grant: preview.grant,
      event: preview.event,
      receipt_preview: previewReceipt({
        mutationId: mutation_id,
        mutationKind,
        grantId: preview.grant.id,
        eventType: preview.event.event_type,
      }),
      next_store_summary: {
        schema_version: preview.nextStore.schema_version,
        grant_count: preview.nextStore.grants.length,
        changed: preview.changed,
      },
      durable: false,
      grant_written: false,
      provenance_appended: false,
      activation_performed: false,
      subscription_activated: false,
      model_delivery_performed: false,
    };
  } catch (error) {
    return previewFailure({
      mutationKind,
      mutationId: mutation_id,
      code: error?.code ?? "grant_mutation_preview_failed",
      message: error?.message ?? "Grant mutation preview failed.",
    });
  }
}

function previewGrantCreate({ store, input, context }) {
  const nextStore = createGrant(store, input, context);
  const grant = findCreatedGrant(store, nextStore);
  const event = createGrantCreatedProvenanceEvent({ grant });
  return {
    nextStore,
    grant,
    event,
    changed: true,
  };
}

function previewGrantRevoke({ store, input, context }) {
  const nextStore = revokeGrant(store, input, context);
  const grant = nextStore.mutation?.grant ?? findGrantByInput(nextStore, input);
  const event = createGrantRevokedProvenanceEvent({ grant });
  return {
    nextStore,
    grant,
    event,
    changed: Boolean(nextStore.mutation?.changed),
  };
}

function findCreatedGrant(previousStore = {}, nextStore = {}) {
  const previousIds = new Set((previousStore.grants ?? []).map((grant) => grant.id));
  return (nextStore.grants ?? []).find((grant) => !previousIds.has(grant.id)) ?? null;
}

function findGrantByInput(store = {}, input = {}) {
  const id = String(input.id ?? input.grant_id ?? "").trim();
  return (store.grants ?? []).find((grant) => grant.id === id) ?? null;
}

function previewReceipt({ mutationId, mutationKind, grantId, eventType }) {
  return {
    mutation_id: mutationId,
    mutation_kind: mutationKind,
    grant_store_path: "",
    grant_id: grantId,
    event_type: eventType,
    status: "preview",
    error_code: "",
    grant_store_committed: false,
    provenance_appended: false,
    recovery_required: false,
    degraded: false,
    retryable: false,
  };
}

function previewFailure({ mutationKind, mutationId, code, message }) {
  return {
    ok: false,
    dry_run: true,
    code,
    message,
    mutation_kind: mutationKind,
    receipt_preview: {
      mutation_id: mutationId,
      mutation_kind: mutationKind,
      grant_store_path: "",
      grant_id: "",
      event_type: "",
      status: "failed",
      error_code: code,
      grant_store_committed: false,
      provenance_appended: false,
      recovery_required: false,
      degraded: false,
      retryable: false,
    },
    durable: false,
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
  };
}
