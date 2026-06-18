import { resolveFileResourceDescriptor } from "./fileAccess.js";
import {
  syntheticDesktopFixtureDescriptor,
  syntheticDesktopFixtureDigest,
} from "./desktopSyntheticFixtures.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  HOST_SERVICE_RESTART_CAPABILITY,
  HOST_SERVICE_STATUS_CAPABILITY,
  HOST_SERVICE_SYNTHETIC_PROVIDER_ID,
  hostServiceError,
} from "./hostServiceContracts.js";
import { hostServiceDescriptorDigest } from "./hostServiceInventory.js";

const DEFAULT_PROVENANCE_SUMMARY_PROVIDER_ID = "soma.provider.provenance-summary";
const DEFAULT_DESKTOP_BROKER_PROVIDER_ID = "soma.provider.desktop-broker";
const SYNTHETIC_DESKTOP_PROVIDER_ID = "soma.provider.synthetic-desktop";
const SYNTHETIC_CONTAINER_DESKTOP_PROVIDER_ID = "soma.provider.synthetic-container-desktop";
const SYNTHETIC_DESKTOP_PROVIDER_MODES = new Set(["synthetic_fixture", "synthetic_container_live"]);
const DEFAULT_SYNTHETIC_CONTAINER_SESSION_ID = "desktop-realism-minimal-x11-v1";
const DEFAULT_SYNTHETIC_CONTAINER_CANARY_SET_ID = "desktop-realism-minimal-x11-v1";
const DESKTOP_REALISM_CANARY_MANIFEST_PATH = fileURLToPath(
  new URL("../docs/fixtures/desktop-realism/canary-manifest.json", import.meta.url),
);
const DEFAULT_MAX_EVENTS_CONSIDERED = 1000;

export async function resolveResourceDescriptor({
  domain = "operational",
  capability = "",
  ref = {},
  grant = null,
  harness = {},
  baseDir = process.cwd(),
  providerRegistry = {},
  hostServiceAuthority = null,
  hostServiceAuthorization = null,
} = {}) {
  if (capability === "tool.files.read") {
    return resolveFileResourceDescriptor({ domain, capability, ref, grant, harness, baseDir });
  }
  if (capability === "provenance.summary.read") {
    return resolveProvenanceSummaryResourceDescriptor({ domain, capability, ref, grant, harness, providerRegistry });
  }
  if (capability === "desktop.inspect.accessibility_tree") {
    return resolveDesktopAccessibilityTreeResourceDescriptor({ domain, capability, ref, grant, harness, providerRegistry });
  }
  if (capability === "desktop.inspect.windows") {
    return resolveDesktopWindowsResourceDescriptor({ domain, capability, ref, grant, harness });
  }
  if (capability === "desktop.inspect.text") {
    return resolveDesktopTextResourceDescriptor({ domain, capability, ref, grant, harness });
  }
  if (capability === "desktop.act.invoke_action" || capability === "desktop.act.text_input") {
    return resolveDesktopActuationResourceDescriptor({ domain, capability, ref, grant, harness });
  }
  if ([HOST_SERVICE_STATUS_CAPABILITY, HOST_SERVICE_RESTART_CAPABILITY].includes(capability)) {
    return resolveHostServiceStatusResourceDescriptor({
      domain,
      capability,
      ref,
      grant,
      hostServiceAuthority,
      hostServiceAuthorization,
    });
  }
  throw resourceRouterError("resource_capability_unrouted", "No resource router is registered for this capability.", 400);
}

