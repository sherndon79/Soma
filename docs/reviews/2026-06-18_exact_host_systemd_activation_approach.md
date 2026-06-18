# Exact-Host Systemd Activation Package - Approach

- Date: 2026-06-18
- Status: **IMPLEMENTED AND REVIEW-CLEAN - activation remains separately unauthorized**
- Scope: inert installation artifacts and an attended activation runbook only.
- Non-authorization: no install, identity creation, policy installation, inventory entry, route
  activation, or host restart is authorized by this note.

## 1. Provider identity and control channel

Use a systemd socket-activated service running as the static, unprivileged
`soma-systemd-provider` user and group. The Node harness must run as the distinct, dedicated
`soma-harness` uid, and no unrelated process may use that identity. It connects to a root-owned
`AF_UNIX` stream socket whose mode grants access only to that harness identity. The Rust provider
accepts no stdio control traffic in operational mode and requires the stable `SO_PEERCRED` uid
captured for the connection to match `soma-harness`. That dedicated-uid match is the decisive
caller gate.

A bare peer pid-to-systemd-unit lookup is not authoritative because the numeric pid can be reused
after `connect()`. An exact-unit check may be retained only as non-load-bearing defense-in-depth.
If the target kernel and runtime support `SO_PEERPIDFD`, a later reviewed implementation may pin
the peer with a pidfd before resolving additional process identity. Activation does not depend on
that optional mechanism.

The endpoint therefore has two independent caller checks: filesystem admission and peer
credential/unit verification. The provider's root-owned inventory is a third, resource-level
allowlist. Occupant, computer-use, synthetic, API, and remote input can reach the provider only
through the already gated Node control flow; they receive no socket path authority or generic
provider client. This boundary does not claim to survive arbitrary code execution inside the
trusted harness process.

Socket activation is preferred because it gives the provider a separately hardened identity and
lifecycle without a privileged launcher. A launcher would add a setuid/root request parser and
drop-privilege correctness surface. Direct Node spawning cannot change to the dedicated identity
without such privilege and makes inherited descriptors and environment part of the trust
boundary. The existing stdio adapter remains controlled-test-only and is not the operational
transport.

The socket and service ship disabled and are not wanted by a target. The operational Node adapter
also remains disabled until a separate activation change names the exact socket, expected harness
unit, and provider inventory.

## 2. Provider hardening profile

The service genuinely needs only:

- the inherited Unix listening socket and `AF_UNIX`;
- read access to its exact root-owned inventory and systemd unit/drop-in files;
- the system bus socket for typed systemd reads and the one polkit-authorized restart;
- bounded memory, CPU, file descriptors, and runtime time.

The proposed unit sets:

- `User=soma-systemd-provider`, `Group=soma-systemd-provider`, `UMask=0077`;
- `NoNewPrivileges=yes`, `CapabilityBoundingSet=`, `AmbientCapabilities=`;
- `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`;
- `PrivateNetwork=yes`, `RestrictAddressFamilies=AF_UNIX`, `IPAddressDeny=any`;
- `ProtectKernelTunables=yes`, `ProtectKernelModules=yes`, `ProtectKernelLogs=yes`,
  `ProtectControlGroups=yes`, `ProtectHostname=yes`, `ProtectClock=yes`;
- `RestrictNamespaces=yes`, `RestrictSUIDSGID=yes`, `RestrictRealtime=yes`,
  `LockPersonality=yes`, `MemoryDenyWriteExecute=yes`;
- `SystemCallArchitectures=native` and a reviewed `SystemCallFilter` based on
  `@system-service` with mount, module, raw-I/O, reboot, swap, and keyring families denied;
- `ProcSubset=pid`, `ProtectProc=invisible`, `DevicePolicy=closed`, `RemoveIPC=yes`;
- no writable filesystem path except a bounded private runtime directory if runtime state proves
  necessary; no shell, network namespace access, credentials, home access, or environment secrets;
- restart and resource limits that avoid an unbounded crash loop.

`PrivateUsers` is deliberately omitted because user-namespace credential translation could make
the polkit subject identity ambiguous. The exact directive set must pass `systemd-analyze
security`, provider startup, peer validation, typed reads, definition hashing, and negative
restart tests on the target host. The drill must explicitly prove that
`/run/dbus/system_bus_socket` remains reachable under the complete sandbox. Unsupported hardening
directives, blocked system-bus access, or required relaxations stop activation for review; the
runbook does not silently drop them.

## 3. Polkit generation and fallback

The repository contains a generator and template, not an installed rule. Generation takes one
validated `.service` unit and emits a root-owned rule that:

1. returns non-interactive `YES` only when the subject is the
   `soma-systemd-provider` identity, the action is
   `org.freedesktop.systemd1.manage-units`, `verb` is exactly `restart`, and `unit` is the exact
   Seth-approved service;
2. returns `NO` for every other `manage-units` request from that provider identity, preventing
   fallback to broader policy;
3. leaves unrelated subjects and actions untouched.

The generated rule uses an early lexical filename and the inventory is compared with it in the
activation preflight. Host drills must prove the action details and exact `YES`/`NO` matrix with
the installed systemd/polkit versions. The second-unit and non-restart-verb denials also prove
that no earlier installed rule grants broader `manage-units` authority to the provider subject.
A missing detail, interactive challenge, unexpected earlier grant, fallback, or version-specific
mismatch stops activation.

If exact unit-plus-verb matching cannot be proved, the polkit path remains uninstalled. The
separately reviewed fallback is a root-owned, socket-activated fixed-verb helper. Its socket
admits only the provider identity; the helper verifies `SO_PEERCRED`, accepts only an opaque
inventory id, resolves one exact unit from its own root-owned allowlist, and implements only
`RestartUnit(unit, "replace")`. It has no arbitrary method, verb, unit, or argument surface.
Fallback selection is an explicit activation decision, never automatic broadening.

## 4. Attended activation runbook shape

The eventual runbook will require Seth to perform, in order:

1. review the exact generated package, hashes, expected harness identity/unit, target host, and
   one expendable `soma-lab-*.service`;
2. install static identities and root-owned artifacts while keeping the socket, service, route,
   inventory, and restart flags disabled;
3. create and inspect the throwaway service, then prove its affected closure is exactly itself;
4. register that one unit in staged provider/policy configuration and verify file ownership,
   permissions, package hashes, and agreement between both allowlists;
5. start only the private provider socket and run non-mutating channel, identity, status, digest,
   drift, recovery, and negative policy drills against the exact host and unit;
6. **stop without enabling the route if any drill fails or any result is ambiguous**;
7. prove the off-switch before the on-switch: with the route disabled and restart grant revoked,
   an attempted restart must refuse before provider dispatch;
8. separately authorize and enable the operational route for that one unit;
9. perform one attended, confirmed restart and verify a changed `InvocationID`, expected state,
   content-free evidence, and no second dispatch;
10. immediately disable the route and socket on any anomaly, remove the inventory/policy grant,
   stop the lab unit, daemon-reload, and preserve evidence before optional package/user removal.

Rollback is valid at every boundary: route off first, then socket off, policy and inventory
removed, lab unit stopped/disabled/removed, daemon reloaded. No rollback step relies on the
provider being healthy.

## Build invariants

Implementation may add only inert repository artifacts: unit/socket templates, strict channel
code, policy generator/template, validation tests, packaging manifest, and the runbook. The build
must not install files, create users, start units, modify host policy, populate the operational
inventory, enable a route, or call host `RestartUnit`.
