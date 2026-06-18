# Systemd Provider Exact-Host Activation Runbook

This is an attended procedure for Seth. Repository builds do not execute any step below. Stop at
the first failed, unexpected, interactive, or ambiguous result. Do not continue by relaxing a
unit directive, widening policy, adding another unit, or retrying a possibly dispatched restart.

## Preconditions

1. Record the commit and hashes for the provider binary, manifest, service/socket units, empty
   inventory, channel configuration, and generated policy.
2. Select one expendable `soma-lab-*.service`. Confirm its restart-affected closure is exactly
   itself and that it is not needed by the confirmation authority, harness, provider, desktop,
   network, storage, or recovery path.
3. Confirm the Node harness will run as a dedicated static `soma-harness` uid used by no unrelated
   process. Confirm the provider will run as a distinct static `soma-systemd-provider` uid.
4. Confirm the operational route is absent/disabled, the inventory is empty, and both
   `restart_enabled` and `controlled_testing` are false.

## Stage Inert Artifacts

1. Create the two system identities and install the root-owned artifacts listed in
   `packaging/systemd-provider-manifest.json`. Do not start or enable either provider unit.
2. Resolve the numeric `soma-harness` uid into
   `/etc/soma/systemd-provider-channel.conf`. Its owner must be root and mode `0600`.
3. Create the expendable service, run `systemctl daemon-reload`, and inspect its complete
   definition and dependency/propagation closure. Stop if the closure is not target-only.
4. Generate `00-soma-systemd-provider.rules` for that exact service into a staging directory.
   Compare its unit with the still-staged one-unit inventory. Do not install either file yet.

## Preflight Before Mutation Authority

1. Run `systemd-analyze verify` and `systemd-analyze security` against the exact provider units.
   Stop on an unsupported directive, warning requiring relaxation, or unexpected writable/access
   surface.
2. Start only `soma-systemd-provider.socket`; keep the operational route disabled and restart
   authority absent.
3. Prove the socket mode admits `soma-harness` and rejects unrelated uids. Prove the provider
   rejects a peer whose `SO_PEERCRED` uid is not the configured dedicated harness uid.
4. From the dedicated harness service, prove the provider starts under
   `soma-systemd-provider`, has no capabilities or network access, and can reach
   `/run/dbus/system_bus_socket` under the complete sandbox.
5. Run typed status, effective-definition digest, canary-minimization, malformed-request,
   connection-loss, recovery, and definition-drift drills. No result may expose unit names,
   paths, commands, environment, status text, PIDs, or raw DBus diagnostics.

## Policy Proof

1. Install the reviewed root-owned one-unit inventory and generated early-order polkit rule only
   after the non-mutating preflight passes. Keep the route disabled.
2. Confirm polkit supplies `unit` and `verb` details on this host.
3. As `soma-systemd-provider`, prove this exact matrix:
   - selected unit plus `restart` returns non-interactive `YES`;
   - a second unit plus `restart` returns `NO`;
   - selected unit plus `start`, `stop`, `reload`, or any other verb returns `NO`;
   - no request returns an interactive challenge.
4. Treat the negative cases as proof that no lexically earlier installed rule grants this
   provider subject broader `manage-units` authority. Stop and remove the staged rule/inventory if
   any negative case succeeds or falls through.

## Prove Off Before On

1. Keep the route disabled and revoke/disable the once restart grant.
2. Attempt the complete restart flow. It must refuse before provider dispatch, with zero restart
   calls and unchanged `InvocationID`.
3. Disable and stop the provider socket. Repeat the non-mutating reachability check and prove the
   endpoint is unavailable. Restart the socket only after this kill-switch proof passes.

## Attended First Restart

1. Separately approve activation for this exact host, provider, unit, task, and one restart.
2. Enable only the operational route needed for that one inventory id.
3. Display the exact local preview and complete trusted local confirmation.
4. Dispatch once. Verify a changed nonempty `InvocationID`, expected active/sub state, unchanged
   definition/closure, content-free evidence, and no second dispatch.
5. Disable the route immediately after the proof. Any ambiguity enters reconciliation; never
   retry automatically.

## Revocation And Rollback

Rollback never depends on provider health:

1. Disable the operational route and revoke grants/confirmations.
2. Stop `soma-systemd-provider.socket`; verify the endpoint is absent.
3. Remove the polkit rule and operational inventory entry, then reload polkit as appropriate.
4. Stop, disable, and remove the lab service; run `systemctl daemon-reload`.
5. Preserve content-free evidence and package hashes. Remove provider artifacts and static users
   only after confirming no remaining ownership or process references.
