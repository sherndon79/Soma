# Remote Graphical Live Provider Manifest

Status: manifest draft, no live Sunshine/Moonlight calls enabled

This draft describes the provider metadata Soma should require before a Sunshine/Moonlight-backed
remote graphical broker can be configured as a live provider. It is deliberately declarative: a
manifest may make support visible for review, but it must not construct a broker, open a session,
pair with Sunshine, start Moonlight, capture frames, dispatch input, record, or deliver visual
payloads to a model.

The existing `soma.provider.remote_desktop.sunshine` provider registry entry remains only a support
claim. This draft defines the fuller live-provider metadata required before that claim can be
connected to a broker.

## Manifest Purpose

A live provider manifest should answer these questions before runtime code is allowed to load a
broker:

- which provider identity is being configured
- which target hosts and locality classes are allowed
- which broker actions are implemented
- which capability contracts each action can satisfy
- which authorities remain disabled even if the provider is reachable
- which runtime opt-ins and operator disclosures are required
- how bounded status, session-open, cleanup, and provenance behave
- what rollback path exists for the target node or host

The manifest is not a grant. It does not authorize observation, input, disconnect, recording,
pairing, credential persistence, durable writes, or model delivery.

## Required Fields

A live remote graphical provider manifest should include at least:

```json
{
  "id": "soma.provider.remote_desktop.sunshine",
  "manifest_version": "soma.remote_graphical.provider_manifest.v1",
  "provider_contract": "soma.remote_graphical.broker.v1",
  "runtime": "remote-graphical-session",
  "implementation": {
    "broker_kind": "moonlight-client-broker",
    "transport": "sunshine-moonlight",
    "construction": "explicit-runtime-injection"
  },
  "default_enabled": false,
  "required_runtime_opt_ins": [
    "SOMA_REMOTE_GRAPHICAL_ENABLED=1",
    "SOMA_REMOTE_GRAPHICAL_PROVIDER=soma.provider.remote_desktop.sunshine"
  ],
  "target_constraints": {
    "allowed_hosts": ["soma-agent-desktop.local.sthnet.org"],
    "locality": ["lan"],
    "attended_required": true,
    "operator_rollback": "graphical lab base snapshot or documented host rollback"
  },
  "supported_actions": [
    {
      "action": "status",
      "requires_grant": false,
      "live_transport_allowed": false
    },
    {
      "action": "open_session",
      "requires_grant": true,
      "requires_user_actor": true,
      "requires_review": true,
      "live_transport_allowed": true,
      "must_not_enable": ["video", "input", "recording", "model_delivery"]
    }
  ],
  "disabled_authorities": [
    "pairing",
    "credential_persistence",
    "video_observation",
    "screenshot_capture",
    "ocr",
    "pointer_input",
    "keyboard_input",
    "clipboard",
    "file_transfer",
    "audio",
    "controller_input",
    "recording",
    "model_visual_delivery",
    "durable_grant_writes"
  ]
}
```

The concrete file format can be JSON or another structured format, but the loaded shape should be
schema-checked before it can influence runtime provider construction.

The first pure schema scaffold is `validateRemoteGraphicalLiveProviderManifest`. It validates the
documented shape without loading manifests into runtime broker construction.

## Review Fixture

A non-runtime review fixture lives at:

```text
docs/fixtures/remote-graphical-live-provider-manifest.json
```

The fixture is review evidence only. It is not in `config/provider-registry.json`, is not loaded by
server startup, and does not construct a live broker.

Operators can validate the fixture with:

```bash
node --test test/remoteGraphicalLiveProviderManifest.test.js
```

The pure `remoteGraphicalLiveProviderManifestReviewText` formatter can render a validated manifest
for operator review. The CLI exposes that formatter for the docs fixture only:

```bash
npm run cli -- remote-graphical manifest-review
```

The CLI path does not add an HTTP route, provider registry entry, runtime manifest loader, or broker
construction path.

Operator smoke expectations for this command live in
[Remote Graphical Manifest Review Smoke](../../runbooks/remote_graphical_manifest_review_smoke.md).
Startup posture review examples for the same fixture live in
[Remote Graphical Startup Review](../../runbooks/remote_graphical_startup_review.md).
The source-selection boundary for this command is defined by
[Remote Graphical Manifest Selection Policy](./remote_graphical_manifest_selection_policy.md).

## Implemented Review Thread

The current manifest thread is review-only and ends before runtime loading:

```text
manifest draft
  -> pure validator
  -> repository fixture
  -> pure review formatter
  -> CLI fixture review
  -> smoke expectations
  -> fixture source-selection policy
  -> local source-selection guard
```

Implemented pieces:

- `validateRemoteGraphicalLiveProviderManifest` validates the future live manifest shape without
  loading it at runtime.
