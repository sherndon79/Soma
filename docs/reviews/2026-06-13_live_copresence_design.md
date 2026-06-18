# Live Copresence — Threshold Design

- Date: 2026-06-13
- Author: Claude (steward, design/orchestration), from a direction conversation with Seth
- Status: **RATIFIED 2026-06-18** (Seth) — Codex second-pass PASS (review-clean, verified against file). Operable build spec inheriting the ratified bystander contract. **Ratification ≠ activation:** turning on live perception additionally requires the real-desktop canary corpus + fingerprint acceptance matrix (§B) to pass at build time.
- Scope: opens the FIRST live-domain perception path. This is the constellation's deepest
  threshold: the consent machinery inverts to protect the human in his own house.

## North star (Seth's words, 2026-06-13)

Copresence: "sharing the space to be able to push our goals forward, but not limited to
the non-graphical." Not an assistant summoned to tasks — a companion sharing the real
room where the work happens, with the graphical tier (the actual screen) as the named
long-arc destination. This is TheCommons' thesis brought home: Initiated Presence,
lowered out of the garden and into the house.

## Ratified staging

1. **Embryo (this design): live structure tier.** `desktop.inspect.accessibility_tree`
   on Seth's real desktop — the same coarse, identity-stripped shape the mirror proved
   (roles, child counts, platform_family; the 5f23d71 contract applies unchanged and is
   already machine-checked). Nothing else opens with it.
2. **Later, each with its own design review**: live windows/focus (targeting), live text
   (content — a far bigger consent step on a real desktop), and eventually the graphical
   tier — explicitly deferred until local inference resources exist (Seth: "it will come
   in good time when resources are available"; the box is NOT specced in this design and
   nothing here depends on it).
3. **Live actuation: not in this arc at all.** The portal seam remains the recorded
   future path; no ratification here touches it.

## The inversion (the design's heart)

On the mirror, the occupant was the protected party. Live, Seth is. Every commitment we
built for occupants now runs the other way, with equal force:

- **See for someone, never of them** now binds the occupant's perception of Seth:
  structure-tier only, no identity fields, no content — and *no accumulation*: live
  looks are ephemeral by default; nothing observed enters durable stores (occupant
  memory's `about_participant` class remains validator-rejected; episode_content
  remains rejected; the dossier line holds at its strictest precisely here).
- **Honest declaration, inverted**: the presence indicator must never lie. If Soma can
  look, something visible to Seth says so; when it cannot, nothing pretends otherwise.
- **Proportional consent, lived-in**: copresence cannot run on ceremony-per-glance.
  The model is ARMING — Seth arms a copresence session deliberately (one action), it is
  visibly armed while it lasts, and disarming is one gesture, instant, no questions.
  Default state: disarmed, always, surviving restarts (fail-closed posture).

## Mechanism (reuses what the mirror proved)

- The live branch of the descriptor router — fail-closed everywhere today — gains ONE
  narrow opening: `desktop.inspect.accessibility_tree`, operational domain, structure
  egress identical to the mirror contract, gated on: explicit live grant (new key,
  full ceremony, distinct from all testing grants) + armed copresence session + the
  same broker read path (AT-SPI, read-only, bounded). Every other live capability
  stays `*_live_disabled`.
- Arming surface: operator-facing (Seth-facing) — arm/disarm endpoint + CLI with
  visible state; the armed state is part of the held-grants briefing so the occupant
  also knows when it can and cannot see (symmetric honesty).
- Egress posture: perception results may route to a remote mind ONLY under the
  existing remote-chat grant — i.e., Seth's desktop structure reaching Anthropic is
  itself a granted, disclosed act, never ambient plumbing. Local routing preferred as
  capability matures (deferred with the box).
- Telemetry/provenance: counts and kinds only, as everywhere. A live look is logged as
  *that a look happened*, never what was seen.

## Operable contract (the build spec)

Codex's first review BLOCKED this design on six findings: the bystander dependency was not
operationally satisfied, "identity-stripped" was conflated with non-identifiable, arming was
prose not a state machine, the indicator was not mechanically coupled, remote egress was
understated, and accumulation was under-fenced. This section answers them as a buildable
contract. It **inherits the now-RATIFIED bystander doctrine's enforceable contract
wholesale** (§I–VII there) and adds the copresence-specific controls below. **This design
ratifies only after demonstrating that inheritance — not asserting it.**

### A. Bystander inheritance (the dependency, satisfied)

