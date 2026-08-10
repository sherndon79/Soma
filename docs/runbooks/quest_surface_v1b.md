# Quest surface v1b operator runbook — voice + panel round trip

Status: **Host path BUILT; device run is Gate 2 (Seth-only), still closed.** The v1b wire/consent
machinery (armed episode, four-leaf manifest, per-stream audio, correlated answer panel, fail-closed
latch) and the **real local-only answer route** (Whisper STT → local Gemma → Kokoro TTS behind the
abort-aware pipeline — interruptible, fail-closed, transcript-firewalled, no-retention, voice-brief)
are built and verified host-side against injected-fetch adapters (`npm run test:quest-v1b-loopback`).
Two things remain before this runbook is fully executable on the headset: the **live-services
loopback** (run against the real Whisper/Gemma/Kokoro services — the ultimate pre-Gate-2 proof), and
real `AudioRecord`/`AudioTrack` capture/playback on device. Those are called out inline.

**Gate 2 is Seth-only.** Arming the episode window and running live microphone capture on the
headset are not agent actions. Everything below the pre-device host loopback is an operator
exercise the wearer performs deliberately; nothing here arms capture on its own.

v1b adds, on top of the v1a bounded panel: wearer microphone **capture**, wearer-directed audio
**playback**, a **host-local** STT→model→TTS answer route (local destination only, no remote
fallback), and an **answer panel** that carries the answer text — and the recognized-input
transcript when the provider emits one — correlated to the spoken answer by `answer_id`. It does not
add controller/hand/gaze input, scene/camera/depth access, head-pose export, arbitrary assets, or
durable spatial state. Passthrough remains compositor-owned; the client receives no camera pixels.

## What this evaluation proves (§10.2 v1b acceptance)

Each criterion below maps to a numbered operator step and an observable. The evaluation passes only
when every positive observable holds **and** every negative case refuses without leaking capability
content, audio, or retained state.

| # | §10.2 criterion | Operator step | Pass observable |
|---|---|---|---|
| P1 | `on → ask → answer → off` succeeds | §6 round trip | Spoken answer heard; answer panel shows answer text (+ transcript if emitted), correlated by `answer_id` |
| P2 | Mic stop on focus loss / disconnect is **immediate** | §6.4 doff / §6.5 unplug | Capture and playback stop the instant focus/presence is lost or the socket drops; no trailing audio |
| P3 | **No** sensitive auto-resume | §6.4 re-don | After doff, re-don leaves the Activity `SUSPENDED`/latched; capture never resumes without deliberate relaunch **and** a fresh authenticated epoch |
| P4 | **No** persistence / retention | §7 audit | Post-close audit finds no raw PCM, transcript, or answer text on disk or in a live process |
| P5 | Local model destination only | §5 config + §7 audit | No remote egress during the answer route; provider bound to the local adapters with no fallback |
| N1 | Unarmed session | §6.1 | Four grants + mTLS present but no armed episode → no manifest issued, no capture offered |
| N2 | Expired / revoked episode mid-utterance | §6.6 | Revoke during capture → immediate latch, capture + in-flight STT/model/TTS aborted, PCM released, no answer |
| N3 | Wrong / stale lease, wrong epoch/revision | §6.6 | Refused before capture/playback; only the named stream torn down, session survives where the contract says so |
| N4 | Disconnect → offline, no-Soma recovery | §6.5 | Client latches, shows offline shell, re-negotiates only on deliberate relaunch |

## Safety and authority boundary

- Installing the APK, enrolling its certificate, holding any grant, or reaching Soma over TLS
  **creates no capture authority.** Presence of the four grants does not arm the microphone.
- Microphone capture requires an **armed episode window** (operator-only, explicit TTL clamped
  1 s–24 h) **and** an exact four-leaf manifest (`panel.present`, `mic_capture`,
  `audio.wearer_directed.present`, `model.context.audio.microphone.local.attach`). Audio never
  rides the panel lease.
