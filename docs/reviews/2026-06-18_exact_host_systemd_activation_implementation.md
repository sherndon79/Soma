# Exact-Host Systemd Activation Package - Implementation Evidence

- Date: 2026-06-18
- Status: **HOST FINDINGS CORRECTED AND REVIEW-CLEAN - approved for workstation re-run**
- Activation posture: **INERT**. No files were installed, no identities were created, no unit was
  started, no policy was changed, no inventory entry was added, no route was enabled, and no host
  restart was attempted.

## Implemented

- Rust socket-activated mode requiring exactly one systemd-passed listener and a configured,
  non-root expected harness uid.
- Decisive per-connection `SO_PEERCRED` uid validation before request parsing. `SO_PEERPIDFD` is
  acquired and closed when supported; absence on older kernels does not weaken the dedicated-uid
  gate. No bare pid-to-unit decision is made.
- Disabled-by-default Node Unix-socket client using the existing strict response validator.
- Non-install-enabled socket/service units with separate `soma-harness` and
  `soma-systemd-provider` identities and the reviewed sandbox profile.
- Early-order exact-unit/exact-restart polkit template and a generator that rejects non-service
  targets and writes new files with mode `0600`.
- Inert package manifest, repeatable package validator, and attended activation/rollback runbook.

The implementation retains the explicit scope boundary: it protects the provider channel from
occupant and input paths during normal harness operation. It does not claim to survive arbitrary
code execution inside the trusted harness process.

## Validation

- Rust provider tests: 8 library tests and 1 socket peer-credential test pass.
- Focused Node tests: disabled socket admission, explicit typed exchange, policy generation, and
  inert package validation pass.
- `systemd-analyze verify` passes against the service/socket syntax using a temporary inert
  executable substitution because the production binary is intentionally not installed.
- `systemd-analyze security --offline=yes` reports exposure `0.6 SAFE`; package validation fails
  above `1.0`.
- The package validator confirms no `[Install]` section, all required hardening directives,
  `PrivateUsers` omission, exact socket group/mode, explicit provider-subject polkit denial,
  disabled registry/inventory, and all manifest mutation flags false.
- `git diff --check` passes.

## Deferred To Attended Host Preflight

Repository validation cannot prove the target host's dedicated uid assignments, system-bus
reachability under the live sandbox, polkit action details/rule precedence, exact lab-unit
closure, or the kill-switch behavior. The runbook makes each a stop-on-failure precondition before
route activation or the first real restart. The checked-in operational inventory remains empty
and the provider registry remains disabled.

## Workstation preflight findings

The first workstation preflight stopped before policy installation, route activation, or restart:

- F-HOST-1: `DirectoryMode=0750` created `/run/soma` as `root:root`, preventing the dedicated
  harness from traversing to the correctly group-owned socket.
- F-HOST-2: the manifest installed the inventory as `0600 root:root`, preventing the
  post-privilege-drop provider from reading its allowlist.

The corrected package creates `/run/soma` through tmpfiles as `0750 root:soma-harness` and installs
the inventory as `0640 root:soma-systemd-provider`. `channel.conf` deliberately remains `0600
root:root`: systemd reads `EnvironmentFile` before applying the service `User=`, so the provider
does not need direct file access. The controlled container now installs these exact ownerships and
exercises the socket-activated peer path live. The socket unit also refuses to start when
`/run/soma` is absent instead of silently relying on a newly created, incorrectly owned parent.

The revised privileged container drill now installs the package at those exact permissions and
proves:

- `soma-harness` can traverse `/run/soma`, while an unrelated uid cannot;
- the provider can read but cannot write the inventory and cannot read `channel.conf`;
- the real packaged socket and hardened service start successfully;
- a root socket peer receives `provider_peer_unauthorized` before request parsing;
- a `soma-harness` peer receives a typed status result through the socket;
- stopping the socket preserves the tmpfiles-owned parent, and restarting restores typed service;
- the existing real-systemd digest, drift, policy, restart, ambiguity, and runtime-boundary drills
  still pass.
