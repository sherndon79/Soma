# Real Systemd Provider — Pre-Implementation Approach

- Date: 2026-06-18
- Status: **IMPLEMENTED AND REVIEW-CLEAN — architecture and D1/D2/P1/P2 requirements are
  reflected in the disabled-first provider**
- Authorization: build the real provider behind the disabled route; no activation, exact unit,
  installation, policy change, or real restart is authorized by this note.

## 1. Mechanism: dedicated Rust DBus sidecar

Add a small `soma-systemd-provider` Rust binary using `zbus` against the system bus and
`org.freedesktop.systemd1`.

The sidecar exposes a fixed versioned protocol over a private inherited stdio channel:

- `status.read`
- `restart.inspect`
- `restart.apply`

There is no shell, command execution, `systemctl`, arbitrary DBus method, batch selector, or
caller-supplied unit name. The sidecar loads a root/operator-owned inventory at startup. Node
sends only the inventory id produced by final opaque-handle resolution; the sidecar resolves the
real unit name from its own inventory and rejects unknown ids. The inventory is empty by default.

Reads use typed manager/unit/service properties. Raw provider output is still untrusted:
`readStatusRaw` returns only typed enum/boolean/digest/evidence fields, and Node's existing
`normalizeHostServiceStatus` remains the model-facing trust boundary. DBus error names and text,
unit descriptions, journal/status text, PIDs, paths, commands, environment, and identities never
enter the protocol.

The effective-definition digest is computed locally from:

- fragment and drop-in file contents, read without following unexpected symlinks and bounded by
  count/size;
- normalized `ExecStart*` and `ExecStop*` definitions;
- `ExecCondition`, `ExecStartPre`, `ExecStart`, `ExecStartPost`, `ExecStop`, and
  `ExecStopPost`;
- `Type`, `Restart`, and `BusName`;
- execution identity: `User`, `Group`, and `DynamicUser`;
- privilege posture: `CapabilityBoundingSet`, `AmbientCapabilities`, and
  `NoNewPrivileges`;
- filesystem/execution context: `RootDirectory`, `RootImage`, and `WorkingDirectory`;
- sandbox posture, including the versioned allowlist of `Protect*` and `Private*`
  properties supported by the provider;
- `Environment` and `EnvironmentFile` directives as configured. The digest hashes directive
  values and referenced paths but never dereferences `EnvironmentFile` or reads its possibly
  secret contents;
- dependency and propagation properties enumerated below;
- socket/DBus activation posture;
- a versioned digest-schema identifier.

Only the digest leaves the sidecar. Conservative affected closure is derived from an explicit
versioned set of forward/reverse properties:

- `BindsTo` / `BoundBy`;
- `PartOf` / `ConsistsOf`;
- `Requisite` / `RequisiteOf`;
- `Requires` / `RequiredBy` where stop/restart propagation can occur;
- `PropagatesStopTo` / `StopPropagatedFrom`;
- `PropagatesReloadTo` / `ReloadPropagatedFrom`, recorded conservatively even though reload is
  not an operation in this slice.
- `Triggers` / `TriggeredBy`, with any socket trigger refusing activation.

All forward and reverse relations are included in the definition digest. The affected-set refusal
uses the reverse/propagating relations that can cause restarting the target to stop, restart, or
otherwise transition another unit: `BoundBy`, `ConsistsOf`, `RequiredBy`, `RequisiteOf`,
`PropagatesStopTo`, `PropagatesReloadTo`, and `TriggeredBy`. This avoids treating ordinary forward
dependencies such as `Requires=system.slice` as affected objects while still binding them into the
confirmed definition. `StopPropagatedFrom` and `ReloadPropagatedFrom` are also checked as the
systemd-exposed reverse propagation relations. Any non-target reverse/propagating member,
unsupported or unavailable
reverse property, unresolved dependency, socket activation, or DBus activation refuses. The
property-set schema is versioned so adding or removing a relation is a reviewed contract change
rather than an incidental implementation edit.

`restart.apply` calls `Manager.RestartUnit(unit, "replace")` exactly once. Any error after the
method call may have been dispatched is marked ambiguous. Only validation or authorization
failure proven to occur before the DBus call is non-ambiguous. Verification reads the real
systemd `InvocationID` as primary evidence and the monotonic activation timestamp as secondary.

## 2. Privilege model: unprivileged provider plus narrow polkit activation

The provider does not run as root. It runs as a dedicated local service identity with:

- a private Unix/stdio control channel unavailable to occupants and computer-use input;
- root-owned executable, inventory, and configuration;
- no network access;
- systemd hardening (`NoNewPrivileges`, private temporary state, read-only system paths, bounded
  writable runtime directory, capability bounding set empty);
- no credentials exposed to Node or model-facing results.

Status and digest reads need no elevation. Restart authorization is supplied by polkit to the
provider process, not by passing a credential through Node.

The polkit rule is **not installed on Seth's host during this build**. At later exact-unit
activation, a
root-owned generated rule must match all of:

- the dedicated provider Unix user;
- `org.freedesktop.systemd1.manage-units`;
- verb `restart`;
- the one Seth-approved exact `.service` unit.

Everything else returns `NO`. The provider's root-owned exact inventory is an independent
allowlist, so both provider resolution and polkit must agree. Expanding either list is an
activation change requiring review. If the installed systemd/polkit versions do not expose
reliable unit and verb action details, this model fails closed and the fallback is a separate
root-owned fixed-verb helper with peer-credential authentication and the same exact root-owned
allowlist; it is not silently broadened to generic `manage-units`.

Polkit is not the human confirmation gate. It is a non-interactive final permit after the LCA,
Node authorization, exact plan, and single-use receipt have already passed. The rule must return
`YES` for the exact allowed action, never `AUTH_ADMIN` or another interactive challenge.

## 3. Controlled validation

Provider implementation tests have three levels:

1. Pure Rust protocol/property/digest tests with a fake DBus property source.
2. Integration tests in a systemd-enabled `systemd-nspawn` container or disposable VM. The image
   contains only a trivial `soma-lab-restart-proof.service` whose process sleeps and writes no
   external state. Test policy and inventory name only that unit.
3. A separately authorized attended host drill, later, against Seth's exact approved expendable
   unit.

The container/VM tests must prove:

- typed status read and Node-side canary minimization;
- definition digest changes after a drop-in content change and daemon reload;
- definition digest changes when a drop-in changes only execution identity or privilege
  (`User`, `Group`, capabilities, or sandbox posture) without changing an `Exec*` command;
- affected closure is exactly target-only;
- inactive state refuses rather than starts;
- real `RestartUnit` changes `InvocationID`;
- unchanged/absent evidence remains `outcome_unknown`;
- provider errors obey pre-dispatch versus ambiguous semantics;
- recovery, revocation, race, and provenance-loss drills pass through the real adapter.

The controlled systemd+polkit environment must also prove the privilege boundary empirically:

- `YES` for the dedicated provider uid restarting the exact fixture unit;
- `NO` for the same uid targeting a second fixture unit absent from the exact rule;
- `NO` for a non-restart manage-units verb;
- no interactive or `AUTH_ADMIN` result.

The repository will include the fixture unit, container/VM setup, and opt-in integration command,
but normal `npm test` will not install units, polkit rules, or invoke host systemd.

## Residual limits

Container/VM evidence cannot prove Seth's host-specific polkit details, unit dependencies, local
filesystem race behavior, or attended Local Confirmation Authority integration. Those remain
activation evidence for one exact host/unit. This build will not claim live readiness from mocks,
container tests, provider installation, or successful status reads.
