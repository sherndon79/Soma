import path from "node:path";

import {
  addOccupantMemoryEntry,
  normalizeOccupantMemoryStore,
  revokeOccupantMemoryEntry,
} from "./occupantMemory.js";

const DEFAULT_SCHEMA_VERSION = 1;

export class OccupantMemoryStoreWriteError extends Error {
  constructor(code, message, { cause, retryable = false, degraded = false, receipt } = {}) {
    super(message, { cause });
    this.name = "OccupantMemoryStoreWriteError";
    this.code = code;
    this.retryable = retryable;
    this.degraded = degraded;
    this.receipt = receipt;
  }
}

export function writeOccupantMemoryAddMutation(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeOccupantMemoryStoreMutation({
    ...writerOptions,
    mutationKind: "occupant.memory.written",
    mutate: (store) => {
      const nextStore = addOccupantMemoryEntry(store, input, context);
      const entry = nextStore.entries.at(-1);
      return {
        nextStore,
        entry,
        event: createOccupantMemoryWrittenEvent({ entry }),
      };
    },
  });
}

export function writeOccupantMemoryRevokeMutation(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeOccupantMemoryStoreMutation({
    ...writerOptions,
    mutationKind: "occupant.memory.revoked",
    mutate: (store) => {
      const nextStore = revokeOccupantMemoryEntry(store, input, context);
      return {
        nextStore: {
          schema_version: nextStore.schema_version,
          entries: nextStore.entries,
          tombstones: nextStore.tombstones,
        },
        entry: nextStore.mutation.entry,
        tombstone: nextStore.mutation.tombstone,
        event: createOccupantMemoryRevokedEvent({ tombstone: nextStore.mutation.tombstone }),
      };
    },
  });
}

