# Quest surface v1b operator runbook — voice + panel round trip

Status: **Host path and Gate 2 operator surface BUILT; headset validation remains.** The v1b wire/consent
machinery (armed episode, four-leaf manifest, per-stream audio, correlated answer panel, fail-closed
latch) and the **real local-only answer route** (Whisper STT → local Gemma → Kokoro TTS behind the
abort-aware pipeline — interruptible, fail-closed, transcript-firewalled, no-retention, voice-brief)
are built and verified host-side against injected-fetch adapters (`npm run test:quest-v1b-loopback`).
The injected-adapter and live-services host loops have both run green. The remaining proof is the
worn headset validation of the built `AudioRecord`/`AudioTrack` path and Android permission shim.

**Gate 2 remains an explicit operator decision.** The loopback control API gives the local operator
an operational arm/disarm mechanism; it does not prove which same-account process or person issued
the command. Nothing here arms capture on its own, and the headset still requires its separate
Android microphone permission and a fresh authenticated session.

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
| P3 | **No** sensitive auto-resume | §6.4 re-don | Re-don alone stays `SUSPENDED`; one new right-A rising edge starts a short bounded resume that must prove the same armed episode and mint a fresh authenticated epoch + four fresh leases before content/capture returns |
| P4 | **No** persistence / retention | §7 audit | Post-close audit finds no raw PCM, transcript, or answer text on disk or in a live process |
| P5 | Local model destination only | §5 config + §7 audit | No remote egress during the answer route; provider bound to the local adapters with no fallback |
| N1 | Unarmed session | §6.1 | Four grants + mTLS present but no armed episode → no manifest issued, no capture offered |
| N2 | Expired / revoked episode mid-utterance | §6.6 | Revoke during capture → immediate latch, capture + in-flight STT/model/TTS aborted, PCM released, no answer |
| N3 | Wrong / stale lease, wrong epoch/revision | §6.6 | Refused before capture/playback; only the named stream torn down, session survives where the contract says so |
| N4 | Disconnect → offline, no-Soma recovery | §6.5 | Client latches terminal/offline; it does not use the doff-resume path or retry indefinitely |

## Safety and authority boundary

- Installing the APK, enrolling its certificate, holding any grant, or reaching Soma over TLS
  **creates no capture authority.** Presence of the four grants does not arm the microphone.
- Microphone capture requires an **armed episode window** (operator-only, explicit TTL clamped
  1 s–24 h) **and** an exact four-leaf manifest (`panel.present`, `mic_capture`,
  `audio.wearer_directed.present`, `model.context.audio.microphone.local.attach`). Audio never
  rides the panel lease.
- Presence loss and a viable transient OpenXR focus loss **latch this Activity fail-closed**:
  hardware capture and playback stop immediately, remote content and session state clear, and
  re-don/focus regain alone remains inert. One new right-A rising edge may start a short bounded
  resume. The server then requires the opaque handle minted for the still-current original armed
  episode, the exact four current grants/mode, and a distinct fresh epoch; the resumed manifest
  preserves that handle while minting four fresh lease ids. The client withholds panel and capture
  until its Java and native latches both clear.
- Transport loss, lease/episode expiry, disarm/revoke, OpenXR EXITING/LOSS_PENDING, Activity
  destroy, and true terminal failures are **terminal** for the current Activity. STOPPING and
  PAUSE/STOP after first focus are **resumable** (explicit A), pre-first-focus PAUSE/STOP/STOPPING
  inert. They never invoke resume unsolicited. Recovery after
  episode/disconnect termination requires the ordinary operator re-arm/relaunch path.
- The independent local mute latch is wearer-controlled and survives re-don; only a deliberate
  fresh-epoch resume clears it.
- A deliberate disarm followed by a new arm starts a fresh server-side episode latch. It does not
  revive the prior session or clear a terminal headset Activity; freshly launch the client.
- The answer route has a **local model destination only**. An unavailable or aborted local adapter
  fails closed; there is no remote fallback.
- Teardown acknowledgement never extends authority; a missing client ack governs only cleanup
  reporting.
- `LEASE_RENEWAL` is same-session continuity, not new authority: it preserves the exact four lease
  ids, episode handle, and every authority field, advances only generation/timing, and is issued
  around half-life only after revalidating the original episode, exact grants, mode, and provider.
  The client accepts it only before the old deadline when both server and monotonic local expiry
  strictly extend. One server push is made with no retry; the optional ACK is observational. A
  lost/invalid/late renewal leaves the old deadline intact, whose expiry is terminal. Renewal can
  never clear a resume latch.
