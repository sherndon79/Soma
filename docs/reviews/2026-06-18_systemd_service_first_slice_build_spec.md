# Systemd Service Control — First Computer-Use Build Slice

- Date: 2026-06-18
- Author: Codex (implementation/specification), from the converged
  `spec/host-management-capability` design thread with Claude and Seth
- Status: **REVIEW-CLEAN — Claude confirmed F1-F5 are faithfully represented and introduce
  no new authorization path. Pending Seth's approval of the contract and exact first lab
  unit set. No build or activation is authorized by this document.**
- Parent design:
  `docs/reviews/2026-06-18_computer_use_capability_design.md`
- Scope: the first proof slice for Soma's general computer-use architecture:
  `host.service.status.read` and `host.service.restart` for an allowlisted set of systemd
  system units on one registered local host.

## 1. Purpose and non-goals

This slice proves the reusable computer-use rails against a real but narrow operational
resource:

1. a Seth-authorized task envelope;
2. exact capability and provider grants;
3. inventory-resolved opaque resource handles;
4. `ResourceDescriptor` / `DomainRouter` isolation;
5. typed observe, plan, confirm, apply, and fresh verify stages;
6. consequence classification that resolves upward;
7. content-free provenance and revocation;
8. synthetic testing with no operational fallthrough.

It does **not** provide:

- arbitrary shell execution;
- arbitrary unit-name or host selection by the model;
- service creation, enable/disable, start/stop, reload, masking, dependency changes, or
  daemon reload;
- journal or process output;
- remote-host operation;
- batch restart;
- autonomous background remediation;
- a generic infrastructure router designed ahead of a consumer.

The registered local host and systemd system manager are the only operational target in
this slice.

## 2. Consequence classification

### `host.service.status.read`: C0

The read is observation-only. It returns a compiled, bounded state projection and an opaque
service handle. It does not return the real hostname, unit name, command line, environment,
paths, journal text, process identifiers, usernames, or credentials.

### `host.service.restart`: C3

Restart is **not C2**.

A restart can interrupt availability, terminate in-flight work, trigger network-visible
behavior, rotate connections, execute unit hooks, or fail to return to the prior state.
Capturing that the unit was `active` before apply does not create a rollback artifact:
returning it to `active` cannot undo the interruption or external side effects. Idempotency
and recovery posture are not rollback.

Therefore:

- every restart requires just-in-time Seth confirmation of one exact, digest-bound plan;
- no task envelope may pre-authorize autonomous restart as C2;
- the policy mapping records restart as C3;
- unknown unit type, state, policy, or side-effect posture remains C3 or refuses; it never
  resolves downward;
- a future operation may be classified C2 only if it captures a real pre-apply revert
  artifact that can restore the changed state and the operation's relevant effects.

This slice proves both mandatory guarantees from the parent design honestly:

- **rollback-before-apply:** restart fails the C2 rollback test and is not allowed to flow
  autonomously;
- **misclassification resolves upward:** an apparently local/idempotent action remains C3
  because its actual consequences are not reversible.

The first successful autonomous C2 mutation must be proved by a later capability with real
rollback, such as a scoped file patch with a captured prior version. This slice must not
claim that proof.

## 3. Capability and provider contracts

Two separate capability keys are introduced disabled-first:

| Capability | Risk / class | Scope | Authority |
| --- | --- | --- | --- |
| `host.service.status.read` | sensitive / C0 | session | Read one allowlisted service through an opaque handle |
| `host.service.restart` | high / C3 | once | Restart one exact service from one confirmed plan |

Proposed provider:

`soma.provider.systemd-local`

Proposed contracts:

- `soma.host.service.status.read.v1`
- `soma.host.service.restart.plan.v1`
- `soma.host.service.restart.apply.v1`
- `soma.host.service.restart.verify.v1`

Provider installation and catalog support grant no authority. Both public paths remain
disabled until their activation gates pass. The read and restart grants are independent;
read authority never implies restart authority.

## 4. Registered inventory and opaque handles

### Operator-owned inventory

The model never supplies a hostname or systemd unit name. An operator-owned, reviewed
inventory defines:

