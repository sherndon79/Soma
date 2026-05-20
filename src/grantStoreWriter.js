import path from "node:path";

import { normalizeGrantStore } from "./grants.js";

const DEFAULT_SCHEMA_VERSION = 1;

export class GrantStoreWriteError extends Error {
  constructor(code, message, { cause, retryable = false, degraded = false, receipt } = {}) {
    super(message, { cause });
    this.name = "GrantStoreWriteError";
    this.code = code;
    this.retryable = retryable;
    this.degraded = degraded;
    this.receipt = receipt;
  }
}

export async function writeGrantStoreMutation({
  grantStorePath,
  expectedSchemaVersion = DEFAULT_SCHEMA_VERSION,
  mutationKind,
  mutationId,
  io,
  provenance,
  lock,
  mutate,
  createProvenanceEvent,
} = {}) {
  const context = createWriteContext({
    grantStorePath,
    mutationKind,
    mutationId,
  });
  const adapterError = validateAdapters({ io, provenance, mutate });
  if (adapterError) {
    return failureResult(adapterError, context);
  }

  let releaseLock = null;
  let lockAcquired = false;
  let tempPath = "";
  let nextStore = null;
  let grant = null;
  let event = null;

  try {
    releaseLock = await acquireLock(lock, context);
    lockAcquired = Boolean(lock);
    const raw = await io.readFile(context.grant_store_path, "utf8");
    const currentStore = parseGrantStore(raw, context);
    validateSchemaVersion(currentStore, expectedSchemaVersion, context);
    const mutation = await runMutation(mutate, normalizeGrantStore(currentStore), context);
    ({ nextStore, grant, event } = await normalizeMutationResult({
      mutation,
      createProvenanceEvent,
      context,
    }));

    tempPath = createTempPath({ io, context });
    const serialized = serializeGrantStore(nextStore);
    await io.writeFile(tempPath, serialized, "utf8");
    await maybeCall(io, "fsyncFile", tempPath);
    await io.rename(tempPath, context.grant_store_path);
    tempPath = "";
    await maybeCall(io, "fsyncDir", path.dirname(context.grant_store_path));
    await provenance.append(event);

    return {
      ok: true,
      grant,
      event,
      receipt: createReceipt(context, {
        status: "committed",
        grant_id: grant.id,
        event_type: event.event_type,
        grant_store_committed: true,
        provenance_appended: true,
        recovery_required: false,
        degraded: false,
        retryable: false,
      }),
    };
  } catch (error) {
    const writeError = normalizeWriteError(error, context, {
      tempPath,
      grant,
      event,
      nextStore,
    });
    if (tempPath) {
      await tryCleanupTemp(io, tempPath, context, writeError);
    }
    return failureResult(writeError, context);
  } finally {
    if (lockAcquired) {
      await releaseAcquiredLock(releaseLock, lock, context);
    }
  }
}

function createWriteContext({ grantStorePath, mutationKind, mutationId }) {
  const storePath = String(grantStorePath ?? "").trim();
  const kind = String(mutationKind ?? "").trim();
  const id = String(mutationId ?? "").trim();
  return {
    grant_store_path: storePath,
    mutation_kind: kind,
    mutation_id: id,
  };
}

function validateAdapters({ io, provenance, mutate }) {
  if (!io || typeof io.readFile !== "function" || typeof io.writeFile !== "function"
    || typeof io.rename !== "function") {
    return new GrantStoreWriteError(
      "grant_store_io_unavailable",
      "Grant-store writer requires readFile, writeFile, and rename adapters.",
    );
  }
  if (!provenance || typeof provenance.append !== "function") {
    return new GrantStoreWriteError(
      "grant_store_provenance_unavailable",
      "Grant-store writer requires a provenance append adapter.",
    );
  }
  if (typeof mutate !== "function") {
    return new GrantStoreWriteError(
      "grant_store_mutation_unavailable",
      "Grant-store writer requires a mutation function.",
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
    if (typeof lock === "function") {
      return await lock(context);
    }
  } catch (error) {
    throw new GrantStoreWriteError(
      "grant_store_lock_failed",
      "Grant-store writer could not acquire the mutation lock.",
      { cause: error, retryable: true },
    );
  }
  return null;
}

function parseGrantStore(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GrantStoreWriteError(
      "grant_store_parse_failed",
      "Grant-store writer could not parse the current grant store.",
      { cause: error, receipt: failedReceipt(context, "grant_store_parse_failed") },
    );
  }
}

function validateSchemaVersion(store, expectedSchemaVersion, context) {
  if (store?.schema_version !== expectedSchemaVersion) {
    throw new GrantStoreWriteError(
      "grant_store_schema_mismatch",
      "Grant-store writer refused to mutate an unsupported schema version.",
      {
        receipt: failedReceipt(context, "grant_store_schema_mismatch", {
          expected_schema_version: expectedSchemaVersion,
          observed_schema_version: store?.schema_version ?? null,
        }),
      },
    );
  }
}

