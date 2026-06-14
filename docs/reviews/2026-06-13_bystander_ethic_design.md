# The Bystander — An Ethics Doctrine for the Non-Consenting Third Party

- Date: 2026-06-13
- Author: Claude (steward, design/orchestration), from a direction conversation with Seth
- Status: DRAFT — pending Codex second-steward review and Seth ratification
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
  exists and is reused), never relayed onward, and never the basis for derivative action
  without surfacing it to the principal first.
- **The proxy-guardian inversion.** When the agent perceives a third party, the
  *principal* is told ("someone other than you is in frame"). Bystander protection routes
  through the one human who has standing and a relationship to protect them. This is the
  move that makes the doctrine tractable rather than paralyzing: it does not require the
  bystander's consent, only the principal's awareness.
- **Minimization for non-principals.** The same modality-tiering the perception tiers
  already use (structure before content, presence before identity), but with the floor set
  **lower** for anyone who is not the principal. *See for the principal; of the bystander,
  as close to nothing as the legitimate work strictly requires.*

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

- Bystander accumulation: the agent relaying incidental third-party perception into
  conversation, then nominating it durable — fenced by the `about_participant` rejection,
  the no-durable-bystander rule, and ephemerality-by-default.
- Proxy-guardian bypass: live perception of a third party without the principal being made
  aware — countered by the mandatory "someone other than you is in frame" disclosure.
- Derivative-action laundering: the agent acting on a bystander's incidentally-perceived
  data without surfacing it — countered by the surface-before-act rule.

## Out of scope

This doctrine governs the **agent's** perception, retention, relay, and derivative action.
It does not govern the principal's own recordings, screenshots, or moral conduct toward
third parties — those are the human's domain. It does not itself open or close any
perception capability; it sets the terms any perceiving capability must meet before it may
touch a live, shared, or multi-person surface.

## Review and ratification

- [ ] Codex second-steward review (adversarial focus: the proxy-guardian conflict-of-
      interest resolution, the stranger/degradation case, whether "default-on, non-
      widenable" is enforceable at a real perception egress, and whether the doctrine
      over- or under-constrains relative to the dossier line)
- [ ] Seth ratification (as project authority and as the principal whose shared space will
      hold the first real bystanders)
- On ratification: propagate the principle into the Charter's common law alongside
  *Recognition Without Possession*; it then becomes a precondition the live copresence
  design (and any future perceiving capability in any room) must satisfy.