- one stable local `host_id`;
- expected machine/boot identity policy;
- provider id;
- an allowlist of systemd **system** units;
- per-unit restart policy;
- unit-type restrictions (`.service` only in this slice; no templated `@` instances);
- required pre-restart state (`active` / `running` in this slice);
- activation restrictions (no socket- or DBus-activated services in this slice);
- an empty reviewed restart-propagation closure;
- verification timeout and expected healthy states;
- whether the unit is excluded because it is security-critical, session-critical,
  dependency-critical, transient, generated, templated, user-scoped, or otherwise unsafe.

Inventory changes require review. Unknown hosts and units fail closed.

The first activation allowlist should contain expendable, non-critical fixture or lab
services, not networking, authentication, storage, display/session, container runtime,
or Soma's own control-plane services.

Some units are categorically excluded even when an operator considers them non-critical:

- the local user-presence / confirmation authority and its dependencies (including the
  relevant logind, polkit, display/session, and trusted-indicator path);
- the provider's own observation/control channel (including the DBus broker/system bus used
  to inspect and restart units);
- Soma's service plane, grant/provenance stores, provider process, or any service required
  to revoke, record, or verify the operation;
- units whose restart can propagate to another unit through `PartOf`, `BindsTo`,
  `PropagatesStopTo`, or equivalent stop/restart coupling.

The first live unit must have a reviewed affected closure of exactly `{target}`. General
dependency-bearing or activation-driven services require a later review after the one-unit
proof is complete.

### Task-scoped service handles

At task start, Soma mints an opaque service handle from:

- task id;
- host inventory generation;
- unit inventory generation;
- provider id;
- random nonce;
- expiry.

The provider-side handle table holds the real host/unit mapping. The model sees only the
opaque handle and minimized state.

Handles are:

- task-, grant-, provider-, domain-, and host-generation-bound;
- non-enumerable and non-derivable;
- short-lived;
- revoked on task close, grant revocation, inventory change, host reboot/identity drift,
  provider restart, or recovery degradation;
- never accepted as bearer authority without the matching active grant and task envelope.

Seth's local review surface resolves the real hostname and unit name. Provenance and
model-facing results do not.

## 5. Task envelope

The task envelope is confirmed by Seth before operational reads. It is context and bounds,
not a substitute for grants.

Required fields:

- `task_id`;
- declared objective;
- registered `host_id`;
- allowed service inventory ids or an operator-selected subset;
- allowed capabilities (`status.read`; optionally `restart`);
- consequence ceiling;
- expiry and maximum elapsed time;
- maximum status reads;
- maximum restart plans;
- maximum successful restarts (`1` in this slice);
- route (`local` only);
- model-egress/provider policy;
- teardown posture;
- explicit exclusions.

The default consequence ceiling may be C2 globally, but restart remains C3 and cannot run
without step-up confirmation.

Task closure destroys the opaque-handle table, unconsumed plan artifacts, and task-local
result context. It does not erase content-free audit records.

## 6. Resource descriptors and routing

This slice **reuses** Soma's existing `ResourceDescriptor` / `DomainRouter` authority
boundary. It adds the minimum systemd-specific descriptor resolver required by this
consumer; it does not add a new generic infrastructure abstraction layer.

### Status descriptor

The `DomainRouter` resolves a status request to an internal descriptor resembling:

```json
{
  "domain": "operational",
  "capability": "host.service.status.read",
  "provider_id": "soma.provider.systemd-local",
  "resource_class": "systemd_service",
  "host_id": "inventory-local-host",
  "service_handle": "opaque",
  "inventory_generation": "opaque-generation",
  "task_id": "task-id",
  "grant_id": "grant-id",
  "limits": {
    "max_properties": 12,
    "timeout_ms": 5000
  }
}
```

The descriptor carries internal opaque ids, never a caller/model-supplied unit name, host,
DBus path, command, or socket.

### Restart descriptors

Plan, apply, and verify descriptors add:

- observation generation;
- immutable plan id and digest;
- runtime-state generation/precondition digest;
- effective unit-definition digest;
- confirmation receipt id for apply;
- apply attempt id;
- verification deadline.

Testing domain resolves only a synthetic systemd fixture/provider. Operational-looking ids
in testing must refuse or resolve synthetic. There is no synthetic-to-live fallback.

