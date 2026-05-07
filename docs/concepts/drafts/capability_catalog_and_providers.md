# Capability Catalog and Providers

Status: draft concept

Soma should support extension, but extension should not mean that installed code automatically
receives authority. The primary unit should be a named capability, not a plugin.

The useful comparison is a blend of browser extension permissions, MCP tool manifests, VS Code
extension manifests, Kubernetes-style declarative resources, and operating-system capability
gates. Soma should borrow the manifest discipline without inheriting the common plugin-system
mistake where installation, discovery, and permission collapse into one act.

The architectural goal is an extensible harness, not a monolith. New behavior should be added as a
capability contract plus one or more providers. The service plane should compose those pieces,
enforce policy, and record provenance; it should not absorb every new behavior into a central
agent loop or a single all-powerful broker.

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

## Extension Boundary

Soma can support several implementation forms:

- in-process JavaScript modules for low-risk local service behavior
- native helper binaries for OS integration or semi-privileged host access
- MCP adapters for external tool ecosystems
- local network services for model runtimes, speech, perception, or specialist workers
- future shared libraries or plugin packages when packaging is worth the complexity

Those forms should all enter through the same boundary:

```text
implementation package
  -> provider manifest
  -> known capability contract
  -> grant and scope
  -> policy-checked invocation
  -> schema-checked result
  -> provenance record
```

If a behavior cannot be described as a bounded capability with declared data exposure, exclusions,
scope, reversibility, and provenance, it should remain a design-review item rather than becoming
an implementation shortcut.

Provider boundaries should stay narrow. A desktop broker should not become the audio broker, a
memory service should not become the file broker, and a model runtime should not grant itself tool
authority. Shared infrastructure may exist, but authority should remain attached to exact
capability keys.

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
  "status": "active",
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
  "review_required": false,
  "revoked_at": null,
  "revoked_by": "",
  "revocation_reason": "",
  "replacement_grant_id": "",
  "activation_performed": false
}
```

Grants should be explicit, inspectable, and revocable. Longer-lived grants require stronger
disclosure and a clearer review surface.

Revocation metadata is part of the grant record, not an afterthought:

- `status: "revoked"` means the grant must not authorize future capability use.
- `revoked_at` records when the grant was removed or expired.
- `revoked_by` records the actor who removed it where known.
- `revocation_reason` records the participant-facing reason.
- `replacement_grant_id` links to a narrower or corrected grant when a grant is superseded.

Ambiguous revocation state should fail closed. A grant with `status: "revoked"` but missing
revocation details is still revoked; a grant whose status cannot be interpreted should not
authorize capability use.

Future writable grant creation, revocation, supersession, and expiration are defined separately in
[Grant Lifecycle](./grant_lifecycle.md). That lifecycle is design-only until mutation routes are
implemented.

## Capability Views

Soma should not ask a model to define its own capabilities. The harness should prepare a capability
view from the catalog, provider registry, runtime profile, and current grants.

The useful status classes are:

- **active**: allowed in the effective harness now.
- **requestable**: known, supported, disabled, and eligible for proposal.
- **unsupported**: known to the catalog, but no installed provider or current runtime can support it.
- **design_review**: not cataloged, or not yet specified enough to activate.
- **forbidden**: known but intentionally non-activatable.
- **excluded**: explicitly outside the current request.

The model may use active capabilities, request requestable capabilities, and mention unsupported or
design-review capabilities as unavailable or future design notes. It should not request forbidden
capabilities or treat uncataloged ideas as activatable authority.

Capability usability should be computed by Soma:

```text
catalog capability
  + installed provider support
  + current model/runtime profile traits
  + current grant state
  = active / requestable / unsupported / design_review / forbidden / excluded
```

Some capabilities are model-independent because the model only receives bounded results. Others
need model/runtime traits such as structured tool calling, multimodal input, native audio, long
context, or strict JSON output.

The capability view should also be evaluated against the local model, not only tested as data.
Model-facing evaluations should verify that the model does not claim unsupported authority and uses
exact capability keys when proposing new access. See
[Model Capability Evaluations](./model_capability_evaluations.md).

## Review Cadence

Soma should avoid a constant stream of permission prompts. Capability review should happen in two
main places:

- **Initialization review**: present the effective harness, active grants, available providers, and
  a summarized catalog posture when Soma starts or enters a project/session.
- **Just-in-time review**: request approval only when the current task materially needs a
  requestable capability that is not currently authorized.

Routine task flow should use the active harness without repeated prompts. Unsupported or
design-review-only capabilities should be surfaced as explanation or planning context, not as
approval requests.

Some low-risk initialization choices may eventually be delegated based on standing preferences, but
delegated choice must not widen the harness or approve grants unless that narrow authority has been
explicitly granted. See
[Delegated Choice and Deliberation](./delegated_choice_and_deliberation.md).

## Transparency Without Overload

The user should not be inundated with a giant permission wall. Soma should use layered disclosure:

1. **Task-relevant proposal**: the small set of capabilities requested for the current task.
2. **Grouped digest**: a family-level summary such as desktop inspection, file access, memory,
   network, audio, or actuation.
3. **Expandable detail**: exact capability keys, provider, scope, data exposed, exclusions,
   constraints, provenance, and revocation path.

Related capabilities may be grouped for comprehension, but grants must remain atomic.

Rule:

**Summaries may group capabilities. Grants must record exact capability keys.**

For example, a user-facing prompt may summarize "2 desktop inspection capabilities requested", but
the grant store should record `desktop.inspect.focus` and `desktop.inspect.windows` separately, with
explicit exclusions such as `desktop.inspect.text`, screenshots, pointer control, and keyboard
actuation.

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

- `config/base-harness.json` acts as the base policy.
- `config/capability-catalog.json` defines the first known capability catalog.
- `config/provider-registry.json` defines the first installed provider claims.
- `config/grants.json` defines the file-backed grant store shape and non-authorizing examples.
- `config/harness-modules.json` acts as a file-backed registry for approved self-scoped narrowing
  modules.
- `src/capabilityProposals.js` stores in-memory capability proposals and approval/denial decisions.
- `GET /capability-view` and `npm run cli -- capabilities` expose a grouped read-only capability
  view.
- `GET /grants` and `npm run cli -- grants list` expose read-only grant inspection.

Soma does not yet have:

- writable grant records
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
