# FIDO2 LCA Hardware-Free Completion

- Date: 2026-06-22
- Status: **IMPLEMENTED FOR REVIEW - no host or authenticator action performed**
- Non-authorization: this slice does not install isolation, enroll a credential, touch a key,
  start the issuer, enable restart, or dispatch a restart.

## Ceremony boundary

Cargo feature `hardware-fido` is required to compile the backend. At runtime the issuer remains on
`DisabledCeremony` unless the attended systemd drop-in supplies an exact
`SOMA_LCA_FIDO_DEVICE=/dev/hidrawN`; the same generated drop-in supplies the matching
`DeviceAllow`. The service never enumerates devices or falls back to another credential.

The libfido2 call runs in a bounded child mode of the same issuer binary. The parent kills it after
15 seconds and never retries. The worker receives a cleared environment containing only the exact
device path; the systemd unit also unsets loader-control variables. The worker requests exactly
one enrolled credential, UP=true, and the policy's UV setting, then returns raw authenticator data
and signature to the existing pure verifier. Device paths must be non-symlink `/dev/hidrawN`
character devices exactly `0660 root:soma-lca`.

## Enrollment boundary

The root-operated feature-gated enrollment tool:

- accepts one exact device and one `soma-lab-*.service`;
- verifies a cached FIDO MDS RS256 JWT against a separately supplied reviewed root;
- rejects expired metadata and compromised, bypassed, or revoked status reports;
- requires an external wired authenticator with Basic/AttCA roots;
- requests packed Basic attestation for a non-discoverable ES256 credential at
  `lca.soma.local`, with `require_uv=false`;
- validates the attestation signature and certificate path, and pins YubiKey 5 NFC AAGUID
  `d7781e5d-e353-46aa-afe2-3ca49f13332a`;
- performs a second assertion and refuses a zero signature counter;
- writes a new review directory containing policy, replay baseline, evidence, and the exact
  device drop-in. It performs no installation.

## N5

The N5 known-answer test uses Yubico libfido2's published ES256 regression vector at commit
`8ee8e5a2eb94575c8baeda9c7bf1d4f27a3b1db4`. The real public key, client-data hash,
authenticator data, and DER signature verify through Soma's P-256 verifier. The source vector
intentionally has UP=0, so the full confirmation verifier separately proves it refuses issuance.

Remaining attended work is the actual two-touch enrollment, YubiKey-specific assertion capture,
hidraw and OTP isolation drill, one live confirmation ceremony, and the first restart.