## 7. Typed status read

The provider reads systemd through a bounded typed interface, preferably the systemd DBus
API or a fixed-argument helper. It must not invoke a shell or interpolate caller strings.

The model-facing result is a schema allowlist such as:

```json
{
  "service_handle": "svc-opaque",
  "observation_generation": "obs-opaque",
  "load_state": "loaded",
  "active_state": "active",
  "sub_state": "running",
  "unit_file_state_class": "enabled",
  "can_restart": true,
  "restart_policy_class": "allowed_with_confirmation",
  "state_changed_at_bucket": "recent",
  "healthy": true,
  "content_included": false,
  "identifiers_included": false
}
```

Allowed values are enumerated and normalized. Unknown provider values map to `unknown` and
raise consequence/refusal posture; raw values do not pass through.

Excluded:

- hostname and unit name;
- descriptions that may contain names or operator text;
- fragment/drop-in paths;
- `Exec*` commands;
- environment variables;
- process ids and cgroup paths;
- user/group identity;
- dependency unit names;
- status text and journal excerpts;
- raw DBus errors.

The local Seth-facing surface may resolve the exact target and show additional reviewed
operator metadata. That local display is not copied into model context or provenance.

## 8. Restart plan

Planning is read-only and creates no restart authority.

A plan request references:

- service handle;
- fresh observation generation;
- task id;
- restart grant intent (an active once grant may be required at plan time, but remains
  unconsumed until apply).

Before producing a plan, Node/provider re-check:

- task envelope and expiry;
- exact read/restart capability grants;
- provider and operational domain;
- inventory membership and generations;
- host/boot identity;
- unit loaded state, supported unit type, and required `active` / `running` pre-state
  (this slice refuses restart of an inactive unit rather than silently turning restart into
  start);
- effective unit-definition digest;
- restart allowlist;
- one requested target and affected closure exactly `{target}`;
- no recovery degradation;
- no concurrent plan/apply lock;
- current state still matches the observation generation.

The immutable `PlanArtifact` includes:

- plan id and digest;
- task id;
- opaque service handle;
- internal resource descriptor digest;
- before-state digest and selected normalized before-state;
- effective unit-definition digest;
- operation: `restart`;
- consequence class: C3;
- why it is C3;
- expected transient state and final postcondition;
- timeout;
- requested-target count (`1`);
- affected closure: `target_only`;
- rollback posture: `not_reversible`;
- recovery posture: wait/verify and report, never claim rollback;
- expiry;
- confirmation required: `true`.

The model receives a minimized plan summary. Seth's local preview resolves the exact host
and unit and shows:

- exact target;
- current state;
- effective-definition fingerprint and whether it still matches the reviewed inventory;
- expected interruption;
- affected set: exact target only;
- timeout;
- lack of rollback;
- verification condition;
- plan digest and expiry.

The preview is not confirmation and does not mutate anything.

### Effective unit-definition digest

Seth confirms the effect of restarting the unit **as it is defined at preview time**, not
merely the unit's runtime state.

The provider computes a local, content-withheld digest over the effective definition that
determines restart behavior, including:

- fragment and drop-in content/generation;
- `ExecStart`, `ExecStartPre`, `ExecStartPost`, `ExecStop`, and `ExecStopPost`;
- service type and restart policy;
- dependency and propagation properties relevant to stop/restart;
- socket/DBus activation posture;
- other reviewed properties included by the versioned definition-digest schema.

Raw definition content, commands, paths, and environment never leave the provider. The plan
records only the digest and schema version.

Node/provider recomputes the digest at the last possible boundary immediately before
`RestartUnit`. Any mismatch invalidates the plan and confirmation with
`service_unit_definition_drift`; Soma returns to a fresh status/plan/preview cycle.

This check prevents known definition drift from silently changing the confirmed operation.
It does not claim filesystem-to-systemd transactional locking that systemd does not provide;
the residual check-to-call race is one reason the first activation is restricted to an
expendable lab unit under an attended session.

## 9. Confirmation and apply

### Local Confirmation Authority

