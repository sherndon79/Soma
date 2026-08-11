# Quest v1b — first worn round trip: milestone + worn-feedback slice

**2026-08-11.** First worn v1b voice round trip completed live on the Quest 3: spoken question →
mic capture → STT → local model → **answer text on the correlated panel**, three times. The whole
consent/arm/capture/answer spine works on device. Audible answer playback is the one core gap (see
below). This note records the milestone and the next slice, driven by Seth's worn-testing feedback.

## Bugs found and fixed to reach the milestone (all device-only; host tests structurally missed them)
- adb/wireless recovery discipline (system vs container adb thrash revokes auth).
- git-clobbered grant store — durable runtime grants lived in a **git-tracked**
  `config/grants.json`, so a `git checkout`/`restore` silently dropped them. **Fixed in the current
  tree:** store + mutation provenance are gitignored runtime state, an empty committed example owns
  only shape, and both paths can be placed outside the worktree by environment.
- client manifest parser rejected non-panel leaf `device_fingerprint256` (fixed, +regression test).
- provider-lifetime mic latch leaked across episodes; a fresh arm now allocates a fresh latch (Codex).
- missing service API key (`INTERNAL_API_KEY`) → Whisper 401 (server env fix).

## Open: audible answer playback (diagnosed, filed with muse)
Downlink playback enqueues chunks into the item-H **200 ms drop-oldest** jitter buffer and only
drains/plays at `ANSWER_END`, so all but the last ~200 ms of a multi-second answer is discarded
before it plays — sub-audible. The AudioTrack (Piece B) is fine; the **playback wiring must stream
chunks to the AudioTrack as they arrive**, keeping one MODE_STREAM track open across the answer, with
a small smoothing buffer — not the uplink-style drop-oldest-and-drain-at-end. The H drop-oldest bound
is correct for uplink (latency) and wrong for downlink (completeness).

## Worn-feedback slice: PTT + on-panel capture status

**Motivation (Seth, worn):** with a video playing and another person (his daughter) in the room, the
VAD-always-on capture picked up *both* the video audio and her voice. Two problems: (1) unusable
input management — no way to tell his audio from ambient; (2) **a consent problem** — a bystander was
captured. The v1 "no controller/hand input, VAD-gated" constraint is contradicted by real use.

### PTT (push-to-talk) — a selectable capture mode
- **Recommended mechanism: controller hold-to-talk** (OpenXR controller button/trigger held =
  capture active). Client-local: the capture driver's eligibility gate adds a "PTT held" term in PTT
  mode. **No protocol change, no new authority** — a controller button is UI input, not perception,
  so it needs no grant/leaf. Still fully bounded by the armed episode + mic lease.
- PTT is a **stronger consent primitive** than VAD: explicit per-utterance intent, and no one is
  captured unless Seth deliberately triggers — directly addresses the bystander capture.
- Keep VAD as the other mode (quiet solo space); **PTT is the right default for shared/noisy rooms.**
- **Mode is selectable IN the app at runtime** (Seth's ask), not a build flag: a **controller button
  toggles VAD ↔ PTT** live, and the **current mode is shown on the panel** next to the capture state
  (below) so it is never ambiguous which mode is active. Client-local: the mode is purely a
  capture-gating choice, so the server/protocol never sees it. Transient (resets on relaunch) is fine
  to start; a persisted client setting is a later nicety. Default = PTT.
- Alternatives considered: hand-pinch PTT (adds hand tracking, less reliable); workstation-side PTT
  (server signals client — needs a downlink control frame; good for keyboard-side testing but a
  protocol change). Controller-local is the cleanest first cut.

### On-panel capture status
- Render capture state **client-locally** (the client is authoritative on its own capture state):
  `idle` → `listening/armed` → `capturing` (PTT held / VAD voiced) → `processing` (utterance sent,
  awaiting answer) → back to `idle`, **plus the current mode (VAD / PTT)**. No protocol change, no
  server round trip. This is the single readout that answers "what is being captured right now."
- Pairs with both modes; makes "what is being captured right now" visible, which is what Seth needed
  to manage input against background audio.

### Scope note
Both PTT (controller-local) and the status indicator are **client-side, no new authority, no protocol
change** — a contained client slice, naturally muse's. It should land with or just after the
audible-playback fix, since worn testing needs both to be practical.

## Next-session queue
1. **Audible playback streaming fix** (muse; diagnosed above) — unblocks hearing answers.
2. **PTT + on-panel status** (muse; this note) — makes worn testing usable in a real room.
3. ~~**Grant store out of git**~~ — fixed; runtime store and provenance are untracked local state.
4. Cleanup: 4 test grants in the local runtime store; quest server on `:8795`; services warm.
