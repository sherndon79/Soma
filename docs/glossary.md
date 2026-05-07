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

## Disabled

A capability status meaning the capability is not currently allowed. Disabled capabilities may or
may not be requestable depending on catalog policy and provider support.

## Effective Harness

The harness posture currently enforced on requests after applying the base harness, active
self-scoped narrowing modules, and future grants or policy overlays.

## Excluded

A capability status meaning the capability is explicitly outside the current request, current
module posture, or current policy context. Exclusion is stronger than merely not using a capability.

## Forbidden

A capability status meaning Soma knows about the capability but intentionally does not allow it to
be requested or activated.

## Grant

User-approved authority to use a capability through a provider under a scope and constraints. A
grant should be inspectable, revocable, provenanced, and atomic by exact capability key.

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
