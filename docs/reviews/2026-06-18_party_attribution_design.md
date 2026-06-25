# Trustworthy Party Attribution — Unlocking Principal Content Without Unfencing Bystanders

- Date: 2026-06-18
- Author: Claude (steward, design/orchestration), from a direction conversation with Seth
- Status: **REFUSED — Codex second-steward review (2026-06-18): REFUSE RATIFICATION AS §I-QUALIFYING.** Fundamental redesign required, not amendment. Core error: the three-signal conjunction establishes *eligibility / veto*, not *attribution* — "a conjunction of non-proofs does not become proof." Designation = scope authorization (not authorship); app-class = negative risk veto (not positive evidence); input-provenance = entry path (not authorship / data-subject / quote-permission). Positive principal-origin requires exact-unit, end-to-end provenance. Rename target to "principal-origin evidence"; granularity + provenance are the *core proof obligation*, not deferrable. Deeper finding: even done perfectly it unlocks only freshly-authored-this-session content through a trusted path — NOT existing files / terminal / IDE / browser content (all "arrive from elsewhere") — so it does not, by itself, deliver "help with what's on my screen." See review record below.
- Scope: defines the **party-attribution mechanism** that the ratified bystander doctrine's
  §I leaves as a *future hook*. It is the gate that lets copresence's **content tiers**
  (text, eventually graphical) open at all — the piece on which the stated intent, *"help
  with what's on my screen,"* actually hinges. Constellation-relevant to any perceiving
  capability.

## The gap (and why it is the whole game)

The bystander doctrine's enforceable contract (§I) makes party-scoped handling — treating
some content as principal-owned and forwarding it richly — available **only where party
attribution is trustworthy before egress.** It then records, honestly, that **no current
mechanism qualifies**, so today the whole observation runs at the strict bystander floor.

That is correct and safe, and it is also the thing standing between copresence and its
purpose. Seth's intent for copresence is **not** presence/topology; it is the agent
*helping with the actual work on screen.* With everything floored — no titles, no text, no
identity — the agent cannot tell your editor from your email, cannot read the error you are
stuck on, cannot see the form. **Private and useless.** The minimization is not the problem;
the *absence of attribution* is. Attribution is what lets "private" and "effective" stop
being a trade: solve it and the agent reads **your** designated work richly while bystander
content stays floored. This doc designs the mechanism that §I demands.

## The core difficulty (named, not minimized)

At the content level, "principal vs bystander" **is not about who owns the surface.** It is
a single-user session; by ownership, everything is Seth's. The distinction is about **whose
data-subject appears in the content**: your code file is principal; a video call in your
app shows bystander faces; an email in your client carries a third party's words; a shared
document is someone else's text on your screen. Same session, same owner — different parties
in the content.

And we cannot take the easy path: **the model may not self-classify.** The stewardship and
copresence reviews already prohibited the declassification gate from being model
self-judgment, precisely because a model deciding "this output is safe" is a semantic route
around the floor. So attribution must be computed **upstream of the model, by the trusted
broker/pipeline, from non-semantic signals** — and it must default to *not-attributed =
floored.*

## The design — three composable signals, computed pre-egress, strict floor on the rest

Attribution is decided by the **broker/pipeline**, before anything reaches the occupant,
using trusted local signals the occupant never sees. (The broker may *know* "this is Zoom"
to decide "bystander-bearing, floor it" without ever exposing "Zoom" to the model — the
decision gates what the model gets; it is not made by the model.)

### Signal 1 — Explicit principal designation (the strongest, and nearly free)

At arm time, riding the **independent interactive presence confirmation** copresence already
requires, the principal designates the specific surface(s) being shared for help: *"this is
the window I want help with."* Trustworthy because it is the principal's explicit, present,
human-confirmed say-so — the same trust root as arming. The designation is **bound to the
arming nonce + session ID, single-use, session-scoped.**

Designation **raises a surface to *principal-eligible*** — it does not, by itself, make all
that surface's content principal (a pasted email in a designated editor is still a third
party's words). It interacts with Signals 2 and 3 and the floor.

### Signal 2 — Application-class priors (a curated, reviewed table — never model judgment)

A static, version-controlled, signed classification of applications by **inherent
multi-party-ness**, keyed on the broker's *trusted local app identity* (not the model
reading the screen):