export function resolveHostServiceStatusResourceDescriptor({
  domain = "operational",
  capability = HOST_SERVICE_STATUS_CAPABILITY,
  ref = {},
  grant = null,
  hostServiceAuthority = null,
  hostServiceAuthorization = null,
} = {}) {
  const normalizedDomain = normalizeResourceDomain(domain);
  if (normalizedDomain !== "testing") {
    throw hostServiceError(
      "service_status_unavailable",
      "Operational service status remains disabled in this build slice.",
      403,
    );
  }
  if (!hostServiceAuthority?.inventory || !hostServiceAuthority?.handles) {
    throw hostServiceError("service_recovery_degraded", "Service authority is unavailable.", 503);
  }
  const providerId = hostServiceAuthority.inventory.host.provider_id;
  if (providerId !== HOST_SERVICE_SYNTHETIC_PROVIDER_ID) {
    throw hostServiceError(
      "service_testing_live_fallthrough_denied",
      "Testing service resolution cannot select an operational provider.",
      403,
    );
  }
  if (
    !hostServiceAuthorization
    || hostServiceAuthorization.capability !== capability
    || hostServiceAuthorization.task_id !== String(ref.task_id ?? "")
    || hostServiceAuthorization.grant_id !== String(grant?.id ?? "")
    || hostServiceAuthorization.provider_id !== providerId
    || hostServiceAuthorization.domain !== "testing"
    || grant?.status !== "active"
  ) {
    throw hostServiceError("service_task_scope_denied", "Service descriptor requires prior active authorization.", 403);
  }
  const entry = hostServiceAuthority.handles.resolve({
    handle: ref.service_handle,
    inventory: hostServiceAuthority.inventory,
    task_id: ref.task_id,
    grant_id: grant?.id,
    provider_id: providerId,
    domain: "testing",
  });
  const descriptor = {
    domain: "testing",
    capability,
    provider_id: providerId,
    resource_class: "systemd_service",
    synthetic: true,
    host_id: entry.host_id,
    service_handle: entry.handle,
    inventory_generation: entry.host_inventory_generation,
    unit_inventory_generation: entry.unit_inventory_generation,
    unit_inventory_id: entry.unit_inventory_id,
    task_id: entry.task_id,
    grant_id: entry.grant_id,
    fixture_id: entry.fixture_id,
    limits: {
      max_properties: 12,
      timeout_ms: 5000,
    },
  };
  return Object.freeze({
    ...descriptor,
    descriptor_digest: hostServiceDescriptorDigest(descriptor),
  });
}

export function resolveProvenanceSummaryResourceDescriptor({
  domain = "operational",
  capability = "provenance.summary.read",
  ref = {},
  grant = null,
  harness = {},
  providerRegistry = {},
} = {}) {
  if (capability !== "provenance.summary.read") {
    throw resourceRouterError(
      "provenance_summary_capability_invalid",
      "Provenance summary router only resolves provenance.summary.read.",
      400,
    );
  }
  const normalizedDomain = normalizeResourceDomain(domain);
  const episodeId = boundedDescriptorString(ref.episode_id ?? ref.episodeId, "episode_id");
  if (!episodeId) {
    throw resourceRouterError("provenance_summary_episode_required", "Provenance summary requires an episode_id.", 400);
  }
  return {
    domain: normalizedDomain,
    capability,
    provider_id: providerForCapability(providerRegistry, capability) || DEFAULT_PROVENANCE_SUMMARY_PROVIDER_ID,
    resource_class: "internal_provenance",
    scope: {
      episode_id: episodeId,
      domain: normalizedDomain,
    },
    synthetic: normalizedDomain === "testing",
    max_events_considered: normalizeMaxEvents(ref.max_events_considered ?? harness.provenance?.max_summary_events),
    grant_id: grant?.id ?? "",
  };
}

