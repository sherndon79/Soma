# Remote Graphical Session Provider Note

Date: 2026-05-17

Scope:

- `docs/concepts/drafts/remote_graphical_session_provider.md`
- `docs/architecture/mvp_slice.md`
- `docs/README.md`
- `ROADMAP.md`

## Finding

The Sunshine/Moonlight discussion is captured as a draft provider concept, not an implementation
commitment. The placement is correct: streamed graphical sessions are useful for remote hosts and
visual co-presence, but they should not replace local semantic desktop inspection as the default
local host surface.

## Accepted Boundary

The draft preserves the important splits:

- local semantic inspection remains the preferred local path
- remote graphical viewing is high-risk visual perception
- remote input forwarding is separate actuation
- view access does not imply input access
- hardware encoding is an engineering advantage, not a consent-risk reduction

## Follow-Up

If this moves toward implementation, the next design step should define concrete capability keys,
provider metadata, grant review fields, and fail-closed behavior for view-only versus input-enabled
sessions.
