# FIDO2 Local Confirmation Authority - Approach

- Date: 2026-06-22
- Status: **APPROVED - T1-T4 incorporated for implementation**
- Scope: production trusted-local confirmation issuer for C3 actions.
- Non-authorization: this note does not enroll a key, grant hidraw access, install a service, enable
  restart authority, or authorize a host restart.

## 1. Trust statement and first-slice limit

The LCA must prove two different facts:

1. **Presence:** a human physically touched the enrolled hardware authenticator for this fresh
   challenge.
2. **Meaning:** the assertion corresponds to the exact operation Seth intends to approve.

FIDO2 User Presence solves the first fact. It does not give the security key a trusted display.
Because Soma's computer-use path can control the workstation screen, an ordinary desktop prompt,
terminal, notification, or overlay is not an integrity boundary for the second fact.

For the first slice, meaning is established without trusting the screen: attended enrollment
creates an issuer-owned policy that permits exactly one fixed expendable
`soma-lab-*.service`. The issuer independently resolves the inventory id through its root-owned
one-unit allowlist. Its FIDO device access is unavailable to the harness, so the key only blinks
for that issuer's one permitted action. Seth's attended ceremony pre-establishes that a touch
means "approve one restart of this exact lab unit." The issuer may display a preview, but that
display is informational rather than the trust root.

This does not generalize to arbitrary targets. Multi-target or content-rich confirmation requires
a trusted display outside the agent's actuation surface, such as a separate enrolled device or a
hardware authenticator with a transaction-confirmation display. Until that exists, the production
LCA refuses every target except the single enrolled lab unit.

## 2. Components and identity separation

Add a small Rust `soma-local-confirmation-issuer` using libfido2 directly over CTAP2/hidraw. It
runs as a dedicated `soma-lca` system identity, separate from `soma-harness` and
`soma-systemd-provider`.

- A root-owned Unix socket admits only `soma-harness`; the issuer verifies `SO_PEERCRED`.
- A udev rule grants only `soma-lca` access to the enrolled USB FIDO device. The harness and
  computer-use broker receive no hidraw access.
- Root-owned stores contain the exact credential id/public key, attestation evidence,
  AAGUID/model policy, RP id, counter baseline, and one-unit target mapping. The harness may read
  the public verification record but cannot write it; it must be root-owned and not group/world
  writable. The issuer cannot rewrite policy or enrollment state during normal service operation.
- The issuer has no network access. FIDO Metadata Service material and trust roots are reviewed,
  cached, and installed during attended enrollment/update, not fetched during confirmation.
- The issuer accepts only the versioned confirmation request schema. It has no arbitrary CTAP,
  enrollment, target, display, command, or signing endpoint.

The harness can request a ceremony but cannot make it succeed: only a valid assertion from the
enrolled credential with User Presence set can cause the issuer to sign a receipt.

## 3. Attended enrollment

Enrollment is a separate root-operated command with the runtime issuer stopped.

1. Seth selects one dedicated roaming USB security key and one expendable lab service.
2. The enrollment tool creates a non-discoverable credential scoped to the RP id
   `lca.soma.local`, with a random user id and an allow-list credential id retained by the issuer.
3. Registration requires User Presence and requests direct/basic attestation. Self-attestation,
   `none`, platform credentials, synced passkeys, virtual authenticators, and unverifiable
   attestation refuse enrollment.
4. The tool validates the attestation chain against reviewed FIDO Metadata Service trust material,
   pins the AAGUID/model and credential public key, and confirms that the metadata identifies a
   hardware roaming authenticator without a disqualifying status.
5. The selected deployment must provide a usable monotonic signature counter. A zero/unsupported
   counter is not accepted for this first implementation. Enrollment performs an assertion and
   records its counter as the initial baseline; a key used elsewhere before enrollment must still
   produce a later counter during this ceremony or enrollment refuses.
6. Seth verifies and signs off on the exact one-unit issuer policy and generated hashes before the
   root-owned store is installed.

The first-slice enrollment is explicitly **UP-only** with `require_uv=false`. A keyboard-entered
YubiKey PIN is within Soma's computer-actuation surface, so it does not strengthen the
anti-automation property supplied by physical touch. It would address a different
physical-impostor-at-the-desk threat that is outside this slice. UP remains mandatory.

If Seth later needs UV for a different environment or consequence tier, the credential must be
deliberately re-enrolled with `require_uv=true` after configuring the authenticator. Setting a PIN
for unrelated key uses does not silently change this LCA credential's policy.

## 4. Confirmation ceremony

