# Quest v1b item I — real local-only answer route: slice scope

**Status: scope, sliced, not yet built.** Item I replaces the fixture answer pipeline with the real
local STT → model → TTS route behind a provider contract, and establishes the dual-mode answer
matrix. Only **text + local** ships a real provider; the other three modes are defined-but-inert
leaves. Prereqs A/B/D/E/F/G/H are closed. Gate 2 (live mic on device) remains Seth-only and closed;
everything here is host-side, no headset, no live capture.

Governing prior decisions (do not re-litigate): the dual-mode provider contract, the four-cell floor
matrix {text|audio-native}×{local|remote} with the armed leaf selecting the mode, the mutually-
exclusive model-sink slot, the episode-bound `{mode, capability, provider, grant_id}` tuple, the
structural "text-mode model receives zero PCM" invariant, remote destinations pinned through the
existing egress floor, and the transcript-only floor as the shipped default. See the AMQ record on
`spec/quest3-v1b` (dual-mode + enforcement rulings) and the canonical draft.

## Current-code touchpoints

- `src/questSurfaceFixtureProvider.js`: `armEpisode({episodeId, ttlMs, actor, provenance})` →
  `armedEpisode = {id, expiresAtMs, actor, provenance, ttlMs}` (no mode/leaf yet); provider builds
  `pipelineFactory ?? createQuestSurfaceAudioPipeline` and calls `pipeline.handleUtteranceEnd(...)`
  returning `{panelPayload, ttsChunks}` (batch, not streaming).
- `src/questSurfaceAudioPipeline.js`: `createQuestSurfaceAudioPipeline({transcribe, chat, synthesize})`
  — the hard-coded 3-stage fixture pipeline to move behind the contract as one provider.

## Slices (dependency-ordered; one hard thing each)

### I-1 — provider seam + 4-mode leaf matrix — CONSENT-CRITICAL — Claude authors acceptance
- **One hard thing:** make "the armed leaf selects the mode" tamper-proof.
- **Scope:** define `answerProvider.respond({pcm, utteranceId, answerId, context, signal}) →
  AsyncIterable<{answerText, transcript?, audioChunk?, terminal|abort}>`; refactor the fixture
  pipeline to sit behind it as one provider declaring immutable
  `{input_class, destination, required_leaf}`; extend `armEpisode` to bind exact
  `{mode, capability, provider, grant_id}`; one mutually-exclusive model-sink slot; manifest issuance
  AND provider selection must prove the same tuple; structural guarantee that a text-mode model
  adapter receives zero PCM. Define all four catalog leaves (text-local live-able; text-remote,
  audio-native-local, audio-native-remote disabled/inert). Still fixtures behind the contract.
- **Acceptance (reviewer-authored, up front):** the 4×4 mismatch matrix — the 4 exact
  {mode,destination} matches invoke a provider, the 12 mismatches refuse **before** any provider
  call; a structural test asserting no audio bytes reach a text-mode model adapter; fresh-epoch
  required for a mode change (no mid-epoch switch); no fallback on refusal. Cause-matched red→green.
- **Verify:** `node --test test/questSurface*.test.js` green incl. the new matrix/structural tests.
- **Owner:** Claude authors the acceptance tests and reviews closely (Fix-A-class authority);
  implementation of the seam to green may be muse under the contract.
- **Deps:** none (first).

### I-2 — local service reachability — mechanical — muse-contract
- **One hard thing:** Soma reaches `whisper-stt:4001`, `kokoro-tts:4010`, `gemma-vLLM:8000` from its
  own process/network (they live in TheCommons compose; Soma in its own).
- **Scope:** compose/network wiring or config so the three endpoints resolve from Soma; an endpoint
  config surface; a connectivity/health check; fail-closed if any endpoint is down. No answer logic.
- **Acceptance (muse-owned ordinary tests):** a health check reaches all three (2xx/healthy);
  config-driven endpoints; unavailable endpoint fails closed with a clear error.
- **Verify:** the health check + config unit tests green; a documented manual `curl`/health probe.
- **Owner:** muse-contract (contained). **Deps:** none — runs in parallel with I-1.

### I-3 — real text-local provider — the integration — Claude owns the seam, muse the adapter mechanics
- **One hard thing:** real `PCM → Whisper → transcript → Gemma → text → Kokoro → PCM stream +
  ANSWER_END`, streaming, replacing fixtures, fail-closed.
- **Scope:** the text-local provider behind the I-1 seam; incremental audio+text streaming (not the
  batch `{panelPayload, ttsChunks}`); the once-grant reserve immediately before the **model** call;
  fail-closed on any adapter unavailable/abort (no remote fallback); panel carries answer text
  (+ transcript when emitted). The three HTTP adapters (Whisper/Gemma/Kokoro marshaling) are
  contained sub-contracts for muse.
- **Acceptance:** a real utterance produces a real answer (audio+text+ANSWER_END) through the seam;
  fail-closed when an adapter is down; the no-PCM-to-model invariant holds with the real STT adapter
  in place; the once-grant is reserved exactly once.
- **Verify:** an integration test against the real (or a real-shaped injected) adapters; the I-1
  suite still green.
- **Owner:** Claude carries the streaming/fail-closed/sink seam; muse owns the adapter mechanics as
  sub-contracts; Claude takes the mechanics too if muse stalls. **Deps:** I-1 + I-2.

### I-4 — host loopback artifact + no-retention audit — CONSENT-CRITICAL — Claude authors acceptance
- **One hard thing:** the real-class end-to-end proof plus empty-retention.
- **Scope:** `test:quest-v1b-loopback` — `on → ask → [real STT→model→TTS] → answer + correlated panel
  → off`, host-side, **no headset, real adapters not fixtures**; a no-retention audit (no raw PCM /
  transcript / answer text persists on disk or in a live process after off/close).
- **Acceptance:** the loopback runs green through the real adapters; the retention audit is empty.
  This is the pre-device gate leg — fakes hide live blockers, so it must exercise the real path.
- **Verify:** `npm run test:quest-v1b-loopback` green; the audit output empty.
- **Owner:** Claude authors the acceptance (no-retention is consent-critical). **Deps:** I-3.

### I-5 — canonical promotion — docs — folds into J
- Promote the dual-mode contract + leaf matrix + provider-registry entries into the design draft,
  capability-catalog, provider-registry, and finalize runbook §3/§5. Per the same-change-doc rule.
- **Deps:** I-1…I-4.

## Sequencing

Critical path: **I-1 → I-3 → I-4**. I-1 and I-2 start in parallel (independent). I-4 needs I-3.
Consent-critical slices (I-1, I-4) get reviewer-authored acceptance tests and close under Claude's
verify + semantic review; with Codex out, Claude is the sole reviewer and carries those closely.
The integration slice (I-3) is split at the seam so muse is not handed a G-class integration whole.
