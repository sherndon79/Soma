# Remote Graphical Runtime Manifest Loader Decision

Status: implemented as a default-off metadata-only runtime loader scaffold

This document records the loader decision required by the remote graphical live broker activation
checklist. It decides whether reviewed live provider manifests may influence provider selection or
broker construction.

## Decision

Do not add dynamic or operator-supplied runtime manifest loading.

The next eligible implementation slice may add a **static, repository-owned runtime manifest
loader** only if it remains default-off and reads from a fixed allowlisted manifest root. It must
not load manifests from arbitrary paths, stdin, URLs, provider ids, environment-selected paths, user
home directories, or runtime-discovered directories.

The first eligible runtime source is:

```text
config/remote-graphical-providers/
```

That directory now exists as a repository-owned runtime configuration root. A manifest in that
directory is still configuration evidence, not permission.

## Rationale

The fixture-review thread proved that Soma can validate and render a live provider manifest shape
without activation. Runtime loading is a different authority boundary. Once a manifest influences
provider selection or broker construction, it becomes part of the execution path for a capability
that can eventually lead to live desktop presence.

Dynamic manifest loading would make that boundary too broad too early:

- arbitrary local paths create path traversal, symlink, and provenance ambiguity
- stdin makes review evidence easy to confuse with runtime configuration
- URLs introduce network trust, freshness, and substitution questions
- environment-selected directories can silently change the active provider set
- provider registry ids blur support claims with executable provider configuration

A static repository-owned root keeps the first loader auditable. The manifest source can be
reviewed in Git, tested deterministically, and clearly distinguished from operator-supplied review
inputs.

## Loader Rules

The static loader must:

- remain disabled unless `SOMA_REMOTE_GRAPHICAL_ENABLED=1`
- require an explicit provider id match with `SOMA_REMOTE_GRAPHICAL_PROVIDER`
- read only from the fixed repository-owned manifest root
- reject missing, duplicate, malformed, unsupported-version, or provider-mismatched manifests
- validate every manifest with `validateRemoteGraphicalLiveProviderManifest` before use
- require `default_enabled: false`
- require all first-slice disabled authorities to remain explicitly disabled
- require target host allowlists and locality class checks
- produce bounded status metadata that identifies the manifest source as repository-owned runtime
  configuration
- refuse before broker construction when any loader check fails

The loader must not:

- mutate `config/provider-registry.json`
- create or modify grants
- append provenance by itself
- pair with Sunshine
- start Moonlight
- open a graphical session
- observe video, capture screenshots, dispatch input, record, transfer files, access clipboard or
  audio, or deliver visual payloads to a model

## Relationship To The Review CLI

`remote-graphical manifest-review` remains fixture-only. This decision does not authorize
`--manifest-path`, stdin, URLs, or positional manifest inputs for review.

Runtime loading and manifest review stay separate:

```text
review fixture          -> operator-readable evidence, not runtime config
repository manifest root -> future default-off runtime config, not a grant
active grant             -> authority to request a bounded action, not broker construction alone
live broker              -> injected only after runtime opt-in, manifest validation, and grant gates
```

## Activation Boundary

This decision does not activate live remote graphical transport. The first loader implementation
must stop at provider eligibility and configured-broker selection. It may make status report a
validated provider manifest as configured, but it must not make `open_session` call Sunshine or
Moonlight until the live broker activation checklist is separately satisfied.

## Implemented Scaffold Boundary

The first loader scaffold reads only `config/remote-graphical-providers/` after explicit runtime
opt-in and provider selection. A valid manifest may make `remote-graphical status` report
`provider_manifest_configured` with repository source metadata.

The scaffold does not construct a live Sunshine/Moonlight broker. It does not pair, start
Moonlight, open sessions, append provenance, write grants, observe video, dispatch input, record,
access clipboard/files/audio, or deliver visual payloads to a model.

## Required Tests For Loader Implementation

Before a runtime loader is merged, tests should prove:

- default-off startup does not read runtime manifests
- opt-in with no provider id refuses before broker construction
- opt-in with missing manifest refuses before broker construction
- provider id mismatch refuses before broker construction
- unsupported manifest version refuses before broker construction
- disabled authority omission refuses before broker construction
- target host mismatch refuses before broker construction
- duplicate manifests for one provider refuse before broker construction
- fixture review command still reads only the docs fixture
- no loader failure appends provenance, writes grants, opens sessions, starts providers, or dispatches
  input

## Review Triggers

Run a focused review before any change that:

- creates `config/remote-graphical-providers/`
- loads a remote graphical manifest during server startup
- lets runtime configuration select a live graphical provider
- changes `remote-graphical status` from unsupported/unconfigured to configured by manifest
- changes `remote-graphical session-open` refusal ordering
- allows external manifest paths, stdin, URLs, or environment-selected directories

## Related Documents

- [Remote Graphical Live Provider Manifest](./remote_graphical_live_provider_manifest.md)
- [Remote Graphical Manifest Selection Policy](./remote_graphical_manifest_selection_policy.md)
- [Remote Graphical Live Broker Activation Checklist](./remote_graphical_live_broker_activation_checklist.md)
- [Remote Graphical Broker Boundary](./remote_graphical_broker_boundary.md)
