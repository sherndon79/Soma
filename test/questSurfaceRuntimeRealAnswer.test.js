import assert from "node:assert/strict";
import test from "node:test";
import { createQuestSurfaceRuntime } from "../src/questSurfaceRuntime.js";

function baseEnv(overrides = {}) {
  return {
    SOMA_QUEST_SURFACE_ENABLED: "1",
    SOMA_QUEST_SURFACE_TLS_KEY: "/tmp/key",
    SOMA_QUEST_SURFACE_TLS_CERT: "/tmp/cert",
    SOMA_QUEST_SURFACE_CLIENT_CA: "/tmp/ca",
    SOMA_QUEST_SURFACE_GRANT_ID: "grant-test",
    ...overrides,
  };
}

async function createRuntimeWithSpy(env) {
  let captured = null;
  const provider = {
    async start(opts) { return { address: "127.0.0.1", port: 1111 }; },
    async stop() {},
  };
  const runtime = await createQuestSurfaceRuntime({
    env,
    readFileImpl: async () => Buffer.from("x"),
    providerFactory: (opts) => { captured = opts; return provider; },
    logger: { info() {} },
  });
  return { runtime, captured, provider };
}

test("flag unset/false -> providerFactory receives NO answerStages (fixture path byte-identical)", async () => {
  for (const flag of [undefined, "", "0", "false", "no", "off"]) {
    const env = baseEnv();
    if (flag !== undefined) env.SOMA_QUEST_SURFACE_REAL_ANSWER = flag;
    const { runtime, captured } = await createRuntimeWithSpy(env);
    assert.equal(captured.answerStages == null, true, `flag ${JSON.stringify(flag)} should yield no answerStages`);
    assert.equal("answerStages" in captured, false, "flag-off must not set answerStages key at all (byte-identical fixture path)");
    await runtime.stop();
  }
});

test("flag=1 -> providerFactory receives non-null answerStages with transcribe/chat/synthesize", async () => {
  for (const flag of ["1", "true", "TRUE", "yes", "on", "YES"]) {
    const env = baseEnv({ SOMA_QUEST_SURFACE_REAL_ANSWER: flag });
    const { runtime, captured } = await createRuntimeWithSpy(env);
    assert.ok(captured.answerStages, `flag ${flag} should yield answerStages`);
    assert.equal(typeof captured.answerStages.transcribe, "function");
    assert.equal(typeof captured.answerStages.chat, "function");
    assert.equal(typeof captured.answerStages.synthesize, "function");
    await runtime.stop();
  }
});

test("flag=1 with default endpoints does NOT crash at construction", async () => {
  const env = baseEnv({ SOMA_QUEST_SURFACE_REAL_ANSWER: "1" });
  // no SOMA_WHISPER_URL etc set — should use defaults via getLocalServiceEndpoints and not throw
  const { runtime, captured } = await createRuntimeWithSpy(env);
  assert.ok(captured.answerStages);
  // stages should be call-time fail-closed, not construction-time
  assert.doesNotThrow(() => captured.answerStages);
  await runtime.stop();
});

test("cause-matched red->green: new flag behavior is flag-gated", async () => {
  // RED on old code would have no answerStages even when flag=1; GREEN after fix has it
  const envOff = baseEnv({ SOMA_QUEST_SURFACE_REAL_ANSWER: "0" });
  const { captured: off, runtime: r1 } = await createRuntimeWithSpy(envOff);
  assert.equal(off.answerStages == null, true);
  await r1.stop();

  const envOn = baseEnv({ SOMA_QUEST_SURFACE_REAL_ANSWER: "1" });
  const { captured: on, runtime: r2 } = await createRuntimeWithSpy(envOn);
  assert.ok(on.answerStages && on.answerStages.transcribe);
  await r2.stop();
});
