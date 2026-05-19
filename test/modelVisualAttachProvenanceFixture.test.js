import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FIXTURE_URL = new URL("../docs/fixtures/model-visual-attach-provenance-summary.json", import.meta.url);

test("model visual attach provenance fixture documents byte-free candidate fields", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_URL, "utf8"));
  const event = fixture.event_fields;

  assert.equal(fixture.status, "future_fixture_not_current_delivery");
  assert.equal(event.event_type, "model.context.visual.grant_candidate_built");
  assert.equal(event.capability, "model.context.visual.color.attach");
  assert.equal(event.scope, "once");
  assert.equal(event.preview_acknowledged, true);
  assert.equal(event.retention_mode, "none");
  assert.equal(event.payload_retained, false);
  assert.equal(event.payload_bytes_included, false);
  assert.equal(event.model_delivery_performed, false);
  assert.equal(event.payload_attached, false);

  for (const forbidden of fixture.must_not_include) {
    assert.equal(
      Object.hasOwn(event, forbidden),
      false,
      `fixture event must not include ${forbidden}`,
    );
  }
});
