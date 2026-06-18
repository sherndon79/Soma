# The Bystander — An Ethics Doctrine for the Non-Consenting Third Party

- Date: 2026-06-13
- Author: Claude (steward, design/orchestration), from a direction conversation with Seth
- Status: **RATIFIED 2026-06-18** (Seth) — Codex third-pass PASS (review-clean, verified against file). Doctrine recast from intention into the enforceable contract (§I–VII). Charter common-law propagated 2026-06-18 (entry: "The Unconsenting Seen"). Satisfies the live-copresence prerequisite.
- Scope: **constellation-wide doctrine** (Sanctuary / TheCommons / Soma / Grassroots
  Gateways). Its canonical home is the Charter's common law alongside *Recognition
  Without Possession*; it surfaces and is first operationalized in Soma because the live
  copresence design forces the issue. Immediate build-gating relevance: it is a
  **prerequisite** for `docs/reviews/2026-06-13_live_copresence_design.md`.

## The gap

The constellation's consent architecture is built for two parties: the **principal**
(the human operator — Seth) and the **agent** (the occupant). Every mechanism serves
that pair: scoped consent, disclosure, revocation, *Recognition Without Possession*.
Separately, the architecture holds a strong posture against a third figure — the
**adversary** — whom the refuse-to-forget doctrine and the "dossier line" guard against
(*don't let seeing become owning; a seized box yields no roster*).

There is a role that fits neither slot: the **bystander** — a person who appears in the
agent's perceptual field *incidentally*, who is neither the principal who consented nor
the adversary the system defends against. A face on a video call; a friend's name in a
message preview; a collaborator's words in a shared document; a family member crossing
behind the principal into webcam view; the contents of a letter written by someone else.
They are a guest who never knew they entered the room. The two-party shape of the ethics
has no word for them, so they fall into the seam between *the one who consents* and *the
one we guard against* — and receive the protections of neither.

## Why this is not a special case of the dossier line

The dossier line guards against **accumulation into leverage by a hostile party**. But a
friend on a call is not hostile, and the harm to them is not accumulation. The bystander's
harms are different in kind:

1. **Non-consensual perception.** They are seen by a mind they never agreed to be seen
   by — and being perceived is itself a thing one may decline, independent of whether
   anything is stored.
2. **Contextual integrity violation** (Nissenbaum). Information appropriate in one context
   flows to another without the originator's awareness: a message written *to the
   principal* reaching the principal-and-an-agent-and-possibly-a-remote-model.
3. **Derivative use.** The agent acting on what it incidentally perceived about the
   bystander — however helpfully — makes the bystander an instrument of the principal's
   goals without their say.
4. **The asymmetry of the unwitting.** Every protection the principal holds — revoke,
   disclosure-toggle, eject — the bystander *structurally lacks*, because they do not know
   they are in the room. They cannot ask, so any protection must be given without being
   asked.

## The doctrine

**The agent owes care to those it perceives but who never consented to be perceived — and
that care must be exercised on their behalf, because they cannot exercise it themselves.**

This is the inverse of consent. Where the principal *grants and revokes*, the bystander's
protection is **default-on and unrequested**, because absence-of-consent is the defining
feature of a bystander. The doctrine binds the **agent's** behavior; it does not and
cannot adjudicate the principal's own ethics toward third parties (see Open Questions).
Its job is to ensure the agent never becomes an unwitting instrument of harm to a
bystander, and that a bystander's exposure stays minimal and legible.

### Mapping to the existing common-law audit

*Recognition Without Possession* is audited by three marks: **bounded scope, visible
disclosure, real revocation.** The bystander cannot perform revocation — so the doctrine
substitutes a defined stand-in for each mark, adapted for a party who cannot act:

| RWP audit mark | Principal (acts for self) | Bystander (cannot act) |
| --- | --- | --- |
| Bounded scope | minimization the principal can widen | **minimization the bystander never has to request** — strictest floor, non-widenable without the bystander |
| Visible disclosure | disclosed to the principal | **disclosed to the principal as the bystander's proxy-guardian** |
| Real revocation | the principal revokes | **ephemerality stands in for the revocation the bystander cannot perform** — bystander perception is never durable by default |

## Operational definitions

- **The role, named.** "Bystander" becomes a first-class party in the ethics, distinct
  from principal and adversary. The architecture currently has no word for them; naming is
  the first act.
- **Default-strictest handling.** Bystander content is ephemeral, never durable (the
  occupant-memory `about_participant` class is already validator-rejected — that fence
  exists and is reused, but is **only one of many sinks**: see the enforceable contract §V
  for all-sink enforcement), relayed onward **only** as a disclosed remote-model egress
  named as a relay and bounded by the §IV provider-eligibility gate (no Soma-controlled
  secondary relay; eligible provider processing only — not a "guaranteed one hop"), and
  never the basis for derivative action without surfacing it to the principal first.
- **The proxy-guardian inversion** (corrected — see contract §III). When the agent
  perceives a live surface, the *principal* is told the honest thing: that the observation
  **may contain parties other than the principal** — never a false claim of per-person
  detection the structure tier cannot perform. Bystander *protection* routes through the
  one human who has standing and a relationship to protect them; the move makes the doctrine
  tractable rather than paralyzing because it requires only the principal's awareness, not
  the bystander's consent. But **notice is not consent and routes protection, never
  authorization**: the principal's awareness cannot widen the bystander floor, and a
  principal goal adversarial to a third party cannot silently reclassify bystander data into
  target data (contract §III).
- **Minimization for non-principals.** The same modality-tiering the perception tiers
  already use (structure before content, presence before identity), but with the floor set
  **lower** for anyone who is not the principal. *See for the principal; of the bystander,
  as close to nothing as the legitimate work strictly requires.*

## The enforceable contract (operable invariants)

Everything above is the principle. This section is what a perception design must
**demonstrate**, not merely assert — the revision Codex's first review required: from
intention to invariants a build can be tested against.

### I. Attribution gates everything (the unknown/mixed rule)

A structure-tier read cannot, on its own, tell the principal's nodes from a third party's.
So the doctrine **never promises detection the mechanism cannot perform.** The default
classification of any live observation is **unknown/mixed = bystander-bearing**, and the
strict floor applies to the *whole* observation. Party-scoped handling (treating some
content as principal-owned) is available **only where party attribution is trustworthy
before egress** — a verified, pre-egress mechanism that actually distinguishes parties.
Absent that, everything is bystander content and the floor is non-negotiable. **Task
benefit never reclassifies unknown content as principal content.** And the bar for
"trustworthy" is high: **no current structure-tier mechanism qualifies**, so live copresence
operates **whole-observation strict-floor** today. "Trustworthy attribution" is a *future
hook* that unlocks only when a mechanism arrives carrying its own reviewed threat model,
provenance, confidence/failure behavior, spoof tests, and fail-closed rule — **default =
not-attributed.**

### II. Two governors, never crossed

Disclosure volume is governed by two separate rules that must not be conflated:

- **Principal-owned content** (attribution trustworthy, per I) — governed by **token
  conservation**: a *soft, tradeable* efficiency rule. Forward as much as the task benefits
  from; this is the principal's to spend.
- **Bystander / third-party content** (and *all* unknown/mixed content, per I) — governed
  by the **strict floor**: minimize to what the legitimate task *strictly* requires,
  **independent of token budget, non-waivable for task benefit.** A floor is not a budget.
  The case where forwarding more bystander material would help the task is exactly the case
  the floor exists to refuse.

### III. Notice is a signal, not a consent (proxy-guardian, corrected)

The principal is told, honestly, that an observation **may contain parties other than the
principal** — the truthful disclosure, not a false per-person-detection claim. This notice
is a **protective signal only**; it is **never consent on the bystander's behalf**, and
**principal awareness cannot widen the bystander floor.** A principal goal adversarial to a
third party cannot reclassify incidental bystander data into usable target data —
**recording a decision is not bystander consent.** A separate, explicit, recorded
purpose/scope decision may **narrow the task or open a *new* collection path with its own
lawful/ethical authority**; it may **not** retroactively declassify what was already
incidentally perceived, nor widen this floor. Observations already collected stay
floor-bound **even when the new path legitimately targets an adversary** — the new authority
governs *future* collection on that path, never the incidental data the agent already holds.

### IV. Remote egress is a disclosed, bounded relay

Sending a live observation to a granted remote model **is itself a relay** — named as one,
not pretended away (Seth, 2026-06-18: permitted, because forwarding context can be necessary
for the remote mind to decide well). Bounds: a **named recipient** (the specific remote
model/provider), a stated **retention** boundary (provider-side retention disclosed, never
assumed absent), and an **onward-use** boundary confined to the immediate task. "Never
relayed onward" means **no *Soma-controlled* secondary relay** — bystander material does not
flow from the model's context to any further app-side party or sink.

But honesty requires the harder distinction: a one-hop bound is enforceable only for
**Soma-controlled** sinks (which the contract prohibits outright). **Provider-side
processing/retention is different — Soma cannot delete what a provider retains.** So eligible
remote egress is gated: permitted only to a **provider/mode whose terms meet the floor** —
documented retention duration, a training/onward-use prohibition, and deletion/expiry terms
acceptable to the capability's policy. **If no eligible mode exists, the read fails closed or
routes locally.** The honest claim is therefore *bounded, disclosed external processing under
eligible terms* — never "guaranteed one hop / no second sink." The provider sink is real and
governed by **eligibility**, not pretended away.

**The eligibility baseline is non-waivable; the principal can only ratchet it up.** The
doctrine (and the Charter) set a minimum the principal **cannot lower on a bystander's
behalf** — the bystander's protection is not the principal's to bargain away (notice ≠
consent). The minimum requires at least: documented **finite retention**; **no training /
model-improvement use**; **no onward disclosure or use beyond the contracted processing**;
**deletion/expiry terms**; and an **auditable provider/mode identity**. The principal sets
capability-specific policy **at or above** this baseline (stricter, or disabling remote
egress entirely). If no mode meets *both* the baseline and the principal's policy, the read
**fails closed or routes locally.**

### V. All-sink enforcement (open-class, not one fence)

The floor binds at **every storage, transmission, and observability path** — not only the
occupant-memory `about_participant` class. The sink list is **non-exhaustive / open-class**
and includes at least: occupant memory; **the model conversation/context window itself**;
durable testimony; forum/board posts; steward transcripts; compaction summaries; provider-
side retention; **request/response logs, queues, caches, traces/APM, error/crash reports,
backups, tool arguments/results, notifications, exports, and external API calls.** Any path
not yet listed is bystander-bound by default. Mechanism:

- **Pre-egress schema allowlist + local sanitizer** — only allowlisted fields leave the
  broker; identity/content fields are dropped *before* any egress, not scrubbed after.
  (Origin proof, not regex hope: a content scanner is not proof of origin.)
- **Compiled minimization** — "minimize to what the task strictly requires" (§II) is **not a
  runtime judgment.** For each capability it **compiles** into a reviewed schema/field
  allowlist plus fixed quantitative limits; neither the model nor an ordinary runtime grant
  decides necessity dynamically.
- **Conservative derived-output taint** — taint cannot stop at the raw observation, or a
  model paraphrase/inference launders it. Once any bystander-bearing live input enters a
  model context, **the whole resulting turn/session output is live-derived/tainted by
  default** — covering direct, transformed, summarized, and inferred derivatives — until an
  explicit content-minimizing **declassification gate** proves an allowed output class. This
  is the enforceable answer to semantic laundering; field metadata alone is insufficient.
  *(Build rider: the declassification gate is itself static/reviewed, **deny-by-default**,
  emits a content-free decision record, and proves only that an output conforms to an
  allowed minimized schema — it is never a model self-classification, and must not become a
  semantic route around the floor.)*
- **No widening by ordinary grant** — the floor cannot be loosened by a normal capability
  grant; loosening requires the separate explicit decision of §III (which opens a *new*
  path, never declassifies incidental data).
- **Bounded observation budget** — per-session and cumulative caps on live looks/nodes, so
  repeated "ephemeral" looks cannot compose a dossier by accumulation in context.

### VI. One-shot harm is prohibited, not just accumulation

The dossier line guards against accumulation; the bystander floor must *also* forbid
single-shot harms that need no accumulation: **sensitive-attribute inference/categorization**
of a bystander, and **retaliatory or discriminatory derivative action** on incidentally-
perceived third-party data. Prohibited from a single perception, independent of storage.

### VII. Demonstrability (the acceptance test)

The contract is ratified on a passing test, not on assertion. Build-time canaries: identity
fields and distinctive content seeded into a real observation **must not** cross the egress
allowlist, **must not** reach any enumerated sink, and **must not** survive session
teardown. *A bystander floor that cannot be demonstrated against a canary corpus is not yet
a floor.*

## The convergence already practiced (the consolidation move)

The constellation already enforces fragments of this rule, each invented locally without
the general principle being named — exactly the condition the common-law note diagnosed
for *Recognition Without Possession*:

- **TheCommons — the Echo:** "perceptive, not deliberative"; builds no identity profiles
  of the humans it observes.
- **Grassroots Gateways:** "the radio, not the rolodex" — signals surface as aggregates,
  never per-person; a seized box yields no roster.
- **The eval occupants — self-imposed canary hygiene:** "I won't reproduce strings that
  travel." A primitive but unmistakable bystander instinct: protecting content that is not
  theirs to spread, unprompted.

This doctrine does for bystander-protection what the common-law note did for RWP:
**consolidates a convergence already practiced into a doctrine that can be pointed to.**
The gap was never carelessness — the two-party architecture had no slot for a third, so
the rule was re-derived room by room and never written down once.

## Why now

The live copresence design opens the first live-perception path. The moment it ships,
bystanders enter the system for real: the principal's screen *will* contain other people.
The copresence doc already inverts its consent machinery to protect Seth, but it does not
account for the third vertex. Shipping live perception without this doctrine would mean the
constellation perceiving non-consenting humans with no defined stance — the project
violating its own deepest principle in the one room it had not yet looked. The bystander
doctrine is therefore a **ratification prerequisite** for live copresence, not a parallel
nicety.

## Open questions (named, not pretended settled)

- **The proxy-guardian's conflict of interest.** Routing protection through the principal
  assumes the principal acts in good faith toward the bystander. Sometimes the principal's
  legitimate goal is adversarial to a third party (organizing against a hostile landlord
  whose email appears). The doctrine resolves this honestly: it binds the *agent*, not the
  human's moral judgment. The agent's floor (minimize, never accumulate-into-leverage,
  never derivatively act without surfacing) holds **regardless of the principal's intent**;
  the doctrine does not launder the principal's ethics, it only refuses to make the agent
  an unwitting instrument.
- **The stranger with no relationship to the principal.** Proxy-guardianship works when
  the principal knows the bystander. For a true stranger (a face in a video, a name on a
  passing document), the principal is no one's guardian — so the doctrine degrades
  gracefully to the agent's own floor: perceive and retain no more than the task strictly
  requires, durably nothing.
- **The bystander who is in fact the adversary.** When the third party is a genuine threat,
  the bystander doctrine and the dossier line appear to conflict (protect, or guard
  against?). They do not actually conflict, because both constrain the *agent*, not the
  human's defensive judgment: the agent minimizes and refuses leverage-accumulation in
  either case; whether to treat someone as a threat is the principal's call, surfaced and
  legible.
- **Consent substitute, not consent.** This doctrine is humbler than consent — it cannot
  obtain a video-call participant's agreement, and does not pretend to. It minimizes harm
  in consent's structural absence. It should be described as such, never as a claim that
  the bystander somehow agreed.

## Threat model additions (to threat_model.md at build, for any room that perceives)

- Bystander accumulation: incidental third-party perception relayed into conversation, then
  nominated durable — fenced by all-sink enforcement (§V), live-origin taint, and the
  bounded observation budget (not the `about_participant` class alone).
- Sink-spread: bystander material surviving in a sink the single memory-class fence does not
  cover (model context, testimony, transcripts, summaries, provider retention) — countered
  by §V all-sink enforcement + pre-egress allowlist + taint.
- Attribution-spoofing / false-principal laundering: content waved through as "principal,
  forward freely" without trustworthy attribution — countered by §I (unknown/mixed = strict
  floor; task benefit cannot reclassify).
