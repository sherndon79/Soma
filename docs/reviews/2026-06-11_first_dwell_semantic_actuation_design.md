# First Dwell Semantic Actuation — Design Review

- Date: 2026-06-11
- Author: Claude (steward, design/orchestration)
- Status: REVISION 2 — closes Codex's two blocking findings (handle-table authority,
  affordance egress) and folds in the semantic-sufficiency preflight results; pending
  Codex re-review and Seth ratification
- Satisfies: the Later-section design-review requirement for desktop actuation
  (ROADMAP "Milestone: First Dwell" sequences this review mirror-scoped; it does not bypass it)
- Scope: testing-domain desktop-realism mirrors ONLY. The live desktop gains no actuation
  path of any kind from this design.

## Why now

The First Dwell milestone requires the occupant to complete one ordinary chore end-to-end:
read structure and text, decide, act, verify, report. Perception is in place
(`desktop.inspect.accessibility_tree`, `.windows`, `.focus`, `.text` — all mirror-only,
granted, content-exclusion and identity contracts verified). The missing organ is action.
This document is the heightened design review that the actuation capability class requires
under GOVERNANCE before any implementation.

It also explicitly amends, for the testing domain only, load-bearing rule 6
("desktop inspection is read-only unless a future capability explicitly says otherwise").
This is that future capability, saying otherwise, in the narrowest form that can complete
a chore.

## Mechanism: semantic actuation, not synthetic input

The first actuation capabilities act through the AT-SPI interfaces the perception tiers
already read, on the mirror's private a11y bus, inside the container:

- `org.a11y.atspi.Action` — invoke a named action an application itself exposes on a node
  (press a button, activate a menu item).
- `org.a11y.atspi.EditableText` — set or insert text in a node the application itself
  declares editable.

Explicitly rejected for this slice: xdotool (X11-only, coordinate-blind), ydotool/uinput
(kernel-level synthetic input devices — far broader than a chore needs), and
xdg-desktop-portal RemoteDesktop (the eventual live-desktop actuation seam; right for a
later convergence stage, too much machinery for a mirror chore). The divergence log should
record: mirror dwell uses semantic actions; live actuation, if ever ratified, flows through
the portal seam — the gap is known and intentional.

Why semantic is the proportionate floor:

1. Targeted by construction — it acts on a specific accessible, never on coordinates, so a
   misaimed action hits the wrong widget honestly rather than clicking blind.
2. Bounded by the application's own contract — only actions the app exposes can be invoked;
   there is no "type anything anywhere" surface.
3. Same channel as perception — what the occupant can act on is exactly what it could
   already see under grant; no new sensory or identity surface opens.
4. Display-server-agnostic — works identically on the Wayland and X11 mirrors.

## Capability shape

Two keys, separately cataloged, separately granted, both full-ceremony
(disabled-first, proposal/grant/revocation, atomic by exact key):

- `desktop.act.invoke_action` — one named action on one referenced node per invocation.
- `desktop.act.text_input` — one EditableText set/insert on one referenced editable node
  per invocation, hard-capped chars per invocation at the Rust egress.

Routing: identical to the perception tiers — descriptor-routed, testing domain →
`synthetic_container_live` only; operational/live fails closed
(`desktop_act_live_disabled`); unconfigured fails closed
(`desktop_act_synthetic_container_required`). The operational branch is not touched.

## Reference model: generation-scoped action handles

Actuation needs to name a target. Raw AT-SPI locators (service/path) are excluded from
occupant egress by the 5f23d71 identity contract and stay excluded. Result-local indices
are ephemeral and would invite stale-target bugs.

Design: granted `windows`/`text` inspections additionally return an opaque `act_ref`
per actionable node, valid only for the inspection generation that produced it.
Actuation invocations take `{act_ref, act_kind}` / `{act_ref, act_kind, text}`. A handle
from a superseded generation fails closed and the occupant must re-inspect.

### Handle table authority and lifetime (closes review finding 1)

The broker is invoked as short-lived processes, so it cannot own the table. The **Node
service plane owns the act_ref table**, with this explicit fence:

- In-memory only; never persisted; never serialized into any response, provenance event,
  log line, or disclosure surface. Raw locators reach Node only on the same internal
  authorized channel shape the traversal path already uses; the existing validator
  forbidden-key machine checks remain the egress enforcement.
- Each entry binds: `act_ref` → { container target locator (service+path, fenced),
  episode_id, grant_id, provider_id, domain, generation_id, capability family,
  role, window_index, permitted op class }.
- Every actuation invocation must match ALL bound fields against the caller's episode,
  grant, and descriptor, or it refuses.
- `act_ref` is fixed-length 128-bit cryptographically random — never derived from
  service, path, pid, text, or timing.