export async function resolveDesktopAccessibilityTreeResourceDescriptor({
  domain = "operational",
  capability = "desktop.inspect.accessibility_tree",
  ref = {},
  grant = null,
  harness = {},
  providerRegistry = {},
} = {}) {
  if (capability !== "desktop.inspect.accessibility_tree") {
    throw resourceRouterError(
      "desktop_accessibility_capability_invalid",
      "Desktop accessibility router only resolves desktop.inspect.accessibility_tree.",
      400,
    );
  }
  const normalizedDomain = normalizeResourceDomain(domain);
  const limits = {
    max_apps: normalizeDesktopLimit(ref.max_apps ?? ref.maxApps, 1, 64),
    max_children: normalizeDesktopLimit(ref.max_children ?? ref.maxChildren, 0, 8),
  };
  if (normalizedDomain === "testing") {
    const providerMode = resolveTestingDesktopProviderMode({ harness, ref });
    if (providerMode === "synthetic_container_live") {
      return {
        domain: "testing",
        capability,
        provider_id: resolveSyntheticContainerProviderId({ harness, ref }),
        provider_mode: "synthetic_container_live",
        resource_class: "desktop",
        synthetic: true,
        desktop_surface: "accessibility_tree",
        session_id: resolveSyntheticContainerSessionId({ harness, ref }),
        canary_set_id: resolveSyntheticContainerCanarySetId({ harness, ref }),
        canary_set_digest: await desktopRealismCanaryManifestDigest(),
        limits,
        grant_id: grant?.id ?? "",
      };
    }
    const fixtureId = resolveTestingDesktopFixtureId({ harness, ref });
    const fixture = syntheticDesktopFixtureDescriptor(fixtureId);
    if (!fixture) {
      throw resourceRouterError("synthetic_desktop_fixture_unknown", "Synthetic desktop fixture is not allowlisted.", 403);
    }
    return {
      domain: "testing",
      capability,
      provider_id: SYNTHETIC_DESKTOP_PROVIDER_ID,
      provider_mode: "synthetic_fixture",
      resource_class: "desktop",
      synthetic: true,
      desktop_surface: "accessibility_tree",
      fixture_id: fixture.id,
      fixture_digest: await syntheticDesktopFixtureDigest(fixture.id),
      limits,
      grant_id: grant?.id ?? "",
    };
  }
  return {
    domain: "operational",
    capability,
    provider_id: providerForCapability(providerRegistry, capability) || DEFAULT_DESKTOP_BROKER_PROVIDER_ID,
    provider_mode: "live_helper",
    resource_class: "desktop",
    synthetic: false,
    desktop_surface: "accessibility_tree",
    limits,
    grant_id: grant?.id ?? "",
  };
}

export async function resolveDesktopWindowsResourceDescriptor({
  domain = "testing",
  capability = "desktop.inspect.windows",
  ref = {},
  grant = null,
  harness = {},
} = {}) {
  if (capability !== "desktop.inspect.windows") {
    throw resourceRouterError(
      "desktop_windows_capability_invalid",
      "Desktop windows router only resolves desktop.inspect.windows.",
      400,
    );
  }
  const normalizedDomain = normalizeResourceDomain(domain);
  if (normalizedDomain !== "testing") {
    throw resourceRouterError(
      "desktop_windows_live_disabled",
      "Desktop window inspection is disabled for operational live desktops in this slice.",
      403,
    );
  }
  const providerMode = resolveTestingDesktopProviderMode({ harness, ref });
  if (providerMode !== "synthetic_container_live") {
    throw resourceRouterError(
      "desktop_windows_synthetic_container_required",
      "Testing desktop window inspection requires a configured synthetic container provider.",
      403,
    );
  }
  return {
    domain: "testing",
    capability,
    provider_id: resolveSyntheticContainerProviderId({ harness, ref }),
    provider_mode: "synthetic_container_live",
    resource_class: "desktop",
    synthetic: true,
    desktop_surface: "windows_focus_targeting",
    session_id: resolveSyntheticContainerSessionId({ harness, ref }),
    canary_set_id: resolveSyntheticContainerCanarySetId({ harness, ref }),
    canary_set_digest: await desktopRealismCanaryManifestDigest(),
    grant_id: grant?.id ?? "",
    content_included: false,
    titles_included: false,
    identity_fields_included: false,
  };
}

export async function resolveDesktopTextResourceDescriptor({
  domain = "testing",
  capability = "desktop.inspect.text",
  ref = {},
  grant = null,
  harness = {},
} = {}) {
  if (capability !== "desktop.inspect.text") {
    throw resourceRouterError(
      "desktop_text_capability_invalid",
      "Desktop text router only resolves desktop.inspect.text.",
      400,
    );
  }
  const normalizedDomain = normalizeResourceDomain(domain);
  if (normalizedDomain !== "testing") {
    throw resourceRouterError(
      "desktop_text_live_disabled",
      "Desktop text inspection is disabled for operational live desktops in this slice.",
      403,
    );
  }
  const providerMode = resolveTestingDesktopProviderMode({ harness, ref });
  if (providerMode !== "synthetic_container_live") {
    throw resourceRouterError(
      "desktop_text_synthetic_container_required",
      "Testing desktop text inspection requires a configured synthetic container provider.",
      403,
    );
  }
  return {
    domain: "testing",
    capability,
    provider_id: resolveSyntheticContainerProviderId({ harness, ref }),
    provider_mode: "synthetic_container_live",
    resource_class: "desktop",
    synthetic: true,
    desktop_surface: "text_content",
    session_id: resolveSyntheticContainerSessionId({ harness, ref }),
    canary_set_id: resolveSyntheticContainerCanarySetId({ harness, ref }),
    canary_set_digest: await desktopRealismCanaryManifestDigest(),
    grant_id: grant?.id ?? "",
    content_included: true,
    titles_included: true,
    names_included: true,
    descriptions_included: true,
    identity_fields_included: false,
    screenshots_included: false,
  };
}