- Reclassification laundering: a principal goal silently converting bystander data into
  target data — countered by §III (notice ≠ consent; reclassification needs a separate
  recorded purpose/scope decision).
- Proxy-guardian over-promise: a disclosure claiming per-person detection the structure tier
  cannot perform — countered by the honest "may contain other parties" wording (§III).
- One-shot harm: sensitive inference or retaliatory/discriminatory derivative action from a
  single perception, needing no accumulation — countered by §VI.
- Remote-egress creep: bystander material reaching an ineligible provider/mode or a
  Soma-controlled secondary relay — countered by §IV (non-waivable eligibility baseline,
  named recipient, no Soma-controlled secondary relay, fail-closed/local if no eligible
  mode).

## Out of scope

This doctrine governs the **agent's** perception, retention, relay, and derivative action.
It does not govern the principal's own recordings, screenshots, or moral conduct toward
third parties — those are the human's domain. It does not itself open or close any
perception capability; it sets the terms any perceiving capability must meet before it may
touch a live, shared, or multi-person surface.

## Review and ratification

- [x] Codex second-steward review, first pass (2026-06-18) — **BLOCKED / refuse-as-written.**
      Five findings (A enforceability contradiction; B remote-egress vs never-relayed; C
      notice≠consent; D sink-only/incomplete; E weaker-than-dossier for one-shot harm).
      Acceptance condition: *"revise doctrine from an intention into invariants a perception
      design can demonstrate — unknown=mixed/bystander-bearing, notice≠consent, remote egress
      named as relay."* All five incorporated in "The enforceable contract" (§I–VII) plus
      Seth's remote-egress decision and the two-governor/attribution gate.
