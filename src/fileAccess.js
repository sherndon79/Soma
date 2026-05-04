import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_BYTES = 256_000;

export async function readScopedTextFile({
  requestedPath,
  roots = [],
  baseDir = process.cwd(),
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const normalizedPath = String(requestedPath ?? "").trim();
  if (!normalizedPath) {
    throw fileAccessError("invalid_file_path", "File path is required.", 400);
  }

  const resolvedPath = path.resolve(baseDir, normalizedPath);
  const realFilePath = await realpath(resolvedPath).catch(() => {
    throw fileAccessError("file_not_found", "File was not found.", 404);
  });
  const realRoots = await Promise.all(roots.map((root) => realpath(path.resolve(baseDir, root))));
  const allowedRoot = realRoots.find((root) => isWithinRoot(realFilePath, root));
  if (!allowedRoot) {
    throw fileAccessError("file_scope_denied", "File path is outside granted read scopes.", 403);
  }

  const fileStat = await stat(realFilePath);
  if (!fileStat.isFile()) {
    throw fileAccessError("not_a_file", "Path is not a regular file.", 400);
  }
  if (fileStat.size > maxBytes) {
    throw fileAccessError("file_too_large", `File exceeds max read size of ${maxBytes} bytes.`, 413);
  }

  return {
    path: realFilePath,
    root: allowedRoot,
    bytes: fileStat.size,
    content: await readFile(realFilePath, "utf8"),
  };
}

function isWithinRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function fileAccessError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
