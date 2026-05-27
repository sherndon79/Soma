import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseCli, runCli } from "../src/cli.js";

const EXAMPLE_FIXTURE_PATH = new URL(
  "../docs/fixtures/remote-graphical-startup-review-output.example.json",
  import.meta.url,
);
const HELPER_BINARY_SUFFIX = "/target/debug/soma-moonlight-broker";
const PORTABLE_HELPER_BINARY_PATH = "<repo-root>/target/debug/soma-moonlight-broker";

test("remote graphical startup-review JSON example matches current CLI output shape", async () => {
  const fixture = JSON.parse(await readFile(EXAMPLE_FIXTURE_PATH, "utf8"));
  const payload = normalizeStartupReviewForFixture(await runStartupReviewJsonCli());

  assert.deepEqual(payload, fixture);
});

test("remote graphical startup-review JSON example preserves non-activation flags", async () => {
  const fixture = JSON.parse(await readFile(EXAMPLE_FIXTURE_PATH, "utf8"));

  assert.equal(fixture.type, "remote_graphical_live_broker_startup_review");
  assert.equal(fixture.review_only, true);
  assert.equal(fixture.plan.eligible, true);
  assert.equal(fixture.plan.eligibility, "eligible");
  assert.equal(fixture.plan.reviewed_helper_binary_path, true);

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
    assert.equal(fixture[flag], false);
  }

  for (const flag of [
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
    assert.equal(fixture.plan[flag], false);
  }
});

async function runStartupReviewJsonCli() {
  let called = false;
  const writes = [];
  const code = await runCli(parseCli([
    "node",
    "soma",
    "remote-graphical",
    "startup-review",
    "--json",
  ]), {
    stdout: { write: (value) => writes.push(value) },
    request: async () => {
      called = true;
      throw new Error("request should not be called");
    },
  });

  assert.equal(code, 0);
  assert.equal(called, false);
  return JSON.parse(writes.join(""));
}

function normalizeStartupReviewForFixture(payload) {
  const normalized = structuredClone(payload);
  assert.equal(typeof normalized.plan.helper_binary_path, "string");
  assert.equal(normalized.plan.helper_binary_path.endsWith(HELPER_BINARY_SUFFIX), true);
  normalized.plan.helper_binary_path = PORTABLE_HELPER_BINARY_PATH;
  return normalized;
}