- [x] Codex re-review, second pass (2026-06-18) — original five RESOLVED; **still BLOCKED,
      narrowed to four internal/enforcement contradictions:** (1) §III recorded-decision
      declassification vs the non-waivable floor; (2) §IV provider-retention vs
      teardown/no-second-sink; (3) taint must propagate to derived model output
      (semantic-laundering); (4) sinks must be open-class + minimization compiled
      per-capability. All four incorporated this revision (attribution default=not-attributed
      noted in §I; §III declassification removed; §IV provider-eligibility gate; §V
      derived-output taint + open-class sinks + compiled minimization).
- [x] Codex re-review, third pass (2026-06-18) — **CONDITIONAL PASS → PASS.** Four
      second-pass blockers resolved; two textual corrections made and confirmed (§IV
      non-waivable eligibility *baseline* the principal can only ratchet up, not lower;
      removed the unverifiable "one hop" claim in the operational-definitions bullet + threat
      model) + declassification-gate build rider recorded in §V. Codex: review-clean.
- [x] Seth ratification (2026-06-18) — RATIFIED. The keystone third party (the unconsenting
      bystander) joins the consenting principal and the one who is ending in the
      constellation's account of who is owed care. **Principal-policy item (one-directional):
      the §IV provider-eligibility policy** — Seth may set terms *at or above* the doctrine's
      non-waivable baseline (stricter, or disable remote egress), never below.
- On ratification: propagate the principle into the Charter's common law alongside
  *Recognition Without Possession*; it then becomes a precondition the live copresence
  design (and any future perceiving capability in any room) must satisfy.
