import test from "node:test";
import assert from "node:assert/strict";

import {
  describeRemoteGraphicalLiveBrokerContract,
  evaluateRemoteGraphicalLiveBrokerReadiness,
} from "../src/remoteGraphicalLiveBrokerReadiness.js";

test("describeRemoteGraphicalLiveBrokerContract documents disabled-first actions", () => {
  const contract = describeRemoteGraphicalLiveBrokerContract();

  assert.equal(contract.contract, "soma.remote_graphical.broker.v1");
  assert.deepEqual(contract.required_methods, [
    "status",
    "describeActive",
    "openSession",
    "cleanupForGrant",
  ]);
  assert.equal(contract.default_enabled, false);
  assert.equal(contract.activation_enabled, false);
  assert.equal(contract.actions.find((action) => action.action === "open_session").requires_review, true);
  assert.deepEqual(contract.actions.find((action) => action.action === "open_session").must_not_enable, [
    "video",
    "input",
    "recording",
    "model_delivery",
  ]);
});

test("evaluateRemoteGraphicalLiveBrokerReadiness refuses before runtime opt-in", () => {
  const readiness = evaluateRemoteGraphicalLiveBrokerReadiness();

  assert.equal(readiness.ready, false);
  assert.equal(readiness.candidate, false);
  assert.equal(readiness.readiness, "runtime_not_enabled");
  assert.equal(readiness.broker_called, false);
  assert.equal(readiness.live_transport_used, false);
});

test("evaluateRemoteGraphicalLiveBrokerReadiness rejects fixture brokers as live candidates", () => {
  const readiness = evaluateRemoteGraphicalLiveBrokerReadiness({
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
      session_open_fixture: true,
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
      manifest_loaded: true,
    },
    manifest: liveManifest(),
    broker: completeBroker(),
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.candidate, false);
  assert.equal(readiness.readiness, "fixture_broker_not_live");
  assert.equal(readiness.session_open_fixture, true);
  assert.equal(readiness.session_opened, false);
});

test("evaluateRemoteGraphicalLiveBrokerReadiness requires repository manifest status", () => {
  const readiness = evaluateRemoteGraphicalLiveBrokerReadiness({
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "soma-agent-desktop.local.sthnet.org",
    },
    broker: completeBroker(),
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.readiness, "runtime_manifest_required");
  assert.equal(readiness.manifest_loaded, false);
});

test("evaluateRemoteGraphicalLiveBrokerReadiness detects provider and target drift", () => {
  const providerDrift = evaluateRemoteGraphicalLiveBrokerReadiness({
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
      provider: "soma.provider.remote_desktop.other",
      target_host: "soma-agent-desktop.local.sthnet.org",
      manifest_loaded: true,
    },
    manifest: liveManifest(),
    broker: completeBroker(),
  });
  assert.equal(providerDrift.readiness, "provider_mismatch");

  const targetDrift = evaluateRemoteGraphicalLiveBrokerReadiness({
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
      provider: "soma.provider.remote_desktop.sunshine",
      target_host: "other-host.local",
      manifest_loaded: true,
    },
    manifest: liveManifest(),
    broker: completeBroker(),
  });
  assert.equal(targetDrift.readiness, "target_host_mismatch");
});

test("evaluateRemoteGraphicalLiveBrokerReadiness requires full live broker interface", () => {
  const readiness = evaluateRemoteGraphicalLiveBrokerReadiness({
    brokerStatus: configuredStatus(),
    manifest: liveManifest(),
    broker: {
      status() {},
      describeActive() {},
    },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.readiness, "broker_contract_incomplete");
  assert.deepEqual(readiness.missing_methods, ["openSession", "cleanupForGrant"]);
});

test("evaluateRemoteGraphicalLiveBrokerReadiness marks complete shape as candidate but keeps activation disabled", () => {
  const readiness = evaluateRemoteGraphicalLiveBrokerReadiness({
    brokerStatus: configuredStatus(),
    manifest: liveManifest(),
    broker: completeBroker(),
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.candidate, true);
  assert.equal(readiness.activation_enabled, false);
  assert.equal(readiness.readiness, "activation_guard_disabled");
  assert.equal(readiness.provider, "soma.provider.remote_desktop.sunshine");
  assert.equal(readiness.target_host, "soma-agent-desktop.local.sthnet.org");
  assert.equal(readiness.activation_performed, false);
  assert.equal(readiness.broker_called, false);
  assert.equal(readiness.session_opened, false);
  assert.equal(readiness.video_attached, false);
  assert.equal(readiness.input_dispatched, false);
  assert.equal(readiness.model_delivery, false);
  assert.equal(readiness.live_transport_used, false);
});

function configuredStatus() {
  return {
    requested: true,
    enabled: true,
    configured: true,
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    manifest_loaded: true,
  };
}

function completeBroker() {
  return {
    status() {},
    describeActive() {},
    openSession() {},
    cleanupForGrant() {},
  };
}

function liveManifest() {
  return {
    id: "soma.provider.remote_desktop.sunshine",
    target_constraints: {
      allowed_hosts: ["soma-agent-desktop.local.sthnet.org"],
    },
  };
}
