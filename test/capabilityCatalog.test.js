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

// ── Sensorium subscription capabilities (disabled-first integration) ───────
//
// Tests below pin the load-bearing facts of the Sensorium capability
// entries and provider claim documented in
// docs/concepts/drafts/sensorium_integration.md. The assertions guard
// against silent drift: dropping an entry, downgrading a risk class,
// flipping default_status to "allowed", or accidentally promoting
// harness_status when a provider claim exists.

const SENSORIUM_CAPABILITIES = [
  { key: "perception.sensorium.color.subscribe",    risk: "high",      contract: "soma.perception.sensorium.color.v1" },
  { key: "perception.sensorium.depth.subscribe",    risk: "high",      contract: "soma.perception.sensorium.depth.v1" },
  { key: "perception.sensorium.imu.subscribe",      risk: "sensitive", contract: "soma.perception.sensorium.imu.v1" },
  { key: "perception.sensorium.location.subscribe", risk: "sensitive", contract: "soma.perception.sensorium.location.v1" },
  { key: "perception.sensorium.status.subscribe",   risk: "low",       contract: "soma.perception.sensorium.status.v1" },
];

test("Sensorium subscription capabilities are catalogued with the disabled-first shape", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  for (const want of SENSORIUM_CAPABILITIES) {
    const cap = view.capabilities.find((c) => c.key === want.key);
    assert.ok(cap, `expected capability ${want.key} to be present in catalog`);
    assert.equal(cap.category, "perception");
    assert.equal(cap.risk_class, want.risk);
    assert.equal(cap.harness_status, "disabled");
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

test("Sensorium provider registry claim makes capabilities requestable without activating them", async () => {
  // The Sensorium provider entry claims the five subscription
  // capability contracts and the helper is implemented, but provider
  // availability is not grant authority. The capability view should
  // report:
  //   support_status = "supported"   (provider claims the contract)
  //   status         = "requestable" (eligible for proposal)
  //   harness_status = "disabled"    (provider claim is not activation)
  // This is the "approval is not activation" / "provider availability
  // is not permission" load-bearing rule from AGENTS.md, made visible
  // in test assertions.

  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const sensoriumProvider = providerRegistry.providers.find(
    (p) => p.id === "soma.provider.sensorium.jetsorano",
  );
  assert.ok(sensoriumProvider, "expected Sensorium provider entry to be present");
  assert.equal(sensoriumProvider.runtime, "zenoh-subscriber");
  assert.equal(sensoriumProvider.local_only, false);
  assert.equal(sensoriumProvider.network_access, true);
  assert.deepEqual(sensoriumProvider.requires, [
    "soma-sensor-broker",
    "zenoh client transport",
  ]);
  assert.equal(
    sensoriumProvider.capabilities.length,
    SENSORIUM_CAPABILITIES.length,
    "expected Sensorium provider to claim all five capability contracts",
  );

  for (const want of SENSORIUM_CAPABILITIES) {
    const cap = view.capabilities.find((c) => c.key === want.key);
    assert.ok(cap, `expected capability ${want.key} to be present in view`);

    assert.equal(cap.harness_status, "disabled", `${want.key}: provider claim must not activate harness`);
    assert.equal(cap.status, "requestable", `${want.key}: status should be requestable now that a provider claims it`);
    assert.equal(cap.support_status, "supported", `${want.key}: provider claim should make support_status = supported`);
    assert.equal(cap.providers.length, 1, `${want.key}: expected exactly one provider claim`);
    assert.equal(cap.providers[0].id, "soma.provider.sensorium.jetsorano");
    assert.equal(cap.providers[0].provider_contract, want.contract);
  }
});

test("Sensorium catalog exposes subscriptions without model-facing visual delivery", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const sensoriumCapabilities = view.capabilities.filter((capability) =>
    capability.key.startsWith("perception.sensorium."),
  );
  assert.equal(sensoriumCapabilities.length, SENSORIUM_CAPABILITIES.length);

  for (const capability of sensoriumCapabilities) {
    assert.ok(
      capability.key.endsWith(".subscribe"),
      `${capability.key} should remain a subscription capability, not a delivery capability`,
    );
    assert.doesNotMatch(capability.key, /deliver|route|model|visual_context|screenshot|record/);
    assert.equal(capability.status, "requestable");
    assert.equal(capability.harness_status, "disabled");
  }
});

const MODEL_VISUAL_ATTACH_CAPABILITIES = [
  {
    key: "model.context.visual.color.attach",
    contract: "soma.model.context.visual.color.attach.v1",
  },
  {
    key: "model.context.visual.depth.attach",
    contract: "soma.model.context.visual.depth.attach.v1",
  },
  {
    key: "model.context.visual.composite.attach",
    contract: "soma.model.context.visual.composite.attach.v1",
  },
];

test("model-facing visual attach capabilities are requestable without activating delivery", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  for (const want of MODEL_VISUAL_ATTACH_CAPABILITIES) {
    const cap = view.capabilities.find((c) => c.key === want.key);
    assert.ok(cap, `expected capability ${want.key} to be present in catalog`);
    assert.equal(cap.category, "model");
    assert.equal(cap.risk_class, "high");
    assert.equal(cap.harness_status, "disabled");
    assert.equal(cap.status, "requestable");
    assert.equal(cap.support_status, "supported");
    assert.deepEqual(cap.allowed_scopes, ["once"]);
    assert.equal(cap.activation_policy, "explicit_grant");
    assert.equal(cap.reversible, false);
    assert.equal(cap.provider_contract, want.contract);
    assert.equal(cap.providers.length, 1);
    assert.equal(cap.providers[0].id, "soma.provider.local-model");
    assert.equal(cap.providers[0].provider_contract, want.contract);
    assert.equal(cap.providers[0].output_schema, "soma.model.context.visual.attach.proposal.v1");
    assert.ok(cap.excluded_by_default.includes("background delivery without preview"));
  }
});
