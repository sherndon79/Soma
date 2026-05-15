# Sensorium Grant Constraint Review

Date: 2026-05-15

Scope:

- `src/sensoriumGrantConstraints.js`
- `src/app.js`
- `test/sensoriumGrantConstraints.test.js`
- `test/app.test.js`
- Sensorium docs and roadmap

## Finding

Sensorium subscription requests are now compared against active grant constraints before the
subscriber is invoked. This closes the gap between "an active grant exists" and "the requested
stream bounds are actually within that grant."

The enforced constraints are:

- `max_seconds` as an upper duration bound
- `max_fps` as an upper frame-rate bound
- `format_required` as an exact match when pinned
- `downsample_to` as maximum `[width, height]` dimensions

## Accepted Boundary

The enforcement preserves the route ordering:

- request-shape validation still runs first
- missing grants still deny before provider or helper work
- provider support and host/topic checks still run before constraint enforcement
- constraint denials happen before `sensoriumSubscriber.start`
- no grants are added to `config/grants.json`
- provenance remains metadata-only

If a grant declares a bounded value and the request omits it, Soma copies the grant value into the
bounded request. If the request uses a bounded key that the grant does not declare, Soma rejects the
request. This avoids accidental unbounded subscriptions while keeping narrower requests available.

## Actionable Follow-Up

The next safe slice is durable Sensorium grant review/creation design. Before long-lived grants
exist, Soma should define the user-facing review surface for:

- host/topic namespace
- stream type and risk class
- maximum duration and frame rate
- required encoding
- downsample bounds
- active-mode disclosure wording
- revocation behavior

## Residual Risk

Constraint inheritance is conservative, but it means grant records must be clear. A malformed grant
constraint now blocks subscription, which is the right fail-closed behavior but will need operator
diagnostics once durable grant editing exists.
