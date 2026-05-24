import assert from "node:assert/strict";
import test from "node:test";

import { loadCapabilityCatalog, loadProviderRegistry } from "../src/capabilityCatalog.js";
import { buildRemoteGraphicalProposalTemplate } from "../src/remoteGraphicalProposalTemplate.js";

const PROVIDER = "soma.provider.remote_desktop.sunshine";
const HOST = "soma-agent-desktop.local.sthnet.org";

test("buildRemoteGraphicalProposalTemplate produces a non-activating view-only proposal", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  const template = buildRemoteGraphicalProposalTemplate({
    capability: "perception.remote_desktop.video.subscribe",
    provider: PROVIDER,
    target_host: HOST,
    mode: "view_only",
    reason: "Observe a bounded graphical lab session.",
    constraints: {
      max_seconds: 120,
      max_fps: 30,
      max_width: 1280,
      max_height: 720,
    },
    catalog,
    providerRegistry,
  });

  assert.equal(template.type, "remote_graphical_session_proposal_template");
  assert.equal(template.activation_performed, false);
  assert.equal(template.durable, false);
  assert.equal(template.writable, false);
  assert.equal(template.proposal.capability, "perception.remote_desktop.video.subscribe");
  assert.equal(template.review.authority, "video");
  assert.deepEqual(template.review.requested_channels, ["video"]);
  assert.ok(template.review.excluded_channels.includes("keyboard"));
  assert.ok(template.review.excluded_channels.includes("pointer"));
  assert.equal(template.grant_intent.provider, PROVIDER);
  assert.equal(template.grant_intent.constraints.max_width, 1280);
  assert.equal(template.grant_intent.constraints.max_height, 720);
});

test("buildRemoteGraphicalProposalTemplate validates pointer keyboard and disconnect modes separately", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();
  const cases = [
    ["desktop.remote.input.pointer", "pointer_input", "pointer"],
    ["desktop.remote.input.keyboard", "keyboard_input", "keyboard"],
    ["desktop.remote.session.disconnect", "disconnect", "disconnect"],
  ];

  for (const [capability, mode, authority] of cases) {
    const template = buildRemoteGraphicalProposalTemplate({
      capability,
      provider: PROVIDER,
      target_host: HOST,
      mode,
      reason: `Request ${authority} for graphical lab.`,
      constraints: { max_seconds: 30 },
      catalog,
      providerRegistry,
    });

    assert.equal(template.review.authority, authority);
    assert.deepEqual(template.review.requested_channels, [authority]);
    assert.equal(template.grant_intent.constraints.mode, mode);
    assert.equal(template.activation_performed, false);
  }
});

test("buildRemoteGraphicalProposalTemplate rejects cross-channel authority overreach", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  assert.throws(
    () => buildRemoteGraphicalProposalTemplate({
      capability: "perception.remote_desktop.video.subscribe",
      provider: PROVIDER,
      target_host: HOST,
      mode: "view_only",
      reason: "Observe and type into graphical lab.",
      requested_channels: ["video", "keyboard"],
      constraints: {
        max_seconds: 120,
        max_fps: 30,
        max_width: 1280,
        max_height: 720,
      },
      catalog,
      providerRegistry,
    }),
    (error) => {
      assert.equal(error.code, "invalid_remote_graphical_proposal_template");
      assert.ok(error.validation_errors.includes("requested_channels.keyboard is not authorized by view_only"));
      return true;
    },
  );
});

test("buildRemoteGraphicalProposalTemplate rejects malformed target provider and constraints", async () => {
  const catalog = await loadCapabilityCatalog();
  const providerRegistry = await loadProviderRegistry();

  assert.throws(
    () => buildRemoteGraphicalProposalTemplate({
      capability: "desktop.remote.input.pointer",
      provider: "soma.provider.sensorium.jetsorano",
      target_host: "bad host",
      mode: "pointer_input",
      reason: "",
      constraints: {
        max_seconds: 0,
        max_fps: 30,
      },
      catalog,
      providerRegistry,
    }),
    (error) => {
      assert.equal(error.code, "invalid_remote_graphical_proposal_template");
      assert.ok(error.validation_errors.includes("reason is required"));
      assert.ok(error.validation_errors.includes("target_host must be a hostname-like identifier"));
      assert.ok(error.validation_errors.includes("provider \"soma.provider.sensorium.jetsorano\" does not support desktop.remote.input.pointer"));
      assert.ok(error.validation_errors.includes("constraints.max_seconds must be an integer from 1 to 3600"));
      assert.ok(error.validation_errors.includes("constraints.max_fps is not allowed for pointer authority"));
      return true;
    },
  );
});
