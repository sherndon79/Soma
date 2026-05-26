import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRemoteGraphicalRuntimeManifest,
} from "../src/remoteGraphicalRuntimeManifestLoader.js";

test("loadRemoteGraphicalRuntimeManifest is default-off and does not read manifests", async () => {
  const result = await loadRemoteGraphicalRuntimeManifest({
    env: {},
    listManifestFiles() {
      throw new Error("manifest root should not be read without opt-in");
    },
  });

  assert.equal(result.requested, false);
  assert.equal(result.configured, false);
  assert.equal(result.loaded, false);
  assert.equal(result.status, "runtime_not_requested");
  assert.equal(result.manifest_source_kind, "");
  assert.equal(result.manifest, null);
});

test("loadRemoteGraphicalRuntimeManifest requires provider id before reading manifests", async () => {
  const result = await loadRemoteGraphicalRuntimeManifest({
    env: { SOMA_REMOTE_GRAPHICAL_ENABLED: "1" },
    listManifestFiles() {
      throw new Error("manifest root should not be read without provider id");
    },
  });

  assert.equal(result.requested, true);
  assert.equal(result.configured, false);
  assert.equal(result.status, "provider_id_required");
  assert.match(result.summary, /SOMA_REMOTE_GRAPHICAL_PROVIDER/);
});

test("loadRemoteGraphicalRuntimeManifest fails closed when root is unavailable", async () => {
  const error = new Error("missing");
  error.code = "ENOENT";
  const result = await loadRemoteGraphicalRuntimeManifest({
    env: runtimeEnv(),
    async listManifestFiles() {
      throw error;
    },
  });

  assert.equal(result.requested, true);
  assert.equal(result.configured, false);
  assert.equal(result.loaded, false);
  assert.equal(result.status, "manifest_root_unavailable");
  assert.equal(result.error_code, "ENOENT");
});

test("loadRemoteGraphicalRuntimeManifest configures a repository manifest without activation", async () => {
  const result = await loadRemoteGraphicalRuntimeManifest({
    env: runtimeEnv(),
    manifestRoot: "/repo/config/remote-graphical-providers",
    async listManifestFiles() {
      return [{ name: "soma.provider.remote_desktop.sunshine.json" }];
    },
    async readManifestFile() {
      return JSON.stringify(validManifest());
    },
  });

  assert.equal(result.requested, true);
  assert.equal(result.configured, true);
  assert.equal(result.loaded, true);
  assert.equal(result.status, "provider_manifest_configured");
  assert.equal(result.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(result.target_host, "soma-agent-desktop.local.sthnet.org");
  assert.equal(result.locality, "lan");
  assert.equal(result.attended, true);
  assert.equal(result.manifest_source_kind, "repository_runtime_config");
  assert.match(result.manifest_source, /soma\.provider\.remote_desktop\.sunshine\.json$/);
  assert.equal(result.manifest.broker_construction, false);
});

test("loadRemoteGraphicalRuntimeManifest accepts the checked-in runtime manifest root", async () => {
  const result = await loadRemoteGraphicalRuntimeManifest({ env: runtimeEnv() });

  assert.equal(result.configured, true);
  assert.equal(result.loaded, true);
  assert.equal(result.status, "provider_manifest_configured");
  assert.equal(result.manifest_source, "config/remote-graphical-providers/soma.provider.remote_desktop.sunshine.json");
  assert.equal(result.manifest.broker_construction, false);
});

test("loadRemoteGraphicalRuntimeManifest fails closed on invalid manifests", async () => {
  const manifest = validManifest();
  manifest.disabled_authorities = manifest.disabled_authorities.filter((authority) => authority !== "ocr");

  const result = await loadRemoteGraphicalRuntimeManifest({
    env: runtimeEnv(),
    async listManifestFiles() {
      return [{ name: "invalid.json" }];
    },
    async readManifestFile() {
      return JSON.stringify(manifest);
    },
  });

  assert.equal(result.configured, false);
  assert.equal(result.loaded, false);
  assert.equal(result.status, "manifest_validation_failed");
  assert.deepEqual(result.validation_errors, ["disabled_authorities must include ocr"]);
});

test("loadRemoteGraphicalRuntimeManifest fails closed on duplicate provider manifests", async () => {
  const result = await loadRemoteGraphicalRuntimeManifest({
    env: runtimeEnv(),
    async listManifestFiles() {
      return [{ name: "a.json" }, { name: "b.json" }];
    },
    async readManifestFile() {
      return JSON.stringify(validManifest());
    },
  });

  assert.equal(result.configured, false);
  assert.equal(result.loaded, false);
  assert.equal(result.status, "provider_manifest_duplicate");
});

test("loadRemoteGraphicalRuntimeManifest fails closed when provider manifest is missing", async () => {
  const result = await loadRemoteGraphicalRuntimeManifest({
    env: {
      SOMA_REMOTE_GRAPHICAL_ENABLED: "1",
      SOMA_REMOTE_GRAPHICAL_PROVIDER: "soma.provider.remote_desktop.unknown",
    },
    async listManifestFiles() {
      return [{ name: "soma.provider.remote_desktop.sunshine.json" }];
    },
    async readManifestFile() {
      return JSON.stringify(validManifest());
    },
  });

  assert.equal(result.configured, false);
  assert.equal(result.loaded, false);
  assert.equal(result.status, "provider_manifest_missing");
});

function runtimeEnv() {
  return {
    SOMA_REMOTE_GRAPHICAL_ENABLED: "1",
    SOMA_REMOTE_GRAPHICAL_PROVIDER: "soma.provider.remote_desktop.sunshine",
  };
}

function validManifest() {
  return {
    id: "soma.provider.remote_desktop.sunshine",
    manifest_version: "soma.remote_graphical.provider_manifest.v1",
    provider_contract: "soma.remote_graphical.broker.v1",
    runtime: "remote-graphical-session",
    implementation: {
      broker_kind: "moonlight-client-broker",
      transport: "sunshine-moonlight",
      construction: "explicit-runtime-injection",
    },
    default_enabled: false,
    required_runtime_opt_ins: [
      "SOMA_REMOTE_GRAPHICAL_ENABLED=1",
      "SOMA_REMOTE_GRAPHICAL_PROVIDER=soma.provider.remote_desktop.sunshine",
    ],
    target_constraints: {
      allowed_hosts: ["soma-agent-desktop.local.sthnet.org"],
      locality: ["lan"],
      attended_required: true,
      operator_rollback: "graphical lab base snapshot or documented host rollback",
    },
    supported_actions: [
      {
        action: "status",
        requires_grant: false,
        live_transport_allowed: false,
      },
      {
        action: "open_session",
        requires_grant: true,
        requires_user_actor: true,
        requires_review: true,
        live_transport_allowed: true,
        must_not_enable: ["video", "input", "recording", "model_delivery"],
      },
      {
        action: "describe_active",
        live_transport_allowed: false,
      },
      {
        action: "cleanup_for_grant",
        requires_grant: true,
      },
    ],
    disabled_authorities: [
      "pairing",
      "credential_persistence",
      "video_observation",
      "screenshot_capture",
      "ocr",
      "pointer_input",
      "keyboard_input",
      "clipboard",
      "file_transfer",
      "audio",
      "controller_input",
      "recording",
      "model_visual_delivery",
      "durable_grant_writes",
    ],
    review_only: false,
    runtime_loaded: true,
    provider_registry_entry: true,
    broker_construction: false,
  };
}
