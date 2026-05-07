# AGENTS.md Review — 2026-05-07

**Date:** 2026-05-07
**Scope:** Initial review of `AGENTS.md` (Soma adaptation of TheCommons editor-agnostic agents convention)
**Reviewer:** Claude (Opus 4.7)

---

## Sources Reviewed

- `AGENTS.md`
- `/home/sherndon/project-repos/TheCommons/AGENTS.md` (source pattern)
- Cross-references to `docs/` confirming linked documents exist

---

## Overall Assessment

The AGENTS.md is well-adapted to Soma's posture. It preserves the format and discipline of TheCommons' version while adapting:

- the technical stack (Node + Rust vs Go + TypeScript)
- the risk surface (desktop access and policy-gated capabilities vs shared-world multiplayer state)
- the document set (smaller, more focused; threat model / failure modes / migration docs are first-class rather than implicit)
- the autonomy stance — *"Do not treat TheCommons or Sanctuary as architectural parents"* is a sharp and appropriate addition

All documents referenced under Essential Documents exist on disk: thesis, principles, architecture/overview, architecture/mvp_slice, operators, glossary, security/threat_model, failure_modes, migration, ROADMAP. The forward-pointing structure that the prior documentation review identified as a gap has been addressed.

---

## What's Sharpest

### Load-Bearing Rules section

Eight rules that make architectural discipline executable for AI assistants:

- *The policy gateway is the authority boundary.*
- *Approval is not activation.*
- *Provider installation is not permission.*
- *Memory is not authority.*
- *Narrowing modules are safe to self-apply; widening modules are not.*
- *Desktop inspection is read-only unless a future capability explicitly says otherwise.*
- *MCP may be an adapter, not the trust boundary.*
- *Fail closed for authority.*

These are quotable, enforceable, and direct expressions of the architectural discipline. The right level of abstraction — concrete enough to apply, principled enough to survive specific feature changes.

### Conflict-resolution priority ordering

The order for resolving doc conflicts (mvp_slice → operators → threat_model → glossary → principles → drafts) is correct for "what should an AI consult when sources disagree." Implementation-first, then operations, then security boundary, then vocabulary, then intent, then exploration. This is different from "what should drive new design," but it is the right ordering for the AI-assistant-arbitrating-ambiguity case.

### Author Context caveat

The expansion over TheCommons' version — *"Do not quote, summarize, or persist details from these files unless the task calls for it and the participant's intent is clear. Treat them as context for care and judgment, not as a source to mine"* — is sharper. Appropriate given those documents contain personal and family context that should not surface casually.

### Common Tasks "Add A Capability" checklist

Catalog → provider → grant → revocation → threat model → failure modes → evals. The ordering enforces the architectural discipline at task-execution time, so an AI assistant cannot easily skip the slow steps.

### Project autonomy clause

*"Do not treat TheCommons or Sanctuary as architectural parents. They are related projects, not authority over Soma's implementation."* Preserves Soma's right to diverge. Good guard against well-intentioned AI assistants importing patterns that do not fit Soma's posture.

---

## Worth Tightening

### `docs/onboarding.md` is not in Essential Documents

The file exists but is not in the table. Useful to add — onboarding is exactly the kind of doc an AI assistant should consult when shaping first-run UX, new-user-facing CLI output, or capability-view surfaces.

### Sanctuary path missing in Related Repositories

TheCommons entry gives a filesystem path; the Sanctuary entry does not. If Sanctuary lives at `~/project-repos/Sanctuary` (consistent with the constellation under `~/project-repos/`), worth being explicit so AI assistants can locate it without guessing.

### `docs/reviews/` is not in Repository Structure

The reviews directory now exists but is not in the tree under "Repository Structure." Worth listing for completeness and to signal that reviews are part of project history.

### "Add disabled/requestable capabilities before implementing use paths" could be sharper

Correct but compressed. Could read: *"Catalog entries (with `default_status: disabled` or `requestable`) should land before the code that implements the capability use path."* As written, an unfamiliar contributor might miss that "capabilities" here means catalog entries, not code.

### Eval coverage in "Add A Capability"

The line *"Add model capability evals if model behavior around the boundary matters"* could be more concrete: *"Add or update model capability evals covering whether the model claims unsupported authority, requests excluded data, or proposes the new capability with required reason / scope / risk / fallback fields."* Same intent, sharper invitation.

### Author Context boundary mechanism

The caveat is right as default: do not quote, summarize, or persist unless the task calls for it. Recent practice (the 2026-05-06 documentation and direction review) referenced personal context briefly under the participant's explicit invitation. Worth being clear that the *"task calls for it"* mechanism remains conversational — checked with the user — rather than self-judged by the AI assistant. The default is silence; the exception is explicit invitation; the AI does not self-clear into the exception.

---

## Closing

This is a strong adaptation of the TheCommons convention. The architectural discipline that makes Soma's design work is encoded in a way AI assistants can act on directly. The risk in this kind of document is becoming either a manifesto (too much philosophy, not actionable) or a checklist (too procedural, does not preserve intent). This lands between them.

The minor items above are tightening, not gaps. The document does its job.

---

## Next Review Trigger

- when `AGENTS.md` is materially restructured
- when Load-Bearing Rules add, remove, or reframe a rule
- before introducing a `CONTRIBUTING.md` or external-contributor guidelines
- when the Author Context section's referenced documents change significantly
- if conflict-resolution priority ordering is changed
