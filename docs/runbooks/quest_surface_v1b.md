# Quest surface v1b operator runbook — voice + panel round trip

Status: **DRAFT, pre-implementation.** The v1b wire/consent machinery (armed episode, four-leaf
manifest, per-stream audio, correlated answer panel, fail-closed latch) is integrated and verified
against fake/no-op hardware. This runbook cannot be executed end to end until **item I** lands — the
real local-only STT/model/TTS adapters and the host loopback artifact — and until real
`AudioRecord`/`AudioTrack` capture/playback are wired. Sections marked **[pending I]** finalize then.

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

v1b authority is a manifest over four independently revocable leaves. Create each grant through the
operator mutation surface, substituting the step-1 fingerprint. **[pending I]** — exact capability
ids/constraints confirm against the shipped catalog when item I lands.

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

## 3. Arm the episode window — **Gate 2, Seth-only** — **[pending I]**

The armed episode is the consent act. It is operator-only, carries an episode id, an explicit
TTL, and deliberate provenance, and is instantly revocable. Arming is what distinguishes a v1b
session that *may* capture from four grants that merely *exist*. The exact arm/disarm surface
finalizes with item I; it must record who armed it, when, and for how long, and expose an instant
revoke. Do not proceed past this step in any run Seth has not personally armed.

## 4. Pre-device host loopback — run this **before** the headset — **[pending I]**

Item I ships a **real-class host loopback artifact**: `on → ask → [real local STT → local model →
real TTS] → answer + correlated panel → off`, run host-side through the actual local adapters with
no headset, asserting the no-retention audit. Run it green first. This is the gate leg that catches
integration blockers cheaply; the program lesson is that fakes hide live blockers, so this loopback
must exercise the real adapters, not fixtures.

```bash
# [pending I] exact invocation — the loopback lives with item I's tests and runs the real adapters
npm run test:quest-v1b-loopback
```

## 5. Start the real-compute-wired provider — **[pending I]**

Start Soma with the v1b listener bound to the LAN address, the four grant ids, and the **local**
STT/model/TTS adapters wired (no remote fallback). Exact env surface finalizes with item I.

```bash
SOMA_QUEST_SURFACE_ENABLED=1 \
SOMA_QUEST_SURFACE_HOST=192.168.50.20 SOMA_QUEST_SURFACE_PORT=8793 \
# ...TLS key/cert/client-ca as v1a...
# ...four grant ids...
# [pending I] local STT / local model / local TTS adapter selection, no-remote-fallback assertion
npm start
```

The provider emits content-free lifecycle/metadata only; it logs no PCM, transcript, or answer
text.

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

## 7. No-retention audit — **[pending I]**

After close, verify no raw PCM, transcript, or answer text persists — on disk, in provider logs, or
in a live process buffer *(P4/P5)*. Item I defines the exact audit; it must be empty. Capture the
audit output as the retention evidence.

## Cleanup

Disarm the episode (instant), revoke each of the four grants, stop Soma. Remove the external TLS
directory when evidence no longer needs it; an installed APK still carries its packaged identity —
uninstall or replace it as part of cleanup.

## Open before this runbook is executable

- **[item I]** real local STT/model/TTS adapters, host loopback artifact (§4), no-retention audit
  (§7), and the exact arm surface (§3).
- **[item H]** bounded ≤200 ms drop-oldest capture/playback queues (20 ms = 1920 B mono / 3840 B stereo, 40 ms = 3840 B mono / 7680 B stereo, duration-bound ≤200 ms, per-stream isolated, synchronous flush) and `ANSWER_END` terminal (drain-then-clear, lifecycle latch preempts, exact lease/correlation, `BigInt` seq, stream 0 / late refusal) — fake-hardware-tested via `Threshold/docker/quest-build.sh` + `g++` + `node --test` (H production seam).
- Real `AudioRecord`/`AudioTrack` capture/playback and `RECORD_AUDIO` handling on device.
