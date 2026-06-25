import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapabilityView,
  loadCapabilityCatalog,
  loadProviderRegistry,
  normalizeCapabilityCatalog,
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
  assert.equal(tree.risk_class, "sensitive");
  assert.equal(tree.activation_policy, "base_harness");
  assert.ok(tree.data_exposed.includes("authorized structure-only recursive role/count topology"));
  assert.ok(tree.excluded_by_default.includes("child names"));
  assert.ok(tree.excluded_by_default.includes("descriptions"));
  assert.ok(tree.excluded_by_default.includes("text content"));
  assert.ok(tree.excluded_by_default.includes("states"));
  assert.ok(tree.excluded_by_default.includes("actions"));
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

test("status snapshot read is explicit-grant and provider-backed", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const statusSnapshot = view.capabilities.find((capability) => capability.key === "status.snapshot.read");
  assert.ok(statusSnapshot, "expected status.snapshot.read to be present in catalog");
  assert.equal(statusSnapshot.category, "status");
  assert.equal(statusSnapshot.risk_class, "low");
  assert.equal(statusSnapshot.harness_status, "disabled");
  assert.equal(statusSnapshot.status, "requestable");
  assert.equal(statusSnapshot.activation_policy, "explicit_grant");
  assert.equal(statusSnapshot.reversible, true);
  assert.equal(statusSnapshot.provider_contract, "soma.status.snapshot.v1");
  assert.equal(statusSnapshot.providers.length, 1);
  assert.equal(statusSnapshot.providers[0].id, "soma.provider.status");
  assert.equal(statusSnapshot.providers[0].provider_contract, "soma.status.snapshot.v1");
});

test("space status read is explicit-grant occupant capability and provider-backed", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const spaceStatus = view.capabilities.find((capability) => capability.key === "space.status.read");
  assert.ok(spaceStatus, "expected space.status.read to be present in catalog");
  assert.equal(spaceStatus.category, "space");
  assert.equal(spaceStatus.risk_class, "low");
  assert.equal(spaceStatus.harness_status, "disabled");
  assert.equal(spaceStatus.status, "requestable");
  assert.equal(spaceStatus.activation_policy, "explicit_grant");
  assert.equal(spaceStatus.reversible, true);
  assert.equal(spaceStatus.provider_contract, "soma.space.status.read.v1");
  assert.ok(spaceStatus.data_exposed.includes("armed protective controls"));
  assert.ok(spaceStatus.excluded_by_default.includes("predecessor content"));
  assert.equal(spaceStatus.providers.length, 1);
  assert.equal(spaceStatus.providers[0].id, "soma.provider.status");
  assert.equal(spaceStatus.providers[0].provider_contract, "soma.space.status.read.v1");
});

test("space history read is explicit-grant occupant capability and provider-backed", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const spaceHistory = view.capabilities.find((capability) => capability.key === "space.history.read");
  assert.ok(spaceHistory, "expected space.history.read to be present in catalog");
  assert.equal(spaceHistory.category, "space");
  assert.equal(spaceHistory.risk_class, "sensitive");
  assert.equal(spaceHistory.harness_status, "disabled");
  assert.equal(spaceHistory.status, "requestable");
  assert.equal(spaceHistory.activation_policy, "explicit_grant");
  assert.equal(spaceHistory.reversible, true);
  assert.equal(spaceHistory.provider_contract, "soma.space.history.read.v1");
  assert.ok(spaceHistory.data_exposed.includes("approved same-domain curated history projection entries"));
  assert.ok(spaceHistory.excluded_by_default.includes("withheld entry counts"));
  assert.equal(spaceHistory.providers.length, 1);
  assert.equal(spaceHistory.providers[0].id, "soma.provider.history-projection");
  assert.equal(spaceHistory.providers[0].provider_contract, "soma.space.history.read.v1");
});

test("capability catalog rejects ambiguous base-harness authority", () => {
  assert.throws(
    () => normalizeCapabilityCatalog({
      capabilities: [
        {
          key: "example.unknown",
          activation_policy: "base_harness",
        },
      ],
    }),
    /capability "example\.unknown" has risk_class=unknown and must use activation_policy=explicit_grant or forbidden/,
  );
});

test("capability catalog rejects high-risk base-harness authority", () => {
  assert.throws(
    () => normalizeCapabilityCatalog({
      capabilities: [
        {
          key: "example.high",
          risk_class: "high",
          activation_policy: "base_harness",
        },
      ],
    }),
    /capability "example\.high" has risk_class=high and must use activation_policy=explicit_grant or forbidden/,
  );
});

test("capability catalog rejects unrecognized risk classes on light authority", () => {
  assert.throws(
    () => normalizeCapabilityCatalog({
      capabilities: [
        {
          key: "example.typo",
          risk_class: "sensitve",
          activation_policy: "base_harness",
        },
      ],
    }),
    /capability "example\.typo" has risk_class=sensitve and must use activation_policy=explicit_grant or forbidden/,
  );
});

