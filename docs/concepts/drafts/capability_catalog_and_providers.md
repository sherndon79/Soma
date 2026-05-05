# Capability Catalog and Providers

Status: draft concept

Soma should support extension, but extension should not mean that installed code automatically
receives authority. The primary unit should be a named capability, not a plugin.

The useful comparison is a blend of browser extension permissions, MCP tool manifests, VS Code
extension manifests, Kubernetes-style declarative resources, and operating-system capability
gates. Soma should borrow the manifest discipline without inheriting the common plugin-system
mistake where installation, discovery, and permission collapse into one act.

## Core Distinction

Soma should keep these concepts separate:

- **Capability catalog**: the set of named powers Soma understands.
- **Provider registry**: implementations that can execute one or more capabilities.
- **Grant store**: user-approved authority for a capability, provider, scope, and constraints.
- **Harness modules**: reusable policy overlays that narrow or, later, bundle reviewed grants.
- **Proposal store**: pending requests for a capability grant or design review.

The rule:

**A provider may advertise capability. Only the harness may grant authority.**

## Why Not Start With Plugins

A normal plugin model tends to say:

```text
install plugin -> plugin exposes behavior -> plugin can be called
```

That is too coarse for Soma. It makes permission an implementation detail and encourages silent
surface expansion.

Soma should instead say:

```text
catalog defines capability semantics
  -> provider advertises support for a capability contract
  -> user grants capability under scope and constraints
  -> harness enforces the grant on the request path
  -> provider receives only the bounded invocation
  -> provenance records proposal, decision, activation, use, and revocation
```

This keeps extensibility compatible with consent, disclosure, reversibility, and provenance.

## Capability Definition

A capability definition describes what a power means before any provider is allowed to execute it.

Example:

```json
{
  "key": "desktop.inspect.focus",
  "name": "Focused Desktop Inspection",
  "category": "desktop",
  "risk_class": "sensitive",
  "default_status": "disabled",
  "data_exposed": [
    "focused application metadata",
    "focused accessibility role",
    "focused object bounds"
  ],
  "excluded_by_default": [
    "text content",
    "password fields",
    "screenshots",
    "keyboard input",
    "pointer control"
  ],
  "allowed_scopes": ["once", "session"],
  "requires_user_reason": true,
  "reversible": true,
  "activation_policy": "explicit_grant",
  "provider_contract": "soma.desktop.inspect.focus.v1"
}
```

The catalog should eventually include:

- stable capability key
- human-readable name and summary
- category
- risk class
- default status
- allowed scopes
- data exposed
- actions enabled
- excluded data or actions
- reversibility
- disclosure requirements
- provider contract
- provenance requirements
- activation policy
- revocation behavior

## Provider Manifest

A provider manifest describes an implementation. It does not grant permission by itself.

Example:

```json
{
  "id": "soma.provider.desktop-broker",
  "name": "Soma Desktop Broker",
  "version": "0.1.0",
  "runtime": "native-binary",
  "binary": "./target/debug/soma-desktop-broker",
  "capabilities": [
    "desktop.inspect.accessibility_tree",
    "desktop.inspect.focus"
  ],
  "local_only": true,
  "network_access": false,
  "requires": [
    "at-spi2-core",
    "dbus-session"
  ]
}
```

Provider records should include:

- provider id
- version
- runtime type
- executable or connection endpoint
- supported capability keys
- supported provider contracts
- locality and network posture
- host requirements
- sandbox expectations
- output schemas
- provenance behavior

## Grant Object

A grant is the user-approved authority to use a capability through a provider under a scope.

Example:

```json
{
  "id": "grant-123",
  "capability": "desktop.inspect.focus",
  "provider": "soma.provider.desktop-broker",
  "scope": "session",
  "approved_by": "user",
  "reason": "Needed to understand the currently focused application during troubleshooting.",
  "constraints": {
    "include_text": false,
    "max_depth": 1
  },
  "created_at": "2026-05-05T00:00:00.000Z",
  "revoked_at": null
}
```

Grants should be explicit, inspectable, and revocable. Longer-lived grants require stronger
disclosure and a clearer review surface.

## Harness Modules

Harness modules remain useful, but they should not become the only extension primitive.

Modules are policy overlays. They may:

- narrow active authority
- package a reviewed operating posture
- later bundle known grants under a named user-approved mode

Modules should not bypass the catalog. If a module widens capability, it should reference known
catalog capabilities and produce activation provenance.

## Proposed Repository Shape

The early file-backed form could be:

```text
config/
  base-harness.json
  capability-catalog.json
  harness-modules.json
  provider-registry.json
  grants.json
```

If the registry grows, it may move into directories:

```text
registry/
  capabilities/
    desktop.inspect.focus.json
    desktop.inspect.text.json
    tool.files.write.json
  providers/
    soma.desktop-broker.json
    soma.local-filesystem.json
  modules/
    soma.module.no-desktop-inspection.json
    soma.module.focused-desktop-inspection.json
```

Durable governance state may later move to SQLite, but the manifest shape should remain explicit
and exportable.

## Interaction With Capability Proposals

A capability proposal should target a catalog capability. The proposal can still be stored for
unknown capabilities as design input, but unknown capabilities should not be activatable.

Approval should create a decision record. Activation should require:

- known capability definition
- compatible provider
- allowed scope
- explicit grant object
- provenance event
- revocation path

Approval is not activation. Provider installation is not activation. A module being present is not
activation.

## Current MVP Status

Soma currently has partial static versions of these pieces:

- `config/base-harness.json` acts as the initial capability vocabulary and base policy.
- `config/harness-modules.json` acts as a file-backed registry for approved self-scoped narrowing
  modules.
- `src/capabilityProposals.js` stores in-memory capability proposals and approval/denial decisions.

Soma does not yet have:

- a separate capability catalog file
- a provider registry
- a grant store
- activation from approved proposals
- durable proposal or grant records

## Non-Goals

- no plugin installation as implicit permission
- no provider-defined authority
- no model-defined capability keys for activation
- no hidden activation
- no widening without a grant
- no activation without provenance
- no grant without a revocation path
