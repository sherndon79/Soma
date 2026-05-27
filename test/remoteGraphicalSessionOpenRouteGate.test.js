import test from "node:test";
import assert from "node:assert/strict";

import {
  decideRemoteGraphicalSessionOpenRouteInvocation,
} from "../src/remoteGraphicalSessionOpenRouteGate.js";

test("decideRemoteGraphicalSessionOpenRouteInvocation allows current fixture path only when complete", () => {
  const decision = decideRemoteGraphicalSessionOpenRouteInvocation({
    broker: { openSession() {} },
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
      session_open_fixture: true,
    },
  });

  assert.equal(decision.route_mode, "fixture_session_open");
  assert.equal(decision.invoke_fixture, true);
  assert.equal(decision.invoke_live, false);
  assert.equal(decision.broker_called, false);
  assert.equal(decision.live_transport_used, false);
});

test("decideRemoteGraphicalSessionOpenRouteInvocation refuses incomplete fixture brokers", () => {
  const decision = decideRemoteGraphicalSessionOpenRouteInvocation({
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
      session_open_fixture: true,
    },
  });

  assert.equal(decision.route_mode, "refusal");
  assert.equal(decision.refusal, "fixture_broker_contract_incomplete");
  assert.equal(decision.invoke_fixture, false);
});

test("decideRemoteGraphicalSessionOpenRouteInvocation keeps live candidate behind activation guard", () => {
  const decision = decideRemoteGraphicalSessionOpenRouteInvocation({
    broker: { openSession() {} },
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
    },
    liveReadiness: {
      candidate: true,
      ready: false,
      readiness: "activation_guard_disabled",
    },
  });

  assert.equal(decision.route_mode, "refusal");
  assert.equal(decision.refusal, "live_activation_guard_disabled");
  assert.equal(decision.live_candidate, true);
  assert.equal(decision.invoke_live, false);
  assert.equal(decision.broker_called, false);
  assert.equal(decision.session_opened, false);
});

test("decideRemoteGraphicalSessionOpenRouteInvocation refuses ready live broker unless route switch is explicit", () => {
  const decision = decideRemoteGraphicalSessionOpenRouteInvocation({
    broker: { openSession() {} },
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
    },
    liveReadiness: {
      candidate: true,
      ready: true,
      readiness: "ready",
    },
  });

  assert.equal(decision.route_mode, "refusal");
  assert.equal(decision.refusal, "live_route_invocation_disabled");
  assert.equal(decision.live_ready, true);
  assert.equal(decision.invoke_live, false);
});

test("decideRemoteGraphicalSessionOpenRouteInvocation exposes future live route decision only with explicit switch", () => {
  const decision = decideRemoteGraphicalSessionOpenRouteInvocation({
    broker: { openSession() {} },
    brokerStatus: {
      requested: true,
      enabled: true,
      configured: true,
    },
    liveReadiness: {
      candidate: true,
      ready: true,
      readiness: "ready",
    },
    allowLiveRouteInvocation: true,
  });

  assert.equal(decision.route_mode, "live_session_open");
  assert.equal(decision.invoke_fixture, false);
  assert.equal(decision.invoke_live, true);
  assert.equal(decision.activation_performed, false);
  assert.equal(decision.broker_called, false);
  assert.equal(decision.live_transport_used, false);
});

test("decideRemoteGraphicalSessionOpenRouteInvocation defaults to refusal without invokable paths", () => {
  const decision = decideRemoteGraphicalSessionOpenRouteInvocation();

  assert.equal(decision.route_mode, "refusal");
  assert.equal(decision.refusal, "broker_not_invokable");
  assert.equal(decision.invoke_fixture, false);
  assert.equal(decision.invoke_live, false);
});
