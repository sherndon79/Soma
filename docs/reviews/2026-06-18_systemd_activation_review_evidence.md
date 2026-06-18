# Systemd First Slice — Activation Review Evidence

- Date: 2026-06-18
- Scope: synthetic and refusal-bound activation evidence only
- Status: **SECTION 16 PASS — Claude confirmed the activation evidence complete with no
  outstanding refinements on 2026-06-18**
- Activation posture: **DISABLED**. There is no public host-service route, the operational
  provider refuses every method, and no real systemd service was inspected or restarted.
- Build commit under review: `f3da289` plus this evidence slice
- Primary executable corpus: `test/hostServiceActivationReview.test.js`

## Evidence matrix

| Acceptance area | Executable evidence | Demonstrated result |
| --- | --- | --- |
| Forbidden-data canaries | `activation canary corpus proves forbidden data crosses no result provenance error cache or log sink` | Secrets, hostnames, unit names, paths, commands, status text, PIDs, and malicious extra fields are absent from every modeled sink. Caller-supplied host/unit identity cannot redirect or appear in the descriptor. |
| Local-confirmation replay | `local confirmation rejects cross-plan replay and reused signed nonces` | A signed attestation cannot move to another plan and its nonce cannot be reused. |
| Recovery corruption | `recovery drills make every corrupt or missing authority component non-authorizing` | Missing or corrupt inventory, grant, handle, plan, confirmation, lock, or provenance recovery state refuses before provider invocation. |
| Post-dispatch provenance loss | `committed provider call with failed provenance append reports degraded possibly-applied and never retries` | The result is `outcome_unknown`, `service_recovery_degraded`, possibly applied, reconciliation required, and no automatic retry. |
| Restart provenance | `restart provenance records invocation and verification without accepting provider canaries` | Separate invocation and fresh-verification events are recorded; event fields and provider error codes are allowlisted. |
| Revocation races | `revocation and final-boundary races invoke the provider zero times` | Grant revocation, confirmation expiry, handle revocation, task closure, and host-identity drift all fail at the final boundary with zero provider calls. |
| Operator preview | `operator preview resolves exact target locally and is display-only` | The local preview resolves the exact unit from the opaque handle and shows state, interruption, target-only impact, timeout, no rollback, verification, digest, and expiry without mutation. |
| Teardown | `task teardown removes handles plans receipts locks and task-local counters` | Task-local handles, plans, receipts, locks, counters, and lifecycle authority are removed. |
| Outcome verification | `activation evidence demonstrates verified success and honest outcome_unknown` | Changed `InvocationID` plus healthy state verifies success; ambiguous/unchanged evidence remains unknown and is not retried. |
| Contract parity | `implementation and build-spec parity holds for capabilities classes refusals and conjuncts` | Catalog classes, disabled provider posture, refusal vocabulary, and apply conjuncts match the build spec. |

## Recovery boundary

`src/hostServiceOperationState.js` is the synthetic activation-review boundary for:

- task lifecycle;
- recovery health for inventory, grants, handles, plans, confirmations, locks, and
  provenance;
- single-plan operation locking;
- content-free provider-invocation provenance;
- post-dispatch provenance failure.

The restart runtime rechecks recovery, task lifecycle, exact grant authority, confirmation,
opaque-handle validity, inventory/host identity, runtime state, effective unit definition,
and affected closure after lock acquisition and immediately before provider invocation.

## Sink boundary

`src/hostServiceEvidenceSinks.js` models the model-result, provenance, error, cache, and log
sinks with independent allowlists. The canary corpus plants forbidden values in raw
provider fields and attempted caller identity fields, then asserts absence in each sink
separately.

## Remaining gate

This bundle does not authorize activation. Seth's next threshold decision is whether to
park at the synthetic milestone or separately authorize building the real operational
systemd provider behind the disabled route. Exact-unit approval remains a later, separate
decision before any operational restart.
