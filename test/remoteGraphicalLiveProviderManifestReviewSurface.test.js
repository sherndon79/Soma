import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  remoteGraphicalLiveProviderManifestReviewText,
} from "../src/remoteGraphicalLiveProviderManifestReviewSurface.js";

test("remoteGraphicalLiveProviderManifestReviewText summarizes fixture without activation", async () => {
  const fixture = await readFixture();
  const text = remoteGraphicalLiveProviderManifestReviewText(fixture);

  assert.match(text, /Remote graphical live provider manifest/);
  assert.match(text, /provider: soma\.provider\.remote_desktop\.sunshine/);
  assert.match(text, /manifest version: soma\.remote_graphical\.provider_manifest\.v1/);
  assert.match(text, /provider contract: soma\.remote_graphical\.broker\.v1/);
  assert.match(text, /runtime: remote-graphical-session/);
  assert.match(text, /implementation: broker=moonlight-client-broker transport=sunshine-moonlight construction=explicit-runtime-injection/);
  assert.match(text, /default enabled: no/);
  assert.match(text, /runtime opt-ins: SOMA_REMOTE_GRAPHICAL_ENABLED=1, SOMA_REMOTE_GRAPHICAL_PROVIDER=soma\.provider\.remote_desktop\.sunshine/);
  assert.match(text, /target hosts: soma-agent-desktop\.local\.sthnet\.org/);
  assert.match(text, /locality: lan/);
  assert.match(text, /attended required: yes/);
  assert.match(text, /rollback: graphical lab base snapshot or documented host rollback/);
  assert.match(text, /supported actions: .*status\(grant=no,user=unknown,review=unknown,live_transport=no\)/);
  assert.match(text, /open_session\(grant=yes,user=yes,review=yes,live_transport=yes,must_not_enable=video\/input\/recording\/model_delivery\)/);
  assert.match(text, /cleanup_for_grant\(grant=yes,user=unknown,review=unknown,live_transport=unknown\)/);
  assert.match(text, /disabled authorities: .*pairing.*video_observation.*keyboard_input.*model_visual_delivery.*durable_grant_writes/);
  assert.match(text, /review only: yes/);
  assert.match(text, /runtime loaded: no/);
  assert.match(text, /provider registry entry: no/);
  assert.match(text, /broker construction: no/);
  assert.match(text, /activation blockers: not in provider registry; not loaded by server startup; no broker construction/);
  assert.match(text, /activation boundary: manifest review is not live transport, pairing, observation, input, recording, grant write, or model delivery/);
});

test("remoteGraphicalLiveProviderManifestReviewText rejects invalid manifests before formatting", async () => {
  const fixture = await readFixture();

  assert.throws(
    () => remoteGraphicalLiveProviderManifestReviewText({
      ...fixture,
      default_enabled: true,
    }),
    {
      code: "invalid_remote_graphical_live_provider_manifest",
    },
  );
});

async function readFixture() {
  return JSON.parse(await readFile(
    new URL("../docs/fixtures/remote-graphical-live-provider-manifest.json", import.meta.url),
    "utf8",
  ));
}