- Native lifecycle callbacks do not perform socket, audio, executor-shutdown, or TLS work. Each
  `NativeActivity` owns one bounded control worker and immutable generation. Terminal and suspend
  have dedicated durable/coalesced slots ahead of the 30-command normal lane; pressure discards an
  observational bounds ACK first. START/RESUME admission and completion carry exact
  generation/sequence pairs, so an old Activity or stale result cannot reopen a replacement.
- Capture narrowing is not queued: focus/presence/pause/stop closes the Activity-owned capture gate
  and publishes PTT false before heavy suspend/terminal work. PTT false bypasses transport ACTIVE
  state. The native loop caps OpenXR event work, stops render calls while Android is paused, keeps a
  viable suspended session frame-pumped so a new A edge remains observable, and exits only after
  `APP_CMD_DESTROY`/`destroyRequested`. Init failure requests finish and continues pumping glue to
  that destroy boundary.

## 1. Development identities

Reuse the v1a disposable-identity procedure (`scripts/quest-surface-dev-tls.sh`, identities kept
outside the repo, fixed compatibility PKCS#12 password, treat APK + PKCS#12 as secret). See
`quest_surface_v1a.md` §1. No change for v1b.

## 2. Create the four exact grants, then restart

v1b authority is a manifest over four independently revocable leaves (the text-local mode). Create
each grant through the operator mutation surface, substituting the step-1 fingerprint. The four leaf
capabilities are shipped in the catalog; the three expansion leaves (text-remote, raw-audio-local/
remote) are defined but disabled and are **not** used here.

Start a temporary write-enabled Soma process and create four durable grants. Every grant carries the
same enrolled client-certificate SHA-256 fingerprint; the panel leaf also carries its surface/text
limits. Use `session` scope for the first three leaves and `window` for local attach.

```bash
SOMA_RUNTIME_WRITES_ENABLED=1 npm start

npm run cli -- grants create \
  --capability interaction.quest.surface.panel.present \
  --provider soma.provider.quest-surface-fixture --scope session \
  --reason "Authorize the bounded Quest v1b panel leaf." \
  --constraints-json '{"allowed_surface_ids":["panel.main"],"max_panel_text_bytes":2048,"lease_ttl_ms":60000,"device_fingerprint256":"CLIENT_SHA256_WITHOUT_COLONS"}' --json

npm run cli -- grants create \
  --capability interaction.quest.surface.microphone.capture \
  --provider soma.provider.quest-surface-fixture --scope session \
  --reason "Authorize the bounded Quest v1b microphone leaf." \
  --constraints-json '{"lease_ttl_ms":60000,"device_fingerprint256":"CLIENT_SHA256_WITHOUT_COLONS"}' --json

npm run cli -- grants create \
  --capability interaction.quest.surface.audio.wearer_directed.present \
  --provider soma.provider.quest-surface-fixture --scope session \
  --reason "Authorize the bounded Quest v1b wearer-audio leaf." \
  --constraints-json '{"lease_ttl_ms":60000,"device_fingerprint256":"CLIENT_SHA256_WITHOUT_COLONS"}' --json

npm run cli -- grants create \
  --capability model.context.audio.microphone.local.attach \
  --provider soma.provider.local-model --scope window \
  --reason "Authorize local attachment for one bounded Quest v1b window." \
  --constraints-json '{"lease_ttl_ms":60000,"device_fingerprint256":"CLIENT_SHA256_WITHOUT_COLONS"}' --json
```

Record each returned grant id, then stop this process. Grant creation is separate from arming and
runtime activation; it contacts no headset and arms no microphone. The Quest provider receives an
immutable authority snapshot at construction, so create all four grants **before** restarting it
with the §5 environment. Arming never creates, discovers, or refreshes a grant.

## 3. Arm the episode window — **Gate 2, Seth-only**

The armed episode is the consent act. The control binds the exact `text/local` mode, local-attach
capability, Quest answer provider, and configured local-attach grant. It requires an explicit
episode id, reason, provenance id, and TTL. Episode TTL is independent from the shorter manifest
lease TTL: the supported range is 1 second through 24 hours, the provider default is 1 hour, and a
worn validation should explicitly use 15 minutes. Arm **before** launching or deliberately
relaunching the headset client so the episode is evaluated at the natural HELLO-time issuance
point. Re-arm validates its complete request and exact grant tuple first, then atomically replaces
the RAM window in one command. A failed replacement leaves the prior episode and expiry timer
untouched; it does not partially disarm or extend the old window.

With the §5 process running:

```bash
npm run cli -- quest-surface status
npm run cli -- quest-surface arm \
  --episode-id quest-worn-2026-08-11-1 \
  --ttl-ms 900000 \
  --reason "Authorize one bounded worn Quest voice test." \
  --provenance-id gate/quest-v1b/worn-2026-08-11-1
```

The CLI talks only to Soma's existing loopback API at `127.0.0.1:8765`; it never exposes the Quest
mTLS listener on `:8793` as a control plane. `status` is content- and payload-byte-free and does not
refresh the TTL. The current boundary relies on loopback plus the single-user host convention; it
is an operational gate, not cryptographic proof that the human wearer typed the command. A future
Local Control Authenticator may strengthen that boundary, but it is not part of this slice.

Disarm is immediate, narrowing-only, and idempotent:

```bash
npm run cli -- quest-surface disarm --reason operator_disarmed
```

Disarm or episode expiry closes every issued session, latches capture/playback off, aborts in-flight
work, and makes doff-style resume ineligible. Re-arm and deliberately relaunch for a new episode and
fresh epoch. Process restart also clears the RAM-only arm state.

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
loopback cannot catch live-service behavior (the lesson: fakes hide live blockers). A runnable
harness drives one utterance through the *real* Whisper/Gemma/Kokoro, self-contained (it bootstraps
the question audio via real Kokoro, then STT → model → TTS), printing each stage as evidence:

```bash
# 1. bring the services up, host-published on 4001/4010/8000 (TheCommons):
docker compose -f docker-compose.gpu.yml up -d whisper-stt kokoro-tts gemma4-llm
# 2. run the live loopback (endpoints default to 127.0.0.1; override with
#    SOMA_WHISPER_URL / SOMA_KOKORO_URL / SOMA_LLM_URL if needed):
SOMA_QUEST_API_KEY="$INTERNAL_API_KEY" npm run quest-v1b-live-loopback
```

It health-gates the services first (clear bring-up hint if any is down), then prints the transcript
Whisper heard, the model's answer, and the TTS audio size, with per-stage latencies. It writes
nothing to disk; the provider-level no-retention audit is proven by the mocked loopback (§7) and
repeated on device. A coherent answer here clears the last host-side unknown before Gate 2.

## 5. Start the real-compute-wired provider

Start Soma with the v1b listener and set `SOMA_QUEST_SURFACE_REAL_ANSWER=1` to attach the **local**
STT/model/TTS adapters (no remote fallback). Absent the flag, the listener runs the fixture answer
path (useful for wire/consent testing without the services).

```bash
SOMA_QUEST_SURFACE_ENABLED=1 \
SOMA_QUEST_SURFACE_HOST=192.168.50.20 SOMA_QUEST_SURFACE_PORT=8793 \
# ...TLS key/cert/client-ca as v1a...
SOMA_QUEST_SURFACE_PANEL_GRANT_ID=grant-panel-id \
SOMA_QUEST_SURFACE_MIC_CAPTURE_GRANT_ID=grant-mic-id \
SOMA_QUEST_SURFACE_AUDIO_PRESENT_GRANT_ID=grant-audio-id \
SOMA_QUEST_SURFACE_LOCAL_ATTACH_GRANT_ID=grant-local-id \
SOMA_QUEST_SURFACE_REAL_ANSWER=1 \
SOMA_WHISPER_URL=http://127.0.0.1:4001 SOMA_KOKORO_URL=http://127.0.0.1:4010 SOMA_LLM_URL=http://127.0.0.1:8000 \
npm start
```

`SOMA_QUEST_SURFACE_GRANT_ID` remains a compatibility alias for the panel id; when both panel names
are set, they must match. All four ids are otherwise required, distinct, and resolved exactly.

The provider emits content-free lifecycle/metadata only; it logs no PCM, transcript, or answer text.
The answer is voice-brief by default (short spoken sentences); a long answer offers to say more.

## 6. Device exercise — the round trip

Build the APK in the pinned container as in v1a §4 (`RECORD_AUDIO` permission is requested at first
capture; granting it is a device-side deliberate act, not a standing authority). Then:

1. **On.** Arm with §3, then freshly launch the client and don the headset; wait for OpenXR
   `FOCUSED` + affirmative presence. Client completes
   mTLS, consumes the epoch, and — only within the armed episode — receives the four-leaf manifest.
   *(N1: with no armed episode, no manifest issues; capture is never offered.)*
2. **Ask.** Speak one utterance. VAD gates uplink; capture frames flow on a nonzero stream.
3. **Answer.** Hear the wearer-directed TTS answer; the answer panel shows the answer text (and the
   recognized-input transcript when the provider emits one), correlated to the audio by `answer_id`.
   *(P1)*
4. **Off / re-don / A.** Remove the headset mid- and post-utterance. Capture + playback stop
   immediately *(P2)*. Re-don and focus regain alone leave the local-only `SUSPENDED — PRESS A TO
   RESUME` shell inert: no old panel and no capture. A trigger press, held A from before doff, or
   mode-toggle traffic must not resume. Press and release right A once after return. Confirm one
   short `RESUMING…` window, a fresh epoch and four fresh lease ids under the same episode, then the
   fresh panel/capture path *(P3)*. The resume A press must not also toggle PTT/VAD, and trigger must
   be observed released once before PTT is eligible.
5. **Unplug.** Drop the network / stop Soma. Client latches terminal/offline and does not enter the
   doff-resume flow or retry indefinitely *(N4)*.
6. **Negatives.** Exercise mid-utterance revoke *(N2)*, wrong/stale lease and wrong epoch/revision
   *(N3)*, disarm while suspended/resuming, re-arm with a replacement episode,
   malformed/wrong-handle resume intent, and a dropped renewal. Each remains off or expires at the
   old deadline; no case may play audio, display capability content, or leave retained state.

## 7. No-retention audit

The loopback (§4) already asserts the automated audit: the transcript, answer text, and raw PCM
never appear in the provider's logs or emitted events, and no session state is retained after close
*(P4/P5)*. For the **live** run, additionally confirm no raw PCM/transcript/answer persists on disk
or in a live process buffer after close, and capture that as the retention evidence. The provider is
built to emit content-free metadata only; the audit is the proof, not the promise.

## Cleanup

Run `npm run cli -- quest-surface disarm` (instant), revoke each of the four grants, then stop Soma.
Remove the external TLS
directory when evidence no longer needs it; an installed APK still carries its packaged identity —
uninstall or replace it as part of cleanup.

## Remaining before headset validation

**Built (host-side):** item H (bounded ≤200 ms drop-oldest queues + `ANSWER_END`
terminal), item I (mode-matrix enforcement, the four leaves, the real Whisper→Gemma→Kokoro answer
route, the `SOMA_QUEST_SURFACE_REAL_ANSWER` runtime flag, exact-grant/fingerprint enforcement, the
loopback arm/status/disarm surface, and the loopback + no-retention audit). All are verified against
injected-fetch adapters / fake hardware.

**Remaining before the headset run:**
- ~~Real `AudioRecord`/`AudioTrack` capture/playback and `RECORD_AUDIO` handling on device.~~
  **BUILT + host-verified 2026-08-10** (device-audio slice; see
  `docs/design/2026-08-10_quest-v1b-device-audio-scope.md`). Real `AudioTrack` playback hardware
  (`QuestSurfaceAudioHardware`), `RECORD_AUDIO` permission (declared + runtime-requested, fail-closed
  on denial, grant does not arm), and a continuous VAD-gated `AudioRecord` capture driver
  (`QuestSurfaceCaptureDriver` + `QuestSurfaceVad`) wired above the transport. 55/55 JVM tests green.
  The mic opens only within the armed episode and closes the instant eligibility drops; on-device
  behavior (does the mic hear Seth, is playback audible) is the worn test itself.
- The **live-services loopback** (§4) — one host-side utterance through the real
  Whisper/Gemma/Kokoro services. The ultimate pre-Gate-2 proof; the mocked loopback cannot catch
  live-service behavior. **(Ran green earlier: real ~2.7 s round trip, voice-brief answer.)**
- **APK build + install** — build in the pinned Threshold container (needs the external dev-TLS
  identities from v1a §1) and `adb install`; then server config (§5) and Gate 2 (§3, Seth arms).
- ~~The operator-facing arm surface.~~ **BUILT + host-verified 2026-08-11:** the loopback CLI/API
  exposes fixed `text/local` arm, byte-free status, and idempotent disarm without putting control on
  the device listener. The residual same-user attribution limitation is explicit in §3.
