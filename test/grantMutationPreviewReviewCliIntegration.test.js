import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRequestHandler } from "../src/app.js";
import { parseCli, runCli } from "../src/cli.js";

const REVIEW_CASES_URL = new URL(
  "../docs/fixtures/grant-mutation-preview-review-cases.json",
  import.meta.url,
);

test("grants review-preview CLI formats fixture preview through the real handler", async () => {
  const fixture = JSON.parse(await readFile(REVIEW_CASES_URL, "utf8"));
  const grantStore = { schema_version: 1, grants: [], examples: [] };
  const handler = makeHandler({ grantStore });
  const { baseUrl, close } = await createHttpServer(handler);
  const writes = [];

  try {
    const code = await runCli(parseCli([
      "node",
      "soma",
      "grants",
      "review-preview",
      "--stdin",
      "--json",
      "--url",
      baseUrl,
    ]), {
      stdin: [JSON.stringify(fixture.accepted_case.preview)],
      stdout: { write: (value) => writes.push(value) },
    });

    const response = JSON.parse(writes.join(""));
    assert.equal(code, 0);
    assert.equal(response.review_only, true);
    assert.equal(response.dry_run, true);
    assert.equal(response.durable, false);
    assert.equal(response.grant_written, false);
    assert.equal(response.provenance_appended, false);
    assert.equal(response.activation_performed, false);
    assert.equal(response.subscription_activated, false);
    assert.equal(response.model_delivery_performed, false);
    assert.match(response.text, /Grant mutation preview/);
    assert.match(response.text, /mutation: grant\.created/);
    assert.match(response.text, /durable write: no/);
    for (const value of fixture.accepted_case.must_not_render) {
      assert.doesNotMatch(response.text, new RegExp(value));
    }
    assert.deepEqual(grantStore.grants, []);
  } finally {
    await close();
  }
});

test("grants review-preview CLI preserves forbidden-field refusal details through the real handler", async () => {
  const fixture = JSON.parse(await readFile(REVIEW_CASES_URL, "utf8"));
  const rejectedCase = fixture.rejected_cases.find((entry) => entry.forbidden_key === "event_value");
  const grantStore = { schema_version: 1, grants: [], examples: [] };
  const handler = makeHandler({ grantStore });
  const { baseUrl, close } = await createHttpServer(handler);

  try {
    await assert.rejects(
      () => runCli(parseCli([
        "node",
        "soma",
        "grants",
        "review-preview",
        "--stdin",
        "--json",
        "--url",
        baseUrl,
      ]), {
        stdin: [JSON.stringify(rejectedCase.preview)],
        stdout: { write() {} },
      }),
      (error) => {
        assert.equal(error.code, "grant_mutation_preview_review_forbidden_field");
        assert.equal(error.statusCode, 400);
        assert.ok(error.validation_errors.includes(rejectedCase.expected_path));
        return true;
      },
    );
    assert.deepEqual(grantStore.grants, []);
  } finally {
    await close();
  }
});

function makeHandler({ grantStore }) {
  return createRequestHandler({
    harness: { capabilities: [] },
    capabilityCatalog: { schema_version: 1, capabilities: [] },
    providerRegistry: { schema_version: 1, providers: [] },
    moduleRegistry: { schema_version: 1, modules: [] },
    runtimeProfiles: { schema_version: 1, default_profile: "", profiles: [] },
    grantStore,
    modelClient: {
      async chat() {
        return { text: "ok", model: "test", finish_reason: "stop", tokens_used: 1 };
      },
    },
    logger: { info() {} },
  });
}

async function createHttpServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
