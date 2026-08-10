// Item I-1 acceptance tests — the dual-mode answer matrix enforcement.
//
// Reviewer-authored (Claude) up front, per the ratified workload protocol: this
// is the consent-critical enforcement that "the armed leaf selects the mode."
// muse implements src/questSurfaceModeMatrix.js to make these green; the tests
// assert the CONTRACT, not a preferred implementation.
//
// The two enforcement points (manifest issuance AND provider selection) both
// call matchAnswerProvider with the same {mode, capability, provider, grant_id}
// tuple. Four exact matches invoke a provider; the twelve mismatches refuse
// BEFORE any provider call. A text-mode provider's model adapter must receive
// zero PCM (the transcript-only firewall, made structural).

import test from "node:test";
import assert from "node:assert/strict";

import {
  ANSWER_MODES,
  matchAnswerProvider,
  createTextLocalAnswerProvider,
} from "../src/questSurfaceModeMatrix.js";

// The four cells of the floor matrix: {input_class} x {destination}.
const MODES = [
  { input_class: "text", destination: "local" },
  { input_class: "text", destination: "remote" },
  { input_class: "raw_audio", destination: "local" },
  { input_class: "raw_audio", destination: "remote" },
];

const LEAF_FOR = {
  "text:local": "model.context.audio.microphone.local.attach",
  "text:remote": "model.context.audio.microphone.remote.attach",
  "raw_audio:local": "model.context.audio.microphone.raw.local.attach",
  "raw_audio:remote": "model.context.audio.microphone.raw.remote.attach",
};
const modeKey = (m) => `${m.input_class}:${m.destination}`;

// A provider-registry entry declaring an immutable answer mode.
function providerEntry(mode, overrides = {}) {
  return {
    id: `soma.provider.answer.${modeKey(mode).replace(":", "-")}`,
    answer: {
      input_class: mode.input_class,
      destination: mode.destination,
      required_leaf: LEAF_FOR[modeKey(mode)],
      // remote destinations must pin an exact governed endpoint (egress floor).
      ...(mode.destination === "remote" ? { remote_destination: "https://pinned.local-frontier.invalid/answer" } : {}),
    },
    ...overrides,
  };
}

// A manifest that has armed exactly the leaves named.
function manifestWith(leafNames) {
  const leases = {};
  for (const name of leafNames) leases[name] = { lease_id: `lease-${name}`, source_grant_id: `grant-${name}` };
  return { leases };
}

// An armed episode bound to an exact {mode, capability, provider, grant_id}.
function armedFor(mode, provider) {
  return {
    id: "ep-1",
    mode: { input_class: mode.input_class, destination: mode.destination },
    capability: provider.answer.required_leaf,
    provider: provider.id,
    grant_id: `grant-${provider.answer.required_leaf}`,
  };
}

test("I-1: the four answer modes are defined and immutable", () => {
  assert.equal(ANSWER_MODES.length, 4);
  const keys = new Set(ANSWER_MODES.map(modeKey));
  for (const m of MODES) assert.ok(keys.has(modeKey(m)), `missing mode ${modeKey(m)}`);
});

test("I-1: 4x4 matrix — exactly the diagonal invokes, the 12 mismatches refuse before any call", () => {
  let matches = 0;
  let refusals = 0;
  for (const armedMode of MODES) {
    for (const providerMode of MODES) {
      const provider = providerEntry(providerMode);
      const registry = { providers: [provider] };
      // The manifest arms the provider's own leaf so only the mode/tuple decides.
      const manifest = manifestWith([provider.answer.required_leaf]);
      const armedEpisode = armedFor(armedMode, provider);
      const same = modeKey(armedMode) === modeKey(providerMode);
      if (same) {
        const selected = matchAnswerProvider({ armedEpisode, providerRegistry: registry, manifest });
        assert.equal(selected.id, provider.id, `${modeKey(armedMode)} must select its provider`);
        matches += 1;
      } else {
        assert.throws(
          () => matchAnswerProvider({ armedEpisode, providerRegistry: registry, manifest }),
          (err) => err && /mismatch|no_matching_provider|mode/i.test(String(err.code ?? err.message)),
          `armed ${modeKey(armedMode)} against provider ${modeKey(providerMode)} must refuse`,
        );
        refusals += 1;
      }
    }
  }
  assert.equal(matches, 4, "exactly four exact matches invoke");
  assert.equal(refusals, 12, "the twelve mismatches all refuse");
});

test("I-1: mode matches but required_leaf not armed -> refuse (leaf gates the sink)", () => {
  const mode = MODES[0]; // text-local
  const provider = providerEntry(mode);
  const registry = { providers: [provider] };
  const manifest = manifestWith(["panel.present"]); // provider's leaf absent
  const armedEpisode = armedFor(mode, provider);
  assert.throws(
    () => matchAnswerProvider({ armedEpisode, providerRegistry: registry, manifest }),
    (err) => err && /leaf|not_armed|manifest/i.test(String(err.code ?? err.message)),
  );
});

test("I-1: episode tuple mismatch (wrong provider or grant) -> refuse even when mode matches", () => {
  const mode = MODES[0];
  const provider = providerEntry(mode);
  const registry = { providers: [provider] };
  const manifest = manifestWith([provider.answer.required_leaf]);
  const wrongProvider = { ...armedFor(mode, provider), provider: "soma.provider.someone-else" };
  assert.throws(() => matchAnswerProvider({ armedEpisode: wrongProvider, providerRegistry: registry, manifest }),
    (err) => err && /provider|tuple|mismatch/i.test(String(err.code ?? err.message)));
  const wrongGrant = { ...armedFor(mode, provider), grant_id: "grant-not-this-one" };
  assert.throws(() => matchAnswerProvider({ armedEpisode: wrongGrant, providerRegistry: registry, manifest }),
    (err) => err && /grant|tuple|mismatch/i.test(String(err.code ?? err.message)));
});

