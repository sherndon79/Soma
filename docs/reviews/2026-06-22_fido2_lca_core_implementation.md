# FIDO2 LCA Core - Inert Implementation Evidence

- Date: 2026-06-22
- Status: **CORE REVIEW-CLEAN - approved as an inert implementation slice**
- Activation posture: **INERT**. No hardware backend, enrollment command, socket service, udev
  rule, credential store, or host action is enabled. The binary exits configuration-refused.

## Implemented

- Versioned one-unit confirmation request and root-owned credential-policy schemas.
- Canonical, domain-separated challenge committing to RP id, plan/target digests, task, provider,
  inventory id, exact target, C3/no-rollback, nonce, and expiry.
- Raw FIDO assertion boundary rather than a backend-supplied "verified" boolean.
- Pure ES256 verification of credential id, RP-ID hash, authenticator-data length, UP, configured
  UV, signature, and counter.
- Strict counter-baseline/advance and nonce replay rejection.
- Durable state replacement using write, file fsync, rename, and directory fsync before verified
  confirmation is returned.
- Replay-state load rejects symlinks, foreign ownership, and group/other writability.
- One-outstanding ceremony limiter and cooldown.
- Root ownership/non-writability assertion for the enrolled public credential store.

## Demonstrated

Pure Rust tests prove valid assertion verification, missing-UP refusal, nonce replay/counter
refusal, durable state before confirmation return, ceremony cooldown, and fail-closed malformed
authenticator-data/tampered challenge handling.

## Intentionally not yet implemented

The libfido2 ceremony/hidraw backend, attended attested enrollment, hardware/MDS validation,
socket/peercred service, udev isolation, Node direct-assertion integration, durable-store recovery
inspection, bounded nonce pruning, package/runbook artifacts, and hardware-key drill remain
required before activation. A known-answer vector captured from a real authenticator must verify
before live use; fake-generated signatures prove internal consistency but not device conformance.
The existing Ed25519 attended-driver path remains interim and cannot authorize a real restart.