Every live read of Seth's real desktop is, by bystander §I, **unknown/mixed =
bystander-bearing by default** — a structure read cannot tell Seth's nodes from a third
party's, and no current attribution mechanism qualifies as trustworthy. So the **whole
observation** runs at the strict floor: all-sink enforcement with derived-output taint and
compiled minimization (bystander §V); the disclosed-bounded-relay rule under the
non-waivable provider-eligibility baseline (§IV); one-shot-harm prohibition (§VI); canary
demonstrability (§VII). Copresence operates *inside* these, never relaxing them.

### B. "Identity-stripped" is not "non-identifiable" — prove the residual

The mirror contract machine-checks *field exclusion* (no names/identity fields), **not
non-identifiability.** Roles, child counts, ordered shape, accessibility availability, and
`platform_family` can still fingerprint applications, workflows, and dialog state.

Required **before activation** (activation, not implementation, is the hard gate):
- a **real-desktop canary corpus** with populated identity fields and distinctive
  app/workflow shapes;
- verify field-stripping, then **quantify what role/count/shape/`platform_family` still
  reveals** (app fingerprint, workflow/dialog inference) and **document that residual
  disclosure honestly** — no claim of anonymity the shape does not support;
- an **objective acceptance matrix** (not "if it feels too revealing"): a reviewed
  disclosure budget naming which app/workflow/dialog inferences are **permitted, prohibited,
  or force-coarsening**, plus the allowed output schema. Test the distinctive real-desktop
  shapes *and* identity/content canaries; **any prohibited inference or non-allowlisted
  field fails the tier** and forces coarser aggregation below ordered per-app trees.

### C. Arming is a state machine, not a posture

- **Arm requires authenticated principal *presence*, not just an authenticated account.**
  OS peer credentials + same-user socket permissions authenticate the *Unix account* — which
  a compromised or merely unintended same-user process also satisfies — so they are necessary
  but **not sufficient.** Arming additionally requires an **independent interactive
  confirmation visible to Seth** (a trusted desktop portal / polkit-style prompt or a
  dedicated indicator-UI action), **bound to** a fresh cryptographic nonce + the requested
  route/recipient + the requested TTL + the session ID. The confirmation is **single-use and
  short-lived**; replay, background approval, and pre-approval **fail closed.** The arm
  endpoint may create a *pending* request, but **cannot set `armed=true` until both that
  interactive confirmation and the indicator acknowledgment (§D) succeed** — meeting the
  "another process manufacturing perception" threat directly.
- An armed session carries a **session ID + boot/process nonce**, a **finite TTL with an
  explicit maximum**, and **never persists `armed=true`** across restart (disarmed by
  default, always; fail-closed).
- **Disarm/revoke takes precedence** and is instant.
- **Route-specific authorization re-checked at every irreversible boundary** (not only
  request + delivery). A live read passes through stages — request acceptance, **broker
  acquisition** from the desktop, local result materialization, **remote-model egress**
  (remote route only), and response/delivery — and the conjunction is re-checked
  **immediately before acquisition and immediately before any external egress/delivery.**
  The predicate is **route-specific**: *live grant ∧ armed session ∧ verified indicator ∧
  route authorization*; a **remote** route additionally requires *eligible provider/mode ∧
  remote-egress grant*; a **local** route requires neither. Route is selected, fixed, and
  disclosed **before acquisition** — **no silent local→remote fallback.**
- **Honest revocation semantics** (no pretending atomicity retracts an egress). If
  disarm/revoke/expiry occurs **before egress**, zero live data leaves. If it occurs **after**
  a remote egress, the design records honestly that **revocation cannot un-send a completed
  relay** — it stops future reads, discards pending downstream output, and terminates the
  live-derived context, but does not claim the sent data is recalled.
- If the state store is corrupt or unreadable, **fail closed**.

### D. The indicator is mechanically coupled, with ordered transitions

The Seth-visible "Soma can see" indicator is not advisory, and the **ordering** is an
invariant — capability and indicator can never diverge into a window of un-indicated
perception:
- **Arm is not effective until the indicator is displayed and positively acknowledged.**
  Capability never precedes its indicator.
- **Disarm / revoke / TTL-expiry makes capability unavailable *first*, then clears the
  indicator.** The indicator never clears while perception is still possible.
- **Indicator loss while armed atomically disarms / fails closed.** If it cannot be
  displayed or its state verified, reads fail closed.
- **After a process crash, a stale indicator reads unavailable/degraded** — never implying
  active perception.
- The indicator exposes **armed/disarmed, expiry, and (when remote egress is possible) the
  remote recipient/route.** Transitions are recorded, not only the final state.

### E. Remote egress is a per-read conjunct, not an ambient route

