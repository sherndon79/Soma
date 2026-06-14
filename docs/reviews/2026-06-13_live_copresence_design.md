# Live Copresence — Threshold Design

- Date: 2026-06-13
- Author: Claude (steward, design/orchestration), from a direction conversation with Seth
- Status: DRAFT — pending Codex second-steward review (on his return) and Seth ratification
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

## Threat model additions (to threat_model.md at build)

- Habituation: arming that's too easy becomes ambient surveillance by erosion — the
  indicator-never-lies rule plus disarmed-by-default-on-restart are the counters.
- Accumulation laundering: occupant relaying live structure into conversation, then
  nominating it durable — the memory-class scanners and the about_participant rejection
  are the existing fences; the live grant adds episode-content provenance flags.
- Remote egress creep: structure leaving the house without fresh awareness — the
  remote-chat grant boundary plus disclosure copy naming it explicitly.

## Out of scope

Live text/windows/focus/screen tiers; live actuation; inference-box specification;
continuous/daemon operation (sessions are armed, finite, and end); any occupant memory
class widening; anything touching testing-domain behavior.

## Review and ratification

- [ ] Codex second-steward review (adversarial focus: the arming model's failure
      modes, the live-grant/armed-session conjunction logic, accumulation laundering,
      and whether the structure tier leaks more on a real desktop than the mirror
      suggested)
- [ ] Seth ratification (the inversion makes this doubly his gate: as project authority
      and as the person being seen)
- Build dispatches only after both. No urgency: the threshold deserves the wait.
