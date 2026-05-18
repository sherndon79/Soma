# Sensorium Live Smoke Verification

**Date:** 2026-05-17
**Scope:** Real helper-backed run of the guarded Sensorium live smoke wrapper against a Soma service
started with `SOMA_SENSORIUM_ENABLED=1`.

## Commands Exercised

- `cargo build -p soma-sensor-broker`
- `SOMA_PORT=8876 SOMA_SENSORIUM_ENABLED=1 npm start`
- `SOMA_URL=http://127.0.0.1:8876 SOMA_SENSORIUM_ENABLED=1 SOMA_SENSORIUM_LIVE_SMOKE=1 npm run sensorium:smoke`
- post-run checks with `node src/cli.js sensorium subscriptions --json`,
  `node src/cli.js grants list --json`, and `node src/cli.js provenance list --json`

The local server listen required escalation outside the sandbox because binding
`127.0.0.1:8876` failed inside the sandbox with `listen EPERM`.

## Result

Partial success.

Confirmed:

- the Rust `soma-sensor-broker` builds
- Soma starts with Sensorium runtime enabled
- the guarded wrapper can create a proposal, approve it, create a runtime session grant, start a
  bounded status subscription, stop it, and revoke the grant
- cleanup leaves `active_count: 0`
- runtime grants remain process-local and are revoked after the run
- provenance remains metadata-only: `frames_recorded: false`, `text_content_included: false`

Not confirmed:

- the status publisher delivered samples on `sensor/jetsorano/status`

The stricter wrapper now waits three seconds before stopping and fails with
`no_samples_observed` when `frames_consumed` remains zero. The observed run opened a subscription
for three seconds and consumed zero samples.

## Follow-Up Findings

`jetsorano` is reachable on the LAN:

```text
PING jetsorano.local.sthnet.org (192.168.20.179): 1 packet transmitted, 1 received
```

SSH was not used for publisher inspection because host key verification failed. That should be
resolved deliberately before remote commands are run on the node; do not bypass host identity just
to make the smoke pass.

## Disposition

The Soma-side control path is good enough to keep. The smoke wrapper correctly distinguishes
"control path completed" from "publisher sample observed" and now fails when no samples arrive.

The next slice should diagnose Sensorium publisher delivery on `jetsorano`: confirm the publisher
service is running, confirm the status topic name, confirm Zenoh peer discovery/routing between
the workstation and node, then rerun the guarded smoke wrapper.
