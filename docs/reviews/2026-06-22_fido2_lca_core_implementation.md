# FIDO2 LCA Core - Inert Implementation Evidence

- Date: 2026-06-22
- Status: **CORE REVIEW-CLEAN - approved as an inert implementation slice**
- Activation posture: **INERT BY DEFAULT**. The hardware backend and enrollment command require
  Cargo feature `hardware-fido`; the service additionally requires an attended exact-device
  drop-in. No credential, policy store, host action, or live ceremony exists.

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
authenticator-data/tampered challenge handling. N5 verifies Yubico's published libfido2 ES256
assertion vector at the cryptographic boundary and proves its intentionally absent UP flag remains
rejected by Soma policy.

## Subsequent slices

The feature-gated direct libfido2 ceremony, attended attested enrollment/MDS validation, socket
peer authentication, udev isolation package, and Node integration are implemented but remain
unactivated. Durable-store recovery inspection and bounded nonce pruning remain future hardening.
Attended enrollment, a YubiKey-specific assertion capture, access/OTP drills, the live ceremony,
and the first restart remain required. The default issuer ceremony remains hardware-disabled.
