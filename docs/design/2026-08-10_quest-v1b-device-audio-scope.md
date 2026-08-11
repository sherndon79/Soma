# Quest v1b device audio — real capture/playback hardware: slice scope

**Status: BUILT + host-verified (55/55 JVM tests, 0 failures), 2026-08-10.** Piece A (permission)
and B (AudioTrack playback) by muse; Piece C (VAD + capture driver) and D (transport wiring) by
Claude. New test classes green in the Threshold container: `QuestSurfaceVadTest` (6),
`QuestSurfaceCaptureDriverTest` (3), `QuestSurfaceAudioHardwareTest` (4),
`QuestSurfaceAudioPermissionTest` (5); all 37 pre-existing tests still pass. **Not yet on device:**
APK build + install + server config remain, then Gate 2 (Seth arms) for the worn run. The verification
ceiling below still holds — JVM tests cannot prove the mic hears Seth or that playback is audible.

This was the **last device-side build before worn functional testing.** The host path is complete (item I real answer route, live-services loopback green). What
remains is the Android audio hardware the headset run needs: real microphone capture, real
wearer-directed playback, and `RECORD_AUDIO` handling — everything the current client models with
no-op/fake hardware (`QuestSurfaceAudioEngine.java:19`).

**Gate 2 stays Seth-only and closed.** This slice *builds the dormant capability*; it does not arm
it. Nothing here captures a live microphone. On device, capture starts only within a Seth-armed
episode, and arming is his act alone.

Governing prior decisions (do not re-litigate): the four-leaf manifest, the armed-episode consent
act, the fail-closed latch on focus/presence/transport/lease loss, the transcript-only floor, the
bounded ≤200 ms drop-oldest jitter queues (item H), and the no controller/hand/gaze rule — capture is
**VAD-gated within the armed episode**, not push-to-talk.

## The measured foundation (Threshold, do not re-derive)

`Threshold/docs/ops/2026-07-28_quest3-audio-transport.md` measured the Quest 3 audio path on
hardware. Carry these forward as facts, not assumptions:

