# Exact-Host Systemd Activation Package - Implementation Evidence

- Date: 2026-06-18
- Status: **REVIEW-CLEAN - Claude approved the inert package for commit**
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