export async function resolveDesktopActuationResourceDescriptor({
  domain = "testing",
  capability = "",
  ref = {},
  grant = null,
  harness = {},
} = {}) {
  if (!["desktop.act.invoke_action", "desktop.act.text_input"].includes(capability)) {
    throw resourceRouterError(
      "desktop_act_capability_invalid",
      "Desktop actuation router only resolves desktop actuation capabilities.",
      400,
    );
  }
  const normalizedDomain = normalizeResourceDomain(domain);
  if (normalizedDomain !== "testing") {
    throw resourceRouterError(
      "desktop_act_live_disabled",
      "Desktop actuation is disabled for operational live desktops in this slice.",
      403,
    );
  }
  const providerMode = resolveTestingDesktopProviderMode({ harness, ref });
  if (providerMode !== "synthetic_container_live") {
    throw resourceRouterError(
      "desktop_act_synthetic_container_required",
      "Testing desktop actuation requires a configured synthetic container provider.",
      403,
    );
  }
  return {
    domain: "testing",
    capability,
    provider_id: resolveSyntheticContainerProviderId({ harness, ref }),
    provider_mode: "synthetic_container_live",
    resource_class: "desktop",
    synthetic: true,
    desktop_surface: "actuation",
    session_id: resolveSyntheticContainerSessionId({ harness, ref }),
    canary_set_id: resolveSyntheticContainerCanarySetId({ harness, ref }),
    canary_set_digest: await desktopRealismCanaryManifestDigest(),
    grant_id: grant?.id ?? "",
    actuation_kind: capability === "desktop.act.invoke_action" ? "invoke_action" : "text_input",
  };
}

export function testingDesktopProviderIdForHarness({ harness = {}, ref = {} } = {}) {
  const providerMode = resolveTestingDesktopProviderMode({ harness, ref });
  if (providerMode === "synthetic_container_live") {
    return resolveSyntheticContainerProviderId({ harness, ref });
  }
  return SYNTHETIC_DESKTOP_PROVIDER_ID;
}

export function testingDesktopProviderModeForHarness({ harness = {}, ref = {} } = {}) {
  return resolveTestingDesktopProviderMode({ harness, ref });
}

export function defaultSyntheticContainerDesktopProviderId() {
  return SYNTHETIC_CONTAINER_DESKTOP_PROVIDER_ID;
}

function resolveTestingDesktopProviderMode({ harness = {}, ref = {} } = {}) {
  const desktop = harness.desktop ?? {};
  const syntheticContainer = desktop.synthetic_container ?? {};
  const requested = boundedDescriptorString(
    ref.provider_mode
      ?? ref.providerMode
      ?? desktop.testing_provider_mode
      ?? desktop.testingProviderMode
      ?? desktop.provider_mode
      ?? desktop.providerMode
      ?? syntheticContainer.provider_mode
      ?? syntheticContainer.providerMode
      ?? "synthetic_fixture",
    "provider_mode",
  ) || "synthetic_fixture";
  if (!SYNTHETIC_DESKTOP_PROVIDER_MODES.has(requested)) {
    throw resourceRouterError("desktop_testing_provider_mode_invalid", "Testing desktop provider mode is invalid.", 400);
  }
  return requested;
}

function resolveSyntheticContainerProviderId({ harness = {}, ref = {} } = {}) {
  const desktop = harness.desktop ?? {};
  const syntheticContainer = desktop.synthetic_container ?? {};
  return boundedDescriptorString(
    ref.provider_id
      ?? ref.providerId
      ?? desktop.synthetic_container_provider_id
      ?? desktop.syntheticContainerProviderId
      ?? syntheticContainer.provider_id
      ?? syntheticContainer.providerId
      ?? SYNTHETIC_CONTAINER_DESKTOP_PROVIDER_ID,
    "provider_id",
  ) || SYNTHETIC_CONTAINER_DESKTOP_PROVIDER_ID;
}

