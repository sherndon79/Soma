import assert from "node:assert/strict";
import test from "node:test";

import {
  createDesktopActuationTable,
  desktopActRefInvalidCode,
} from "../src/desktopActuationTable.js";

function binding(overrides = {}) {
  return {
    episode_id: "episode-1",
    grant_id: "grant-inspect",
    provider_id: "provider.synthetic",
    domain: "testing",
    family: "text",
    ...overrides,
  };
}

function mintTextRef(table, overrides = {}) {
  const generation = table.startGeneration(binding(overrides.binding));
  const actRef = table.mint({
    generation,
    role: "text",
    window_index: 0,
    op_class: "text_input",
    act_kind: "text_set",
    locator: { service: ":1.2", path: "/buffer" },
    ...overrides.mint,
  });
  return { generation, actRef };
}

function resolveTextRef(table, actRef, overrides = {}) {
  return table.resolve({
    ...binding(),
    act_ref: actRef,
    op_class: "text_input",
    ...overrides,
  });
}

test("desktop actuation table collapses invalid refs with distinct internal categories", () => {
  let currentNow = 1_000;
  let counter = 0;
  const table = createDesktopActuationTable({
    now: () => currentNow,
    random: () => `${(++counter).toString(16).padStart(32, "0")}`,
    ttlMs: 100,
  });

  const { actRef: staleRef } = mintTextRef(table);
  mintTextRef(table);
  assert.deepEqual(resolveTextRef(table, staleRef), {
    allowed: false,
    code: "stale_generation",
    external_code: desktopActRefInvalidCode(),
    entry: null,
  });

  const { actRef: expiredRef } = mintTextRef(table);
  currentNow += 101;
  assert.equal(resolveTextRef(table, expiredRef).code, "expired_ref");
  assert.equal(resolveTextRef(table, "unknown").code, "unknown_ref");

  const { actRef } = mintTextRef(table);
  assert.equal(resolveTextRef(table, actRef, { episode_id: "episode-2" }).code, "episode_mismatch");
  assert.equal(resolveTextRef(table, actRef, { grant_id: "grant-other" }).code, "grant_mismatch");
  assert.equal(resolveTextRef(table, actRef, { provider_id: "provider.other" }).code, "provider_mismatch");
  assert.equal(resolveTextRef(table, actRef, { domain: "other" }).code, "domain_mismatch");
  assert.equal(resolveTextRef(table, actRef, { family: "windows" }).code, "family_mismatch");
  assert.equal(resolveTextRef(table, actRef, { op_class: "invoke_action" }).code, "op_class_mismatch");
});

test("desktop actuation table cleanup clears episode grant and generation refs", () => {
  let counter = 0;
  const table = createDesktopActuationTable({
    random: () => `${(++counter).toString(16).padStart(32, "0")}`,
  });

  const episodeRef = mintTextRef(table).actRef;
  table.clearEpisode("episode-1");
  assert.equal(resolveTextRef(table, episodeRef).code, "unknown_ref");

  const grantRef = mintTextRef(table).actRef;
  table.clearGrant("grant-inspect");
  assert.equal(resolveTextRef(table, grantRef).code, "unknown_ref");

  const { generation, actRef: generationRef } = mintTextRef(table);
  table.clearGeneration(generation);
  assert.equal(resolveTextRef(table, generationRef).code, "unknown_ref");
});

test("desktop actuation table enforces handle and generation caps", () => {
  let counter = 0;
  const table = createDesktopActuationTable({
    random: () => `${(++counter).toString(16).padStart(32, "0")}`,
  });

  const generation = table.startGeneration(binding());
  for (let index = 0; index < 64; index += 1) {
    assert.match(table.mint({
      generation,
      role: "text",
      op_class: "text_input",
      act_kind: "text_set",
      locator: { service: ":1.2", path: `/buffer-${index}` },
    }), /^[0-9a-f]{32}$/);
  }
  assert.equal(table.mint({
    generation,
    role: "text",
    op_class: "text_input",
    act_kind: "text_set",
    locator: { service: ":1.2", path: "/buffer-overflow" },
  }), null);

  const capped = createDesktopActuationTable({
    random: () => `${(++counter).toString(16).padStart(32, "0")}`,
  });
  const first = mintTextRef(capped).actRef;
  for (let index = 0; index < 32; index += 1) {
    mintTextRef(capped);
  }
  assert.equal(resolveTextRef(capped, first).code, "unknown_ref");
});

test("desktop actuation table enforces text bounds and operation rate", () => {
  let currentNow = 10_000;
  const table = createDesktopActuationTable({ now: () => currentNow });

  assert.equal(table.recordOperation({
    episode_id: "episode-1",
    op_class: "text_input",
    text: "x".repeat(501),
  }).code, "bounds_exceeded");

  for (let index = 0; index < 10; index += 1) {
    assert.equal(table.recordOperation({
      episode_id: "episode-1",
      op_class: "text_input",
      text: "x".repeat(500),
    }).allowed, true);
  }
  assert.equal(table.recordOperation({
    episode_id: "episode-1",
    op_class: "text_input",
    text: "x",
  }).code, "bounds_exceeded");

  const rateTable = createDesktopActuationTable({ now: () => currentNow });
  for (let index = 0; index < 12; index += 1) {
    assert.equal(rateTable.recordOperation({
      episode_id: "episode-2",
      op_class: "invoke_action",
    }).allowed, true);
  }
  assert.equal(rateTable.recordOperation({
    episode_id: "episode-2",
    op_class: "invoke_action",
  }).code, "rate_limited");

  currentNow += 60_001;
  assert.equal(rateTable.recordOperation({
    episode_id: "episode-2",
    op_class: "invoke_action",
  }).allowed, true);
});
