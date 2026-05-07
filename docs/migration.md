# Migration And Versioning

Status: initial policy before durable grants or durable memory

Soma should treat schema and catalog changes as authority changes when they affect what a model,
provider, memory item, or grant may do. Migration is not only data compatibility; it is consent
compatibility.

## Core Rules

- Schema versions must be explicit on durable or file-backed records.
- Compatible changes may be accepted without user review only when they do not broaden authority,
  disclosure, persistence, or actuation.
- Breaking or authority-broadening changes require migration, invalidation, or user review.
- Grants do not silently survive capability splits, merges, or semantic broadening.
- Proposal history cannot be used as a grant.
- Unknown future records should fail closed for authority while remaining inspectable where
  possible.
- Durable memory should not be silently reinterpreted under a new schema or purpose.

## Current Versioned Surfaces

Current file-backed records:

- `config/base-harness.json`
- `config/capability-catalog.json`
- `config/provider-registry.json`
- `config/harness-modules.json`
- `config/runtime-profiles.json`
- desktop inspection result schema

Current in-process records:

- capability proposals and decisions
- session memory
- provenance entries
- active module stack

Future durable records:

- grants
- durable memory items
- durable provenance
- provider trust metadata
- migration history

## Compatibility Classes

### Compatible Change

A change is compatible when older authority remains narrower or equivalent.

Examples:

- adding a description field
- adding a stricter default exclusion
- adding a new disabled capability
- adding a new provider that grants nothing by itself
- adding a new provenance metadata field that does not store raw sensitive context

Compatible changes may be loaded without user review.

### Review-Required Change

A change requires review when it may change user expectations or authority interpretation.

Examples:

- changing a capability's data exposure
- changing allowed scopes
- changing risk class
- changing provider contract
- adding a provider for a previously unsupported disabled capability
- changing memory allowed uses or forbidden uses
- changing retention behavior for provenance

Review-required changes should not silently activate old approvals or grants.

### Breaking Change

A change is breaking when older records cannot be interpreted safely.

Examples:

- capability key changes
- capability splits or merges
- grant schema changes that affect scope or constraints
- memory schema changes that affect purpose, sensitivity, or allowed uses
- provenance event changes that remove required audit fields

Breaking changes require migration code, invalidation, or explicit user re-approval.

## Capability Catalog Migration

Capability keys are authority-bearing identifiers. They should be stable.

### Adding A Capability

Adding a new capability should default to disabled unless it is part of the conservative base
harness and has gone through design review.

New disabled capabilities do not affect existing grants.

### Splitting A Capability

Example:

```text
desktop.inspect.text
  -> desktop.inspect.text.names
  -> desktop.inspect.text.values
  -> desktop.inspect.text.descriptions
```

Existing grants for the old capability should not automatically authorize the new split
capabilities. The safe behavior is:

- mark the old grant as requiring review
- show the participant the new narrower capabilities
- require explicit approval for any new capability key

### Merging Capabilities

Merging capabilities can broaden authority. Existing grants should not automatically authorize the
merged capability unless the merged capability is strictly narrower than every old grant it
replaces.

When in doubt, require re-approval.

### Broadening A Capability

Any change that increases data exposure, scope, persistence, export, or actuation is
authority-broadening.

Existing grants must not silently survive authority broadening.

### Narrowing A Capability

Narrowing a capability is usually compatible. Existing grants may remain valid if the new
capability is strictly less powerful and the participant-facing meaning remains clear.

## Provider Registry Migration

Provider registry records are claims, not authority.

Adding a provider can change a capability from `unsupported` to `requestable`, but it should not
activate the capability.

Provider changes that require review:

- provider gains support for a sensitive capability
- provider changes locality or network posture
- provider binary path changes
- provider runtime changes
- provider contract changes
- provider begins handling sensitive data classes it did not handle before

Future provider trust metadata should include enough information to detect these changes.

## Grant Migration

Grants are the most authority-sensitive records.

A grant should include:

- grant schema version
- capability key
- capability catalog version or digest
- provider id and provider version or digest
- scope
- constraints
- approval provenance id
- created and reviewed timestamps
- revocation state, including `revoked_at`, `revoked_by`, `revocation_reason`, and any
  `replacement_grant_id`

Grant migration rules:

- do not infer grants from proposal approvals
- do not infer grants from provider installation
- do not infer grants from old active module state
- fail closed if grant scope or constraints cannot be interpreted
- fail closed if grant status or revocation state cannot be interpreted
- require review if capability semantics changed since approval
- require review if provider identity or contract changed materially

If a grant cannot be migrated safely, Soma should mark it inactive and review-required rather than
deleting it silently.

## Proposal Record Migration

Proposals are historical requests and decisions. They are not authority.

Migration rules:

- old proposals should remain inspectable where possible
- approved proposals should not become grants through migration
- unknown proposal statuses should be treated as non-activating
- missing risk, fallback, or data-exposure fields should prevent activation
- proposal provenance should remain linked if available

## Provenance Migration

Provenance supports accountability. It should not become hidden memory.

Migration rules:

- preserve event type, timestamp, capability, allowed/denied state, and provenance id where
  possible
- do not add raw user secrets during migration
- do not reinterpret denied events as approvals
- do not reinterpret proposal approvals as activations
- unknown future event types should remain inspectable but should not authorize behavior

Durable provenance should define retention, redaction, export, and corruption handling before it
becomes a dependency for activation.

## Memory Migration

Durable memory is identity-sensitive and authority-adjacent.

Memory migration rules:

- preserve source, scope, sensitivity, purpose, allowed uses, forbidden uses, confidence, and review
  metadata
- do not silently broaden allowed uses
- do not drop forbidden uses during migration
- do not convert session inference into durable memory
- do not use corrupt or ambiguous memory for delegated choice
- require review when sensitivity, purpose, or allowed uses change

If memory cannot be migrated safely, it should become inactive/review-required rather than silently
used.

## Runtime Profile Migration

Runtime profiles affect disclosure and model capability.

Review is required when:

- route changes from local to remote
- remote service posture changes
- tool-call support changes
- allowed data classes broaden
- model identity changes in a way that affects expected behavior
- context limits or multimodal traits change significantly

Runtime profile changes should not silently make new capabilities active.

## Harness Module Migration

Harness modules currently narrow authority.

Rules:

- self-scoped narrowing modules may migrate if their disabled capability list still resolves
- unknown disabled capability keys should remain visible in module inspection
- widening modules require explicit grant semantics before they can exist
- module migration must not turn a narrowing module into a widening module

## Unknown Records

Unknown records should be handled by posture:

- **authority-bearing unknowns**: fail closed
- **historical unknowns**: keep inspectable if possible
- **memory unknowns**: do not use until reviewed
- **provider unknowns**: do not trust
- **provenance unknowns**: do not authorize behavior

## Migration Records

Future durable migrations should record:

- migration id
- timestamp
- source schema version
- target schema version
- records changed
- records invalidated or marked review-required
- whether user approval was required
- provenance or audit reference

## Principle

Do not preserve authority by accident.

When Soma changes the meaning of a capability, memory, provider, grant, or provenance record, the
participant's prior consent must not be stretched to cover the new meaning without review.
