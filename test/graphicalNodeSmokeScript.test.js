import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GRAPHICAL_NODE_SMOKE,
  buildGraphicalNodeSmokePlan,
  formatCommand,
  parseGraphicalNodeSmokeArgs,
} from "../scripts/graphical-node-smoke.js";

test("graphical node smoke defaults to the current soma-agent-desktop lab", () => {
  const options = parseGraphicalNodeSmokeArgs([]);

  assert.equal(options.host, DEFAULT_GRAPHICAL_NODE_SMOKE.host);
  assert.equal(options.user, "sherndon");
  assert.equal(options.primusHost, "primus.local.sthnet.org");
  assert.equal(options.domain, "soma-agent-desktop");
  assert.equal(options.launchVkcube, false);
});

test("graphical node smoke supports explicit visible vkcube launch", () => {
  const options = parseGraphicalNodeSmokeArgs(["--launch-vkcube", "--vkcube-seconds", "10"]);
  const plan = buildGraphicalNodeSmokePlan(options);

  assert.equal(options.launchVkcube, true);
  assert.equal(options.vkcubeSeconds, 10);
  assert.ok(plan.some((step) => step.label === "launch visible Vulkan cube"));
  assert.ok(plan.at(-1).command.at(-1).includes("timeout 10s vkcube"));
});

test("graphical node smoke rejects unsafe host and domain tokens", () => {
  assert.throws(
    () => parseGraphicalNodeSmokeArgs(["--host", "host;rm"]),
    /--host contains unsupported characters/,
  );
  assert.throws(
    () => parseGraphicalNodeSmokeArgs(["--domain", "vm name"]),
    /--domain contains unsupported characters/,
  );
});

test("graphical node smoke validates vkcube duration", () => {
  assert.throws(
    () => parseGraphicalNodeSmokeArgs(["--vkcube-seconds", "0"]),
    /--vkcube-seconds must be an integer from 1 to 120/,
  );
  assert.throws(
    () => parseGraphicalNodeSmokeArgs(["--vkcube-seconds", "121"]),
    /--vkcube-seconds must be an integer from 1 to 120/,
  );
});

test("graphical node smoke plan keeps read-only checks before visible workload", () => {
  const plan = buildGraphicalNodeSmokePlan(parseGraphicalNodeSmokeArgs(["--launch-vkcube"]));
  const labels = plan.map((step) => step.label);

  assert.ok(labels.indexOf("check guest GPU and Sunshine state") < labels.indexOf("launch visible Vulkan cube"));
  assert.ok(labels.indexOf("check browser profile and keyring cleanliness") < labels.indexOf("launch visible Vulkan cube"));
});

test("graphical node smoke command formatter quotes compound commands", () => {
  assert.equal(formatCommand(["ssh", "host", "echo hello"]), 'ssh host "echo hello"');
});
