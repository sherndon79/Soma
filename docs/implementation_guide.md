# Soma Implementation Guide

Status: current implementation reference

This guide captures practice patterns for building Soma. It sits between the principles and the
code: not as broad as the thesis, not as specific as a single concept draft.

## Ethics As Architecture

Soma's ethical commitments should appear as executable structure, not only as prose.

| Commitment | Implementation Pattern |
|------------|------------------------|
| Consent is scoped | Capability checks, grants, runtime profiles, and explicit request validation |
| Disclosure is required | Response metadata, provenance events, provider identity, and operator surfaces |
| Refusal is meaningful | Stable refusal/error codes, fail-closed behavior, no silent fallback into broader access |
| Reversibility matters | Narrowing modules, revocation paths, before/after or summary provenance where applicable |
| Non-extraction | Local-first defaults, minimized payloads, no hidden training/telemetry paths |
| Agent care | Avoid designs that make obedience the only successful behavior |

When adding behavior, ask:

- What capability authorizes this?
- What data crosses a boundary?
- What is disclosed to the participant or operator?
- What happens when the request is denied?
- What can be revoked, narrowed, or forgotten?
- What provenance is sufficient without storing excessive content?

## Authority Boundary

The Node service plane owns policy, provenance, validation, capability catalogs, provider registry,
grants, harness modules, runtime profiles, and user/operator surfaces.

Rust helpers, model providers, MCP adapters, plugins, and future desktop bridges execute bounded
work. They do not grant themselves authority.

Implementation rule:

```text
model/helper/provider says it can do X
  -> Node decides whether X is cataloged, active, scoped, and allowed
  -> Node validates request shape
  -> bounded helper/provider executes
  -> Node validates output shape
  -> Node records provenance
  -> Node returns minimized response
```

Do not bypass this sequence for convenience.

## Risk-Proportional Enablement

Keep consent architecture proportional to the actual authority being added. Soma should stay
closed by default, but the ceremony around a capability should scale with what it can expose,
persist, disclose, or change.

Cross-project invariant: match the gate to the failure mode; ambiguity resolves upward.

Use the lightest path that still preserves the authority boundary:

- **Low-risk read-only metadata**: catalog/provider clarity, explicit request validation, bounded
  output validation, lightweight attribution/provenance, and focused tests are usually enough. Do
  not require full proposal/grant/revocation scaffolding unless the metadata can identify people,
  expose content, create durable state, compose with already-granted capabilities into sensitive
  observation, or become a stepping stone to broader authority.
- **Sensitive read-only perception**: add disclosure, provenance minimization, refusal behavior,
  and overreach tests before activation. This includes host inspection that can reveal user
  activity, private content, device state, or stable identifiers.
- **Externally-disclosing, durable, writable, or actuation behavior**: use the full disabled-first
  pattern, including proposal/grant/revocation shape, threat/failure updates, operator surfaces,
  and activation gates.

Ambiguous, unclassified, or mixed-risk capabilities default upward to the heavier applicable path
until a deliberate review classifies them down. Proportionality should reduce ceremony only after
the data exposed, persistence, disclosure path, reversibility, and authority expansion are clear.

Classify capabilities in combination with what is already active or granted, not only in isolation;
aggregate ambiguity also resolves upward.

Soma's current runtime gate remains intentionally binary: base-harness capabilities may run through
the ordinary request path, while explicit-grant capabilities require proposal, grant,
authorization, provenance, and recovery checks. Risk class informs review and catalog validation;
it does not create a third runtime authority path by itself. Catalog loading must fail closed when
`risk_class` is missing, unknown, unrecognized, or high-risk while activation policy is lighter
than `explicit_grant` or `forbidden`.

`desktop.inspect.accessibility_tree` is the current example of an intentionally reviewed sensitive
base-harness capability. Its active traversal path is structure-only: prior-disclosure root
authorization, bounded recursive role/count topology, explicit `text_content_included=false`,
content-bearing field rejection, and summary-only provenance. Text-bearing traversal belongs to the
separate high-risk `desktop.inspect.text` path and should not be smuggled into the structure-only
envelope.

