# Adaptable Harness

Status: draft concept

Soma needs an adaptable harness, but it should not copy TheCommons directly.

TheCommons is a 3D meeting space rooted in natural surroundings, co-presence, world state,
observation, and hosted embodiment. Soma is a desktop/local-agent harness and service plane.

What should carry over is not TheCommons' world architecture. What should carry over is the
participation law that emerged there.

## Portable Pattern

The portable pattern is:

- a conservative base harness
- explicit capability terms
- reusable opt-in modules
- active module stack
- visible mode and actor disclosure
- unilateral narrowing
- mutual or reviewed widening
- provenance for proposals, mediation, approval, activation, and revocation
- reversible drop where possible
- heightened consent where reversibility is impossible
- enforcement in capability paths, not only descriptive metadata

## Base Harness

The base harness is the always-present respectful default.

It should define:

- default perception mode
- default memory behavior
- default tool access
- default remote-call behavior
- default disclosure
- default refusal semantics
- default audit/provenance expectations

The base should be conservative. It should not assume camera, microphone, shell, filesystem,
remote model, or durable memory access.

## Modules

A harness module is a named, reviewable overlay on top of the base harness.

Examples for Soma:

- text-only focus mode
- visual-aware attentive presence
- cognitive load stewardship
- local-only model routing
- no-remote-disclosure mode
- read-only project exploration
- shell-with-confirmation mode
- memory-writing session
- memory-review-before-save
- embodiment quiet mode
- high-context collaboration mode

Modules should be opt-in, inspectable, and droppable.

## Term Classes

Soma should classify proposed changes before activation.

### Immutable

Terms that cannot be removed or weakened by adaptation:

- consent
- disclosure
- revocation
- refusal
- provenance for sensitive actions
- memory/export ceilings
- anti-coercion rules
- irreversible-action safeguards

### Negotiable

Terms that may change inside bounded protocol:

- pacing
- summary style
- interruption cadence
- silence tolerance
- response density
- local memory preferences
- display/embodiment style
- narrower tool or perception boundaries

### Restricted

Terms that may widen power and require explicit assent or review:

- camera or microphone access
- screen observation
- shell execution
- filesystem writes
- remote model calls with context
- long-term memory writes
- sharing memory with another agent or service
- autonomous desktop actions
- contacting another person or external system

### Forbidden

Terms that should not be activatable:

- hidden recording
- hidden remote export
- disabling disclosure
- disabling revocation
- punishing refusal
- engagement loops that exploit overwhelm
- memory writes the participant cannot inspect or contest
- silent widening of tool scope

## Rule

The short rule:

**Unilateral narrowing, mutual widening.**

A participant may usually reduce their own exposure or power without approval. Increasing
perception, persistence, actuation, export, or effect on others requires assent, review, or both.

Capability widening should begin as a proposal, not an activation. A model or helper may request a
capability and provide a reason, scope, risk summary, data exposure, and fallback, but the harness
must notify the user and wait for approval before any widening can occur. See
[Capability Proposals](./capability_proposals.md).

## First Implementation Slice

An early Soma slice could implement:

- a static base harness manifest
- active mode disclosure
- a local module registry in files or SQLite
- self-apply narrowing modules
- explicit approval prompts for restricted widening
- a capability proposal store before any widening activation
- capability checks in tool, memory, perception, and model-routing paths
- simple audit records for restricted or irreversible actions

Do not begin with broad autonomy. Begin with visible terms and enforced boundaries.

## Current MVP Slice

The first live Soma slice implements:

- file-backed approved module registry in `config/harness-modules.json`
- `GET /harness-modules`
- `POST /harness-modules/adopt`
- `POST /harness-modules/drop`
- in-memory active module stack
- effective-harness policy enforcement for disabled capabilities

Only self-scoped narrowing modules are supported. Widening, shared, and governance-mediated modules
remain future work.
