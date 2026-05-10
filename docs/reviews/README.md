# Soma Review Notes

This folder stores dated reviews of Soma's documentation, architecture, and (eventually) code.

Review notes are historical evidence and guidance. They are not source-of-truth by themselves.
When a review surfaces a vocabulary, policy, capability, or boundary change, the canonical docs
should be updated as a separate follow-up. The review captures the moment; the canonical doc
captures the resolution.

Use [INDEX.md](./INDEX.md) when a capability thread has multiple related reviews. The index groups
review files by thread and gives future reviewers a short path through dense review history.

## Scope

So far this folder holds documentation, architecture, and direction reviews. The template here is
optimized for that style. Code reviews are expected later as Soma grows beyond the current
scaffold, and will get a dedicated template at that point.

Until that template exists, code reviews should still happen and should follow finding-first
review style: lead with risk-ordered findings, cite `path/to/file.ext:line`, separate observed
behavior from recommendation, and use the severity guide below.

## Naming Convention

Use:

```
YYYY-MM-DD_<scope>_review.md
```

Examples:

- `2026-05-06_documentation_and_direction_review.md`
- `2026-05-07_agents_md_review.md`
- `2026-05-08_post_escalation_draft_commits_review.md`

Scope is snake_case and should describe what was reviewed, not the result. A doc review and a
follow-up to that review can both exist on different dates rather than overwriting each other.

## Recommended Structure

Use this section order for documentation, architecture, and direction reviews:

1. Header (`Date`, `Scope`, `Reviewer`, optional `Commit range`)
2. `Sources Reviewed`
3. `Overall Assessment`
4. `What's Sharp` (or `What Holds Up`)
5. `Worth Attending To` (or `Worth Tightening`, or `Identified Gaps`)
6. `Strategic Observations` (optional, when there is a frame worth surfacing beyond the immediate
   findings)
7. `Closing`
8. `Next Review Trigger`

A review may add or skip sections to fit the material. The order matters less than the structure:
say what you read, what holds up, what to attend to, and what would prompt the next review.

## Addendum Convention

Reviews are snapshots of what was true at a moment. Do not retroactively edit the body of a
review.

When another reviewer responds, when an action disposition is recorded, or when implementation
later changes the picture, append an addendum at the bottom of the existing review:

```markdown
---

## Addendum: <Title> — YYYY-MM-DD

**Date:** YYYY-MM-DD
**Reviewer:** <Name or role>
**Scope:** <what this addendum addresses>

<addendum body>
```

Multiple addenda may accumulate over time. Each is dated and attributed. The original review
remains as written, so the audit trail of what was thought when remains visible.

This convention prevents two failure modes: silent retroactive editing (which loses disagreement
history), and proliferation of new review files for what is really a follow-up to an existing one.

## Severity Guide (when applicable)

Soma's reviews so far have been doc/architecture-shaped and have not used severity ratings.
For future code reviews, or for cases where findings are concrete enough to triage, use:

- **High** — blocks user flows, violates a Load-Bearing Rule, or compromises the policy/consent
  boundary.
- **Medium** — important alignment or correctness concern, but not immediate failure.
- **Low** — documentation, ergonomics, naming, or minor consistency.

When severity is not used, prefer prose over labels. Do not invent severity to make a review look
more rigorous than it is.

## Reference Hygiene

- Quote distinctive phrases from the reviewed docs rather than paraphrasing when the wording is
  load-bearing.
- For code reviews, cite `path/to/file.ext:line` where possible.
- Separate observed behavior or wording from recommendation.
- Keep findings reproducible: another reviewer reading the same sources should be able to verify
  what was observed.
- Reviews that span many commits should name the commit range explicitly.

## Template

Start from `docs/reviews/TEMPLATE.md`. The template is shaped for doc/architecture reviews; adapt
sections to the material rather than forcing the material into the sections.

## Relation To Canonical Docs

When a review surfaces a finding that should change canonical posture (a Load-Bearing Rule,
threat-model entry, capability vocabulary, principle, or other shipped contract), update the
relevant canonical doc in a separate change. Do not let a review file be the only place a new
truth lives. Reviews can record the *decision*; canonical docs record the *result*.
