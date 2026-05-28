# Remote Graphical Startup Review

This runbook verifies the review-only startup posture surface for the future live
Sunshine/Moonlight broker manager. It is intentionally a local planning review, not live broker
startup.

This is a CLI-only operator automation surface. Soma does not expose a
`/remote-graphical/startup-review` HTTP route for this fixture.

Before any startup-review output is used to justify route or runtime activation, review the
[Remote Graphical Live Broker Activation Checklist](../concepts/drafts/remote_graphical_live_broker_activation_checklist.md).

## Commands

Run the human-readable startup review:

```bash
npm run cli -- remote-graphical startup-review
```

Run the machine-readable startup review:

```bash
npm run cli -- remote-graphical startup-review --json
```

Both commands read only:

```text
docs/fixtures/remote-graphical-live-provider-manifest.json
```

They do not require the Soma service to be running.

## Expected Text Markers

The text output should include:

- `Remote graphical live broker startup review`
- `review only: yes`
- `eligible: yes`
- `eligibility: eligible`
- `provider: soma.provider.remote_desktop.sunshine`
- `target host: soma-agent-desktop.local.sthnet.org`
- `manifest loaded: yes`
- `helper binary reviewed: yes`
- `manager constructed: no`
- `helper started: no`
- `broker called: no`
- `session opened: no`
- `live transport used: no`

Eligible startup posture means the reviewed fixture can satisfy the pure planner's preconditions.
It does not mean the manager was constructed, the helper was started, or live activation occurred.

## Expected JSON Markers

The `--json` output should include:

```json
{
  "type": "remote_graphical_live_broker_startup_review",
  "review_only": true,
  "runtime_loaded": false,
  "manager_constructed": false,
  "helper_started": false,
  "broker_called": false,
  "session_opened": false,
  "pairing_performed": false,
  "video_attached": false,
  "input_dispatched": false,
  "recording_started": false,
  "provider_session_stopped": false,
  "model_delivery": false,
  "live_transport_used": false
}
```

The embedded `plan` object should include:

```json
{
  "eligible": true,
  "eligibility": "eligible",
  "manager_constructed": false,
  "helper_started": false,
  "broker_called": false,
  "session_opened": false,
  "live_transport_used": false
}
```

The portable example fixture is:

```text
docs/fixtures/remote-graphical-startup-review-output.example.json
```

The fixture normalizes the workspace-absolute helper binary path to
`<repo-root>/target/debug/soma-moonlight-broker`; the live CLI output should still report the
actual local path it reviewed.

## Source Guard Refusals

The command should fail locally before fixture review or service requests when a caller tries to
select another manifest or helper source.

Unsupported explicit manifest path:

```bash
npm run cli -- remote-graphical startup-review \
  --manifest-path /tmp/operator-manifest.json
```

Expected marker:

```text
usage_error: remote-graphical startup-review does not accept --manifest-path
```

Unsupported helper override:

```bash
npm run cli -- remote-graphical startup-review \
  --helper-binary /tmp/operator-helper
```

Expected marker:

```text
usage_error: remote-graphical startup-review does not accept --helper-binary
```

Unsupported positional path:

```bash
npm run cli -- remote-graphical startup-review /tmp/operator-manifest.json
```

Expected marker:

```text
usage_error: remote-graphical startup-review does not accept manifest paths or positional source inputs
```

These refusal checks do not need a running Soma service.

## Non-Activation Boundary

This review does not:

- call an HTTP route
- read runtime provider registry state
- construct `RemoteGraphicalLiveBrokerManager`
- start `soma-moonlight-broker`
- call Sunshine or Moonlight
- open a session
- pair or persist credentials
- write grants
- append provenance
- attach video
- dispatch input
- deliver visual payloads to a model

If any future change makes this review depend on a running Soma service, helper startup, or live
broker construction, stop and review the activation checklist before continuing.
