import path from "node:path";

import {
  normalizeHistoryProjectionStore,
  publishHistoryProjectionEntry,
  withdrawHistoryProjectionEntry,
} from "./historyProjection.js";

const DEFAULT_SCHEMA_VERSION = 1;

export class HistoryProjectionStoreWriteError extends Error {
  constructor(code, message, { cause, retryable = false, degraded = false, receipt } = {}) {
    super(message, { cause });
    this.name = "HistoryProjectionStoreWriteError";
    this.code = code;
    this.retryable = retryable;
    this.degraded = degraded;
    this.receipt = receipt;
  }
}

export function writeHistoryProjectionPublication(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeHistoryProjectionStoreMutation({
    ...writerOptions,
    mutationKind: "history.projection.published",
    mutate: (store) => {
      const nextStore = publishHistoryProjectionEntry(store, input, context);
      const entry = nextStore.entries.at(-1);
      return {
        nextStore,
        entry,
        event: createHistoryProjectionEvent({ eventType: "history.projection.published", entry }),
      };
    },
  });
}

export function writeHistoryProjectionWithdrawal(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeHistoryProjectionStoreMutation({
    ...writerOptions,
    mutationKind: "history.projection.withdrawn",
    mutate: (store) => {
      const nextStore = withdrawHistoryProjectionEntry(store, input, context);
      const entry = nextStore.mutation.entry;
      return {
        nextStore: {
          schema_version: nextStore.schema_version,
          entries: nextStore.entries,
        },
        entry,
        event: createHistoryProjectionEvent({
          eventType: "history.projection.withdrawn",
          entry,
          actor: nextStore.mutation.withdrawn_by,
          timestamp: nextStore.mutation.withdrawn_at,
        }),
      };
    },
  });
}