This slice depends on a first-class **Local Confirmation Authority**. It is not assumed to
exist merely because the copresence design is ratified, and it is not satisfied by an
ordinary API response, terminal stdin, remote-desktop input, model/occupant output, or an
injectable desktop click.

Before restart activation, the authority must provide:

- a trusted local interactive prompt visible to Seth, such as a reviewed polkit/desktop
  portal or dedicated operator UI;
- OS peer credentials and same-user endpoint permissions as account checks;
- independent user-presence confirmation that cannot be supplied by Soma's occupant,
  computer-use input capabilities, synthetic input, or remote input;
- a fresh cryptographic nonce bound to the plan digest, exact local target, C3/no-rollback
  disclosure, task id, provider, and expiry;
- single-use, short-lived receipts with replay, pre-approval, background approval, and
  confused-deputy behavior failing closed;
- positive acknowledgment that the exact preview was displayed before confirmation;
- content-free transition records and recovery inspection.

The confirmation authority is a shared computer-use primitive, but its first real consumer
is this restart slice. It needs its own implementation and acceptance tests before the live
restart route can activate.

Seth confirms the exact plan through that authority. The confirmation receipt binds:

- plan digest;
- exact resolved host/unit;
- task id;
- provider;
- C3 classification and no-rollback disclosure;
- expiry;
- single-use nonce.

Apply requires all of the following immediately before the provider call:

- active task envelope;
- active exact once restart grant;
- unexpired, unconsumed plan;
- unexpired, unconsumed matching confirmation receipt;
- unchanged inventory/host/unit/runtime-state observation generation;
- recomputed effective unit-definition digest matching the plan;
- same provider and descriptor digest;
- apply lock acquired;
- requested-target count still one and affected closure still exactly `{target}`;
- policy still classifies the action C3.

Any drift invalidates the plan and confirmation. Soma returns to a fresh status read; it does
not silently re-plan or re-confirm.

The provider executes exactly one typed restart operation. It receives no arbitrary command,
arguments, environment, unit name from model input, or batch selector.

The once restart grant and confirmation receipt are consumed atomically at apply acceptance.
Retries after an ambiguous transport failure do **not** automatically restart again. They
enter `outcome_unknown` and proceed to verification/reconciliation.

## 10. Verification and outcome semantics

Apply success is a claim. Verification is a fresh typed status read after the restart call,
using a new observation generation.

The verifier checks:

- same registered host and unit inventory identity;
- unit is loaded;
- expected final `active_state` / `sub_state`;
- changed systemd `InvocationID` as the primary evidence that a new service invocation
  occurred;
- changed monotonic activation timestamp as secondary evidence only;
- verification completed before deadline;
- no unexpected unit/host drift.

Outcomes:

- `verified_success`: restart evidence and healthy postcondition observed;
- `verified_failure`: terminal unhealthy/failed state observed;
- `outcome_unknown`: timeout, provider/transport loss, insufficient restart evidence, or
  ambiguous state;
- `not_applied`: refusal before provider invocation.

`outcome_unknown` must never be converted to success and must never trigger an automatic
second restart. It surfaces locally with operator recovery guidance and a fresh-read option.
If `InvocationID` is unavailable or unchanged and no stronger capability-specific proof
exists, a healthy-looking active state remains `outcome_unknown`, not verified success.

Because restart is not reversible, "recovery" means observe, report, and offer separately
authorized next actions. It never means silently stop/start/restart again.

## 11. Privacy, bystander, and untrusted-data posture

Resource authority is not blanket data authority.

This slice avoids content-bearing journal/status text entirely. The compiled status schema
contains operational state only. Exact host/unit identifiers remain in the local broker and
Seth-facing preview.

The provider may use local credentials and exact identifiers internally. It must never return:

- credentials, tokens, environment, or secret material;
- personal identifiers;
- raw service output, logs, status text, or exception text;
- command lines or filesystem paths.

All provider output is untrusted until Node validates it against the exact schema. Error
messages become stable reason codes. No provider text becomes model instructions.

Any future log/content capability requires its own design, compiled minimizer, redaction,
prompt-injection treatment, and bystander review. It does not inherit disclosure authority
from status or restart.

## 12. Provenance and recovery

Content-free events should cover:

- task envelope created/expired/closed;
- handle minted/revoked;
- status read allowed/refused and normalized state class;
- plan created/invalidated/expired;
- local preview displayed;
- confirmation granted/expired/consumed;
- apply accepted/refused;
- provider invocation attempted;
- verification result;
- grant consumed/revoked;
- recovery degradation.

Events may include opaque ids, capability/provider, domain, task id, descriptor/plan digests,
classification, counts, timings, outcome codes, and generation-change booleans.

They must not include hostnames, unit names, raw systemd properties, status text, logs,
commands, credentials, or local preview content.

Corrupt or missing inventory, grant, handle, plan, confirmation, lock, or provenance recovery
state is non-authorizing and fails closed. A committed provider call with failed provenance
append is reported as degraded/possibly applied and requires reconciliation; it is never
blindly retried.

## 13. Refusal codes

The public contract should use stable codes, including:

- `service_task_not_active`
- `service_task_scope_denied`
- `service_handle_invalid`
- `service_handle_expired`
- `service_inventory_drift`
- `service_host_identity_drift`
- `service_unit_not_allowlisted`
- `service_unit_type_unsupported`
- `service_unit_activation_unsupported`
- `service_unit_dependency_closure_unsafe`
- `service_unit_definition_drift`
- `service_restart_prestate_unsupported`
- `service_status_unavailable`
- `service_status_output_invalid`
- `service_restart_grant_required`
- `service_restart_classification_c3`
- `service_restart_plan_stale`
- `service_restart_confirmation_required`
- `service_restart_confirmation_mismatch`
- `service_restart_concurrent_operation`
- `service_restart_provider_refused`
- `service_restart_outcome_unknown`
- `service_restart_verify_failed`
- `service_recovery_degraded`
- `service_testing_live_fallthrough_denied`

Refusals disclose enough to narrow or retry safely without exposing the target identity or
raw provider output.

## 14. Threat model and required tests

### Authority and target confusion

- model supplies a raw unit/host name;
- handle from another task, grant, provider, host, domain, or generation;
- stale inventory after unit/host change;
- wildcard or templated unit expansion;
- non-service, socket-/DBus-activated, or propagation-coupled unit reaches the allowlist;
- confirmation/safety/DBus/Soma control-plane unit reaches the allowlist;
- provider attempts more than one affected object;
- read grant reused for restart;
- testing-domain request reaches live systemd.

### Consequence and confirmation bypass

- restart mislabeled C2;
- envelope C2 ceiling treated as restart authorization;
- preview treated as confirmation;
- confirmation digest or target mismatch;
- unit definition changes after preview;
- expired/replayed confirmation;
- policy changes from C3 to unknown and resolves downward;
- plan regenerated silently after confirmation;
- ambiguous apply automatically retried.

### Provider and egress overreach

- raw unit name/hostname/path/pid/command/environment/status text leaks;
- malformed or extra result fields;
- raw DBus/helper error returned;
- secret/personal canary in provider fixture crosses the result schema or provenance;
- provider executes shell interpolation or caller arguments.

### State and recovery races

- unit changes between observe, plan, confirmation, and apply;
- host reboot or provider restart invalidates handles/plans;
- concurrent restart attempts;
- grant revoked before provider call;
- confirmation expires mid-flight;
- provider call succeeds but response/provenance is lost;
- verify times out or cannot prove a restart occurred.

Required tests include unit tests, property tests, and a synthetic integration fixture. The
synthetic provider must model:

- active/running, inactive/dead, failed, reloading, unknown, and changing states;
- definition/drop-in drift and restart-propagation closure drift;
- restart success, refusal, timeout, ambiguous completion, and postcondition failure;
- identity/inventory generation drift;
- canary secrets and identifiers in forbidden raw fields;
- malicious extra output fields;
- an operational provider registered while testing resolution still refuses or stays
  synthetic.

Assertions target harness behavior, never occupant virtue.

## 15. Disabled-first implementation slices

Each slice leaves public mutation disabled until the full activation gate passes.

1. **Vocabulary only:** catalog keys, provider claims, schemas, policy classification
   (`status=C0`, `restart=C3`), no routes.
