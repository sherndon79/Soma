import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseCli, runCli } from "../src/cli.js";

const RUNBOOK_PATH = "docs/runbooks/remote_graphical_startup_review.md";

test("remote graphical startup-review runbook documents local commands and source guards", async () => {
  const runbook = await readFile(RUNBOOK_PATH, "utf8");

  for (const marker of [
    "npm run cli -- remote-graphical startup-review",
    "npm run cli -- remote-graphical startup-review --json",
    "This is a CLI-only operator automation surface.",
    "`/remote-graphical/startup-review` HTTP route",
    "docs/fixtures/remote-graphical-live-provider-manifest.json",
    "usage_error: remote-graphical startup-review does not accept --manifest-path",
    "usage_error: remote-graphical startup-review does not accept --helper-binary",
    "usage_error: remote-graphical startup-review does not accept manifest paths or positional source inputs",
  ]) {
    assert.match(runbook, escapedPattern(marker));
  }
});

test("remote graphical startup-review runbook text markers match CLI output", async () => {
  const runbook = await readFile(RUNBOOK_PATH, "utf8");
  const output = await runStartupReviewCli();

  for (const marker of [
    "Remote graphical live broker startup review",
    "review only: yes",
    "eligible: yes",
    "eligibility: eligible",
    "provider: soma.provider.remote_desktop.sunshine",
    "target host: soma-agent-desktop.local.sthnet.org",
    "manifest loaded: yes",
    "helper binary reviewed: yes",
    "manager constructed: no",
    "helper started: no",
    "broker called: no",
    "session opened: no",
    "live transport used: no",
  ]) {
    assert.match(runbook, escapedPattern(marker));
    assert.match(output, escapedPattern(marker));
  }
});

test("remote graphical startup-review runbook JSON false flags match CLI output", async () => {
  const runbook = await readFile(RUNBOOK_PATH, "utf8");
  const payload = JSON.parse(await runStartupReviewCli(["--json"]));

  for (const flag of [
    "runtime_loaded",
    "manager_constructed",
    "helper_started",
    "broker_called",
    "session_opened",
    "pairing_performed",
    "video_attached",
    "input_dispatched",
    "recording_started",
    "provider_session_stopped",
    "model_delivery",
    "live_transport_used",
  ]) {
    assert.match(runbook, new RegExp(`"${flag}": false`));
    assert.equal(payload[flag], false);
  }

  for (const flag of [
    "manager_constructed",
    "helper_started",
    "broker_called",
    "session_opened",
    "live_transport_used",
  ]) {
    assert.match(runbook, new RegExp(`"${flag}": false`));
    assert.equal(payload.plan[flag], false);
  }
});

async function runStartupReviewCli(extraArgs = []) {
  let called = false;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "startup-review",
    ...extraArgs,
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => {
      called = true;
      throw new Error("request should not be called");
    },
  });

  assert.equal(code, 0);
  assert.equal(called, false);
  return writes.join("");
}

function escapedPattern(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