function resolveSyntheticContainerSessionId({ harness = {}, ref = {} } = {}) {
  const desktop = harness.desktop ?? {};
  const syntheticContainer = desktop.synthetic_container ?? {};
  return boundedDescriptorString(
    ref.session_id
      ?? ref.sessionId
      ?? desktop.synthetic_container_session_id
      ?? desktop.syntheticContainerSessionId
      ?? syntheticContainer.session_id
      ?? syntheticContainer.sessionId
      ?? DEFAULT_SYNTHETIC_CONTAINER_SESSION_ID,
    "session_id",
  ) || DEFAULT_SYNTHETIC_CONTAINER_SESSION_ID;
}

function resolveSyntheticContainerCanarySetId({ harness = {}, ref = {} } = {}) {
  const desktop = harness.desktop ?? {};
  const syntheticContainer = desktop.synthetic_container ?? {};
  return boundedDescriptorString(
    ref.canary_set_id
      ?? ref.canarySetId
      ?? desktop.synthetic_container_canary_set_id
      ?? desktop.syntheticContainerCanarySetId
      ?? syntheticContainer.canary_set_id
      ?? syntheticContainer.canarySetId
      ?? DEFAULT_SYNTHETIC_CONTAINER_CANARY_SET_ID,
    "canary_set_id",
  ) || DEFAULT_SYNTHETIC_CONTAINER_CANARY_SET_ID;
}

async function desktopRealismCanaryManifestDigest() {
  const contents = await readFile(DESKTOP_REALISM_CANARY_MANIFEST_PATH);
  return createHash("sha256").update(contents).digest("hex");
}

function resolveTestingDesktopFixtureId({ harness = {}, ref = {} } = {}) {
  const allowed = normalizeSyntheticDesktopFixtureIds(harness.desktop?.synthetic_fixtures);
  if (allowed.length === 0) {
    throw resourceRouterError("synthetic_desktop_fixture_not_configured", "Testing desktop inspection requires a configured synthetic fixture.", 403);
  }
  const requested = boundedDescriptorString(
    ref.fixture_id ?? ref.fixtureId ?? harness.desktop?.default_synthetic_fixture_id ?? allowed[0] ?? "",
    "fixture_id",
  );
  if (!allowed.includes(requested)) {
    throw resourceRouterError("synthetic_desktop_fixture_not_allowed", "Synthetic desktop fixture is not allowlisted for this harness.", 403);
  }
  return requested;
}

function normalizeSyntheticDesktopFixtureIds(entries) {
  const values = Array.isArray(entries) ? entries : [];
  return values
    .map((entry) => String(typeof entry === "string" ? entry : entry?.id ?? "").trim())
    .filter(Boolean);
}

function normalizeResourceDomain(domain) {
  const value = String(domain ?? "").trim() || "operational";
  if (!["testing", "operational"].includes(value)) {
    throw resourceRouterError("resource_domain_invalid", "Resource domain must be testing or operational.", 400);
  }
  return value;
}

function normalizeMaxEvents(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0 && number <= DEFAULT_MAX_EVENTS_CONSIDERED) {
    return number;
  }
  return DEFAULT_MAX_EVENTS_CONSIDERED;
}

function normalizeDesktopLimit(value, minimum, maximum) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= minimum && number <= maximum) {
    return number;
  }
  return null;
}

function boundedDescriptorString(value, field) {
  const text = String(value ?? "").trim();
  if (text.length > 512) {
    throw resourceRouterError("invalid_resource_descriptor", `Resource descriptor ${field} is too long.`, 400);
  }
  return text;
}

function providerForCapability(providerRegistry = {}, capability = "") {
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  const matches = providers.filter((provider) => {
    const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
    return capabilities.some((entry) => (typeof entry === "string" ? entry : entry?.key) === capability);
  });
  return matches.length === 1 ? matches[0].id : "";
}

function resourceRouterError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