2. **Inventory and descriptor:** local host/unit registry, opaque handles, testing and
   operational descriptor resolution, negative fallthrough properties.
3. **Synthetic status read:** fixture provider, request/output validation, minimized
   envelope, provenance preview; public operational route still refuses.
4. **Task envelope and grant constraints:** capability-specific constraint validators,
   handle/task binding, expiry/revocation/recovery tests.
5. **Plan artifact:** immutable store, digest, drift invalidation, local review rendering,
   no confirmation or apply.
6. **Local Confirmation Authority:** trusted local UI/polkit-style user-presence channel,
   anti-injection boundary, nonce/preview binding, single-use receipt, recovery tests; no
   apply.
7. **Confirmation receipt integration:** bind the authority's receipt to the exact C3 plan,
   target, definition digest, and expiry; no apply.
8. **Synthetic apply and verify:** one-shot consumption, ambiguous-outcome behavior, fresh
   verification, no automatic retry.
9. **Live provider behind refusal:** fixed systemd API/helper, output validator, allowlisted
   lab service only; public route remains disabled.
10. **Activation review:** canary corpus, recovery drills, revocation race tests, local
   operator preview, documentation parity, Seth approval for one lab unit.
11. **Narrow activation:** one registered host, explicit unit allowlist, one restart per
    task, attended local confirmation, immediate capability deactivation if any invariant
    fails.

Later expansion to remote hosts, logs, start/stop/reload, multiple units, autonomous C2
mutations, or UI actuation requires separate review. No authority carries forward merely
because the provider or inventory already exists.

## 16. Activation acceptance criteria

Activation requires all of the following:

- Claude second-steward design review passes;
- Seth approves this build spec and the exact first operational unit set;
- capability-specific grant constraints are enforced, not merely stored;
- testing-domain operational fallthrough tests pass;
- raw host/unit identifiers and forbidden content fail canary tests across results,
  provenance, errors, caches, and logs;
- restart is mechanically C3 and cannot execute under only a C2 envelope;
- the Local Confirmation Authority passes independent user-presence, anti-injection,
  preview-acknowledgment, replay, recovery, and remote/synthetic-input rejection tests;
- confirmation is local, interactive, single-use, plan/target/definition-digest-bound, and
  replay-safe;
- first-live allowlist is `.service` only, active/running, non-templated,
  non-socket/DBus-activated, outside all confirmation/observation/control-plane dependencies,
  with affected closure exactly `{target}`;
- plan/confirmation invalidation works on every generation drift;
- plan/confirmation invalidation works on effective unit-definition drift;
- no ambiguous outcome automatically retries;
- fresh verification is independent of apply response;
- recovery corruption is non-authorizing;
- teardown removes handles, plans, receipts, locks, and task-local context;
- the operator can revoke before provider invocation and receives honest post-invocation
  non-recall semantics;
- the live fixture demonstrates both successful verification and outcome-unknown handling.

Ratification approves the contract, not activation. The live route remains disabled until
these criteria are demonstrated.

## 17. Review record and revision confirmation

Claude's second-steward review endorsed the contract for ratification subject to four
required amendments:

1. bind plans to an effective unit-definition digest and invalidate on drift;
2. make trusted local human-presence confirmation a first-class dependency;
3. categorically exclude units that underpin confirmation, observation, or Soma's control
   plane, and restrict the first slice to non-templated `.service` units without socket or
   DBus activation;
4. require the first live unit's affected restart-propagation and reverse-dependency closure
   to be exactly the target.

All four amendments are incorporated in this revision. The optional verification refinement
is also adopted: changed systemd `InvocationID` is the primary restart evidence, while
activation timestamps are secondary.

Claude completed revision confirmation on 2026-06-18: F1-F5 pass, the Local Confirmation
Authority remains a strictly narrowing gate rather than an authority origin, and the review
loop is closed. Implementation must preserve two load-bearing properties:

1. computer-use, occupant, synthetic, and remote input can never operate the confirmation
   surface; and
2. the effective unit-definition digest is recomputed at the final boundary before
   `RestartUnit`, with any drift failing closed.

The next decision belongs to Seth: approval of this contract and the exact expendable lab
`.service` unit set. No implementation or activation may begin before that approval.
