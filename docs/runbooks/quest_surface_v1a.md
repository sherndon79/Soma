# Quest surface v1a operator runbook

Status: implemented fixture/client path; container build and positive live Quest path verified.
The live negative-path suite remains open.

v1a presents one bounded UTF-8 snapshot panel through Soma's
`interaction.quest.surface.panel.present` capability. It does not enable audio, controller/hand/gaze
input, scene/camera/depth access, head-pose export, arbitrary assets, or durable spatial state.
Passthrough is compositor-owned: the client receives no camera pixels.

## Positive live evidence — 2026-08-09

The first live client reached OpenXR `FOCUSED`, affirmative presence, passthrough rendering, and
approximately 72 FPS, but failed before TLS. Bounded client diagnostics established the exact
cause: Android's PKCS12 implementation rejected the empty identity-container password before a
socket handshake. The development identity was re-exported with the fixed compatibility password
documented below; its certificate fingerprint remained unchanged.

The rebuilt APK (`sha256:57f0a52c8ffd858796a9bbf364db41d4c8147b15eb53843ca59c3626f00210d0`)
then completed mTLS with the exact grant-bound client fingerprint, consumed a fresh lease and
snapshot, composed a frame, and acknowledged `displayed: true` with actual bounds of approximately
`0.9 m × 0.5 m`. The acknowledgement is protocol evidence emitted only after a successful composed
frame; it is not a claim about wearer-observed legibility or comfort.

At the configured 60-second lease boundary, the fixture closed the exact expired epoch. While the
app remained focused and present, the client re-authenticated into a new epoch, consumed a new
lease, and acknowledged another composed snapshot. This establishes that the expired lease did not
remain authorizing; it does not establish re-don non-resume, which requires a separate lifecycle
exercise.

This closes only the positive v1a path. No-listener, wrong-grant, stale/mismatched content,
focus/presence loss, re-don non-resume, and independent local-stop behavior still require live
exercise. The v1b manifest/audio protocol, per-stream sequencing, paired-answer validation, and
local lifecycle latch are now integrated in the Java client and exercised with fake/no-op hardware.
Real `AudioRecord`/`AudioTrack`, microphone permission, live playback/capture, and the separate
bounded queue/backpressure milestone remain unstarted and require their own operator gate.

## Safety and authority boundary

- Installing the APK, enrolling its certificate, enabling the listener, or reaching it over TLS
  creates no presentation authority.
- Soma requires an exact active session grant for the fixture provider before it issues a lease.
- OpenXR `FOCUSED` and affirmative `XR_EXT_user_presence` are device-side hard preconditions.
- Focus or presence loss clears capability content and permanently latches this Activity instance
  suspended. Re-don does not resume it. Exit and deliberately relaunch to negotiate a fresh epoch
  and lease.
- The system exit/back path is a local stop independent of workstation reachability.

## 1. Create disposable development identities

Keep identities outside the repository. Supply a DNS name and IP that both reach the Soma host from
the Quest; the server certificate contains both SANs.

```bash
scripts/quest-surface-dev-tls.sh \
  /path/outside/repos/soma-quest-v1a-tls \
  soma-workstation.example.internal \
  192.168.50.20
```

The command refuses a nonempty destination and prints the normalized client SHA-256 fingerprint.
The `client-assets` directory intentionally contains only the PKCS#12 identity and server CA that
will be packaged in a test APK. The CA private key and server key remain outside that directory.
These 30-day identities are development material; remove them after the exercise and build a new
APK before a later run. The PKCS#12 uses a fixed, nonempty development compatibility password that
is also compiled into the client because Android rejects an empty password before TLS begins. This
offers no protection against extracting the packaged identity; treat the APK and PKCS#12 as secret
material despite the container password.

## 2. Create the exact grant

Start Soma with its existing explicit durable-write opt-in, then create the grant through the
operator mutation surface. Substitute the fingerprint printed in step 1.