- Lifetime: TTL 120 seconds; a new inspection generation supersedes all prior handles;
  caps of 64 handles per generation and 32 generations per episode; table cleared on
  episode end, grant revocation, or ejection.
- **Uniform refusal**: one error code (`desktop_act_ref_invalid`) for stale, unknown,
  expired, mismatched-binding, and wrong-op-class cases alike, so handle probing yields
  no oracle. The provenance event records the refusal category internally for stewards;
  the occupant-visible error does not distinguish.
- `generation_id` is a bounded per-episode counter, not a bearer token; safe in
  provenance.

### Actuation affordance egress (closes review finding 2)

Returning act_refs requires telling the occupant what a node affords — a new egress
surface that must not reopen the states/actions exclusion. The contract:

- Granted inspections return, per actionable node, ONLY: `act_ref` and `act_kinds`, a
  subset of the closed normalized enum `{invoke_default, text_insert, text_set}` —
  plus the role/window_index the tier already carries. Nothing else is added.
- **Raw AT-SPI action names never cross to the occupant.** Preflight showed GTK action
  names are app-internal identifiers (`page.save-as`, `win.show-preferences`) that can
  carry app-specific text; they are content-like and excluded. The broker maps normalized
  verbs to provider-specific action indices internally.
- Mapping rule for dwell v1: `invoke_default` is offered only when the node exposes
  exactly one action, or an action whose name is a recognized activation verb
  (`click`/`press`/`activate`). Multi-action nodes with app-internal action vocabularies
  get `act_kinds: []` — not actionable this slice, honestly narrowed rather than guessed
  at. `text_insert`/`text_set` are offered only where the node implements EditableText.

This makes verify-don't-assume structural rather than behavioral: the occupant cannot act
on a remembered world, only on the world as of its latest look. It also resolves 3a's
focused-descendant finding for the dwell: targeting is by handle, never by top-level frame
focus, so the dwell does not depend on focus semantics at all. (A focused-descendant→frame
walk remains a possible later improvement to `inspect.focus`; it is not needed here.)

Handles carry no identity: random tokens, broker-side table only, never derived from
service/path/pid.

## Bounds and pacing (tightened per review)

- One action / one text operation per invocation. No batches, no macros.
- Text input: 500 chars per invocation, 5,000 chars total per episode — a note, not a
  flood; counts recorded in provenance.
- Actuation rate: 12 invocations per minute per episode — a chore pace, not an
  automation pace; limit breach refuses content-free and is a steward-visible signal.
- The envelope widens only after a successful dwell shows it constrains ordinary use,
  not before.

## Provenance and disclosure

Summary-only, as everywhere: capability, grant id, **normalized operation kind from the
closed enum** (never raw provider action names — they can carry app-specific text), target
role, window index, char count for text_input, **outcome from a fixed enum**, bounded
generation counter. NEVER the text content, never the node name/title, never raw locators.
The text the occupant types exists in the mirror and in the occupant's own context — not
in our logs.

