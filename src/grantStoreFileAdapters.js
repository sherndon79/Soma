import { constants } from "node:fs";
import {
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export function createGrantStoreFileIo() {
  return {
    readFile: withStage("readFile", (filePath, encoding = "utf8") => readFile(filePath, encoding)),
    writeFile: withStage("writeFile", (filePath, contents, encoding = "utf8") => (
      writeFile(filePath, contents, { encoding, flag: "wx", mode: 0o600 })
    )),
    rename: withStage("rename", (source, target) => rename(source, target)),
    unlink: withStage("unlink", (filePath) => unlink(filePath)),
    fsyncFile: withStage("fsyncFile", fsyncFile),
    fsyncDir: withStage("fsyncDir", fsyncDir),
    tempPath: ({ grant_store_path: grantStorePath, mutation_id: mutationId }) => {
      const directory = path.dirname(grantStorePath);
      const basename = path.basename(grantStorePath);
      const suffix = String(mutationId || `${Date.now()}-${process.pid}`).replaceAll("/", "_");
      return path.join(directory, `.${basename}.${suffix}.tmp`);
    },
  };
}

export function createGrantStoreLock({ lockPath } = {}) {
  return {
    async acquire({ grant_store_path: grantStorePath } = {}) {
      const targetLockPath = String(lockPath || `${grantStorePath}.lock`);
      let handle = null;
      try {
        handle = await open(
          targetLockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        await handle.writeFile(`${process.pid}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        if (handle) {
          await closeQuietly(handle);
          await unlinkQuietly(targetLockPath);
        }
        throw stageError("lock", error);
      }

      return async () => {
        await closeQuietly(handle);
        try {
          await unlink(targetLockPath);
        } catch (error) {
          if (error?.code !== "ENOENT") {
            throw stageError("lock_release", error);
          }
        }
      };
    },
  };
}

function withStage(stage, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw stageError(stage, error);
    }
  };
}

async function fsyncFile(filePath) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await closeQuietly(handle);
  }
}

async function fsyncDir(directoryPath) {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await closeQuietly(handle);
  }
}

async function closeQuietly(handle) {
  try {
    await handle.close();
  } catch {
    // Closing during failure cleanup should not mask the original write/lock error.
  }
}

async function unlinkQuietly(filePath) {
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup while preserving the original lock acquisition error.
  }
}

function stageError(stage, cause) {
  const error = new Error(cause?.message || `${stage} failed`, { cause });
  error.name = "GrantStoreFileAdapterError";
  error.stage = stage;
  error.code = cause?.code || stage;
  return error;
}
