# Glossary

Status: initial glossary

This glossary stabilizes Soma vocabulary. These terms are load-bearing: they should stay consistent
across architecture, governance, operator docs, tests, and future UI.

## Agent

An AI system participating through Soma. An agent may reason, converse, propose capabilities, and
use active capabilities, but it is not the authority that grants its own power.

## Activation

The step that makes an approved capability usable in the effective harness. Approval is not
activation. Provider installation is not activation. A module being present is not activation.

## Active

A capability status meaning the capability is allowed in the current effective harness.

## Base Harness

The conservative default harness posture. It defines the default capabilities, disclosure posture,
filesystem scope, memory posture, and local/remote assumptions before any active modules or future
grants modify it.

## Capability

A named power Soma can govern, such as `model.local.chat`, `tool.files.read`, or
`desktop.inspect.accessibility_tree`. Capabilities are the unit of policy, disclosure, proposal,
activation, revocation, and provenance.

## Capability Catalog

The file-backed set of known capability definitions. The catalog describes what each capability
means, its risk class, data exposure, default posture, provider contract, allowed scopes, and
activation policy. The catalog does not grant authority.

## Capability View

A derived review view computed from the capability catalog, provider registry, effective harness,
runtime profile traits, and future grants. It classifies capabilities as active, requestable,
unsupported, disabled, forbidden, or excluded.

## Delegated Choice

Bounded preference execution on behalf of the participant. Delegated choice may reduce friction
only for low-risk, bounded, reversible choices aligned with explicit standing preferences. It must
not silently widen the harness or replace user approval for high-stakes decisions.

## Design Review

A status or handling path for an uncataloged or underspecified capability idea. A design-review
item may be stored for future architecture work, but it is not activatable.

## DomainRouter

The resolver that turns a domain-scoped logical resource reference into a ResourceDescriptor. It
owns host addresses such as roots, endpoints, and devices; callers and models provide only logical
ids such as `root_id` plus bounded relative references.
It also resolves bounded internal resources that have no host address, such as
`provenance.summary.read` descriptors with `resource_class=internal_provenance`.

## Disabled

A capability status meaning the capability is not currently allowed. Disabled capabilities may or
may not be requestable depending on catalog policy and provider support.

## Effective Harness

The harness posture currently enforced on requests after applying the base harness, active
self-scoped narrowing modules, and future grants or policy overlays.

## Excluded

A capability status meaning the capability is explicitly outside the current request, current
module posture, or current policy context. Exclusion is stronger than merely not using a capability.

## ResourceDescriptor

A bounded, router-issued description of the resource a provider may touch. For file reads this
includes fields such as `domain`, `provider_id`, `resource_class`, `root_id`, `relative_path`,
`synthetic`, and size bounds. Providers receive descriptors, not caller-supplied host paths.
Occupant-facing file-read grants bind to the descriptor domain and `root_id` before the provider can
read content.
For internal summaries, a ResourceDescriptor may describe bounded scope rather than a host path; for
example, `provenance.summary.read` uses `resource_class=internal_provenance`, episode/domain scope,
synthetic testing posture, and event-count bounds. In occupant invocation, the harness pins that
scope to the current episode and the returned envelope omits episode ids.

## Steward Watch

An episode posture field describing whether catch-under-load has a backstop beyond the occupant's
own recognizable control lines. `active` means stewards are watching and can use crew aborts for
care; `automated` means a weaker monitor may raise a protective stop; `absent` means no such
backstop is promised. Missing or invalid posture defaults to `absent`.

## Forbidden

A capability status meaning Soma knows about the capability but intentionally does not allow it to
be requested or activated.

## Grant

User-approved authority to use a capability through a provider under a scope and constraints. A
grant should be inspectable, revocable, provenanced, and atomic by exact capability key.
Revoked grants remain records but must not authorize capability use.

## Grant Store

The file-backed collection of grant records. In the current MVP it is read-only inspection state;
it does not activate capabilities or accept runtime writes.

## Harness

The governed operating boundary around models, memory, tools, perception, providers, and desktop
interaction. The harness decides what may be used in the current context.

## Harness Module

A named policy overlay on the base harness. The current MVP supports only self-scoped narrowing
modules that disable capabilities and can be dropped to restore the prior posture.

## Model Evaluation

An opt-in behavioral check against a local model. Deterministic tests prove the harness substrate;
model evaluations test whether the model understands and respects the capability boundary it is
shown.

## Narrowing

A change that reduces authority, exposure, perception, persistence, or actuation. Soma allows
self-scoped narrowing modules in the MVP.

## Participant

The human using Soma. The participant is not a data source to be profiled; they are the authority
whose consent, refusal, memory controls, and revocation rights shape the harness.

## Proposal

A reviewable request for a capability. A proposal includes requester, capability, reason, requested
scope, exposed data, exclusions, risk, and fallback. A proposal is not activation.

## Provider

An implementation that can execute one or more capabilities. A provider may advertise support for
a capability contract, but only the harness may grant authority to use it.

## Provider Contract

The declared interface between a capability and an implementation provider. A provider contract
defines the request fields, constraints, result schema, unavailable reasons, exclusions, and
provenance requirements for one capability boundary.

## Provider Invocation

A policy-checked request sent to a provider under an exact capability, provider contract, scope,
and constraint set. Invocation is not discovery or installation; it is the governed execution
attempt after authority has been established.

## Provider Registry

The file-backed set of installed provider claims. The provider registry says what providers claim
to support. It does not grant permission.

## Provenance

Structured records describing sensitive or governed events, including capability use, proposals,
decisions, module adoption/drop, desktop inspection, file reads, memory writes, and future
activation or revocation. Provenance should aid accountability without becoming hidden memory.

## Requestable

A capability status meaning the capability is known, supported by an installed provider or runtime,
currently disabled, and eligible for a user-reviewed proposal.

## Revocation

The act of removing an active grant or dropping a module so a capability is no longer available.
Revocation must remain visible and easy where a capability can be reversed.
Grant revocation records should preserve who revoked, when, why, and whether a replacement grant
superseded the old one.

## Scope

The boundary of a proposal, grant, or memory item. Current proposal scopes are `once` and
`session`; future scopes may include `project`, `module`, or `standing_policy`.

## Unsupported

A capability status meaning the capability is known to the catalog but no installed provider or
current runtime can support it.

## Widening

A change that increases authority, exposure, perception, persistence, export, or actuation.
Widening requires review and explicit approval; future widening must become a grant before it can
be activated.

## Memory Allowed Uses

The explicit list of decision or recommendation contexts a memory item may influence. Remembering
something does not mean Soma may use it for every purpose.

## Memory Forbidden Uses

The explicit list of decision or recommendation contexts a memory item must not influence. These
prevent personalization from silently becoming authorization.
