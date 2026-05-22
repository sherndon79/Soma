# Durable Grant Mutation Activation Policy

Review after documenting the policy boundary for future durable grant mutation activation.

## Scope

- `docs/concepts/drafts/durable_grant_mutation_activation_policy.md`
- `docs/concepts/drafts/durable_grant_mutation_route_readiness.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `docs/operators.md`
- `ROADMAP.md`

## Summary

The new policy note separates implementation readiness from activation authority. It states that
durable grant mutation may only be enabled by an explicit operator decision, not by model
recommendation, provider metadata, proposal approval, preview output, CLI availability, or internal
writer tests alone.

It also makes the preview/commit split explicit: preview routes, CLI preview wrappers, review text,
and `--json` output are inspection surfaces, not durable mutation surfaces. Future commit routes
must use a distinct route name, explicit runtime write enablement, durable writer delegation, and
their own tests.

## Boundary

This is documentation only. It does not add `POST /grants`, durable revocation routes, grant
mutation CLI commands, runtime write enablement, recovery repair, Sensorium durable grants,
provider/helper invocation, capability activation, or model-facing payload delivery.

## Residual Risk

The future activation slice will need implementation tests that prove the policy is enforced in
code, especially around runtime write flags, preview/commit separation, and recovery repair.

Verification: documentation-only change.