export async function writeHistoryProjectionStoreMutation({
  historyProjectionStorePath,
  expectedSchemaVersion = DEFAULT_SCHEMA_VERSION,
  mutationKind,
  mutationId,
  io,
  provenance,
  lock,
  mutate,
} = {}) {
  const context = createWriteContext({ historyProjectionStorePath, mutationKind, mutationId });
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
    const raw = await io.readFile(context.history_projection_store_path, "utf8");
    const currentStore = parseStore(raw, context);
    validateSchemaVersion(currentStore, expectedSchemaVersion, context);
    const mutation = await runMutation(mutate, normalizeHistoryProjectionStore(currentStore), context);
    const nextStore = normalizeHistoryProjectionStore(mutation.nextStore);
    entry = mutation.entry;
    event = mutation.event;
    if (!entry?.id || !event?.event_type) {
      throw new HistoryProjectionStoreWriteError(
        "history_projection_mutation_invalid",
        "History projection mutation must return an entry and provenance event.",
        { receipt: failedReceipt(context, "history_projection_mutation_invalid") },
      );
    }

    tempPath = createTempPath({ io, context });
    await io.writeFile(tempPath, serializeStore(nextStore), "utf8");
    await maybeCall(io, "fsyncFile", tempPath);
    await io.rename(tempPath, context.history_projection_store_path);
    tempPath = "";
    await maybeCall(io, "fsyncDir", path.dirname(context.history_projection_store_path));
    await provenance.append(event);

    return {
      ok: true,
      entry,
      event,
      receipt: createReceipt(context, {
        status: "committed",
        entry_id: entry.id,
        event_type: event.event_type,
        history_projection_store_committed: true,
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

function createHistoryProjectionEvent({ eventType, entry, actor = "", timestamp = "" }) {
  return {
    event_type: eventType,
    entry_id: entry.id,
    projection_id: entry.projection_id,
    projection_version: entry.projection_version,
    domain: entry.domain,
    presentation_kind: entry.presentation_kind,
    source_refs: entry.source_refs,
    consent_basis: entry.consent_basis,
    audience: entry.audience,
    recon_review: entry.recon_review,
    withheld_reason_class: entry.withheld_reason_class || entry.withdrawal_reason_class,
    reviewed_by: entry.reviewed_by,
    reviewed_at: entry.reviewed_at,
    actor: actor || entry.created_by,
    timestamp: timestamp || entry.created_at,
    activation_performed: false,
  };
}

function createWriteContext({ historyProjectionStorePath, mutationKind, mutationId }) {
  const storePath = String(historyProjectionStorePath ?? "").trim();
  return {
    history_projection_store_path: storePath,
    grant_store_path: storePath,
    mutation_kind: String(mutationKind ?? "").trim(),
    mutation_id: String(mutationId ?? "").trim(),
  };
}

function validateAdapters({ io, provenance, mutate }) {
  if (!io || typeof io.readFile !== "function" || typeof io.writeFile !== "function" || typeof io.rename !== "function") {
    return new HistoryProjectionStoreWriteError(
      "history_projection_store_io_unavailable",
      "History projection writer requires readFile, writeFile, and rename adapters.",
    );
  }
  if (!provenance || typeof provenance.append !== "function") {
    return new HistoryProjectionStoreWriteError(
      "history_projection_provenance_unavailable",
      "History projection writer requires a provenance append adapter.",
    );
  }
  if (typeof mutate !== "function") {
    return new HistoryProjectionStoreWriteError(
      "history_projection_mutation_unavailable",
      "History projection writer requires a mutation function.",
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
    throw new HistoryProjectionStoreWriteError(
      "history_projection_store_lock_failed",
      "History projection writer could not acquire the mutation lock.",
      { cause: error, retryable: true },
    );
  }
  return null;
}

function parseStore(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new HistoryProjectionStoreWriteError(
      "history_projection_store_parse_failed",
      "History projection writer could not parse the current store.",
      { cause: error, receipt: failedReceipt(context, "history_projection_store_parse_failed") },
    );
  }
}

function validateSchemaVersion(store, expectedSchemaVersion, context) {
  if (store?.schema_version !== expectedSchemaVersion) {
    throw new HistoryProjectionStoreWriteError(
      "history_projection_store_schema_mismatch",
      "History projection writer refused to mutate an unsupported schema version.",
      { receipt: failedReceipt(context, "history_projection_store_schema_mismatch") },
    );
  }
}

async function runMutation(mutate, currentStore, context) {
  try {
    return await mutate(currentStore);
  } catch (error) {
    throw new HistoryProjectionStoreWriteError(
      error?.code || "history_projection_mutation_failed",
      "History projection mutation validation failed.",
      { cause: error, receipt: failedReceipt(context, error?.code || "history_projection_mutation_failed") },
    );
  }
}

function createTempPath({ io, context }) {
  if (typeof io.tempPath === "function") {
    return String(io.tempPath(context) ?? "").trim();
  }
  const suffix = context.mutation_id || `${Date.now()}-${process.pid}`;
  return `${context.history_projection_store_path}.${suffix}.tmp`;
}

function serializeStore(store) {
  return `${JSON.stringify(normalizeHistoryProjectionStore(store), null, 2)}\n`;
}

async function maybeCall(target, method, ...args) {
  const fn = target?.[method];
  if (typeof fn === "function") {
    await fn.call(target, ...args);
  }
}

function normalizeWriteError(error, context, { tempPath, entry, event }) {
  if (error instanceof HistoryProjectionStoreWriteError) {
    return error;
  }
  const code = mapAdapterFailure(error);
  const storeCommitted = code === "history_projection_provenance_append_failed";
  return new HistoryProjectionStoreWriteError(code, messageForCode(code), {
    cause: error,
    retryable: code === "history_projection_store_lock_failed",
    degraded: storeCommitted,
    receipt: createReceipt(context, {
      status: storeCommitted ? "degraded" : "failed",
      error_code: code,
      entry_id: entry?.id ?? "",
      event_type: event?.event_type ?? "",
      history_projection_store_committed: storeCommitted,
      provenance_appended: false,
      recovery_required: storeCommitted,
      degraded: storeCommitted,
      retryable: code === "history_projection_store_lock_failed",
      temp_path: tempPath,
    }),
  });
}

function mapAdapterFailure(error) {
  const stage = String(error?.stage ?? error?.code ?? "").trim();
  if (stage === "writeFile") return "history_projection_store_temp_write_failed";
  if (stage === "rename") return "history_projection_store_rename_failed";
  if (stage === "append") return "history_projection_provenance_append_failed";
  if (stage === "readFile") return "history_projection_store_read_failed";
  return "history_projection_store_write_failed";
}

function messageForCode(code) {
  const messages = {
    history_projection_store_temp_write_failed: "History projection writer could not write the temporary store.",
    history_projection_store_rename_failed: "History projection writer could not promote the temporary store.",
    history_projection_provenance_append_failed: "History projection store was updated but provenance append failed.",
    history_projection_store_read_failed: "History projection writer could not read the current store.",
    history_projection_store_write_failed: "History projection writer failed.",
  };
  return messages[code] ?? "History projection writer failed.";
}

async function tryCleanupTemp(io, tempPath, writeError) {
  try {
    await maybeCall(io, "unlink", tempPath);
  } catch (cleanupError) {
    writeError.cleanup_error_code = cleanupError?.code ?? "cleanup_failed";
  }
}

async function releaseAcquiredLock(releaseLock, lock, context) {
  try {
    if (typeof releaseLock === "function") {
      await releaseLock();
    } else if (typeof lock.release === "function") {
      await lock.release(context);
    }
  } catch {
    // Mutation result already reflects the write outcome.
  }
}

function failureResult(error, context) {
  return {
    ok: false,
    code: error.code ?? "history_projection_store_write_failed",
    retryable: Boolean(error.retryable),
    degraded: Boolean(error.degraded),
    receipt: error.receipt ?? failedReceipt(context, error.code ?? "history_projection_store_write_failed"),
  };
}

function createReceipt(context, fields = {}) {
  return {
    mutation_kind: context.mutation_kind,
    mutation_id: context.mutation_id,
    history_projection_store_path: context.history_projection_store_path,
    ...fields,
  };
}

function failedReceipt(context, errorCode) {
  return createReceipt(context, {
    status: "failed",
    error_code: errorCode,
    history_projection_store_committed: false,
    provenance_appended: false,
  });
}
