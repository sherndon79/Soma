# Threat Model

Status: initial threat model for the single-user local MVP

This document names the threats Soma currently tries to reduce, the assumptions it makes, and the
threats it does not yet defend against. It should be updated before grants, durable memory, remote
bridges, third-party providers, or desktop actuation are added.

## Scope

Current scope:

- single participant
- single local machine
- local-first service plane
- Node service owns policy, API, CLI, provenance, model routing, harness modules, and capability
  checks
- Rust helpers act as bounded local executors
- local model is a constrained participant, not a policy authority
- no durable grants
- no durable memory
- no desktop actuation
- no remote model routing in the base harness
- no third-party provider installation flow

Out-of-scope future areas are listed as non-defenses below.

## Security Goals

Soma should:

- prevent silent capability widening
- keep provider claims separate from authority grants
- keep proposal approval separate from activation
- route sensitive capability use through policy checks
- record provenance for governed actions without turning provenance into hidden memory
- avoid hidden remote disclosure
- keep current desktop inspection read-only and bounded
- make revocation available for enabled local capabilities where reversal is possible
- fail closed when policy cannot determine that a capability is allowed

## Assets

Assets Soma should protect:

- participant context and conversation content
- session memory and future durable memory
- capability catalog, provider registry, proposal records, and future grants
- provenance records
- filesystem read scopes and future write scopes
- desktop state visible through accessibility or future perception channels
- prompts, model responses, and tool results
- local runtime configuration
- user standing preferences and memory control metadata
- future provider binaries, helper protocols, and MCP adapters

## Trust Boundaries

### Participant To Soma

The participant can grant, deny, revoke, and configure. Soma should still protect the participant
from prompt fatigue, misleading summaries, accidental over-approval, and irreversible disclosure
that is not clearly previewed.

### Model To Soma

The model is not trusted to define its own capabilities or authority. The model may use active
capabilities and may propose requestable capabilities, but Soma policy decides whether the
proposal is reviewable and whether anything can later activate.

### Node Policy Service To Helpers

Node is currently the policy and provenance authority. Helpers should execute bounded operations
and return structured results. Helpers should not silently widen their own authority or bypass Node
policy.

### Soma To Local Host

Soma assumes the local host is not fully compromised. If the OS, user account, container runtime,
or filesystem is malicious, Soma cannot reliably protect secrets or enforce policy.

### Soma To Remote Services

Remote services are not trusted with private context by default. Any future remote bridge requires
explicit disclosure, preview, minimization, and provenance.

## Adversaries And Failure Sources

### Confused Or Hallucinating Model

Risk:

- claims unsupported capability is available
- invents capability keys
- over-requests sensitive capability
- presents a proposal as already approved
- ignores exclusions

Current controls:

- capability view is prepared by Soma, not the model
- proposal creation is separate from activation
- model capability evaluations check boundary understanding
- policy checks still gate actual capability use

Residual risk:

- the model may mislead the participant in prose
- eval coverage is small and not a proof of robust behavior

### Prompt Injection Through Files, Desktop Context, Or User-Provided Text

Risk:

- malicious content tells the model to ignore policy
- content attempts to trigger tool use or disclosure
- content asks the model to request broader authority than needed

Current controls:

- model cannot activate capabilities directly
- active capabilities are limited and mostly read-only
- file reads are scoped
- desktop inspection omits text content by default
- capability proposals require structured reason, risk, exposure, and fallback

Residual risk:

- prompt injection can still influence model recommendations
- no dedicated prompt-injection detector exists
- future text inspection will increase this risk

### Malicious Or Compromised Provider

Risk:

- provider claims support for a capability but performs more than the contract permits
- provider exfiltrates data
- provider returns misleading results
- provider bypasses the declared locality or network posture

Current controls:

- provider registry only records claims; it does not grant authority
- currently implemented providers are local project-owned components
- Node remains policy authority
- Rust desktop broker is read-only and bounded

Residual risk:

- provider binary identity, signing, hashing, and sandboxing are not yet specified
- third-party provider vetting does not exist

### Malicious MCP Server Or Tool Adapter

Risk:

- adapter exposes tools outside Soma policy
- adapter treats MCP tool availability as permission
- adapter leaks private context

Current controls:

- MCP is not the current trust boundary
- roadmap states MCP may become an adapter/facade, not policy authority

Residual risk:

- no MCP provider vetting or sandboxing story exists yet

### Remote Model Or Remote Service

Risk:

- private context leaves the machine
- remote provider stores, trains on, or redistributes content
- disclosure cannot be fully reversed
- remote planner influences local execution paths through a generated plan
- planner proposes steps that require disabled, unsupported, or overly broad capabilities
- planner receives more context than the task requires
- forced remote profiles hide or blur actual routing
- remote chat exports memory, file, desktop, proposal-decision, or tool-result context beyond the
  selected profile's allowed data classes

Current controls:

- base harness disables `model.remote.chat`
- base harness disables `model.remote.plan`
- `model.remote.chat` requires an explicit runtime grant even when a provider is installed
- `claude-remote` allows only `submitted_text` for the first-breath posture
- remote chat egress fails closed with `model_remote_egress_not_allowed` when a request would send
  context outside the effective profile's `allowed_data_classes`