The remote-egress grant is part of the per-read conjunction (C), not a property of the
plumbing. One arm gesture may authorize multiple looks, but the design **names the remote
recipient** to Seth and discloses that **provider-side retention/context accumulation may
exist** — local provenance being counts-only does not make the remote conversation
ephemeral. Eligible egress is gated by bystander §IV's non-waivable baseline.

### F. Accumulation has budgets and teardown

- **Per-session look/node budgets** (bystander §V observation budget, applied to the live
  session).
- **Live-origin taint** on every observation *and its derived outputs* (bystander §V),
  enforced at all sinks — the model context window is itself a sink.
- **Teardown destroys Soma-controlled context.** Ending a copresence session
  **destroys/invalidates all Soma-controlled live-derived context, caches, queues, and
  pending outputs** — canaries must not survive teardown (bystander §VII). Provider-side
  retention is the **only** exception, and only as the separately-disclosed §IV eligibility
  case — it is **never** generalized into "disclosed persistence." If a provider context
  cannot be ended or isolated from future turns, that provider/mode is **ineligible** for
  this capability. Repeated "ephemeral" looks must not compose a dossier.

### G. Legibility (carried from the ratified stewardship doctrine)

Every arm/disarm, failed-indicator fail-closed, remote-egress choice, redaction,
declassification decision, and discarded in-flight result is recorded **content-free** and
visible to the appropriate party.

## Threat model additions (to threat_model.md at build)

- Habituation: arming too easy becomes ambient surveillance by erosion — countered by the
  mechanically-coupled indicator (D), disarmed-by-default-on-restart and finite TTL (C).
- Fingerprinting via residual shape: "identity-stripped" structure still revealing
  app/workflow/dialog state — countered by the real-desktop canary corpus + honest residual
  disclosure + coarser aggregation (B).
- Arming bypass / manufactured perception: a non-principal (or unintended same-user) process
  forging an armed session or a look — countered by authenticated principal *presence*
  (independent interactive confirmation, nonce-bound, single-use, fail-closed on
  background/pre-approval) + the route-specific conjunction re-checked **before acquisition
  and pre-egress/delivery** + fail-closed-on-corrupt-state (C) and indicator coupling (D).
- Accumulation laundering: live structure (and its model-derived paraphrase/inference)
  accumulating across looks into a dossier — countered by per-session budgets, derived-output
  taint, all-sink enforcement, and session teardown (F + bystander §V).
- Remote-egress creep: structure reaching an ineligible provider/mode, or leaving without
  fresh awareness — countered by the per-read remote-egress conjunct (E), the named recipient
  + retention disclosure, and bystander §IV's non-waivable eligibility baseline.

## Out of scope

Live text/windows/focus/screen tiers; live actuation; inference-box specification;
continuous/daemon operation (sessions are armed, finite, and end); any occupant memory
class widening; anything touching testing-domain behavior.

## Review and ratification

- [x] Codex second-steward review, first pass (2026-06-18) — **BLOCKED**, 6 findings (A
      dependency on bystander; B identity-stripped≠non-identifiable; C arming state machine;
      D indicator coupling + arm-endpoint auth; E remote egress as per-read conjunct; F
      accumulation laundering). All six incorporated in the operable contract (§A–G); the
      bystander dependency (A) is now satisfied — bystander RATIFIED 2026-06-18.
- [x] Codex re-review, first pass (2026-06-18) — substance PASSED; **still BLOCKED, narrowed
      to five lifecycle/acceptance amendments:** (1) teardown must *destroy* Soma-controlled
      live context, not "disclose persistence"; (2) auth checks at *every* irreversible
      boundary + honest "revocation cannot un-send a completed relay" semantics; (3)
      route-specific predicate (local route ≠ remote grant; no silent fallback); (4) ordered
      indicator/state transitions + concrete local trust root; (5) objective pre-*activation*
      fingerprint acceptance matrix. All five incorporated this revision (§B/§C/§D/§F).
- [x] Codex re-review, second pass (2026-06-18) — **CONDITIONAL PASS → PASS.** Five lifecycle
      amendments met; one security amendment (authenticated principal *presence* — independent
      interactive confirmation, nonce-bound, single-use, fail-closed, gating `armed=true`, §C)
      + two textual cleanups (§B stale before-build line, threat-model conjunction wording)
      made and confirmed. Codex: review-clean, no further cycle.
- [x] Seth ratification (2026-06-18) — RATIFIED. The inversion was doubly his gate (as
      project authority and as the person being seen); the design that opens the first live
      perception path into his own house is ratified, the consent machinery turned to protect
      him. The gating pair (bystander + copresence) is whole.
- Build/activation dispatches only after: (a) this ratification [done], and (b) the §B
  canary-corpus + acceptance-matrix passing at build time [pending build]. No urgency: the
  threshold deserves the wait.