The driver writes a bounded request containing the full immutable plan artifact and:

- plan and target-binding digests;
- task and provider ids;
- exact inventory id;
- C3/no-rollback disclosure;
- request nonce and expiry.

The issuer:

1. authenticates the harness peer and validates schema, freshness, consequence class, and target
   count;
2. recomputes the plan digest from the supplied artifact;
3. resolves the inventory id through its own root-owned one-unit policy and requires an exact
   match;
4. constructs canonical challenge bytes committing to protocol domain separation, RP id, plan
   digest, target-binding digest, task, provider, exact resolved target, C3/no-rollback, request
   nonce, and expiry;
5. hashes those bytes as CTAP2 client data, sets RP id `lca.soma.local`, restricts the allow list
   to the enrolled credential, requires UP, and requests UV according to enrolled policy;
6. asks the authenticator for an assertion with a short timeout and no retry or fallback
   credential;
7. verifies RP-ID hash, credential id, signature, UP and required UV flags, challenge, and
   strictly increasing signature counter;
8. returns a bounded assertion bundle containing credential id, authenticator data, signature,
   canonical challenge/client-data hash, and issuer-resolved target binding.

The runtime verifies the FIDO assertion directly against the root-owned enrolled credential
record. A deterministic Rust verifier recomputes the challenge from the live plan and exact
target, verifies RP-ID hash, signature, credential, UP/UV flags, and strict counter advance, then
durably commits counter+nonce state using temp-file/write/fsync/rename/fsync-directory ordering
before emitting verified confirmation. The verifier has no network, signing key, device access,
or side authority; every parse or verification error refuses.

The Ed25519 verifier in the current attended socket driver is an interim fail-closed transport
proof and must be replaced by this direct assertion verifier before live restart. Raw FIDO
assertions remain inside the verifier boundary; credential ids, AAGUIDs, device paths, PIN
material, and attestation certificates never enter model-facing output or provenance.

## 5. Failure and recovery

The issuer refuses without a receipt on:

- absent/multiple/unexpected authenticators;
- timeout, cancellation, removal, CTAP error, or missing UP;
- required UV absent or failed;
- credential, RP-ID hash, challenge, signature, target, plan, task, provider, or expiry mismatch;
- repeated nonce, unchanged/regressed/zero signature counter, or degraded counter store;
- missing/corrupt enrollment, policy, trust material, or counter/nonce state;
- any request for a target outside the one-unit policy.

No failure retries a touch automatically. No confirmation survives issuer/verifier restart unless
the single-use counter/nonce state was durably committed. Recovery corruption disables issuance;
it does not reset counters or re-enroll. Revocation stops the issuer socket first, removes its
device ACL, revokes the credential/policy store, and disables attended restart flags
independently.

The issuer rate-limits ceremony requests per harness peer and globally, permits only one
outstanding ceremony, and applies a cooldown after timeout/refusal. This limits key-blink denial
and habituation. The one-unit action-space collapse bounds first-slice reflexive-touch risk because
every legitimate blink means the same enrolled operation. Habituation becomes a critical,
currently unsolved threat for any future multi-target LCA.

## 6. Validation before first restart

Tests must cover pure challenge canonicalization and assertion verification, fake CTAP
transcripts, replay/counter regression, UP/UV flags, credential/RP mismatch, store corruption,
peer rejection, target confusion, rate limiting, credential-store ownership/mode, parser fuzzing,
and crash ordering. A crash injected after assertion verification but before confirmation
emission must leave the counter/nonce durably consumed so replay refuses after restart.

A hardware-key integration drill then proves:

- harness cannot open the FIDO hidraw device;
- issuer can access only the enrolled key;
- no touch/no token/wrong token all refuse without receipt;
- one touch produces one receipt for one exact lab-unit plan;
- replaying the assertion, request, or receipt refuses;
- a changed plan or target requires a new touch;
- route/grant/inventory revocation still prevents dispatch after a valid receipt.

Only after this issuer and drill are reviewed may the attended socket driver complete the first
real restart.

## References

- FIDO Alliance CTAP 2.2 specification:
  https://fidoalliance.org/specs/fido-v2.2-ps-20250714/fido-client-to-authenticator-protocol-v2.2-ps-20250714.html
- W3C WebAuthn Level 2:
  https://www.w3.org/TR/webauthn-2/
- libfido2 assertion API:
  https://developers.yubico.com/libfido2/Manuals/fido_assert_set_clientdata_hash.html
- FIDO Metadata Service:
  https://fidoalliance.org/metadata/