async function normalizeMutationResult({ mutation, createProvenanceEvent, context }) {
  if (!isPlainObject(mutation)) {
    throw new GrantStoreWriteError(
      "grant_store_mutation_invalid",
      "Grant-store mutation must return an object.",
      { receipt: failedReceipt(context, "grant_store_mutation_invalid") },
    );
  }
  const nextStore = normalizeGrantStore(mutation.nextStore);
  const grant = isPlainObject(mutation.grant) ? mutation.grant : mutation.mutation?.grant;
  if (!grant?.id) {
    throw new GrantStoreWriteError(
      "grant_store_mutation_missing_grant",
      "Grant-store mutation must return the affected grant.",
      { receipt: failedReceipt(context, "grant_store_mutation_missing_grant") },
    );
  }
  const event = mutation.event ?? await buildProvenanceEvent({
    createProvenanceEvent,
    mutation,
    nextStore,
    grant,
    context,
  });
  if (!isPlainObject(event) || !event.event_type) {
    throw new GrantStoreWriteError(
      "grant_store_mutation_missing_provenance",
      "Grant-store mutation must return or build a provenance event.",
      { receipt: failedReceipt(context, "grant_store_mutation_missing_provenance", { grant_id: grant.id }) },
    );
  }
  return { nextStore, grant, event };
}

async function runMutation(mutate, currentStore, context) {
  try {
    return await mutate(currentStore);
  } catch (error) {
    throw new GrantStoreWriteError(
      error?.code || "grant_store_mutation_failed",
      "Grant-store mutation validation failed.",
      {
        cause: error,
        receipt: failedReceipt(context, error?.code || "grant_store_mutation_failed"),
      },
    );
  }
}

async function buildProvenanceEvent({ createProvenanceEvent, mutation, nextStore, grant, context }) {
  if (typeof createProvenanceEvent !== "function") {
    return null;
  }
  return createProvenanceEvent({
    ...mutation,
    nextStore,
    grant,
    context,
  });
}

function createTempPath({ io, context }) {
  if (typeof io.tempPath === "function") {
    return String(io.tempPath(context) ?? "").trim();
  }
  const suffix = context.mutation_id || `${Date.now()}-${process.pid}`;
  return `${context.grant_store_path}.${suffix}.tmp`;
}

function serializeGrantStore(store) {
  return `${JSON.stringify(normalizeGrantStore(store), null, 2)}\n`;
}

async function maybeCall(target, method, ...args) {
  const fn = target?.[method];
  if (typeof fn === "function") {
    await fn.call(target, ...args);
  }
}

function normalizeWriteError(error, context, { tempPath, grant, event }) {
  if (error instanceof GrantStoreWriteError) {
    return error;
  }
  const code = mapAdapterFailure(error);
  const grantStoreCommitted = code === "grant_store_provenance_append_failed";
  return new GrantStoreWriteError(
    code,
    messageForCode(code),
    {
      cause: error,
      retryable: code === "grant_store_lock_failed",
      degraded: grantStoreCommitted,
      receipt: createReceipt(context, {
        status: grantStoreCommitted ? "degraded" : "failed",
        error_code: code,
        grant_id: grant?.id ?? "",
        event_type: event?.event_type ?? "",
        grant_store_committed: grantStoreCommitted,
        provenance_appended: false,
        recovery_required: grantStoreCommitted,
        degraded: grantStoreCommitted,
        retryable: code === "grant_store_lock_failed",
        temp_path: tempPath,
      }),
    },
  );
}

function mapAdapterFailure(error) {
  const stage = String(error?.stage ?? error?.code ?? "").trim();
  if (stage === "writeFile") {
    return "grant_store_temp_write_failed";
  }
  if (stage === "rename") {
    return "grant_store_rename_failed";
  }
  if (stage === "append") {
    return "grant_store_provenance_append_failed";
  }
  if (stage === "readFile") {
    return "grant_store_read_failed";
  }
  return "grant_store_write_failed";
}

function messageForCode(code) {
  switch (code) {
    case "grant_store_temp_write_failed":
      return "Grant-store writer could not write the temporary grant store.";
    case "grant_store_rename_failed":
      return "Grant-store writer could not promote the temporary grant store.";
    case "grant_store_provenance_append_failed":
      return "Grant-store writer committed the grant store but could not append provenance.";
    case "grant_store_read_failed":
      return "Grant-store writer could not read the current grant store.";
    default:
      return "Grant-store writer could not complete the mutation.";
  }
}

async function tryCleanupTemp(io, tempPath, context, writeError) {
  if (typeof io.unlink !== "function") {
    return;
  }
  try {
    await io.unlink(tempPath);
  } catch (error) {
    writeError.receipt = createReceipt(context, {
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
  const writeError = error instanceof GrantStoreWriteError
    ? error
    : new GrantStoreWriteError(
      "grant_store_write_failed",
      "Grant-store writer could not complete the mutation.",
      { cause: error },
    );
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
    grant_store_committed: false,
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
    grant_store_path: context.grant_store_path,
    grant_id: "",
    event_type: "",
    status: "failed",
    error_code: "",
    grant_store_committed: false,
    provenance_appended: false,
    recovery_required: false,
    degraded: false,
    retryable: false,
    ...fields,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
