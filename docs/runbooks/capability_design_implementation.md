# Capability Design Implementation

`capability_design` proposals are in-memory review records. They are useful for same-session
coordination, but they are not the durable implementation queue. The durable closure artifact is a
reviewed code/config commit plus a receipt in `docs/capability-design-implementations/`.

## Workflow

1. Create a `capability_design` proposal with the proposed capability key in `capability`.
2. Approve it for consideration with feedback. This records review intent only; it does not create a
   grant, mutate the catalog, or activate the capability.
3. Implement the capability as a normal reviewed code/config change:
   - add the capability catalog entry
   - add a matching provider registry claim
   - add route/provider code if the capability has a runtime surface
   - add tests for catalog/provider shape, authorization, and behavior
4. Add a receipt at `docs/capability-design-implementations/<capability-key>.json`.
5. Run the test suite. The receipt validator fails if `implemented_as` is missing from the catalog,
   the provider claim is missing, or provider contracts drift.
6. Use normal Path A to activate the implemented capability: capability proposal, user approval,
   runtime grant, then route use.

Receipts are evidence only. They do not confer authority, write grants, activate capabilities, or
perform runtime catalog mutation.

## Demo Capability

`status.snapshot.read` is the first receipt-backed implementation. It is low-risk and read-only, but
it composes several operational summaries, so it is explicit-grant from the start.

After the service is running, a live walkthrough can use:

```bash
npm run cli -- proposals approve proposal-id --scope session
curl -s http://127.0.0.1:8765/capability-proposals/proposal-id/grants \
  -H 'content-type: application/json' \
  -d '{"actor":"user","provider":"soma.provider.status","reason":"Allow a bounded status snapshot."}'
npm run cli -- status snapshot --grant-id grant-runtime-id
```

The snapshot returns aggregate health, module, proposal, capability, provenance, and grant counts.
It does not include raw provenance entries, chat messages, memory contents, files, desktop content,
or sensor payloads.
