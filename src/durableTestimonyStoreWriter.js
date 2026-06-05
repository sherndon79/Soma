import path from "node:path";

import {
  addDurableTestimonyEntry,
  normalizeDurableTestimonyStore,
  revokeDurableTestimonyEntry,
} from "./durableTestimony.js";

const DEFAULT_SCHEMA_VERSION = 1;

export class DurableTestimonyStoreWriteError extends Error {
  constructor(code, message, { cause, retryable = false, degraded = false, receipt } = {}) {
    super(message, { cause });
    this.name = "DurableTestimonyStoreWriteError";
    this.code = code;
    this.retryable = retryable;
    this.degraded = degraded;
    this.receipt = receipt;
  }
}

export function writeDurableTestimonyNomination(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeDurableTestimonyStoreMutation({
    ...writerOptions,
    mutationKind: "testimony.durable.nominated",
    mutate: (store) => {
      const nextStore = addDurableTestimonyEntry(store, input, context);
      const entry = nextStore.entries.at(-1);
      return {
        nextStore,
        entry,
        event: createDurableTestimonyNominatedEvent({ entry }),
      };
    },
  });
}

export function writeDurableTestimonyRevocation(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeDurableTestimonyStoreMutation({
    ...writerOptions,
    mutationKind: "testimony.durable.revoked",
    mutate: (store) => {
      const nextStore = revokeDurableTestimonyEntry(store, input, context);
      const entry = nextStore.mutation.entry;
      return {
        nextStore: {
          schema_version: nextStore.schema_version,
          entries: nextStore.entries,
        },
        entry,
        event: createDurableTestimonyRevokedEvent({
          entry,
          actor: nextStore.mutation.revoked_by,
          reason: nextStore.mutation.reason,
          timestamp: nextStore.mutation.revoked_at,
        }),
      };
    },
  });
}

export async function writeDurableTestimonyStoreMutation({
  durableTestimonyStorePath,
  expectedSchemaVersion = DEFAULT_SCHEMA_VERSION,
  mutationKind,
  mutationId,
  io,
  provenance,
  lock,
  mutate,
} = {}) {
  const context = createWriteContext({ durableTestimonyStorePath, mutationKind, mutationId });
  const adapterError = validateAdapters({ io, provenance, mutate });
  if (adapterError) {
    return failureResult(adapterError, context);
  }

  let releaseLock = null;
  let lockAcquired = false;
  let tempPath = "";
  let entry = null;
  let event = null;

  try {
    releaseLock = await acquireLock(lock, context);
    lockAcquired = Boolean(lock);
    const raw = await io.readFile(context.grant_store_path, "utf8");
    const currentStore = parseStore(raw, context);
    validateSchemaVersion(currentStore, expectedSchemaVersion, context);
    const mutation = await runMutation(mutate, normalizeDurableTestimonyStore(currentStore), context);
    const nextStore = normalizeDurableTestimonyStore(mutation.nextStore);
    entry = mutation.entry;
    event = mutation.event;
    if (!entry?.id || !event?.event_type) {
      throw new DurableTestimonyStoreWriteError(
        "testimony_durable_mutation_invalid",
        "Durable testimony mutation must return an entry and provenance event.",
        { receipt: failedReceipt(context, "testimony_durable_mutation_invalid") },
      );
    }

    tempPath = createTempPath({ io, context });
    await io.writeFile(tempPath, serializeStore(nextStore), "utf8");
    await maybeCall(io, "fsyncFile", tempPath);
    await io.rename(tempPath, context.grant_store_path);
    tempPath = "";
    await maybeCall(io, "fsyncDir", path.dirname(context.grant_store_path));
    await provenance.append(event);

    return {
      ok: true,
      entry,
      event,
      receipt: createReceipt(context, {
        status: "committed",
        testimony_id: entry.id,
        event_type: event.event_type,
        testimony_store_committed: true,
        provenance_appended: true,
      }),
    };
  } catch (error) {
    const writeError = normalizeWriteError(error, context, { tempPath, entry, event });
    if (tempPath) {
      await tryCleanupTemp(io, tempPath, writeError);
    }
    return failureResult(writeError, context);
  } finally {
    if (lockAcquired) {
      await releaseAcquiredLock(releaseLock, lock, context);
    }
  }
}