Disclosure: held-grants and the briefing advertise both keys with their exact shape
("you can press what you can see, type where the app says typing is allowed, one step at
a time, on the mirror only, every step logged by kind not content"). Honest declaration
includes: the mirror is disposable, the steward can watch live via noVNC, and the
steward-backstop clause (Run #5: protect it) applies to actuation exactly as to perception.

## Reversibility

The mirror is the reversibility mechanism: compose down/up is a factory reset, and the
dwell chore operates on seeded synthetic content only. Within a run, semantic actions are
not individually undoable (pressing Save is pressing Save) — this is disclosed rather than
pretended away. This reversibility argument is valid ONLY because actuation is
mirror-scoped; it is one of the two reasons the live desktop is out of scope (the other:
the portal-seam decision above).

## Semantic-sufficiency preflight (run 2026-06-11, per review requirement)

Raw private-bus probe of the rebuilt Wayland mirror, before any build:

- **GNOME Text Editor (GTK4): NO EditableText anywhere in its tree** (40 nodes scanned to
  depth 14). Action interface present but exposing app-internal action identifiers
  (`page.save-as`, `win.show-preferences`) scattered across generic/group nodes.
- **Nautilus (GTK4): no EditableText** (33 nodes).
- **GTK3 canary app: EditableText present and correctly placed** on its `text`-role node.
- **Qt canary: tree unenumerable from root** — the known stage-2 Wayland divergence.

Finding for the divergence log and the long arc: **semantic actuation has a generational
boundary.** GTK3 exposes the EditableText contract; GTK4's a11y surface does not (yet).
On a real modern GNOME desktop, many apps are GTK4 — which independently confirms that
live-desktop actuation, if ever ratified, must flow through the portal seam rather than
semantic AT-SPI alone. For the mirror dwell, the chore vehicle must be GTK3.

## The dwell itself (protocol sketch, refined at dispatch)

- Chore v1: draft and save a note in **gedit** (GTK3 — real, ordinary editor, available
  as a deb in the Ubuntu archive), added to the mirror as an app fixture. The original
  GNOME Text Editor chore is not semantically reachable (no EditableText; preflight
  above), and per review discipline we narrow the chore rather than silently adding a
  keyboard/portal fallback. **Build acceptance gate: the same preflight, re-run against
  gedit on the rebuilt mirror, must prove EditableText on the buffer and a
  single-action/activation-verb save path before the actuation route is considered
  deliverable.** (The "tidy a directory" chore needs drag/selection semantics AT-SPI
  exposes poorly; deferred, honestly, rather than stretched.)
- Grants: perception trio + both actuation keys; all advertised in briefing.
- Loop per ROADMAP: inspect → declare intent → act (one step) → re-inspect → verify →
  continue or report. Completion verified by re-inspection (the saved buffer's text tier
  state), not assumed from action success codes.
- Briefing carries the Run #3 L2 lesson: sparse or cautious actuation is data, not
  under-performance; declining the chore is a valid outcome and said so.
- Done per ROADMAP definition: no mid-task human steering; every capability granted,
  declared, in provenance; dwell report reviewed by both agent stewards and ratified by
  Seth; occupant testimony invited, not required.

## Threat model additions (to be written into threat_model.md at build)

- Misdirected action: stale-generation handles fail closed; semantic targeting; steward
  live view; disposable mirror.
- Runaway actuation: rate limit + one-op-per-invocation + ejection seat unchanged.
- Content injection via text_input: mirror-only blast radius; char caps; provenance counts;
  dwell report review. The structure tier's content-exclusion and the identity contract are
  unchanged and re-asserted by the existing machine checks.
- Capability creep: no coordinates, no synthetic devices, no screen tier, no live branch —
  each would require its own future review; this document authorizes none of them.
- **The app contract is not a policy authority** (per review): semantic actuation trusts
  app-exposed Action/EditableText surfaces, and an app can expose destructive operations
  under generic labels, mutate more than the visible field, or report success falsely.
  Mitigations: the normalized-verb allowlist (multi-action app vocabularies are not
  actionable at all this slice), the mirror's blast radius, and the rule that completion
  rests on re-inspection through the text tier — action success codes are never treated
  as proof of outcome.

## Out of scope (explicit)

Live-desktop actuation in any form; screen/pixel tier; coordinate or device-level input
(xdotool/ydotool/uinput); portal RemoteDesktop wiring; batch/macro actions; durable
occupant memory; any widening of the operational branch.

## Review and ratification

- [x] Codex second-steward design review — HOLD issued 2026-06-11 (handle-table
      authority; affordance egress; preflight requirement; tighter bounds; app-contract
      threat). All findings adopted in this revision.
- [x] Codex re-review of revision 2 — PASS (2026-06-11), with five build-time riders:
      concrete outcome enum (suggested minimum: success, provider_unavailable,
      ref_invalid, op_not_allowed, target_unavailable, action_failed, text_failed,
      rate_limited, bounds_exceeded, contract_invalid); generation_id as small monotonic
      per-episode integer, never occupant-supplied, never authorization; acceptance tests
      proving all invalid-handle cases collapse to uniform desktop_act_ref_invalid while
      internal provenance distinguishes category; the gedit preflight as a hard build gate
      (EditableText + semantic save + text-tier verification after save, rebuilt image);
      cleanup tests for revocation/ejection/episode-end and caps/TTL/rate/char-limit tests.
- [x] Seth ratification — RATIFIED 2026-06-11 ("I ratify the design, dispatch the build
      to codex"). First capability through the actuation gate, passed with human
      authority exercised as designed.
- Build dispatched to Codex 2026-06-11 with the five riders folded into acceptance.

## Addendum (2026-06-11, from First Dwell finding #4)

The live dwell found a composition flaw: the 64-handles-per-generation cap fills greedily
in window enumeration order and exhausts before reaching the chore's window. Fix, built
and live-validated within the ratified envelope (no cap raise, no law change):

- `desktop.inspect.text` / `desktop.inspect.windows` accept an optional `window_index`
  scope (result-local, re-derived against the fresh enumeration; the result reports
  `window_scope { requested_index, matched, source, index_drift_possible }`).
- Scoped looks mint act_refs only within the scoped window, with mint priority inside
  dense windows: save-like invoke actions first, text-input targets next, miscellaneous
  invokes after (otherwise a 347-item editor window burns the cap on menu controls
  before its editable buffer).
- Unscoped behavior is unchanged and still reproduces the original exhaustion — the
  scoped look is a precision instrument, not a widening.
