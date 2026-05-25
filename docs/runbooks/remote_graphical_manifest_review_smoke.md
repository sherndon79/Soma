# Remote Graphical Manifest Review Smoke

This runbook verifies the local review-only surface for the future live Sunshine/Moonlight provider
manifest. It is intentionally a fixture review, not a live graphical broker smoke.

## Commands

Run the human-readable review:

```bash
npm run cli -- remote-graphical manifest-review
```

Run the machine-readable review:

```bash
npm run cli -- remote-graphical manifest-review --json
```

Both commands read only:

```text
docs/fixtures/remote-graphical-live-provider-manifest.json
```

They do not require the Soma service to be running.
The command remains fixture-only by policy; see
[Remote Graphical Manifest Selection Policy](../concepts/drafts/remote_graphical_manifest_selection_policy.md)
before adding `--manifest-path`, stdin, URL input, or runtime manifest loading.
Current CLI behavior rejects those source-selection flags locally.

## Source Guard Refusals

The command should fail locally before fixture review or service requests when a caller tries to
select another manifest source.

Unsupported explicit path:

```bash
npm run cli -- remote-graphical manifest-review \
  --manifest-path /tmp/operator-manifest.json
```

Expected marker:

```text
usage_error: remote-graphical manifest-review does not accept --manifest-path
```

Unsupported stdin source:

```bash
npm run cli -- remote-graphical manifest-review --stdin
```

Expected marker:

```text
usage_error: remote-graphical manifest-review does not accept --stdin
```

Unsupported positional path:

```bash
npm run cli -- remote-graphical manifest-review /tmp/operator-manifest.json
```

Expected marker:

```text
usage_error: remote-graphical manifest-review does not accept manifest paths or positional source inputs
```

These refusal checks do not need a running Soma service.

## Expected Text Markers

The text output should include:

- `Remote graphical live provider manifest`
- `provider: soma.provider.remote_desktop.sunshine`
- `runtime: remote-graphical-session`
- `target hosts: soma-agent-desktop.local.sthnet.org`
- `default enabled: no`
- `review only: yes`
- `runtime loaded: no`
- `provider registry entry: no`
- `broker construction: no`
- `activation blockers: not in provider registry; not loaded by server startup; no broker construction`

The activation boundary line should continue to state that manifest review is not live transport,
pairing, observation, input, recording, grant write, or model delivery.

## Expected JSON False Flags

The `--json` output should include these top-level false flags:

```json
{
  "runtime_loaded": false,
  "provider_registry_entry": false,
  "broker_construction": false,
  "activation_performed": false,
  "live_transport_used": false,
  "grant_written": false,
  "session_opened": false,
  "input_dispatched": false,
  "video_attached": false,
  "model_delivery_performed": false
}
```

The embedded `manifest` object should also keep:

```json
{
  "default_enabled": false,
  "review_only": true,
  "runtime_loaded": false,
  "provider_registry_entry": false,
  "broker_construction": false
}
```

## Non-Activation Boundary

This smoke does not:

- call an HTTP route
- read the runtime provider registry
- construct a broker
- call Sunshine or Moonlight
- open a session
- pair or persist credentials
- write grants
- append provenance
- attach video
- dispatch input
- deliver visual payloads to a model

If any future change makes this smoke depend on a running Soma service, a provider registry entry,
or a configured live broker, stop and review the activation boundary before continuing.
