import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRuntimeProfiles,
  publicRuntimeProfiles,
} from "../src/runtimeProfiles.js";

test("runtime profiles expose visual attachment preflight ceilings", async () => {
  const profiles = await loadRuntimeProfiles();
  const publicProfiles = publicRuntimeProfiles(profiles);

  const local = publicProfiles.profiles.find((profile) => profile.id === "gemma4-local");
  assert.equal(local.max_visual_attachments_per_turn, 64);
  assert.equal(local.max_visual_bytes_per_turn, 33_554_432);

  const remote = publicProfiles.profiles.find((profile) => profile.id === "claude-remote");
  assert.equal(remote.max_visual_attachments_per_turn, 16);
  assert.equal(remote.max_visual_bytes_per_turn, 8_388_608);
});