- `docs/fixtures/remote-graphical-live-provider-manifest.json` is the only reviewed fixture source.
- `remoteGraphicalLiveProviderManifestReviewText` renders operator-facing text after validation.
- `remote-graphical manifest-review` reads only the repository fixture and supports text or JSON
  output.
- the smoke runbook records expected non-activation markers and source-selection refusals.
- the selection policy keeps external manifest paths, stdin, URLs, provider ids, environment-selected
  paths, and runtime manifest directories out of scope.
- the CLI guard rejects source-selection flags and positional manifest paths locally.

Current non-activation invariants:

- no HTTP manifest-review route
- no runtime manifest loader
- no provider registry mutation or manifest-backed provider selection
- no broker construction
- no Sunshine/Moonlight calls
- no live transport, pairing, video, input, recording, grant write, provenance append, or model
  delivery

The next true activation boundary is not another review formatter. It is a runtime-manifest-loader
decision: whether any manifest may influence provider selection or broker construction. That
decision is recorded in
[Remote Graphical Runtime Manifest Loader Decision](./remote_graphical_runtime_manifest_loader_decision.md).
The decision keeps dynamic and operator-supplied runtime manifest loading out of scope. The first
eligible loader is a future default-off, repository-owned manifest root under
`config/remote-graphical-providers/`.

## Target Host Constraints

Target constraints must be explicit. A manifest should not authorize arbitrary LAN hosts merely
because Moonlight can discover them.

Required target metadata:

- stable target host name
- expected provider id
- locality class: `local`, `lan`, `vpn`, or `internet`
- attended or unattended posture
- expected rollback path
- whether the target is a disposable graphical lab, operator workstation, or shared system
- whether Sunshine pairing already exists and whether new pairing is out of scope

For the current lab, the first eligible target is expected to be
`soma-agent-desktop.local.sthnet.org`. Its ZFS-backed base snapshot is rollback evidence, not
authority.

## Supported Action Claims

The first live manifest should claim only:

| Action | Required state | Must not imply |
| --- | --- | --- |
| `status` | provider configured | grant, session open, pairing, transport activation |
| `open_session` | active grant, user actor, review, disclosure | video, input, recording, model delivery |
| `describe_active` | provider configured | frame metadata, screenshots, window titles |
| `cleanup_for_grant` | Soma-opened session or broker state | provider-wide disconnect unless reviewed |

Video observation, pointer input, keyboard input, disconnect, recording, and model-facing visual
delivery must remain separate later manifests or manifest sections with their own activation
reviews.

## Disabled Authorities

The manifest should state disabled authorities negatively so future code cannot treat omission as
permission. For the first live `open_session` provider, these remain disabled:

- Sunshine pairing and credential persistence
- Moonlight stream frame delivery to Soma
- screenshots, thumbnails, OCR, or window/application metadata
- pointer, keyboard, controller, clipboard, file-transfer, and audio channels
- recording
- model-facing visual payload delivery
- durable grant creation, revocation, or mutation
- local desktop semantic expansion through AT-SPI, D-Bus, compositor APIs, or browser automation

## Provenance And Disclosure Requirements

The manifest should declare that live session-open provenance is metadata-only and must record
explicit false flags for content-bearing surfaces. Disclosure should identify:

- provider id
- target host
- lifecycle state
- active authorities
- inactive authorities
- attended posture
- revocation or cleanup path
- whether live transport was used

Disclosure must not contain frames, screenshots, recognized text, clipboard contents, input events,
window titles, file names, audio payloads, or transport diagnostics.

## Relationship To Runtime Registry

The current static provider registry makes remote graphical capabilities requestable for review. A
future live manifest should be a stricter input to broker construction:

```text
provider registry claim
  -> live provider manifest
  -> runtime opt-in
  -> active grant
  -> session-open review
  -> live broker invocation
```

Every step is necessary. None is sufficient alone.

The runtime loader decision narrows the second step: a live provider manifest may influence runtime
only when loaded from the future repository-owned manifest root under explicit opt-in. The review
fixture remains review evidence only and never becomes runtime configuration by implication.

## Review Triggers

Run a focused review before any change that:

- loads this manifest into runtime broker construction
- broadens allowed target hosts or locality classes
- adds pairing or credential persistence
- adds video, input, recording, disconnect, audio, clipboard, or file-transfer authority
- changes model-facing visual delivery posture
- changes durable grant write posture

## Related Documents

- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)
- [Remote Graphical Session Provider](./remote_graphical_session_provider.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
- [Remote Graphical Session-Open Activation Policy](./remote_graphical_session_open_activation_policy.md)
- [Capability Catalog and Providers](./capability_catalog_and_providers.md)