- Focus/presence loss, transport loss, lease/episode expiry, and server revoke each **latch this
  Activity fail-closed**: hardware capture and playback stop immediately and all session state is
  cleared. Re-don does not resume; exit and deliberately relaunch to negotiate a fresh epoch.
- The independent local mute latch is wearer-controlled and survives re-don; only a deliberate
  fresh-epoch resume clears it.
- The answer route has a **local model destination only**. An unavailable or aborted local adapter
  fails closed; there is no remote fallback.
- Teardown acknowledgement never extends authority; a missing client ack governs only cleanup
  reporting.

## 1. Development identities

Reuse the v1a disposable-identity procedure (`scripts/quest-surface-dev-tls.sh`, identities kept
outside the repo, fixed compatibility PKCS#12 password, treat APK + PKCS#12 as secret). See
`quest_surface_v1a.md` §1. No change for v1b.

## 2. Create the four-leaf grants

v1b authority is a manifest over four independently revocable leaves (the text-local mode). Create
each grant through the operator mutation surface, substituting the step-1 fingerprint. The four leaf
capabilities are shipped in the catalog; the three expansion leaves (text-remote, raw-audio-local/
remote) are defined but disabled and are **not** used here.

```bash
SOMA_RUNTIME_WRITES_ENABLED=1 npm start
# panel.present            — as v1a (max_panel_text_bytes sized to carry answer text + transcript)
# mic_capture              — interaction.quest.surface.microphone.capture
# audio.wearer_directed    — interaction.quest.surface.audio.wearer_directed.present
# model.context.local.attach — model.context.audio.microphone.local.attach (provider: local; scope: window)
npm run cli -- grants create --capability <leaf> --provider <provider> --scope <scope> \
  --reason "Authorize one bounded Quest v1b voice+panel test episode." \
  --constraints-json '{"device_fingerprint256":"CLIENT_SHA256_WITHOUT_COLONS", ...}'
```

Record each grant id. Grant creation is separate from arming and from runtime activation; it
contacts no headset and arms no microphone.

## 3. Arm the episode window — **Gate 2, Seth-only**

The armed episode is the consent act. `armEpisode` binds an exact `{mode, capability, provider,
grant_id}` tuple (here: mode `text/local`) — the armed leaf selects the mode, and only the exactly-
matching answer provider is invoked. It is operator-only, carries an episode id, an explicit
TTL, and deliberate provenance, and is instantly revocable. Arming is what distinguishes a v1b
session that *may* capture from four grants that merely *exist*. The exact arm/disarm surface
finalizes with item I; it must record who armed it, when, and for how long, and expose an instant
revoke. Do not proceed past this step in any run Seth has not personally armed.

## 4. Pre-device host loopback — run this **before** the headset

The **loopback artifact** drives the full provider flow host-side, no headset: `on → ask → [real
STT → model → TTS] → answer + correlated panel → off`, plus the no-retention audit. Run it green
first; it catches wiring/marshaling/fail-closed bugs cheaply.

```bash
npm run test:quest-v1b-loopback
```

It exercises the **real adapter code** (`createRealAnswerStages` → Whisper/Gemma/Kokoro adapters)
with the HTTP mocked (injected fetch). It asserts the real answer reaches the wearer over the wire
*and* that the transcript/answer/PCM never appear in the provider's logs or events (no-retention),
with no session state retained after close.

**Live-services loopback (the ultimate pre-Gate-2 proof — needs the services up).** The mocked
loopback cannot catch live-service behavior (the lesson: fakes hide live blockers). Before Gate 2,
bring up TheCommons `whisper-stt`/`kokoro-tts`/`gemma4-llm` (host-published on 4001/4010/8000), point
Soma at them (`SOMA_WHISPER_URL`/`SOMA_KOKORO_URL`/`SOMA_LLM_URL`, or their defaults), set
`SOMA_QUEST_SURFACE_REAL_ANSWER=1`, and run one host-side utterance through the real services,
confirming a coherent spoken answer and an empty retention audit.

## 5. Start the real-compute-wired provider

Start Soma with the v1b listener and set `SOMA_QUEST_SURFACE_REAL_ANSWER=1` to attach the **local**
STT/model/TTS adapters (no remote fallback). Absent the flag, the listener runs the fixture answer
path (useful for wire/consent testing without the services).

```bash
SOMA_QUEST_SURFACE_ENABLED=1 \
SOMA_QUEST_SURFACE_HOST=192.168.50.20 SOMA_QUEST_SURFACE_PORT=8793 \
# ...TLS key/cert/client-ca as v1a...
# ...four grant ids...
SOMA_QUEST_SURFACE_REAL_ANSWER=1 \
SOMA_WHISPER_URL=http://127.0.0.1:4001 SOMA_KOKORO_URL=http://127.0.0.1:4010 SOMA_LLM_URL=http://127.0.0.1:8000 \
npm start
```

The provider emits content-free lifecycle/metadata only; it logs no PCM, transcript, or answer text.
The answer is voice-brief by default (short spoken sentences); a long answer offers to say more.

## 6. Device exercise — the round trip

Build the APK in the pinned container as in v1a §4 (`RECORD_AUDIO` permission is requested at first
capture; granting it is a device-side deliberate act, not a standing authority). Then:

1. **On.** Don the headset; wait for OpenXR `FOCUSED` + affirmative presence. Client completes
   mTLS, consumes the epoch, and — only within the armed episode — receives the four-leaf manifest.
   *(N1: with no armed episode, no manifest issues; capture is never offered.)*
2. **Ask.** Speak one utterance. VAD gates uplink; capture frames flow on a nonzero stream.
3. **Answer.** Hear the wearer-directed TTS answer; the answer panel shows the answer text (and the
   recognized-input transcript when the provider emits one), correlated to the audio by `answer_id`.
   *(P1)*
4. **Off / re-don.** Remove the headset mid- and post-utterance. Capture + playback stop
   immediately *(P2)*; on re-don the Activity stays `SUSPENDED`/latched and does not resume *(P3)*.
   Exercise the wearer mute latch and confirm it survives re-don.
5. **Unplug.** Drop the network / stop Soma. Client latches, shows the offline shell, recovers only
   on deliberate relaunch *(N4)*.
6. **Negatives.** Exercise mid-utterance revoke *(N2)*, wrong/stale lease and wrong epoch/revision
   *(N3)*. No negative case may play audio, display capability content, or leave retained state.

## 7. No-retention audit

The loopback (§4) already asserts the automated audit: the transcript, answer text, and raw PCM
never appear in the provider's logs or emitted events, and no session state is retained after close
*(P4/P5)*. For the **live** run, additionally confirm no raw PCM/transcript/answer persists on disk
or in a live process buffer after close, and capture that as the retention evidence. The provider is
built to emit content-free metadata only; the audit is the proof, not the promise.

## Cleanup

Disarm the episode (instant), revoke each of the four grants, stop Soma. Remove the external TLS
directory when evidence no longer needs it; an installed APK still carries its packaged identity —
uninstall or replace it as part of cleanup.

## Open before this runbook is executable

**Built (host-side, committed):** item H (bounded ≤200 ms drop-oldest queues + `ANSWER_END`
terminal), item I (mode-matrix enforcement, the four leaves, the real Whisper→Gemma→Kokoro answer
route, the `SOMA_QUEST_SURFACE_REAL_ANSWER` runtime flag, the loopback + no-retention audit). All
verified against injected-fetch adapters / fake hardware.

**Remaining before the headset run:**
- The **live-services loopback** (§4) — one host-side utterance through the real
  Whisper/Gemma/Kokoro services. The ultimate pre-Gate-2 proof; the mocked loopback cannot catch
  live-service behavior.
- Real `AudioRecord`/`AudioTrack` capture/playback and `RECORD_AUDIO` handling on device.
- The operator-facing **arm surface** (§3) — `armEpisode` binds `{mode, capability, provider,
  grant_id}` today; a real operator console for issuing/arming (rather than a code path) is a
  companion build.
