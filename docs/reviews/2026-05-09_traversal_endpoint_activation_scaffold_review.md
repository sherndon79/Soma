# Traversal Endpoint Activation Scaffold Review - 2026-05-09

**Date:** 2026-05-09
**Scope:** Review of Node endpoint traversal activation fixture and hard-refusal scaffold
**Reviewer:** Codex
**Commit range:** `a4111dd..0db8c63`

Related reviews:

- `docs/reviews/2026-05-09_rust_traversal_helper_command_activation_review.md`
- `docs/reviews/2026-05-09_traversal_request_enablement_readiness_review.md`
- `docs/reviews/2026-05-09_traversal_activation_gates_review.md`

---

## Sources Reviewed

- `ROADMAP.md`
- `docs/fixtures/desktop-traversal-endpoint-activation-cases.json`
- `docs/concepts/drafts/desktop_traversal_endpoint_enablement_readiness.md`
- `test/app.test.js`
- `src/app.js`

---

## Overall Assessment

Accept the endpoint activation scaffold as a useful pre-enable fixture.

The fixture names the future public endpoint cases for success, unavailable traversal, authorization
failure, and request validation failure. `test/app.test.js` currently asserts all of those cases are
still hard-refused with `desktop_traversal_not_implemented`, and that refusal happens before root
authorization, disclosure registry writes, or provenance append.

Do not enable the endpoint yet. The scaffold is intentionally incomplete for endpoint activation:
helper-output failure and narrowing/revocation cases still need fixture coverage before the final
endpoint enablement review.

---

## What Holds Up

### Future endpoint paths are named

The fixture gives stable names to activation cases that will later become active endpoint assertions:

- successful authorized traversal
- unavailable authorized traversal
- root not disclosed
- root expired
- root revoked
- root capability inactive
- raw root request validation failure

### Current hard refusal remains pinned

For each fixture case, the endpoint still returns:

- status `403`
- error `desktop_traversal_not_implemented`
- zero `authorizeRootRef` calls
- zero disclosure registry writes
- zero focused-inspection registry writes
- zero `desktop.inspect.accessibility_tree` provenance entries

That preserves the disabled-first posture while endpoint activation cases are being shaped.

### The fixture is reusable

The fixture carries `future_expected_path` and, where relevant, `future_expected_error`. That gives the
activation slice a straightforward migration path from "all hard refused" to path-specific endpoint
assertions.

---

## Remaining Gaps

### Helper-output failure is not represented in the endpoint activation fixture

Endpoint enablement still needs an active case where the helper returns schema-invalid traversal
output. That case must prove:

- no traversal-bearing response is returned
- no traversal provenance is appended
- protected helper fields fail closed before provenance append

### Narrowing/revocation path is not represented in the endpoint activation fixture

There is existing registry behavior around module narrowing and revoked roots, but the endpoint
activation fixture should include a case that maps that behavior into traversal endpoint assertions.
At minimum, the future endpoint test set needs a revoked-root path that proves helper invocation and
provenance are skipped.

### Active success/unavailable response assertions remain pending

The fixture names success and unavailable paths, but active response assertions are still pending until
`desktop_traversal_not_implemented` is actually replaced. The next endpoint test slice should prepare
the missing failure/narrowing cases first, then a final review can decide whether the active endpoint
commit is ready.

---

## Disposition

Do not replace `desktop_traversal_not_implemented` yet.

The next safe slice is to extend endpoint activation fixture coverage for:

- helper-output validation failure
- narrowing/revoked-root behavior
- no-provenance expectations for both paths

Keep all fixture cases hard-refused until the final endpoint enablement commit.

---

## Next Review Trigger

Run another review after helper-output-failure and narrowing/revocation endpoint fixture cases exist,
or immediately before endpoint enablement.
