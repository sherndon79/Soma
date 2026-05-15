import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapabilityView,
  loadCapabilityCatalog,
  loadProviderRegistry,
} from "../src/capabilityCatalog.js";

test("capability view exposes provider contract metadata from registry claims", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const focus = view.capabilities.find((capability) => capability.key === "desktop.inspect.focus");
  assert.equal(focus.provider_contract, "soma.desktop.inspect.focus.v1");
  assert.equal(focus.status, "requestable");
  assert.equal(focus.providers.length, 1);
  assert.equal(focus.providers[0].id, "soma.provider.desktop-broker");
  assert.equal(focus.providers[0].provider_contract, "soma.desktop.inspect.focus.v1");
  assert.equal(focus.providers[0].output_schema, "soma.desktop.inspect.focus.response.v1");

  const tree = view.capabilities.find((capability) => capability.key === "desktop.inspect.accessibility_tree");
  assert.equal(tree.provider_contract, "soma.desktop.inspect.accessibility_tree.v1");
  assert.equal(tree.providers[0].provider_contract, "soma.desktop.inspect.accessibility_tree.v1");
  assert.equal(tree.providers[0].output_schema, "docs/schemas/desktop-inspection-result.schema.json");
});

test("capability view keeps remote planning unsupported until a provider is registered", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const remotePlan = view.capabilities.find((capability) => capability.key === "model.remote.plan");
  assert.equal(remotePlan.provider_contract, "soma.model.remote.plan.v1");
  assert.equal(remotePlan.harness_status, "disabled");
  assert.equal(remotePlan.status, "unsupported");
  assert.equal(remotePlan.support_status, "unsupported");
  assert.deepEqual(remotePlan.providers, []);
  assert.equal(remotePlan.activation_policy, "explicit_grant");
});

// ── Sensorium subscription capabilities (catalog-only, disabled-first) ──────
//
// These entries are step 3 of the disabled-first sequence documented in
// docs/concepts/drafts/sensorium_integration.md: catalog fixtures with
// default_status="disabled", no provider registered yet, public path
// must stay fail-closed until later slices wire activation gates.
//
// The test below pins the load-bearing facts of those entries so a future
// change cannot silently drop one, downgrade its risk class, or flip
// default_status to "allowed" before the rest of the sequence is in
// place.

test("Sensorium subscription capabilities are catalogued as disabled, unsupported, per-class risk", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const expected = [
    { key: "perception.sensorium.color.subscribe",    risk: "high",      contract: "soma.perception.sensorium.color.v1" },
    { key: "perception.sensorium.depth.subscribe",    risk: "high",      contract: "soma.perception.sensorium.depth.v1" },
    { key: "perception.sensorium.imu.subscribe",      risk: "sensitive", contract: "soma.perception.sensorium.imu.v1" },
    { key: "perception.sensorium.location.subscribe", risk: "sensitive", contract: "soma.perception.sensorium.location.v1" },
    { key: "perception.sensorium.status.subscribe",   risk: "low",       contract: "soma.perception.sensorium.status.v1" },
  ];

  for (const want of expected) {
    const cap = view.capabilities.find((c) => c.key === want.key);
    assert.ok(cap, `expected capability ${want.key} to be present in catalog`);
    assert.equal(cap.category, "perception");
    assert.equal(cap.risk_class, want.risk);
    assert.equal(cap.harness_status, "disabled");
    assert.equal(cap.status, "unsupported"); // no provider yet
    assert.equal(cap.support_status, "unsupported");
    assert.deepEqual(cap.providers, []);
    assert.equal(cap.activation_policy, "explicit_grant");
    assert.equal(cap.provider_contract, want.contract);
    assert.equal(cap.reversible, false);
    assert.ok(
      Array.isArray(cap.allowed_scopes) && cap.allowed_scopes.length >= 1,
      `expected ${want.key} to declare at least one scope`,
    );
    assert.ok(
      Array.isArray(cap.data_exposed) && cap.data_exposed.length >= 1,
      `expected ${want.key} to declare its data_exposed surface`,
    );
    assert.ok(
      Array.isArray(cap.excluded_by_default) && cap.excluded_by_default.length >= 1,
      `expected ${want.key} to declare its excluded_by_default surface`,
    );
  }
});
