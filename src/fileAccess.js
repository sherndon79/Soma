import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_BYTES = 256_000;
const DEFAULT_TESTING_ROOT = fileURLToPath(new URL("../docs/fixtures/file-router/testing", import.meta.url));

export async function readScopedTextFile({
  descriptor,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!descriptor) {
    throw fileAccessError("invalid_file_descriptor", "File resource descriptor is required.", 400);
  }
  if (descriptor.capability !== "tool.files.read" || descriptor.resource_class !== "file") {
    throw fileAccessError("invalid_file_descriptor", "File resource descriptor is invalid.", 400);
  }
  const boundedMaxBytes = Number.isFinite(Number(descriptor.max_bytes))
    ? Number(descriptor.max_bytes)
    : maxBytes;

  const fileStat = await stat(descriptor.resolved_real_path);
  if (!fileStat.isFile()) {
    throw fileAccessError("not_a_file", "Path is not a regular file.", 400);
  }
  if (fileStat.nlink > 1) {
    throw fileAccessError("file_hardlink_denied", "Hardlinked files are not readable through this capability.", 403);
  }
  if (fileStat.size > boundedMaxBytes) {
    throw fileAccessError("file_too_large", `File exceeds max read size of ${boundedMaxBytes} bytes.`, 413);
  }

  return {
    descriptor,
    domain: descriptor.domain,
    root_id: descriptor.root_id,
    relative_path: descriptor.relative_path,
    bytes: fileStat.size,
    content: await readFile(descriptor.resolved_real_path, "utf8"),
  };
}

export async function resolveFileResourceDescriptor({
  domain = "operational",
  capability = "tool.files.read",
  ref = {},
  grant = null,
  harness = {},
  baseDir = process.cwd(),
} = {}) {
  if (capability !== "tool.files.read") {
    throw fileAccessError("file_capability_invalid", "File router only resolves tool.files.read.", 400);
  }
  const normalizedDomain = normalizeFileResourceDomain(domain);
  const rootId = boundedDescriptorString(ref.root_id, "root_id");
  const relativePath = normalizeRelativeFilePath(ref.relative_path);
  const root = fileRootsForDomain({ domain: normalizedDomain, harness, baseDir })
    .find((entry) => entry.root_id === rootId);
  if (!root) {
    throw fileAccessError("file_root_unavailable", "File root is not available for the requested domain.", 403);
  }

  const rootRealPath = await realpath(root.path).catch(() => {
    throw fileAccessError("file_root_unavailable", "File root is not available for the requested domain.", 403);
  });
  const resolvedPath = path.resolve(rootRealPath, relativePath);
  const realFilePath = await realpath(resolvedPath).catch(() => {
    throw fileAccessError("file_not_found", "File was not found.", 404);
  });
  if (!isWithinRoot(realFilePath, rootRealPath)) {
    throw fileAccessError("file_scope_denied", "File path is outside granted read scopes.", 403);
  }

  return {
    domain: normalizedDomain,
    capability,
    provider_id: root.provider_id,
    resource_class: "file",
    root_id: root.root_id,
    root_real_path: rootRealPath,
    relative_path: relativePath,
    resolved_real_path: realFilePath,
    resolved_digest: digestPath(realFilePath),
    synthetic: root.synthetic,
    max_bytes: Number.isFinite(Number(harness.filesystem?.max_read_bytes))
      ? Number(harness.filesystem.max_read_bytes)
      : DEFAULT_MAX_BYTES,
    grant_id: grant?.id ?? "",
  };
}

function fileRootsForDomain({ domain, harness = {}, baseDir = process.cwd() } = {}) {
  const filesystem = harness.filesystem ?? {};
  if (domain === "testing") {
    const configured = normalizeConfiguredRoots(filesystem.testing_roots ?? filesystem.testing_read_roots, {
      domain,
      baseDir,
      synthetic: true,
    });
    if (configured.length > 0) {
      return configured;
    }
    return [{
      root_id: "testing-fixture",
      path: DEFAULT_TESTING_ROOT,
      provider_id: "soma.provider.files.testing",
      synthetic: true,
    }];
  }
  return normalizeConfiguredRoots(filesystem.roots, {
    domain,
    baseDir,
    synthetic: false,
  }).concat(legacyOperationalRoots(filesystem.read_roots, { baseDir }));
}

function normalizeConfiguredRoots(value, { domain, baseDir, synthetic }) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => {
      if (typeof entry === "string") {
        return {
          root_id: `root-${index + 1}`,
          path: path.resolve(baseDir, entry),
          provider_id: `soma.provider.files.${domain}`,
          synthetic,
        };
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const rootId = String(entry.root_id ?? entry.id ?? "").trim();
      const rootPath = String(entry.path ?? entry.root ?? "").trim();
      if (!rootId || !rootPath) {
        return null;
      }
      return {
        root_id: rootId,
        path: path.resolve(baseDir, rootPath),
        provider_id: String(entry.provider_id ?? `soma.provider.files.${domain}`).trim(),
        synthetic: Boolean(entry.synthetic ?? synthetic),
      };
    })
    .filter(Boolean);
}

function legacyOperationalRoots(readRoots, { baseDir }) {
  if (!Array.isArray(readRoots)) {
    return [];
  }
  return readRoots.map((root, index) => ({
    root_id: `root-${index + 1}`,
    path: path.resolve(baseDir, String(root ?? "")),
    provider_id: "soma.provider.files.operational",
    synthetic: false,
  }));
}

function normalizeFileResourceDomain(domain) {
  const value = String(domain ?? "").trim() || "operational";
  if (!["testing", "operational"].includes(value)) {
    throw fileAccessError("file_domain_invalid", "File domain must be testing or operational.", 400);
  }
  return value;
}

function normalizeRelativeFilePath(relativePath) {
  const value = boundedDescriptorString(relativePath, "relative_path");
  if (
    !value ||
    value === "." ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    /^file:\/\//i.test(value)
  ) {
    throw fileAccessError("invalid_relative_path", "File relative_path must be a clean relative path.", 400);
  }
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw fileAccessError("invalid_relative_path", "File relative_path must stay within the selected root.", 400);
  }
  return normalized;
}

function boundedDescriptorString(value, field) {
  const text = String(value ?? "").trim();
  if (text.length > 512) {
    throw fileAccessError("invalid_file_descriptor", `File descriptor ${field} is too long.`, 400);
  }
  return text;
}

function digestPath(filePath) {
  return createHash("sha256").update(String(filePath ?? "")).digest("hex");
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
