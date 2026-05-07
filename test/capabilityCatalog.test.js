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