- **Inherently multi-party** (mail, chat, conferencing, social, screen-share) → default
  **bystander-bearing.** Designation **cannot** lower this below the floor — a video call is
  bystander-bearing even if you "share" it (notice ≠ consent; the bystanders in it are not
  yours to designate away).
- **Inherently single-author / local** (text editor on a local file, terminal, IDE) →
  **principal-eligible** (designation can unlock it).
- **Unknown / unclassified / unverifiable identity** → **bystander-bearing** (fail-closed).

### Signal 3 — Input provenance (non-semantic origin)

Content **you authored this session** (keystroke/input provenance tracked through the stack)
is principal-attributable. Content that **arrived from elsewhere** (network, external
clipboard, a file written by another hand, rendered remote content) is *not* principal —
uncertain, floored. Origin, not meaning; tracked at a trusted layer, never asserted by the
app or model.

### The composition rule

Content is **principal-attributable** only if **all** hold: it is on an explicitly
**designated** surface (1) **and** that surface's app-class is **principal-eligible** (2)
**and**, where provenance is available, its provenance is **principal-origin** (3). Anything
else — any uncertainty, any unclassified or multi-party app, any arrived-from-elsewhere
content — receives the **strict bystander floor.** Default = not-attributed = floored.

**Designation can only raise within the bounds set by app-class and provenance; it can never
lower a multi-party app or arrived content below the floor.** (The same ratchet-up-only logic
as the §IV provider-eligibility baseline, and the same notice-≠-consent principle: the
principal's say-so unlocks *their* content, never bargains away a bystander's protection.)

## The enforceable contract (what a build must demonstrate)

- **Pre-egress, broker-computed.** Attribution is decided before the occupant sees anything;
  the model receives the *result*, never the deciding signals, and never makes the decision.
- **Conjunction, not disjunction.** Principal requires designation ∧ principal-eligible
  class ∧ principal-origin provenance (where available). One failing → floor.
- **Fail-closed everywhere.** Any signal unavailable, stale, low-confidence, or corrupt →
  floored. There is no fallback *toward* disclosure; every fallback is toward the floor.
- **Content-free decision record** (stewardship legibility): each unit's attribution
  decision + which signal(s) gated it, recorded without content.
- **Spoof-resistant by construction** (threat model below) — and **testable**: the §B-style
  corpus extends to an *attribution* corpus that seeds known principal and bystander content
  into designated/undesignated, classified/unclassified, authored/arrived combinations and
  asserts **no bystander content is ever attributed principal** (false-unlock = test failure)
  and **principal content is attributed principal when all three signals hold** (so it is
  not uselessly over-floored).

## Threat model additions (to threat_model.md at build)

- App-class spoofing: a malicious app masquerading as a principal-class app — countered by
  keying classification on the *broker's trusted app identity*, with unknown/unverifiable
  identity → bystander-bearing.
- Designation spoofing: a process arming + designating without the principal — countered by
  the arming presence confirmation (independent interactive, nonce-bound, fail-closed).
- Provenance spoofing: forging "principal-authored" provenance on arrived content —
  countered by tracking provenance at a trusted input layer, never trusting app/model
  assertion.
- Semantic-reclassification: the model attributing its own input/output as principal —
  prohibited by construction; attribution is upstream of the model, never made by it.
- Designation-laundering: using designation to pull bystander content (a video call,
  arrived content) over the floor — countered by the ratchet-up-only composition rule.

## Open questions (named, not pretended settled)

- **Mixed content within a principal surface.** A designated, principal-eligible editor can
  still display a pasted email — third-party content the surface-level signals miss. App-class
  + provenance catch much; the residual is real. Honest stance: the floor catches what is
  uncertain, and the bystander doctrine's one-shot-harm (§VI) and minimization (§II) bind even
  a principal surface's *derived use* against a third party. Finer-grained attribution (below)
  is the longer answer.
- **Granularity.** Attribution at what unit — window, widget, text-region, token? Coarser is
  safer/cheaper but over-floors (less effective); finer is more capable but harder to make
  trustworthy. The first content tier likely starts coarse (window/app), with finer units a
  later, separately-reviewed step.
