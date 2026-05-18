# Sensorium Live Smoke Workflow

This runbook verifies the real helper-backed Sensorium path without creating default subscriptions,
recording payloads, decoding frames, or writing durable grants.

Use it only when a Sensorium publisher is available and the operator intends to start a bounded
session subscription.

## Preconditions

- Commands are run from the Soma repository root.
- The Soma service is not already using the target port, unless `SOMA_PORT` is set intentionally.
- The Sensorium broker helper has been built.
- The operator has chosen a low-risk topic first. Prefer `sensor/jetsorano/status`.
- The operator understands that runtime grants and subscriptions are process-local.
- `config/grants.json` does not need to contain Sensorium grants.

## Start Soma With Sensorium Enabled

Build the helper:

```bash
cargo build -p soma-sensor-broker
```

Start Soma with Sensorium explicitly enabled in a dedicated terminal:

```bash
SOMA_SENSORIUM_ENABLED=1 npm start
```

If the helper binary is outside the default cargo target path, provide it explicitly:

```bash
SOMA_SENSORIUM_ENABLED=1 \
SOMA_SENSOR_BROKER=/path/to/soma-sensor-broker \
npm start
```

Startup should log that the Sensorium runtime is enabled. If helper startup fails, Soma should exit
with `sensorium_runtime_start_failed` rather than silently disabling Sensorium.

## Optional Guarded Wrapper

The manual commands below remain the canonical workflow. A guarded wrapper can run the same
status-topic-first sequence after the service is already started:

```bash
SOMA_SENSORIUM_ENABLED=1 SOMA_SENSORIUM_LIVE_SMOKE=1 npm run sensorium:smoke -- --dry-run
SOMA_SENSORIUM_ENABLED=1 SOMA_SENSORIUM_LIVE_SMOKE=1 npm run sensorium:smoke
```

The wrapper refuses unless both `SOMA_SENSORIUM_ENABLED=1` and
`SOMA_SENSORIUM_LIVE_SMOKE=1` are present in its environment. It prints the exact CLI commands
before executing them, creates only process-local runtime grants, waits briefly for metadata-only
sample counters, and does not record, decode, or preprocess payloads. The default observation wait
is three seconds; override it with `--observe-seconds 1..60`. A run that opens and stops a
subscription but observes zero samples fails with `no_samples_observed`.

The default wrapper target is the low-risk status topic:

```text
capability: perception.sensorium.status.subscribe
provider: soma.provider.sensorium.jetsorano
topic: sensor/jetsorano/status
max_seconds: 30
observe_seconds: 3
```

To use a different target, provide the full explicit tuple so partial retargeting cannot happen by
accident:

```bash
SOMA_SENSORIUM_ENABLED=1 SOMA_SENSORIUM_LIVE_SMOKE=1 npm run sensorium:smoke -- \
  --capability perception.sensorium.status.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/status \
  --max-seconds 30 \
  --observe-seconds 3
```

## Confirm No Subscription Is Active

```bash
npm run cli -- sensorium subscriptions
```

Expected posture:

- the command succeeds only when `sensoriumSubscriber` is configured
- `active: 0` before this workflow starts a subscription
- no payloads, frame contents, decoded samples, or raw sensor values are displayed

## Create Review Intent

Generate a review-only template:

```bash
npm run cli -- sensorium proposal-template \
  --capability perception.sensorium.status.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/status \
  --reason "Smoke test status/liveness subscription." \
  --max-seconds 30
```

Store the proposal:

```bash
npm run cli -- sensorium propose \
  --capability perception.sensorium.status.subscribe \
  --provider soma.provider.sensorium.jetsorano \
  --topic sensor/jetsorano/status \
  --reason "Smoke test status/liveness subscription." \
  --max-seconds 30
```

Record the returned `proposal` id.

## Approve And Create Runtime Grant

Approve the proposal:

```bash
npm run cli -- proposals approve proposal-id --scope session --by user
```

Create the runtime session grant:

```bash
npm run cli -- sensorium grant-create proposal-id --by user
```

Record the returned `grant` id. This does not mutate `config/grants.json` and does not start a
subscription.

## Start List Stop

Start a bounded status subscription:

```bash
npm run cli -- sensorium subscribe-start \
  --capability perception.sensorium.status.subscribe \
  --topic sensor/jetsorano/status \
  --max-seconds 30
```

Record the returned `subscription` id.

Inspect active disclosure:

```bash
npm run cli -- sensorium subscriptions
```

Expected posture:

- active count is at least 1 during the subscription window
- output includes subscription id, capability, topic, grant id, and expiry metadata
- output does not include payloads, decoded samples, frame contents, screenshots, or raw sensor
  values

Stop the subscription:

```bash
npm run cli -- sensorium subscribe-stop subscription-id
```

Inspect active disclosure again:

```bash
npm run cli -- sensorium subscriptions
```

Expected posture:

- active count returns to 0
- stop response reports metadata-only subscription-ended provenance

## Revoke The Runtime Grant

```bash
npm run cli -- sensorium grant-revoke grant-id --by user --reason "Smoke test complete."
```

Expected posture:

- grant status becomes `revoked`
- `file written: no`
- no subscription is activated by revocation
- any active subscription tied to the grant would be stopped with termination reason `revoked`

## Failure Checks

These failures are expected and useful:

- Running subscription commands without `SOMA_SENSORIUM_ENABLED=1` returns
  `sensorium_subscriber_not_configured`.
- Starting without an active runtime grant returns `sensorium_subscription_no_grant`.
- Starting a topic outside the grant's exact topic returns `sensorium_subscription_topic_not_authorized`.
- Requesting constraints above the grant bounds returns
  `sensorium_subscription_grant_constraints_exceeded`.

Do not work around these failures by adding default Sensorium grants to `config/grants.json`.
