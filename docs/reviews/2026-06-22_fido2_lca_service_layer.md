# FIDO2 LCA Service Layer - Inert Build Evidence

- Date: 2026-06-22
- Status: **REVIEW-CLEAN INERT PACKAGE - hardware isolation not installed**
- Host observation: YubiKey 5 `1050:0407`, firmware `5.7.4`, FIDO interface `01`,
  `/dev/hidraw8`, currently accessible to the active seat through `uaccess`.

## Isolation design

The package has two exact-match udev rules for `ID_FIDO_TOKEN=1`, vendor `1050`, model `0407`,
and USB interface `01`:

- rule 71 removes `uaccess` before `73-seat-late.rules`;
- rule 99 reasserts `root:soma-lca 0660` and clears residual POSIX ACLs with `setfacl -b`.

This intentionally removes the active seat user's default token access. The model/interface match
may cover another YubiKey of the same model, but only the enrolled credential id/public key can
verify an assertion. No rule is installed by the build.

The service uses `DevicePolicy=closed`. Its base unit contains no `DeviceAllow`; attended
enrollment must generate an exact hidraw-path drop-in. Thus udev ownership alone cannot activate
hardware access.

## Store and request boundaries

- credential policy: root-owned and not group/other writable;
- replay state: `0600 soma-lca:soma-lca`, non-symlink, issuer-owned, not group/other writable;
- one outstanding ceremony plus cooldown is wired through `verify_confirmation_limited`;
- service/socket units have no `[Install]` section;
- package manifest records every install, trigger, start, enrollment, and restart action as false.

## Hardware drill

The guarded drill does not install rules. After separately reviewed installation it requires:

- dynamic enumeration finds exactly one hidraw node matching the same FIDO/vendor/model/interface
  predicates as the udev rules; any supplied override must canonicalize to that exact node;
- active seat user cannot open the FIDO hidraw;
- `soma-harness` cannot open it;
- configured computer-use identity cannot open it;
- only `soma-lca` can open it;
- final node is exactly `0660 root:soma-lca` with no forbidden ACL entry.

Enrollment, MDS validation, counter baseline, real-authenticator known-answer vector, and live
ceremony remain unperformed.

Enrollment policy is decided but not executed: the first credential is non-discoverable,
ES256, RP id `lca.soma.local`, and `require_uv=false`; User Presence remains mandatory. UV would
require an explicit later re-enrollment rather than changing implicitly when a key PIN is set.