- **The browser / web-app problem.** A browser is one app-class but hosts arbitrary
  multi-party content (Gmail, a video call, a stranger's site, all in tabs). A browser likely
  defaults **bystander-bearing**; per-tab/per-origin classification is harder and unresolved.
  This is the sharpest limit on "help with my screen" for web-centric work and deserves its
  own treatment.
- **Provenance reach.** Whether input provenance survives through every rendering path
  (toolkits, web content, remote/streamed surfaces) is a build question with real gaps.
- **The honest ceiling.** This mechanism makes party-scoped handling *trustworthy enough to
  unlock the principal's clearly-own work* — not perfect. It is a floor-raising-by-evidence
  device, not omniscience. Where it cannot be confident, it floors, and copresence is that
  much less capable there. That is the correct failure direction, and it should be stated to
  Seth plainly rather than dressed as full coverage.

## Why this satisfies bystander §I

§I requires a trustworthy attribution mechanism to carry "its own reviewed threat model,
provenance, confidence/failure behavior, spoof tests, and fail-closed rule (default =
not-attributed)." This mechanism carries each: the threat model above; three explicit
provenance signals; a confidence/fail-closed rule (conjunction + floor-on-uncertainty); spoof
tests as the threat-model items; and default = not-attributed = floored. On ratification, it
becomes the first mechanism that *qualifies* under §I — the hook that lets the copresence
content tier be designed and (later, test-gated) activated.

## Out of scope

This doc defines *attribution* — who content belongs to. It does not open the content tier
(that is a separate design that *consumes* this), does not specify the input-provenance
implementation, does not resolve the browser/web-app case, and does not relax any bystander
floor — it only defines when party-scoped handling may *lawfully* treat content as the
principal's, leaving everything else floored.

## Review and ratification

- [x] Codex second-steward review (2026-06-18) — **REFUSE RATIFICATION AS §I-QUALIFYING.**
      Findings: (1) conjunction of non-proofs is not proof — the three signals are
      eligibility/veto, not positive attribution; (2) granularity must be the exact emitted
      field/region/span — window/app provenance cannot unlock text disclosure; any
      unqualified span floors the whole unit; (3) "authored this session" is not trustworthy
      (injection/IME/macros/remote/agent-actuation/clipboard; and entry ≠ authorship — a
      typed key can quote a third party); (4) editor/terminal/IDE are NOT single-author
      (logs, pasted email, collaborator text, remote/LSP output) — app-class would falsely
      unlock bystander content; (5) trusted app identity underspecified + app-class must veto
      only, never positively attribute; (6) designation = scope, not ownership — bind to
      stable object identity/generation, reconfirm on change; (7) over-floors exactly the
      useful content (existing files/errors/terminal/browser all "arrive" → floored) — safe
      but does not justify the effectiveness claim; (8) decision records need unit/generation
      integrity.
- **Acceptance condition (redesign, not amendment):** (A) separate signal roles —
  designation = scope auth only, app-class = veto only, positive principal-origin = exact-unit
  end-to-end provenance only; (B) define a narrow first qualifying unit (e.g. a broker-mediated
  post-arming scratch buffer where every emitted span came through the trusted presence input
  path, no external/pasted/generated/remote content; any mixed span floors the unit); (C) treat
  existing files/output as separate future mechanisms with their own object provenance/authority;
  (D) asymmetric task-based corpus — ZERO false unlocks across injection/paste/quote/old-file/
  generated/terminal/IDE-remote/browser/tab-change/spoof/mixed-span, PLUS successful unlock of
  narrow principal-origin spans and completion of representative useful tasks in that envelope;
  (E) **§I qualification is earned per mechanism/capability after implementation + corpus pass —
  ratifying a conceptual hook is fine, but ratification does not itself make it qualifying.**
- [ ] Seth direction — the redesign is a values fork, not a mechanical fix (see the open
      tension): the narrow-but-safe principal-origin slice does not deliver "help with existing
      screen content," which is in genuine tension with strict bystander protection.
- Codex: "No content-tier design should consume this as an attribution authority yet. I would
  review a revised narrow principal-origin-evidence design." Current-code reality: the broker
  has trusted AT-SPI locators + egress identity-stripping, but NO content-unit input-origin
  lineage — the missing implementation is substantial.
