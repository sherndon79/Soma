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

## Addendum: Cross-Subnet Discovery

Follow-up inspection found the publisher host on `192.168.20.0/24` and the workstation on
`192.168.21.0/24`. Zenoh default multicast discovery does not cross that routed boundary, so
Soma needs an explicit Zenoh client config for this topology.

## Addendum: Explicit Zenoh Config Success

Soma now accepts `SOMA_SENSORIUM_ZENOH_CONFIG` and passes that path into the sensor broker helper
as `zenoh_config_path`.

Using an explicit client config pointed at the current Sensorium endpoint:

```text
tcp/192.168.20.179:37183
```

the guarded smoke wrapper completed successfully:

```text
Observation wait: 8 second(s).
Observed sample count: 1
Sensorium live smoke completed.
```

Post-run checks confirmed `active_count: 0`, the runtime grant was revoked, and provenance stayed
metadata-only. This validates the Soma/helper path across the routed subnet when the Zenoh endpoint
is explicit.

Remaining durability concern: the endpoint above came from Sensorium startup logs and uses a
dynamic Zenoh listen port. A durable deployment should pin the Sensorium listener on the publisher
side, then point Soma's client config at that stable endpoint.

## Addendum: Stable Endpoint Success

Sensorium on `jetsorano` was restarted with a fixed plain-TCP Zenoh listener:

```text
tcp/192.168.20.179:7447
```

Soma's example client config now points at that stable endpoint. A fresh Soma service started with
`SOMA_SENSORIUM_ZENOH_CONFIG=config/sensorium-zenoh-client.example.json5` used that fixed listener
instead of a dynamic port from Sensorium logs.

The guarded smoke wrapper completed successfully:

```text
Observation wait: 8 second(s).
Observed sample count: 2
Sensorium live smoke completed.
```

Post-run checks confirmed `active_count: 0`, the runtime grant was revoked, and provenance stayed
metadata-only with `frames_consumed: 2`, `frames_recorded: false`, and
`text_content_included: false`.