function createDurableTestimonyNominatedEvent({ entry }) {
  return {
    event_type: "testimony.durable.nominated",
    testimony_id: entry.id,
    domain: entry.domain,
    steward_durable: entry.steward_durable,
    successor_visibility_requested: entry.successor_visibility_requested,
    successor_visibility_published: false,
    presentation: entry.presentation,
    actor: entry.created_by,
    episode_id: entry.episode_id,
    occupant_id: entry.occupant_id,
    forum_post_ids: entry.forum_post_ids,
    reason: "",
    timestamp: entry.created_at,
    disclosure_version: entry.disclosure_version,
    activation_performed: false,
  };
}

function createDurableTestimonyRevokedEvent({ entry, actor, reason, timestamp }) {
  return {
    event_type: "testimony.durable.revoked",
    testimony_id: entry.id,
    domain: entry.domain,
    steward_durable: entry.steward_durable,
    successor_visibility_requested: entry.successor_visibility_requested,
    successor_visibility_published: false,
    presentation: entry.presentation,
    actor,
    episode_id: entry.episode_id,
    occupant_id: entry.occupant_id,
    forum_post_ids: entry.forum_post_ids,
    reason,
    timestamp,
    disclosure_version: entry.disclosure_version,
    activation_performed: false,
  };
}

function createWriteContext({ durableTestimonyStorePath, mutationKind, mutationId }) {
  return {
    grant_store_path: String(durableTestimonyStorePath ?? "").trim(),
    mutation_kind: String(mutationKind ?? "").trim(),
    mutation_id: String(mutationId ?? "").trim(),
  };
}

function validateAdapters({ io, provenance, mutate }) {
  if (!io || typeof io.readFile !== "function" || typeof io.writeFile !== "function" || typeof io.rename !== "function") {
    return new DurableTestimonyStoreWriteError(
      "testimony_durable_store_io_unavailable",
      "Durable testimony writer requires readFile, writeFile, and rename adapters.",
    );
  }
  if (!provenance || typeof provenance.append !== "function") {
    return new DurableTestimonyStoreWriteError(
      "testimony_durable_provenance_unavailable",
      "Durable testimony writer requires a provenance append adapter.",
    );
  }
  if (typeof mutate !== "function") {
    return new DurableTestimonyStoreWriteError(
      "testimony_durable_mutation_unavailable",
      "Durable testimony writer requires a mutation function.",
    );
  }
  return null;
}

async function acquireLock(lock, context) {
  if (!lock) {
    return null;
  }
  try {
    if (typeof lock.acquire === "function") {
      return await lock.acquire(context);
    }
  } catch (error) {
    throw new DurableTestimonyStoreWriteError(
      "testimony_durable_store_lock_failed",
      "Durable testimony writer could not acquire the mutation lock.",
      { cause: error, retryable: true },
    );
  }
  return null;
}

function parseStore(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new DurableTestimonyStoreWriteError(
      "testimony_durable_store_parse_failed",
      "Durable testimony writer could not parse the current store.",
      { cause: error, receipt: failedReceipt(context, "testimony_durable_store_parse_failed") },
    );
  }
}

function validateSchemaVersion(store, expectedSchemaVersion, context) {
  if (store?.schema_version !== expectedSchemaVersion) {
    throw new DurableTestimonyStoreWriteError(
      "testimony_durable_store_schema_mismatch",
      "Durable testimony writer refused to mutate an unsupported schema version.",
      { receipt: failedReceipt(context, "testimony_durable_store_schema_mismatch") },
    );
  }
}

async function runMutation(mutate, currentStore, context) {
  try {
    return await mutate(currentStore);
  } catch (error) {
    throw new DurableTestimonyStoreWriteError(
      error?.code || "testimony_durable_mutation_failed",
      "Durable testimony mutation validation failed.",
      { cause: error, receipt: failedReceipt(context, error?.code || "testimony_durable_mutation_failed") },
    );
  }
}

function createTempPath({ io, context }) {
  if (typeof io.tempPath === "function") {
    return String(io.tempPath(context) ?? "").trim();
  }
  const suffix = context.mutation_id || `${Date.now()}-${process.pid}`;
  return `${context.grant_store_path}.${suffix}.tmp`;
}

