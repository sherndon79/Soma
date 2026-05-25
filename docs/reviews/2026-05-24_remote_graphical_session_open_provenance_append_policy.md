# Remote Graphical Session-Open Provenance Append Policy

Review after documenting the gates required before fixture session-open provenance append is enabled.

## Scope

- `docs/concepts/drafts/remote_graphical_session_open_provenance_append_policy.md`
- `docs/concepts/drafts/remote_graphical_session_open_activation_policy.md`
- `docs/concepts/drafts/remote_graphical_broker_boundary.md`
- `docs/README.md`
- `ROADMAP.md`

## Summary

The new policy keeps route-level append disabled while defining the prerequisites for enabling it:

- construct response result first
- build `provenance_preview` from that exact result
- validate forbidden content before append
- append after broker result creation and before response write
- bound append failures without a second broker call
- keep the first append path fixture-only

It also lists the tests required before implementation, including success/failure append, refusal
no-append, append failure, no durable grant writes, and appended event equality with
`provenance_preview`.

## Boundary

Documentation only. No route behavior changed, no `provenanceLog.append` call was added, no durable
writes were enabled, and no live Sunshine/Moonlight transport, pairing, video, input, recording, or
model-facing visual delivery was introduced.

## Residual Risk

The next implementation slice can enable fixture-only append. It should preserve preview-first
ordering and fail without retrying broker calls if append fails.

## Verification

- `git diff --check`