```bash
SOMA_RUNTIME_WRITES_ENABLED=1 npm start

npm run cli -- grants create \
  --capability interaction.quest.surface.panel.present \
  --provider soma.provider.quest-surface-fixture \
  --scope session \
  --reason "Authorize one bounded Quest v1a test panel session." \
  --constraints-json '{"allowed_surface_ids":["panel.main"],"max_panel_text_bytes":512,"lease_ttl_ms":60000,"device_fingerprint256":"CLIENT_SHA256_WITHOUT_COLONS"}'
```

Record the returned grant id. Grant creation is separate from runtime activation and does not start
the listener or contact the headset.

## 3. Start the explicitly opted-in fixture

Stop the write-enabled process if it is still running, then start Soma with the v1a listener. The
default bind address is loopback; a Quest exercise requires the explicit LAN address.

```bash
SOMA_QUEST_SURFACE_ENABLED=1 \
SOMA_QUEST_SURFACE_HOST=192.168.50.20 \
SOMA_QUEST_SURFACE_PORT=8793 \
SOMA_QUEST_SURFACE_TLS_KEY=/path/outside/repos/soma-quest-v1a-tls/server/server.key \
SOMA_QUEST_SURFACE_TLS_CERT=/path/outside/repos/soma-quest-v1a-tls/server/server.pem \
SOMA_QUEST_SURFACE_CLIENT_CA=/path/outside/repos/soma-quest-v1a-tls/server/client-ca.pem \
SOMA_QUEST_SURFACE_GRANT_ID=RETURNED_GRANT_ID \
SOMA_QUEST_SURFACE_LEASE_TTL_MS=60000 \
SOMA_QUEST_SURFACE_PANEL_TEXT="SOMA QUEST V1A" \
npm start
```

The provider requires TLS 1.3 client authentication. It emits content-free lifecycle and document
metadata; it does not log panel text or payload bytes.

## 4. Build the test APK in the pinned Quest container

The Gradle property host must match a server-certificate DNS/IP SAN. Only the exact `client-assets`
directory from step 1 should be staged. The Threshold runner deliberately mounts only its source
tree, so copy the two files into the client's gitignored `local-tls` directory for the duration of
the build. Check `git status --short` before and after: neither identity may appear.

```bash
install -d -m 0700 clients/quest-surface/local-tls
install -m 0600 \
  /path/outside/repos/soma-quest-v1a-tls/client-assets/quest_client_identity.p12 \
  clients/quest-surface/local-tls/quest_client_identity.p12
install -m 0644 \
  /path/outside/repos/soma-quest-v1a-tls/client-assets/quest_server_ca.pem \
  clients/quest-surface/local-tls/quest_server_ca.pem

../Threshold/docker/quest-build.sh clients/quest-surface -- \
  ./gradlew clean testDebugUnitTest assembleDebug --no-daemon \
  -PquestServerHost=192.168.50.20 \
  -PquestServerPort=8793 \
  -PquestTlsAssetsDir=/workspace/local-tls

rm clients/quest-surface/local-tls/quest_client_identity.p12 \
  clients/quest-surface/local-tls/quest_server_ca.pem
rmdir clients/quest-surface/local-tls
git status --short
```

The output is `clients/quest-surface/app/build/outputs/apk/debug/app-debug.apk`. The build container
is the only supported Android/OpenXR build environment for this client.

## 5. Device exercise

Install and launch the APK through the established Quest ADB path. Expected flow:

1. Local shell waits until both OpenXR focus and presence are valid.
2. The client authenticates with mTLS, advertises protocol version 1, consumes a fresh session epoch
   and exact lease, then validates the snapshot bytes/hash/revision/TTL.
3. The view-space panel appears over passthrough. Soma receives an actual-bounds acknowledgement
   only after a successful composed frame.
4. Press the system/exit control or remove the headset. The remote panel disappears immediately;
   on re-don the app remains `SUSPENDED` until exit and deliberate relaunch.

Also exercise these negative paths: no Soma listener, client certificate omitted, wrong grant,
expired/stale lease, mismatched asset hash/length, and focus/presence loss. No negative case may
display capability content.

## Cleanup

Revoke the grant through the existing operator surface and stop Soma. Remove the external TLS
directory when the test evidence no longer needs the identity. Deleting the directory invalidates
future rebuilds but cannot remove an identity already packaged in an installed APK; uninstall or
replace that APK as part of cleanup.
