# Real Systemd Provider — Disabled-First Implementation Evidence

- Date: 2026-06-18
- Status: **REVIEW-CLEAN — Claude approved the disabled-first implementation for commit**
- Activation posture: **DISABLED**. The checked-in operational inventory is empty,
  `restart_enabled` is false, the public route remains absent, and no host unit or polkit rule was
  installed.

## Implementation

- `crates/soma-systemd-provider`: Rust `zbus` sidecar with fixed NDJSON methods
  `status_read`, `restart_inspect`, and `restart_apply`.
- `src/hostServiceSystemdProvider.js`: strict Node envelope/result validator and a disabled-by-
  default synchronous adapter for the existing plan/LCA/restart runtime.
- `config/systemd-provider-inventory.json`: empty, disabled, non-authorizing operational
  inventory.
- `docker/systemd-provider-test` and `docker-compose.systemd-provider-test.yml`: disposable
  systemd+polkit environment with two inert services.
- `scripts/systemd-provider-controlled-test.sh`: opt-in privileged-container drill guarded by
  `SOMA_SYSTEMD_CONTROLLED_TEST=1`.

## Boundaries

The provider accepts an inventory id, never a unit name. It resolves against its own root-owned
inventory and emits no unit identity, commands, paths, status text, environment, PID, description,
journal content, or raw DBus diagnostics.

The effective-definition digest binds fragment/drop-in contents; the full start/stop/condition
command family; execution identity; capabilities and `NoNewPrivileges`; root/working context;
environment directives without dereferencing `EnvironmentFile`; sandbox posture; activation
posture; and the versioned dependency/propagation schema.

The affected set refuses on nonempty reverse or propagating relations, unavailable properties,
socket/DBus activation, or any non-target effect. Ordinary forward dependencies remain digest-
bound without being mislabeled as objects restarted by the target operation.

Systemd property values are currently encoded into the digest using zvariant's debug
representation behind the versioned digest schema. A `zbus`/`zvariant` upgrade must therefore be
treated as a digest-schema migration and re-baseline, not an ordinary dependency bump.

Restart is independently disabled in the binary unless an inventory explicitly sets both
`restart_enabled` and `controlled_testing`. The checked-in inventory sets neither. The controlled
container's polkit rule returns non-interactive `YES` only for the dedicated provider uid,
`restart`, and the exact allowed fixture; it returns `NO` for the second unit and non-restart
verbs.

## Demonstrated

The controlled drill completed successfully and proved:

- typed real-systemd status read;
- Node-side minimization with no real unit name or command leak;
- privilege-only drop-in change alters the digest;
- the same change between plan and apply fails final-boundary validation with zero restart call;
- affected closure is `target_only`;
- exact fixture restart is permitted while second-unit restart and `StopUnit` are denied;
- inactive unit restart refuses and does not start it;
- real `InvocationID` changes on restart;
- absent post-restart `InvocationID` remains `outcome_unknown`;
- real-adapter grant, task, handle, confirmation, host-identity, recovery, and lock gates invoke
  zero restarts when invalid;
- normal tests do not invoke host systemd, install policy, or create units.

## Residual gate

The container proves provider mechanics and policy granularity, not Seth-host readiness. Host
polkit detail behavior, exact unit closure, filesystem layout, LCA integration, and attended
operation remain separate evidence. No operational inventory entry, installation, route
activation, or host restart is authorized by this implementation.

The controlled container launches the provider under the dedicated uid with `runuser`. Production
service/socket packaging that establishes the same dedicated identity and private Node-provider
channel is deliberately not installed or claimed complete here; it belongs to the exact-host
activation package and must be reviewed before any route can reach the provider.

The exact-host package must also harden fragment/drop-in opening against symlinked parent
components (for example, `openat2`/`O_NOFOLLOW` or canonical-prefix verification). The current
provider rejects a symlink at the final path and bounds file count/size, but does not claim that
host-specific parent-path hardening yet.
