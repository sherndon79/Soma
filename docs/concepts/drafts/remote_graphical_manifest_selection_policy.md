# Remote Graphical Manifest Selection Policy

Status: policy draft, current CLI remains docs-fixture-only

This policy defines how Soma should treat live remote graphical provider manifests before they can
influence any runtime path. The current `remote-graphical manifest-review` CLI intentionally reads
only the repository fixture:

```text
docs/fixtures/remote-graphical-live-provider-manifest.json
```

That narrow source is deliberate. A live provider manifest is close to configuration authority: it
names a provider, target host, runtime opt-ins, supported actions, disabled authorities, and rollback
posture. Allowing arbitrary manifest inputs before the path is designed would blur the difference
between review evidence and runtime configuration.

## Current Rule

The current CLI review command remains fixture-only.

It rejects:

- `--manifest-path`
- stdin JSON
- URLs
- provider registry ids
- environment-selected manifest paths
- runtime manifest directories

It must not call the Soma service, read `config/provider-registry.json`, load runtime config,
construct a broker, open a session, append provenance, write grants, dispatch input, attach video,
or deliver visual payloads to a model.

The current guard also rejects positional source inputs so an operator cannot pass a local path and
mistake the result for a reviewed external manifest.

## Why Fixture-Only

Fixture-only review keeps the current surface easy to reason about:

- the reviewed manifest is version-controlled with the project
- tests can prove the fixture validates without relying on local operator files
- the command cannot be confused with activation or provider installation
- path traversal, symlink, and directory boundary questions do not exist yet
- an operator cannot accidentally review a local manifest and assume it is loaded at runtime

This is a design brake, not a permanent product decision. It leaves room for explicit manifest
review later while preventing premature configuration semantics from leaking into the CLI.

## Future Explicit Input Requirements

Any future `--manifest-path` or stdin input must be a separate reviewed change. Before that change,
the implementation and docs should define:

- whether external manifests are allowed at all, or only repository fixtures
- allowed file roots, path normalization, and symlink posture
- maximum manifest size
- JSON parsing and schema-validation failure output
- whether stdin is allowed, and if so how operators distinguish it from runtime loading
- how the output labels the source as operator-supplied review evidence
- that successful review still does not write a provider registry entry or runtime config
- that successful review still does not create a grant, open a session, call a broker, or append
  provenance

If explicit path input is added, the command should label the source clearly in both text and JSON:

```text
source kind: operator-supplied review input
runtime loaded: no
provider registry entry: no
broker construction: no
```

## Runtime Loading Is A Separate Boundary

Manifest review and runtime manifest loading are different capabilities.

Review may answer:

- is this manifest shape valid?
- what target and action claims does it make?
- which authorities are explicitly disabled?
- what opt-ins and blockers remain?

Runtime loading would answer:

- should this manifest influence broker construction?
- is this provider eligible for live transport?
- how does the manifest relate to active grants and runtime opt-ins?

Runtime loading must not be introduced by extending the review command. It needs a separate
activation design, review trigger, tests, and operator decision.

## Review Triggers

Run a focused review before any change that:

- adds `--manifest-path`, stdin, URL input, or environment-selected manifest paths
- reads manifests from outside `docs/fixtures`
- exposes manifest review through HTTP
- loads a manifest into runtime startup
- maps a manifest to provider registry entries
- allows a manifest to construct or select a broker
- changes the JSON false flags documented by the review smoke runbook

## Related Documents

- [Remote Graphical Live Provider Manifest](./remote_graphical_live_provider_manifest.md)
- [Remote Graphical Manifest Review Smoke](../../runbooks/remote_graphical_manifest_review_smoke.md)
- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)
