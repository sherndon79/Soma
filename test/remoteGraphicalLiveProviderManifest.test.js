import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateRemoteGraphicalLiveProviderManifest,
} from "../src/remoteGraphicalLiveProviderManifest.js";

test("remote graphical live provider fixture validates as review-only evidence", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("../docs/fixtures/remote-graphical-live-provider-manifest.json", import.meta.url),
    "utf8",
  ));
  const validated = validateRemoteGraphicalLiveProviderManifest(fixture);

  assert.deepEqual(validated, fixture);
  assert.equal(validated.review_only, true);
  assert.equal(validated.runtime_loaded, false);
  assert.equal(validated.provider_registry_entry, false);
  assert.equal(validated.broker_construction, false);
});

test("validateRemoteGraphicalLiveProviderManifest accepts the disabled-first manifest shape", () => {
  const manifest = makeLiveProviderManifest();
  const validated = validateRemoteGraphicalLiveProviderManifest(manifest);

  assert.deepEqual(validated, manifest);
  assert.notEqual(validated, manifest);
  assert.equal(validated.id, "soma.provider.remote_desktop.sunshine");
  assert.equal(validated.default_enabled, false);
  assert.deepEqual(validated.target_constraints.allowed_hosts, ["soma-agent-desktop.local.sthnet.org"]);
  assert.equal(validated.target_constraints.attended_required, true);
});

test("validateRemoteGraphicalLiveProviderManifest rejects runtime activation shortcuts", () => {
  assertManifestRejects({
    ...makeLiveProviderManifest(),
    default_enabled: true,
    required_runtime_opt_ins: ["SOMA_REMOTE_GRAPHICAL_ENABLED=1"],
  }, [
    "default_enabled must be false",
    "required_runtime_opt_ins must include SOMA_REMOTE_GRAPHICAL_PROVIDER=soma.provider.remote_desktop.sunshine",
  ]);
});

test("validateRemoteGraphicalLiveProviderManifest rejects broad or unattended targets", () => {
  assertManifestRejects({
    ...makeLiveProviderManifest(),
    target_constraints: {
      allowed_hosts: ["*"],
      locality: ["lan", "internet-facing"],
      attended_required: false,
      operator_rollback: "",
    },
  }, [
    "target_constraints.allowed_hosts[0] must not be a wildcard",
    "target_constraints.locality includes unsupported locality internet-facing",
    "target_constraints.attended_required must be true",
    "target_constraints.operator_rollback must be a non-empty string",
  ]);
});

test("validateRemoteGraphicalLiveProviderManifest rejects missing action separation", () => {
  const manifest = makeLiveProviderManifest();
  assertManifestRejects({
    ...manifest,
    supported_actions: manifest.supported_actions.filter((action) => action.action !== "cleanup_for_grant").map((action) => {
      if (action.action !== "open_session") {
        return action;
      }
      return {
        ...action,
        requires_user_actor: false,
        live_transport_allowed: false,
        must_not_enable: ["video", "recording"],
      };
    }),
  }, [
    "supported_actions must include cleanup_for_grant",
    "supported_actions.open_session.requires_user_actor must be true",
    "supported_actions.open_session.live_transport_allowed must be true",
    "supported_actions.open_session.must_not_enable must include input",
    "supported_actions.open_session.must_not_enable must include model_delivery",
  ]);
});

test("validateRemoteGraphicalLiveProviderManifest rejects missing disabled authorities", () => {
  assertManifestRejects({
    ...makeLiveProviderManifest(),
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
    ],
  }, [
    "disabled_authorities must include model_visual_delivery",
    "disabled_authorities must include durable_grant_writes",
  ]);
});

test("validateRemoteGraphicalLiveProviderManifest rejects provider identity drift", () => {
  assertManifestRejects({
    ...makeLiveProviderManifest(),
    id: "soma.provider.remote_desktop.other",
    runtime: "remote-control-plugin",
    implementation: {
      broker_kind: "shell-script",
      transport: "vnc",
      construction: "auto-load",
    },
  }, [
    "id must be soma.provider.remote_desktop.sunshine",
    "runtime must be remote-graphical-session",
    "implementation.broker_kind must be moonlight-client-broker",
    "implementation.transport must be sunshine-moonlight",
    "implementation.construction must be explicit-runtime-injection",
  ]);
});

function assertManifestRejects(manifest, expectedErrors) {
  assert.throws(
    () => validateRemoteGraphicalLiveProviderManifest(manifest),
    (error) => {
      assert.equal(error.code, "invalid_remote_graphical_live_provider_manifest");
      for (const expected of expectedErrors) {
        assert.ok(
          error.validation_errors.includes(expected),
          `expected validation error ${expected}; got ${JSON.stringify(error.validation_errors)}`,
        );
      }
      return true;
    },
  );
}

function makeLiveProviderManifest() {
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
  };
}