- **Capture:** 48 kHz **mono** `PCM_I16`. The Quest grants `SHARED`/`NONE` (not `EXCLUSIVE`/
  `LOW_LATENCY`) for capture; cadence ~16 ms mean, ~39 ms worst case. A 20 ms frame is **1920 bytes**
  (matches `enqueueCaptureChunk`'s accepted sizes 1920/3840).
- **Playback:** 48 kHz **stereo** `PCM_I16`, `LOW_LATENCY` granted, ~4 ms. A 20 ms stereo frame is
  **3840 bytes** (matches `startPlayback`'s accepted 3840/7680).
- **The three traps that cost a headset out-of-service** — all already avoided by our client, verified
  this slice: (1) `RECORD_AUDIO` must be requestable at runtime — a pure `NativeActivity`
  (`hasCode=false`) has no Java path and falsely reports "capture unavailable". **We are clear:**
  `QuestSurfaceActivity extends NativeActivity` with `hasCode="true"`, a real Java path. (2) The
  `IMMERSIVE_HMD` intent-filter must be present or the app never reaches `FOCUSED` and thrashes the
  Shell. **We have it** (`AndroidManifest.xml`). (3) `FOCUSED` is a **precondition, not an
  observation** — no capture before focus. Our transport already only starts from native on
  `FOCUSED`+presence (`startTransportFromNative`).
- **The already-granted permission path has never been exercised** (Threshold uninstalled every run).
  Carry as a requirement: the client must handle both the request path *and* the already-granted path,
  and a test must cover already-granted.

## The architectural finding that shapes the split

The `Hardware` interface is **asymmetric**, and this is not a defect to fix — it falls out of the data
flow:

- **Playback PCM flows *through* the interface** (engine → hardware):
  `startHardwarePlayback(epoch, streamId, leaseRef, pcm)`. A real `AudioTrack` is a **clean drop-in**
  behind this method. → **Piece B.**
- **Capture PCM has *no return path* through the interface.** It flows the *other* way:
  `AudioRecord → runtime.pushCapture → engine.enqueueCaptureChunk` (bounded jitter) →
  `transport.pollCaptureChunkForTransport → send AUDIO_CHUNK`. So the real microphone is **not** a
  `Hardware` implementation. It is a **continuous capture driver above the transport** that owns
  `AudioRecord`, runs the VAD segmenter, and drives the existing
  `sendUtteranceStart / sendAudioChunk / sendUtteranceEnd` API. `startHardwareCapture` /
  `stopHardwareCapture` stay engine state-machine bookkeeping (no-op for real hardware). → **Piece C.**

Consequence: do **not** try to open `AudioRecord` inside `Hardware.startHardwareCapture`. It is called
*per utterance, by* the segmentation decision; the mic must be open *continuously* to detect onset.
The driver decides utterance boundaries and calls down into the transport (which calls
`startCapture` → `startHardwareCapture`), not the reverse.

## Slices

### Piece A — `RECORD_AUDIO` permission (muse; contained, mechanical)
- Declare `android.permission.RECORD_AUDIO` in `AndroidManifest.xml` (removing it from the
  "deliberately absent" comment; the others — CAMERA/scene/tracking — stay absent).
- Request it at runtime from `QuestSurfaceActivity` (Java, `hasCode=true`). Denial is fail-closed:
  the capture driver never starts; the panel/transport path still runs. Grant does **not** arm
  capture (arming is the server-side episode).
- Exercise **both** paths in a JVM-side unit test: request→granted, and already-granted (the path
  Threshold never ran). The permission *check* is unit-testable behind a small seam even though the
  real prompt only runs on device.

### Piece B — `AudioTrack` playback hardware (muse; contained, mechanical)
- A real `Hardware` implementation whose `startHardwarePlayback(epoch, streamId, leaseRef, pcm)`
  writes 48 kHz **stereo** `PCM_I16` to an `AudioTrack`, and `stopHardwarePlayback` tears it down.
- Streaming: playback arrives as successive 3840/7680-byte chunks per (epoch, stream, answer). Create
  the `AudioTrack` once per playback stream, `write()` chunks in order, release on stop / drain /
  latch. Respect the engine's existing terminal/close semantics — the engine already gates duplicate/
  post-terminal chunks; the hardware only plays what it's handed.
- JVM-side test with a fake `AudioTrack` seam asserting: stereo/48k/I16 config requested, chunks
  written in order, released on stop. Real audibility is the worn test, not a unit test.

### Piece C — `AudioRecord` capture driver + VAD segmenter + gating (Claude; consent-critical)
- A `QuestSurfaceCaptureDriver` that opens `AudioRecord` (48 kHz mono `PCM_I16`, 20 ms/1920-byte
  reads) **once**, on a dedicated thread, and only when **all** hold: transport connected, session
  `FOCUSED`+presence, armed episode with the `mic_capture` leaf, engine not latched, mute latch clear.
- **VAD segmenter** (energy-based with trailing-silence hangover for v1 — *flagged scaffolding*, see
  below): onset → `transport.sendUtteranceStart`; each 20 ms voiced frame → `sendAudioChunk`; trailing
  silence past the hangover → `sendUtteranceEnd`. This is the code that decides **when Seth's voice
  reaches the wire** — it is the consent-critical heart of the slice and stays with Claude.
- **Immediate stop** wired to every latch source: focus/presence loss, transport drop, lease/episode
  expiry, server revoke, mute latch → stop the read thread, close `AudioRecord`, no trailing frames.
  Ties into the existing transport `stopPermanently` / engine `latch` lifecycle.
- Unit-testable with synthetic PCM: silence→speech→silence produces exactly one start/…/end; latch
  mid-utterance stops immediately with no further frames; unfocused/unarmed produces nothing.

### Piece D — wiring (Claude)
- Inject the real `AudioTrack` hardware at the transport construction site
  (`QuestSurfaceTransport.java:98`), replacing `new QuestSurfaceAudioEngine()`'s default no-op, behind
  a build/runtime guard so host-side tests keep the fake.
- Instantiate and lifecycle-bind the capture driver to the transport (start on eligible+armed, stop on
  any narrowing).

## VAD choice — flagged scaffolding

v1 uses a **simple energy-based VAD** (RMS threshold + hangover). It is adequate to prove the round
trip and is fully unit-testable, but it is **scaffolding to revisit**: the barge-in / streaming-to-
wire follow-on will want a real VAD (e.g. Silero/webrtcvad-class) for low-false-trigger onset and
tight turn-gaps. Named here so it does not calcify silently.

## What this slice does NOT do
- Does not arm capture (Gate 2, Seth-only). Does not add barge-in / streaming-to-wire (defined
  follow-on). Does not add controller/hand/gaze/scene/camera. Does not prove audibility or that the
  mic hears sound — that is the worn functional test itself.

## First worn attempt — live findings (2026-08-10 night)

Proven live on the Quest 3 (worn, mTLS to `192.168.50.1:8793`, v1a TLS reused):
- The device stack works end-to-end: the app reaches OpenXR **FOCUSED**, starts the transport,
  and **completes mTLS** (server: `transport_authenticated`).
- The **consent floor holds on real hardware**: with no armed episode the server issues no manifest
  → `manifest_not_armed` → `lease_refused` → `session_closed`; the client retries its bounded 8
  attempts (`message_type_unexpected`) and gives up. No panel, no capture — **N1 confirmed live.**

Two device-only blockers (host tests could not catch either — the recurring lesson):
1. **RECORD_AUDIO request in `onCreate` breaks immersion.** Firing a 2D permission dialog during
   immersive launch pulls the app out of its OpenXR session and it is killed (destroy timeout),
   before the transport ever starts. Confirmed by a deferred-permission rebuild that then reached
   mTLS. **Fix needed:** a separate 2D launcher activity that obtains RECORD_AUDIO *before* starting
   the immersive `NativeActivity` (the Threshold-catalogued `XrSceneModel` shim pattern). Piece A's
   `onCreate` request must move there.
2. **v1b has no unarmed path — even the panel needs an armed episode.** The panel snapshot is a leaf
   of the four-leaf manifest, which only issues when armed. So the worn test (panel *or* voice)
   requires arming, and today nothing arms a running headset-facing listener (the env server builds
   an unarmed provider and never calls `armEpisode`; the provider is not exposed for external
   arming). Only the `panel.present` grant exists; the three audio leaf grants
   (mic/audio/model-attach) are not yet created.

**Next slices before a worn round trip:** (a) the permission launcher-shim; (b) a **live arm
surface** — a headset-facing listener that builds the four-leaf manifest and exposes a Seth-triggered
arm action (Gate 2 → `armEpisode` with the text/local leaf) — plus creating the three missing leaf
grants bound to fingerprint `DD1F83…`. Then the worn voice test.

## Verification ceiling (be honest about it)
JVM unit tests cover the VAD segmenter, the permission-check seam, the playback-write seam, and the
gating logic against synthetic input. They **cannot** prove `AudioRecord`/`AudioTrack` behave on the
Quest, that the mic hears Seth, or that playback is audible. Those are the worn functional test, which
requires the APK on device **and Seth arming** (Gate 2). The build is "compiles + logic verified +
structurally wired"; the capability is proven only worn.