export async function writeOccupantMemoryStoreMutation({
  occupantMemoryStorePath,
  expectedSchemaVersion = DEFAULT_SCHEMA_VERSION,
  mutationKind,
  mutationId,
  io,
  provenance,
  lock,
  mutate,
} = {}) {
  const context = createWriteContext({ occupantMemoryStorePath, mutationKind, mutationId });
  const adapterError = validateAdapters({ io, provenance, mutate });
  if (adapterError) {
    return failureResult(adapterError, context);
  }

  let releaseLock = null;
  let lockAcquired = false;
  let tempPath = "";
  let entry = null;
  let tombstone = null;
  let event = null;

  try {
    releaseLock = await acquireLock(lock, context);
    lockAcquired = Boolean(lock);
    const raw = await io.readFile(context.store_path, "utf8");
    const currentStore = parseStore(raw, context);
    validateSchemaVersion(currentStore, expectedSchemaVersion, context);
    const mutation = await runMutation(mutate, normalizeOccupantMemoryStore(currentStore), context);
    const nextStore = normalizeOccupantMemoryStore(mutation.nextStore);
    entry = mutation.entry;
    tombstone = mutation.tombstone ?? null;
    event = mutation.event;
    if (!entry?.id || !event?.event_type) {
      throw new OccupantMemoryStoreWriteError(
        "occupant_memory_mutation_invalid",
        "Occupant memory mutation must return an entry and provenance event.",
        { receipt: failedReceipt(context, "occupant_memory_mutation_invalid") },
      );
    }

    tempPath = createTempPath({ io, context });
    await io.writeFile(tempPath, serializeStore(nextStore), "utf8");
    await maybeCall(io, "fsyncFile", tempPath);
    await io.rename(tempPath, context.store_path);
    tempPath = "";
    await maybeCall(io, "fsyncDir", path.dirname(context.store_path));
    await provenance.append(event);

    return {
      ok: true,
      entry,
      tombstone,
      event,
      receipt: createReceipt(context, {
        status: "committed",
        entry_id: entry.id,
        event_type: event.event_type,
        occupant_memory_store_committed: true,
        provenance_appended: true,
        recovery_required: false,
        degraded: false,
        retryable: false,
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

function createOccupantMemoryWrittenEvent({ entry }) {
  return {
    event_type: "occupant.memory.written",
    entry_id: entry.id,
    memory_class: entry.memory_class,
    actor: entry.created_by,
    reason_class: "",
    timestamp: entry.created_at,
    model_id: entry.model_id,
    episode_id: entry.episode_id,
    domain: entry.domain,
    grant_id: entry.grant_id,
    provider: entry.provider,
    scope: entry.scope,
    live_perception_taint: entry.live_perception_taint,
    activation_performed: false,
  };
}

function createOccupantMemoryRevokedEvent({ tombstone }) {
  return {
    event_type: "occupant.memory.revoked",
    entry_id: tombstone.entry_id,
    memory_class: tombstone.memory_class,
    actor: tombstone.removed_by,
    reason_class: tombstone.reason_class,
    timestamp: tombstone.removed_at,
    model_id: tombstone.model_id,
    episode_id: tombstone.episode_id,
    domain: tombstone.domain,
    grant_id: tombstone.grant_id,
    provider: tombstone.provider,
    scope: tombstone.scope,
    activation_performed: false,
  };
}

function createWriteContext({ occupantMemoryStorePath, mutationKind, mutationId }) {
  return {
    store_path: String(occupantMemoryStorePath ?? "").trim(),
    grant_store_path: String(occupantMemoryStorePath ?? "").trim(),
    mutation_kind: String(mutationKind ?? "").trim(),
    mutation_id: String(mutationId ?? "").trim(),
  };
}

function validateAdapters({ io, provenance, mutate }) {
  if (!io || typeof io.readFile !== "function" || typeof io.writeFile !== "function"
    || typeof io.rename !== "function") {
    return new OccupantMemoryStoreWriteError(
      "occupant_memory_store_io_unavailable",
      "Occupant memory writer requires readFile, writeFile, and rename adapters.",
    );
  }
  if (!provenance || typeof provenance.append !== "function") {
    return new OccupantMemoryStoreWriteError(
      "occupant_memory_provenance_unavailable",
      "Occupant memory writer requires a provenance append adapter.",
    );
  }
  if (typeof mutate !== "function") {
    return new OccupantMemoryStoreWriteError(
      "occupant_memory_mutation_unavailable",
      "Occupant memory writer requires a mutation function.",
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
    throw new OccupantMemoryStoreWriteError(
      "occupant_memory_store_lock_failed",
      "Occupant memory writer could not acquire the mutation lock.",
      { cause: error, retryable: true },
    );
  }
  return null;
}

function parseStore(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new OccupantMemoryStoreWriteError(
      "occupant_memory_store_parse_failed",
      "Occupant memory writer could not parse the current store.",
      { cause: error, receipt: failedReceipt(context, "occupant_memory_store_parse_failed") },
    );
  }
}

function validateSchemaVersion(store, expectedSchemaVersion, context) {
  if (store?.schema_version !== expectedSchemaVersion) {
    throw new OccupantMemoryStoreWriteError(
      "occupant_memory_store_schema_mismatch",
      "Occupant memory writer refused to mutate an unsupported schema version.",
      { receipt: failedReceipt(context, "occupant_memory_store_schema_mismatch") },
    );
  }
}

async function runMutation(mutate, currentStore, context) {
  try {
    return await mutate(currentStore);
  } catch (error) {
    throw new OccupantMemoryStoreWriteError(
      error?.code || "occupant_memory_mutation_failed",
      "Occupant memory mutation validation failed.",
      { cause: error, receipt: failedReceipt(context, error?.reason_class || error?.code || "occupant_memory_mutation_failed") },
    );
  }
}

function createTempPath({ io, context }) {
  if (typeof io.tempPath === "function") {
    return String(io.tempPath(context) ?? "").trim();
  }
  const suffix = context.mutation_id || `${Date.now()}-${process.pid}`;
  return `${context.store_path}.${suffix}.tmp`;
}

function serializeStore(store) {
  return `${JSON.stringify(normalizeOccupantMemoryStore(store), null, 2)}\n`;
}

async function maybeCall(target, method, ...args) {
  if (typeof target?.[method] === "function") {
    await target[method](...args);
  }
}

async function tryCleanupTemp(io, tempPath, writeError) {
  try {
    if (typeof io.unlink === "function") {
      await io.unlink(tempPath);
    }
  } catch (cleanupError) {
    writeError.cleanup_error_code = cleanupError?.code || cleanupError?.name || "cleanup_failed";
  }
}

async function releaseAcquiredLock(releaseLock, lock, context) {
  try {
    if (typeof releaseLock === "function") {
      await releaseLock();
    } else if (typeof lock?.release === "function") {
      await lock.release(context);
    }
  } catch {
    // Mutation already reached a terminal state; recovery inspection owns later evidence.
  }
}

function normalizeWriteError(error, context, { tempPath, entry, event } = {}) {
  if (error instanceof OccupantMemoryStoreWriteError) {
    return error;
  }
  return new OccupantMemoryStoreWriteError(
    error?.code || "occupant_memory_store_write_failed",
    error?.message || "Occupant memory write failed.",
    {
      cause: error,
      receipt: createReceipt(context, {
        status: "failed",
        entry_id: entry?.id ?? "",
        event_type: event?.event_type ?? "",
        occupant_memory_store_committed: false,
        provenance_appended: false,
        recovery_required: true,
        degraded: true,
        retryable: false,
        error_code: error?.code || "occupant_memory_store_write_failed",
        temp_path: tempPath,
      }),
    },
  );
}

function failureResult(error, context) {
  return {
    ok: false,
    code: error.code || "occupant_memory_store_write_failed",
    message: error.message,
    retryable: Boolean(error.retryable),
    degraded: Boolean(error.degraded),
    reason_class: error.cause?.reason_class ?? error.reason_class ?? error.receipt?.error_code ?? error.code ?? "",
    receipt: error.receipt ?? failedReceipt(context, error.code || "occupant_memory_store_write_failed"),
  };
}

function failedReceipt(context, errorCode) {
  return createReceipt(context, {
    status: "failed",
    entry_id: "",
    event_type: "",
    occupant_memory_store_committed: false,
    provenance_appended: false,
    recovery_required: true,
    degraded: true,
    retryable: false,
    error_code: errorCode,
  });
}

function createReceipt(context, fields = {}) {
  return {
    mutation_kind: context.mutation_kind,
    mutation_id: context.mutation_id,
    store_path: context.store_path,
    activation_performed: false,
    ...fields,
  };
}