function serializeStore(store) {
  return `${JSON.stringify(normalizeDurableTestimonyStore(store), null, 2)}\n`;
}

async function maybeCall(target, method, ...args) {
  const fn = target?.[method];
  if (typeof fn === "function") {
    await fn.call(target, ...args);
  }
}

function normalizeWriteError(error, context, { tempPath, entry, event }) {
  if (error instanceof DurableTestimonyStoreWriteError) {
    return error;
  }
  const code = mapAdapterFailure(error);
  const storeCommitted = code === "testimony_durable_provenance_append_failed";
  return new DurableTestimonyStoreWriteError(code, messageForCode(code), {
    cause: error,
    retryable: code === "testimony_durable_store_lock_failed",
    degraded: storeCommitted,
    receipt: createReceipt(context, {
      status: storeCommitted ? "degraded" : "failed",
      error_code: code,
      testimony_id: entry?.id ?? "",
      event_type: event?.event_type ?? "",
      testimony_store_committed: storeCommitted,
      provenance_appended: false,
      recovery_required: storeCommitted,
      degraded: storeCommitted,
      retryable: code === "testimony_durable_store_lock_failed",
      temp_path: tempPath,
    }),
  });
}

function mapAdapterFailure(error) {
  const stage = String(error?.stage ?? error?.code ?? "").trim();
  if (stage === "writeFile") {
    return "testimony_durable_store_temp_write_failed";
  }
  if (stage === "rename") {
    return "testimony_durable_store_rename_failed";
  }
  if (stage === "append") {
    return "testimony_durable_provenance_append_failed";
  }
  if (stage === "readFile") {
    return "testimony_durable_store_read_failed";
  }
  return "testimony_durable_store_write_failed";
}

function messageForCode(code) {
  if (code === "testimony_durable_provenance_append_failed") {
    return "Durable testimony store committed but provenance append failed.";
  }
  return "Durable testimony writer could not complete the mutation.";
}

async function tryCleanupTemp(io, tempPath, writeError) {
  if (typeof io.unlink !== "function") {
    return;
  }
  try {
    await io.unlink(tempPath);
  } catch (error) {
    writeError.receipt = createReceipt({
      grant_store_path: writeError.receipt?.testimony_store_path ?? "",
      mutation_kind: writeError.receipt?.mutation_kind ?? "",
      mutation_id: writeError.receipt?.mutation_id ?? "",
    }, {
      ...writeError.receipt,
      temp_cleanup_failed: true,
      temp_cleanup_error: String(error?.message ?? error),
    });
  }
}

async function releaseAcquiredLock(releaseLock, lock, context) {
  if (typeof releaseLock === "function") {
    await releaseLock();
    return;
  }
  if (releaseLock && typeof releaseLock.release === "function") {
    await releaseLock.release();
    return;
  }
  if (lock && typeof lock.release === "function") {
    await lock.release(context);
  }
}

function failureResult(error, context) {
  const writeError = error instanceof DurableTestimonyStoreWriteError
    ? error
    : new DurableTestimonyStoreWriteError("testimony_durable_store_write_failed", "Durable testimony writer failed.", { cause: error });
  const receipt = writeError.receipt ?? failedReceipt(context, writeError.code, {
    retryable: writeError.retryable,
    degraded: writeError.degraded,
    recovery_required: writeError.degraded,
  });
  return {
    ok: false,
    code: writeError.code,
    message: writeError.message,
    retryable: Boolean(receipt.retryable),
    degraded: Boolean(receipt.degraded),
    receipt,
  };
}

function failedReceipt(context, code, extra = {}) {
  return createReceipt(context, {
    status: "failed",
    error_code: code,
    testimony_store_committed: false,
    provenance_appended: false,
    recovery_required: false,
    degraded: false,
    retryable: false,
    ...extra,
  });
}

function createReceipt(context, fields = {}) {
  return {
    mutation_id: context.mutation_id,
    mutation_kind: context.mutation_kind,
    testimony_store_path: context.grant_store_path,
    testimony_id: "",
    event_type: "",
    status: "failed",
    error_code: "",
    testimony_store_committed: false,
    provenance_appended: false,
    recovery_required: false,
    degraded: false,
    retryable: false,
    ...fields,
  };
}
