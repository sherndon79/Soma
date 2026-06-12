# Capability Block Transport Contract Review

Date: 2026-06-12

## Finding

The app-side `soma-capability` extractor was already position-independent for well-formed fenced blocks: it used a global fenced-block match and did not require the block to be the final response element.

The first-dwell drop specimens in `/tmp/dwell-turn10.json`, `/tmp/dwell-turn14.json`, and related per-turn envelopes show a sharper root cause: in the failed turns, the archived `text` field no longer contained the fenced block at all, while successful turns contained parsed invocations. That means the dwell drops were upstream of the app parser or at model/adapter emission time, not caused by the app regex rejecting mid-response blocks.

## Contract

The application contract is now explicit:

- A well-formed `soma-capability` block may appear before, between, or after prose once it reaches Soma.
- Malformed block-shaped fragments produce a fixed, content-free parser disclosure instead of silence.
- Silence remains meaningful only when no block-shaped fragment reaches Soma.

## Validation

- Regression test proves prose-before and prose-after blocks invoke successfully.
- Regression tests cover malformed fixed reason classes: `invalid_json`, `non_object_json`, and `unclosed_fence`.
- Live `/chat` smoke on `first-dwell` parsed a mid-response `provenance.summary.read` block with prose preserved before and after.
