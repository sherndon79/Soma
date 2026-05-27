import assert from "node:assert/strict";
import test from "node:test";

import { RemoteGraphicalLiveBrokerManager } from "../src/remoteGraphicalLiveBrokerManager.js";
import {
  evaluateRemoteGraphicalLiveBrokerReadiness,
} from "../src/remoteGraphicalLiveBrokerReadiness.js";
import {
  decideRemoteGraphicalSessionOpenRouteInvocation,
} from "../src/remoteGraphicalSessionOpenRouteGate.js";

test("RemoteGraphicalLiveBrokerManager composes with readiness without starting helper transport", () => {
  const manager = new RemoteGraphicalLiveBrokerManager({
    binaryPath: "/not/used/by/readiness",
  });
  const readiness = evaluateRemoteGraphicalLiveBrokerReadiness({
    broker: manager,
    brokerStatus: configuredLiveStatus(),
    manifest: liveManifest(),
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.candidate, true);
  assert.equal(readiness.activation_enabled, false);
  assert.equal(readiness.readiness, "activation_guard_disabled");
  assert.deepEqual(readiness.missing_methods, []);
  assert.equal(readiness.broker_called, false);
  assert.equal(readiness.session_opened, false);
  assert.equal(readiness.live_transport_used, false);
});

test("ready manager-shaped broker still cannot invoke the live route without the route switch", () => {
  const manager = new RemoteGraphicalLiveBrokerManager({
    binaryPath: "/not/used/by/readiness",
  });
  const readiness = evaluateRemoteGraphicalLiveBrokerReadiness({
    broker: manager,
    brokerStatus: configuredLiveStatus(),
    manifest: liveManifest(),
    activationEnabled: true,
  });
  const decision = decideRemoteGraphicalSessionOpenRouteInvocation({
    broker: manager,
    brokerStatus: configuredLiveStatus(),
    liveReadiness: readiness,
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.candidate, true);
  assert.equal(readiness.activation_enabled, true);
  assert.equal(readiness.broker_called, false);
  assert.equal(decision.route_mode, "refusal");
  assert.equal(decision.refusal, "live_route_invocation_disabled");
  assert.equal(decision.invoke_live, false);
  assert.equal(decision.broker_called, false);
  assert.equal(decision.session_opened, false);
  assert.equal(decision.live_transport_used, false);
});

function configuredLiveStatus() {
  return {
    requested: true,
    enabled: true,
    configured: true,
    provider: "soma.provider.remote_desktop.sunshine",
    target_host: "soma-agent-desktop.local.sthnet.org",
    manifest_loaded: true,
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