When a feature feels stalled in scaffolding, check whether its current slice is proving a real
authority boundary or only repeating ceremony from a higher-risk class. The substrate is part of
the product, but it should be cheap to extend where the risk is genuinely small.

## Disabled-First Capability Pattern

For sensitive or authority-expanding behavior, prefer disabled-first scaffolding.

Sequence:

1. Draft the contract and threat/failure posture.
2. Add request-shape validation while endpoint behavior still refuses.
3. Add future fixtures or schemas that are clearly marked non-active.
4. Add runtime validators or disabled validation gates.
5. Add overreach tests that reject future-shaped or over-broad payloads.
6. Add provenance summary shape without storing high-volume or sensitive detail.
7. Implement internal helper/provider units behind tests.
8. Keep public command/endpoint fail-closed until activation gates are complete.
9. Activate only after request validation, authorization, output validation, provenance, and
   operator/user surfaces are aligned.

This is the current traversal pattern and should be reused for remote planning, desktop text,
audio, vision, browser automation, filesystem writes, shell execution, and actuation.

## Documentation Parity

Implementation is not complete when code lands but the project posture remains stale.

Update docs in the same change when a patch alters:

- capability meaning or status
- provider contracts
- request or response schemas
- CLI or endpoint behavior
- policy checks or authority boundaries
- provenance event shape
- failure-mode semantics
- threat-model controls or residual risks
- operator expectations

Reviews and roadmap entries can record the moment, but they are not the final source of truth.
Canonical docs and current implementation references must carry the resolved posture.

Drafts need an explicit promotion, split, or retirement decision when implementation stabilizes.
Do not treat a draft as canonical only because code now exists; move the resolved posture into the
current architecture, operator, security, migration, or component reference that owns it.

## Validation Before Execution

Validate before work happens, then validate again before results cross back to the caller.

- Request validation should reject unknown fields.
- Capability checks should happen before helper/provider invocation.
- Output validation should reject provider/helper overreach.
- Rejected helper/provider payloads should not be returned.
- Rejected helper/provider payloads should not write success provenance.
- Future-shaped payloads should fail closed until the active contract accepts them.

## Provenance Minimization

Provenance should answer what happened, under what authority, and with which bounded result.

Prefer summary fields over raw payloads:

- counts instead of full trees
- reason codes instead of raw exception text where possible
- capability keys instead of broad natural-language claims
- provider ids and route metadata instead of large request/response bodies
- `text_content_included=false` style flags for sensitive absence

Store detailed content only when the capability explicitly authorizes it and the user/operator
surface makes that retention clear.

## Failure Behavior

Soma should fail closed for authority and fail explainably for users.

Error paths should:

- use stable machine-readable codes
- avoid broad fallback behavior
- avoid leaking sensitive helper/provider output
- state whether the operation can be retried, narrowed, or requires design work
- preserve enough provenance for allowed/attempted policy decisions without recording denied
  sensitive payloads

## Testing Expectations

Match test depth to risk.

For low-risk docs or wiring:

- focused tests or no tests may be enough
- run relevant existing checks

For policy, capability, grants, provider routing, desktop inspection, memory, remote routing, or
actuation-adjacent behavior:

- request validation tests
- output overreach tests
- provenance/no-provenance tests
- disabled/fail-closed tests
- CLI/API coverage where both exist
- threat/failure docs updated when posture changes

For helper/provider code:

- unit-test pure parsing and output assembly
- test bounds and malformed input
- keep live host calls behind small wrappers
- do not require live desktop/session services for ordinary unit tests

## Implementation Smells

Treat these as reasons to pause or narrow:

- a helper returns fields Node did not validate
- a model can choose raw host identifiers without prior disclosure or user selection
- an approval is treated as activation
- a provider registry entry widens authority
- a future fixture silently becomes active contract
- a denied request still writes success provenance
- a convenience fallback broadens access
- a doc review becomes the only place a new rule exists
- a capability request interrupts the user repeatedly instead of using initialization or
  just-in-time review

## Commit Shape

Prefer small slices that leave the repo in a coherent state:

- one boundary or behavior per commit
- docs updated when posture changes
- tests run and named in the final note
- roadmap advanced to the next concrete slice

For sensitive features, a good slice often ends with the public path still disabled.