test("I-1: mutually-exclusive slot — two providers for the same armed mode is ambiguous, refuse", () => {
  const mode = MODES[0];
  const p1 = providerEntry(mode, { id: "soma.provider.answer.text-local-a" });
  const p2 = providerEntry(mode, { id: "soma.provider.answer.text-local-b" });
  const registry = { providers: [p1, p2] };
  const manifest = manifestWith([p1.answer.required_leaf]);
  const armedEpisode = armedFor(mode, p1);
  // Even naming p1 in the tuple, a registry advertising two providers for one
  // mode is a mis-configuration the enforcement must reject, not silently pick.
  assert.throws(() => matchAnswerProvider({ armedEpisode, providerRegistry: registry, manifest }),
    (err) => err && /ambiguous|multiple|slot/i.test(String(err.code ?? err.message)));
});

test("I-1: no fallback — a refused match invokes nothing", () => {
  const armedMode = MODES[2]; // raw_audio-local armed
  const provider = providerEntry(MODES[0]); // only a text-local provider registered
  const registry = { providers: [provider] };
  const manifest = manifestWith([provider.answer.required_leaf]);
  const armedEpisode = armedFor(armedMode, provider);
  // No provider matches the armed raw-audio-local mode; must throw, never fall
  // back to the text-local provider that happens to be present.
  assert.throws(() => matchAnswerProvider({ armedEpisode, providerRegistry: registry, manifest }),
    (err) => err && /no_matching_provider|mismatch/i.test(String(err.code ?? err.message)));
});

// --- Structural transcript-only firewall (text mode) ---

test("I-1 structural: a text-mode provider feeds the model transcript only, never PCM", async () => {
  const seenByModel = [];
  const stt = async (pcm) => {
    assert.ok(Buffer.isBuffer(pcm) || pcm instanceof Uint8Array, "STT receives the raw PCM");
    return { transcript: "hello soma" };
  };
  const model = async (input) => {
    seenByModel.push(input);
    return { answerText: "hi there" };
  };
  const tts = async () => [Buffer.alloc(3840)];

  const provider = createTextLocalAnswerProvider({ stt, model, tts });
  const pcm = Buffer.alloc(1920, 1); // non-zero audio bytes
  const events = [];
  for await (const ev of provider.respond({ pcm, utteranceId: "u1", answerId: "a1", context: {}, signal: undefined })) {
    events.push(ev);
  }

  assert.equal(seenByModel.length, 1, "model called once");
  const modelInput = seenByModel[0];
  // The model must have received the transcript, and NOTHING audio-shaped.
  const asString = typeof modelInput === "string" ? modelInput : JSON.stringify(modelInput);
  assert.ok(asString.includes("hello soma"), "model received the transcript");
  assert.ok(!Buffer.isBuffer(modelInput) && !(modelInput instanceof Uint8Array), "model input is not raw bytes");
  const containsPcm = JSON.stringify(modelInput, (k, v) =>
    (Buffer.isBuffer(v) || v instanceof Uint8Array) ? "__BYTES__" : v).includes("__BYTES__");
  assert.equal(containsPcm, false, "no PCM/audio bytes reach the model adapter");
  // And the provider still produces answer text + audio downstream.
  assert.ok(events.some((e) => e.answerText || e.audioChunk || e.terminal), "provider emits answer events");
});

test("I-3(B) interruption: respond honors AbortSignal — abort after STT stops before the model", async () => {
  const ac = new AbortController();
  let modelCalled = 0;
  let ttsCalled = 0;
  const stt = async () => { ac.abort(); return { transcript: "hello soma" }; }; // user barges in right after STT
  const model = async () => { modelCalled += 1; return { answerText: "hi there" }; };
  const tts = async () => { ttsCalled += 1; return [Buffer.alloc(3840)]; };
  const provider = createTextLocalAnswerProvider({ stt, model, tts });
  const emitted = [];
  await assert.rejects(
    async () => {
      for await (const ev of provider.respond({ pcm: Buffer.alloc(1920, 1), utteranceId: "u", answerId: "a", signal: ac.signal })) {
        emitted.push(ev);
      }
    },
    (err) => err && err.code === "answer_aborted",
    "an aborted signal must throw answer_aborted",
  );
  assert.equal(modelCalled, 0, "abort after STT must stop BEFORE the model call (no wasted generation)");
  assert.equal(ttsCalled, 0, "and before TTS");
  assert.equal(emitted.length, 0, "no answer events emitted after abort");
});

test("I-3(B) interruption: abort during TTS chunk stream stops emitting further chunks", async () => {
  const ac = new AbortController();
  const stt = async () => ({ transcript: "hello soma" });
  const model = async () => ({ answerText: "hi there" });
  // three chunks; abort fires as the stream is consumed
  const tts = async () => [Buffer.alloc(3840, 1), Buffer.alloc(3840, 2), Buffer.alloc(3840, 3)];
  const provider = createTextLocalAnswerProvider({ stt, model, tts });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const ev of provider.respond({ pcm: Buffer.alloc(1920, 1), utteranceId: "u", answerId: "a", signal: ac.signal })) {
      if (ev.audioChunk) { chunks.push(ev.audioChunk); ac.abort(); } // barge-in after the first chunk plays
    }
  }, (err) => err && err.code === "answer_aborted");
  assert.equal(chunks.length, 1, "abort mid-playback stops after the current chunk, no further chunks");
});