test("capability catalog permits reviewed sensitive base-harness authority", () => {
  const catalog = normalizeCapabilityCatalog({
    capabilities: [
      {
        key: "example.sensitive",
        risk_class: "sensitive",
        activation_policy: "base_harness",
      },
    ],
  });

  assert.equal(catalog.capabilities.length, 1);
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

test("local sensorium tier exposes semantic events and visual cues as explicit-grant capabilities", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const semanticEvents = view.capabilities.find(
    (capability) => capability.key === "sensorium.semantic_events.read",
  );
  assert.equal(semanticEvents.category, "sensorium");
  assert.equal(semanticEvents.status, "requestable");
  assert.equal(semanticEvents.activation_policy, "explicit_grant");
  assert.equal(semanticEvents.providers[0].id, "soma.provider.sensorium-tier");
  assert.equal(
    semanticEvents.providers[0].provider_contract,
    "soma.sensorium.semantic_events.read.v1",
  );
  assert.ok(semanticEvents.excluded_by_default.includes("screenshots"));
  assert.ok(semanticEvents.excluded_by_default.includes("ambient semantic event persistence"));

  const visualCue = view.capabilities.find(
    (capability) => capability.key === "desktop.visual_cue.present",
  );
  assert.equal(visualCue.category, "desktop");
  assert.equal(visualCue.risk_class, "low");
  assert.equal(visualCue.status, "requestable");
  assert.equal(visualCue.activation_policy, "explicit_grant");
  assert.equal(visualCue.providers[0].id, "soma.provider.sensorium-tier");
  assert.equal(
    visualCue.providers[0].provider_contract,
    "soma.desktop.visual_cue.present.v1",
  );
  assert.ok(visualCue.excluded_by_default.includes("OS chrome mimicry"));
  assert.ok(visualCue.excluded_by_default.includes("cue content in provenance"));
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

const REMOTE_GRAPHICAL_CAPABILITIES = [
  {
    key: "perception.remote_desktop.video.subscribe",
    category: "perception",
    risk: "high",
    contract: "soma.perception.remote_desktop.video.v1",
  },
  {
    key: "desktop.remote.input.pointer",
    category: "desktop",
    risk: "high",
    contract: "soma.desktop.remote.input.pointer.v1",
  },
  {
    key: "desktop.remote.input.keyboard",
    category: "desktop",
    risk: "high",
    contract: "soma.desktop.remote.input.keyboard.v1",
  },
  {
    key: "desktop.remote.session.disconnect",
    category: "desktop",
    risk: "sensitive",
    contract: "soma.desktop.remote.session.disconnect.v1",
  },
];

test("remote graphical session capabilities are catalogued as disabled-first contracts", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  for (const want of REMOTE_GRAPHICAL_CAPABILITIES) {
    const cap = view.capabilities.find((c) => c.key === want.key);
    assert.ok(cap, `expected capability ${want.key} to be present in catalog`);
    assert.equal(cap.category, want.category);
    assert.equal(cap.risk_class, want.risk);
    assert.equal(cap.harness_status, "disabled");
    assert.equal(cap.status, "requestable");
    assert.equal(cap.support_status, "supported");
    assert.equal(cap.activation_policy, "explicit_grant");
    assert.equal(cap.reversible, false);
    assert.equal(cap.provider_contract, want.contract);
    assert.ok(
      Array.isArray(cap.excluded_by_default) && cap.excluded_by_default.length >= 1,
      `${want.key}: expected explicit exclusions`,
    );
  }
});

test("remote graphical provider claim does not collapse view input and disconnect authority", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const provider = providerRegistry.providers.find((p) => p.id === "soma.provider.remote_desktop.sunshine");
  assert.ok(provider, "expected remote graphical provider entry to be present");
  assert.equal(provider.runtime, "remote-graphical-session");
  assert.equal(provider.local_only, false);
  assert.equal(provider.network_access, true);
  assert.equal(provider.network_scope, "lan-sunshine-moonlight");

  for (const want of REMOTE_GRAPHICAL_CAPABILITIES) {
    const cap = view.capabilities.find((c) => c.key === want.key);
    assert.equal(cap.providers.length, 1, `${want.key}: expected exactly one provider claim`);
    assert.equal(cap.providers[0].id, "soma.provider.remote_desktop.sunshine");
    assert.equal(cap.providers[0].provider_contract, want.contract);
  }

  const video = view.capabilities.find((c) => c.key === "perception.remote_desktop.video.subscribe");
  const pointer = view.capabilities.find((c) => c.key === "desktop.remote.input.pointer");
  const keyboard = view.capabilities.find((c) => c.key === "desktop.remote.input.keyboard");
  const disconnect = view.capabilities.find((c) => c.key === "desktop.remote.session.disconnect");
  assert.ok(video.excluded_by_default.includes("keyboard input"));
  assert.ok(video.excluded_by_default.includes("pointer input"));
  assert.ok(pointer.excluded_by_default.includes("remote desktop video access"));
  assert.ok(pointer.excluded_by_default.includes("keyboard input"));
  assert.ok(keyboard.excluded_by_default.includes("remote desktop video access"));
  assert.ok(keyboard.excluded_by_default.includes("pointer input"));
  assert.ok(disconnect.excluded_by_default.includes("remote desktop video access"));
  assert.ok(disconnect.excluded_by_default.includes("keyboard input"));
});

test("comms fixture send is explicit-grant and fixture-only", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const view = buildCapabilityView({ catalog, providerRegistry });

  const comms = view.capabilities.find((capability) => capability.key === "comms.fixture.send");
  assert.ok(comms, "expected comms.fixture.send to be present in catalog");
  assert.equal(comms.category, "comms");
  assert.equal(comms.risk_class, "high");
  assert.equal(comms.harness_status, "disabled");
  assert.equal(comms.status, "requestable");
  assert.equal(comms.activation_policy, "explicit_grant");
  assert.equal(comms.reversible, false);
  assert.equal(comms.provider_contract, "soma.comms.fixture.send.v1");
  assert.ok(comms.excluded_by_default.includes("real external transmission"));
  assert.ok(comms.excluded_by_default.includes("Tier-0 no-touch sending"));
  assert.equal(comms.providers.length, 1);
  assert.equal(comms.providers[0].id, "soma.provider.comms-fixture");
  assert.equal(comms.providers[0].local_only, true);
  assert.equal(comms.providers[0].network_access, false);
  assert.equal(comms.providers[0].provider_contract, "soma.comms.fixture.send.v1");
});
