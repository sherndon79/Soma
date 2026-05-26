import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRemoteGraphicalLiveProviderManifest } from "./remoteGraphicalLiveProviderManifest.js";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export const REMOTE_GRAPHICAL_RUNTIME_MANIFEST_ROOT = new URL(
  "../config/remote-graphical-providers/",
  import.meta.url,
);

export async function loadRemoteGraphicalRuntimeManifest({
  env = process.env,
  manifestRoot = REMOTE_GRAPHICAL_RUNTIME_MANIFEST_ROOT,
  listManifestFiles = defaultListManifestFiles,
  readManifestFile = defaultReadManifestFile,
  validateManifest = validateRemoteGraphicalLiveProviderManifest,
} = {}) {
  const requested = isRemoteGraphicalRuntimeRequested(env);
  if (!requested) {
    return manifestLoaderResult({
      requested,
      status: "runtime_not_requested",
      summary: "Remote graphical runtime manifest loading is disabled until explicit opt-in.",
    });
  }

  const provider = stringValue(env.SOMA_REMOTE_GRAPHICAL_PROVIDER);
  if (!provider) {
    return manifestLoaderResult({
      requested,
      status: "provider_id_required",
      summary: "Remote graphical runtime manifest loading requires SOMA_REMOTE_GRAPHICAL_PROVIDER.",
    });
  }

  let entries;
  try {
    entries = await listManifestFiles(manifestRoot);
  } catch (error) {
    return manifestLoaderResult({
      requested,
      provider,
      status: "manifest_root_unavailable",
      error_code: stringValue(error?.code),
      summary: "Remote graphical runtime manifest root is unavailable.",
    });
  }

  const jsonEntries = entries
    .map((entry) => normalizeManifestEntry(entry, manifestRoot))
    .filter((entry) => entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));

  const matches = [];
  for (const entry of jsonEntries) {
    const parsed = await readJsonManifest({
      entry,
      manifestRoot,
      readManifestFile,
    });
    if (!parsed.ok) {
      return manifestLoaderResult({
        requested,
        provider,
        status: "manifest_parse_failed",
        manifest_source: entry.source,
        summary: "Remote graphical runtime manifest failed JSON parsing.",
      });
    }

    let validated;
    try {
      validated = validateManifest(parsed.manifest);
    } catch (error) {
      return manifestLoaderResult({
        requested,
        provider,
        status: "manifest_validation_failed",
        manifest_source: entry.source,
        error_code: stringValue(error?.code),
        validation_errors: Array.isArray(error?.validation_errors)
          ? [...error.validation_errors]
          : [],
        summary: "Remote graphical runtime manifest failed validation.",
      });
    }

    if (validated.id === provider) {
      matches.push({ entry, manifest: validated });
    }
  }

  if (matches.length === 0) {
    return manifestLoaderResult({
      requested,
      provider,
      status: "provider_manifest_missing",
      summary: "Remote graphical provider is requested but no matching repository manifest was found.",
    });
  }

  if (matches.length > 1) {
    return manifestLoaderResult({
      requested,
      provider,
      status: "provider_manifest_duplicate",
      summary: "Remote graphical provider has more than one matching repository manifest.",
    });
  }

  const [{ entry, manifest }] = matches;
  return manifestLoaderResult({
    requested,
    provider,
    configured: true,
    loaded: true,
    status: "provider_manifest_configured",
    manifest_source: entry.source,
    manifest,
    target_host: firstString(manifest.target_constraints?.allowed_hosts),
    locality: firstString(manifest.target_constraints?.locality),
    attended: manifest.target_constraints?.attended_required === true,
    summary: "Remote graphical provider manifest is configured; live broker activation remains disabled.",
  });
}

async function defaultListManifestFiles(manifestRoot) {
  return readdir(manifestRoot, { withFileTypes: true });
}

async function defaultReadManifestFile(entry, manifestRoot) {
  const rootPath = pathFromRoot(manifestRoot);
  return readFile(path.join(rootPath, entry.name), "utf8");
}

async function readJsonManifest({ entry, manifestRoot, readManifestFile }) {
  try {
    const raw = await readManifestFile(entry, manifestRoot);
    return { ok: true, manifest: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function normalizeManifestEntry(entry, manifestRoot) {
  const name = stringValue(entry?.name ?? entry);
  return {
    name,
    source: sourcePathFor(name, manifestRoot),
  };
}

function manifestLoaderResult(value = {}) {
  return {
    requested: Boolean(value.requested),
    configured: Boolean(value.configured),
    loaded: Boolean(value.loaded),
    provider: stringValue(value.provider),
    target_host: stringValue(value.target_host),
    locality: stringValue(value.locality),
    attended: value.attended === undefined ? null : Boolean(value.attended),
    status: stringValue(value.status) || "runtime_not_requested",
    manifest_source_kind: value.manifest_source ? "repository_runtime_config" : "",
    manifest_source: stringValue(value.manifest_source),
    error_code: stringValue(value.error_code),
    validation_errors: Array.isArray(value.validation_errors) ? [...value.validation_errors] : [],
    manifest: value.loaded ? copyPlainJson(value.manifest) : null,
    summary: stringValue(value.summary),
  };
}

function sourcePathFor(name, manifestRoot) {
  const rootPath = pathFromRoot(manifestRoot);
  const absolute = path.join(rootPath, name);
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const relative = path.relative(repoRoot, absolute);
  return relative && !relative.startsWith("..") ? relative : absolute;
}

function pathFromRoot(manifestRoot) {
  return manifestRoot instanceof URL ? fileURLToPath(manifestRoot) : String(manifestRoot);
}

function firstString(values) {
  return Array.isArray(values) ? stringValue(values[0]) : "";
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function copyPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRemoteGraphicalRuntimeRequested(env = process.env) {
  return ENABLED_VALUES.has(String(env.SOMA_REMOTE_GRAPHICAL_ENABLED ?? "").trim().toLowerCase());
}