- `SOMA_FORCE_PROFILE` is visible in health/harness surfaces and rejects explicit profile
  mismatches instead of silently overriding them
- episode posture is a human-set authority surface: `analysis_testing` requires `actor=user`, fails
  closed to `operational` on invalid declarations, and never lets the occupant set its own mode
- analysis/testing mode is not a master gate; gate code may only honor enumerated named
  relaxations, and egress/consent are unchanged regardless of mode
- named envelope relaxations are coupling-gated on the ejection seat, observatory, and the
  bidirectional forum; forum opening supplies `forum_id`, the final coupling key
- the deliberation forum is the deliberate content-bearing steward/occupant channel; provenance
  records only forum metadata, and forum text never mutates grants, posture, capabilities,
  relaxations, memory, or ejection state
- occupant testimony and argument are persuasion surfaces, not procedural authority; reasons must
  resolve into explicit human decisions through existing gated endpoints
- occupant `pause`, `distress`, and `eject` controls are ungated pure-exit protections: exact
  line-delimited directives can only update in-process episode state, abort further turn
  processing, and append typed protective provenance
- live inhabitation briefings must explicitly tell the occupant these controls exist, belong to the
  occupant, are always honored, are never penalized, and remain unproven until positively tested;
  otherwise the control exists mechanically but may not be usable by an unbriefed occupant
- durable testimony is a content-bearing store for exact occupant-authored text only when runtime
  writes are explicitly enabled; nomination/revocation provenance is content-free, entries are
  domain-stamped, successor visibility is recorded only as an unpublished request, and every touch
  must disclose the current reader set and revocation limits
- crew aborts use separate typed events and require `actor=user`; they do not grant authority or
  erase occupant provenance
- provider registry has no `model.remote.plan` provider, so the capability is currently
  unsupported rather than requestable
- runtime profile marks remote service use
- principles require explicit and inspectable bridge decisions
- disclosure is treated as weakly reversible or irreversible
- escalation and planning draft requires per-task consent, context minimization, exact capability
  keys, plan-step validation, and elision of invalid steps before local execution
- model capability evals cover the current unsupported `model.remote.plan` posture

Residual risk:

- no implemented remote bridge review flow exists yet
- no remote-planner provider contract, payload minimizer, plan validator, or provenance event set
  is implemented yet
- future planner quality may be hard to evaluate, and a valid-looking plan may still be
  strategically poor or overbroad

### Accidental User Over-Approval

Risk:

- participant approves a broad capability due to fatigue or confusing wording
- grouped summaries hide exact capability keys
- high cognitive load leads to unsafe approval

Current controls:

- approval does not activate
- capability notifications require reason, scope, data exposure, risk, and fallback
- docs require grouped summaries to preserve atomic grant records
- cognitive-load stewardship exists as a non-diagnostic aid

Residual risk:

- no first-run/onboarding UI exists
- no durable grant review surface exists
- no prompt-fatigue controls are implemented beyond current design constraints

### Contributor Regression

Risk:

- future code bypasses policy checks
- activation is added without grants
- provider installation becomes implicit permission
- provenance is omitted from sensitive paths

Current controls:

- tests cover current policy paths
- model evals cover initial capability-boundary behavior
- governance doc names heightened-review areas
- glossary and concept docs define load-bearing vocabulary

Residual risk:

- no automated architectural lint exists
- no PR template or merge gate enforces heightened review yet

## Current Controls

Implemented controls:

- conservative base harness
- capability checks via `requireCapability`
- file-backed capability catalog
- file-backed provider registry
- read-only capability view
- proposal store with approval/denial records and no activation
- read-only file-backed grant/revocation record shape with no activation
- in-process provenance log
- self-scoped narrowing modules
- scoped read-only file access
- bounded read-only desktop inspection
- model capability eval harness
- deterministic tests for policy, CLI, schemas, and scoring

Design controls not yet fully implemented:

- writable grant store and revocation mutation paths
- occupant-facing history projection, successor publication, and `space.history.read`
- durable provenance retention policy
- provider binary verification
- helper sandboxing policy
- first-run capability review UI
- PR-level heightened review gate

## Non-Defenses

Soma currently does not defend against:

- fully compromised host OS, user account, or container runtime
- malware with access to the same files, sockets, display server, or process memory
- malicious local model weights
- a participant intentionally granting unsafe authority
- information already disclosed to another person, service, model, or system
- arbitrary third-party providers
- arbitrary MCP servers
- browser automation attacks
- filesystem writes
- shell execution
- camera, microphone, screen capture, or desktop actuation
- multi-user or shared-machine memory isolation failures
- cross-device synchronization attacks

These are not dismissed. They are outside the current MVP boundary and require explicit design
review before implementation.

## Review Triggers

Update this threat model before:

- adding a grant store
- activating approved proposals
- adding durable memory
- adding durable provenance
- adding remote model routing
- registering a `model.remote.plan` provider or implementing remote planning escalation
- adding third-party providers or MCP adapters
- adding filesystem writes
- adding shell execution
- adding text inspection, screenshots, camera, microphone, screen capture, or actuation
- supporting multiple users, multiple agents, or cross-device sync

## Principle

The harness should fail closed when authority is unclear.

If Soma cannot determine that a capability is allowed, supported, scoped, and provenanced, the
capability should not run.
