# <Review Title> — YYYY-MM-DD

**Date:** YYYY-MM-DD
**Scope:** <what was reviewed; one line>
**Reviewer:** <name or role>
**Commit range:** <optional, for multi-commit reviews, e.g., `aaaaaaa..bbbbbbb`>

> **Note on ordering.** This template is shaped for doc/architecture reviews, where surfacing
> what works first frames the tightening that follows. For implementation-risk or safety-boundary
> reviews, lead with findings: move *Worth Attending To* above *What's Sharp*, or omit *What's
> Sharp* entirely if findings dominate. The order matters less than the discipline; do not bury
> risk under praise.

---

## Sources Reviewed

<Documents read in full:>

- `path/to/doc.md`
- `path/to/other_doc.md`

<Documents inspected by diff or grep, when full read was not necessary:>

- `path/to/other.md`

<For commit-range reviews, also state: total commits, files changed, insertions, deletions.>

---

## Overall Assessment

<One to three paragraphs summarizing the read. Name what the work as a whole does well, what is
distinctive about it, and any framing that should hold across the rest of the review.>

---

## What's Sharp

### <Sharp item 1 — short title>

<What is observed; quote distinctive phrases from the reviewed docs when wording is load-bearing.
Why it works. What architectural commitment it expresses.>

### <Sharp item 2>

<...>

---

## Worth Attending To

### <Item 1 — short title>

<What is observed. What's missing or could be tightened. What would resolve it. Whether this is
urgent, deferrable, or a long-term concern.>

### <Item 2>

<...>

---

## Strategic Observations (optional)

<For frames that go beyond the immediate findings — generalizable patterns, longer-term
implications, candidate doc promotions, recurring discipline that could be captured. Skip this
section when the material does not warrant it.>

---

## Closing

<One or two paragraphs. Net read on the work. What it earned. Honest summary of whether the items
above are tightening or gaps.>

---

## Next Review Trigger

Run another review after any of:

- <trigger 1>
- <trigger 2>
- <trigger 3>

---

## Addenda

If this review needs follow-up commentary — a response from another reviewer, an action
disposition, a refinement, or an implementation update — append a new dated section at the bottom
of this file rather than editing the body above. See
[README.md § Addendum Convention](./README.md#addendum-convention) for the format.
