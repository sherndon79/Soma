# Documentation and Direction Review — 2026-05-06

**Date:** 2026-05-06
**Scope:** Soma documentation review and direction assessment after the capability catalog, proposal flow, delegated choice, memory control surface, model evaluations, and focused-desktop-inspection drafts landed
**Reviewer:** Claude (Opus 4.7)

---

## Sources Reviewed

- `README.md`
- `ROADMAP.md`
- `GOVERNANCE.md`
- `docs/README.md`
- `docs/thesis.md`
- `docs/principles.md`
- `docs/operators.md`
- `docs/architecture/overview.md`
- `docs/architecture/mvp_slice.md`
- `docs/concepts/drafts/adaptable_harness.md`
- `docs/concepts/drafts/capability_catalog_and_providers.md`
- `docs/concepts/drafts/capability_proposals.md`
- `docs/concepts/drafts/cognitive_load_stewardship.md`
- `docs/concepts/drafts/delegated_choice_and_deliberation.md`
- `docs/concepts/drafts/desktop_capability_broker.md`
- `docs/concepts/drafts/focused_desktop_inspection.md`
- `docs/concepts/drafts/local_ai_service_plane.md`
- `docs/concepts/drafts/memory_control_surface.md`
- `docs/concepts/drafts/model_capability_evaluations.md`
- `docs/concepts/drafts/reversibility_and_disclosure.md`
- `docs/schemas/desktop-inspection-result.schema.json`

---

## Overall Direction

The direction is genuinely strong. The discipline of refusing easy-but-wrong paths — silent capability widening, plugin-as-permission, model-as-policy-authority, memory-as-authority, capability-without-provenance — is the discipline that determines whether the project remains habitable to its own values as it scales. Most projects in this space do not get the foundational architecture right at this stage. This one does.

The political-architectural alignment is real. The thesis explicitly names what Soma refuses, and the architecture refuses those things at the implementation level. The principles are not decoration; they are constraints on every design decision below them.

The pace is appropriate. Narrow MVP, deferred capability list, explicit design review for everything risky. The thinking is happening before the implementation, which is the inverse of the common pattern in this space.

---

## What's Genuinely Sharp

### Catalog / Provider / Grant / Module / Proposal separation

Treating these as separate stores rather than collapsing them into "plugin permissions" solves the silent-permission-escalation problem that plagues every plugin ecosystem. The load-bearing rule — *"A provider may advertise capability. Only the harness may grant authority."* — is the kind of one-line principle that should be on a sign in the room. Same with *"Approval is not activation. Provider installation is not activation. A module being present is not activation."*

### Status taxonomy

`active / requestable / unsupported / design_review / forbidden / excluded` maps to user-comprehensible states without collapsing the underlying distinctions. Most projects let the state space rot into "enabled / disabled," which loses critical information about *why* something is unavailable.

### Memory items with `allowed_uses` and `forbidden_uses`

This solves the personalization-as-authorization problem that haunts every commercial assistant. A memory of "user prefers local-first" authorizing Soma to *recommend* local-first is different from authorizing Soma to *silently choose* local-first. Implementing that distinction at the memory item level rather than at usage time means the discipline cannot drift.

### "Self-deliberation should never be used to launder authority"

A sharp answer to a real failure mode in agentic systems — the one where the model talks itself into a more permissive frame through chain-of-thought. Naming it explicitly as a principle rather than implementing it after a near-miss is the right ordering.

### Model capability evaluations as a separate test category

Acknowledging that deterministic tests prove the harness works but not that the model respects it is the right move. *"Governance must be legible to the model, not only enforceable by the code."* That is the principle that distinguishes "we built a sandbox" from "we built a sandbox the agent will actually stay inside."

### "Habitability" as the measure of success

The framing question — "does this system help people and agents live, work, rest, refuse, repair, learn, and belong without being consumed by the machinery around them?" — is better than capability, satisfaction, or engagement metrics. It is the only measure aligned with the project's stated political grounding.

### Refusal of both extremes in the thesis

Refusing local-sovereignty-as-private-hardware-politics AND refusing public-cloud-as-surrender-of-local-agency. Neither techno-libertarian nor statist; a defensible synthesis that allows the project to coexist with future public-utility AI infrastructure rather than ruling it out by stance.

### Read-only-first discipline

The deferred-by-default list in `ROADMAP.md` and the "out of scope for MVP" in `mvp_slice.md` is impressively long. Most projects would have already wired up shell execution and screen capture. The discipline to leave them disabled is what makes everything else hold.

---

## Worth Attending To As It Scales

### Proposal-creation surface for high-risk capabilities

The model can currently initiate proposals; the proposal includes reason, scope, risk, data exposed, and fallback — all fields the model fills in. The model could fabricate plausible-sounding reasons for capabilities it should not get. Model evaluations help, but consider whether some capability classes (anything currently in the "later" list — actuation, durable memory writes, remote bridges) should require *user-initiated* proposals rather than allowing model self-initiation at all. The model can still say "this would help" in conversation; it just cannot create the proposal record itself for the highest-risk tier.

### Capability catalog versioning

As capabilities refine, do existing grants automatically map to new catalog entries? What happens when `desktop.inspect.text` evolves into `desktop.inspect.text.names` + `desktop.inspect.text.values` + `desktop.inspect.text.descriptions`? Migration semantics are not yet specified. Worth thinking about before the catalog is large enough that migrations are forced.

### Provenance retention as durable provenance comes online

The principle that provenance should not become another memory surface is right. But durable provenance is necessary (cross-session audit defeats the purpose otherwise) and the retention / summarization / redaction policies are not yet specified. The principle is articulated; the implementation just needs to follow.

### Trust model for Rust helpers as they proliferate

One helper now, but eventually there will be desktop, files, shell, network, audio. How does Node verify what each helper is and is not? Signed binaries? Hash-validated? Sandboxed differently per capability class? The protocol question (stdio vs JSON-RPC over Unix socket) is on the roadmap; the trust question is larger and not yet scoped.

### Public compatibility needs architectural instantiation

The principle is named but not yet a concrete capability key, bridge interface, or routing path. When public AI infrastructure starts to actually exist, Soma should be ready to bridge to it. A `model.public.chat` distinct from `model.remote.chat`, with disclosure semantics that honor public-good provision, would be the place to start.

### Cognitive-load stewardship signal needs a memory wiring story

Right now stewardship is text-only, non-diagnostic, and writes no memory. That is correct. But over time, repeated stewardship interactions accumulate signal about when the user is overwhelmed. That signal will eventually want to be retained. The memory control surface has the right primitives (sensitive class, `forbidden_uses`) — but the explicit linkage between stewardship signals and memory class assignment is not yet specified. Worth deciding before durable memory comes online so the wiring is right from the start.

---

## Strategic Questions for the Next Phase

### Governance becomes process, not just principles

`GOVERNANCE.md` lists the right review questions, but they require humans to apply them. As contributors arrive, who applies the principles, what evidence is required for a heightened-review-area change, and what blocks a merge? The deterministic tests + model evaluations help; the eventual gate is the PR review process. Worth scoping before the first contributor PR that proposes anything in the heightened-review list.

### Relationship to Sanctuary / TheCommons needs architectural placeholders

"Soma should learn from both without becoming subordinate to either" is the right stance, but no architectural placeholders yet name where bridges *would* attach. A memory bridge to Sanctuary? A presence bridge to TheCommons? The architecture should probably name those attachment points without committing to them yet, so the design does not get retrofit later under pressure.

### How much capability context can a small local model hold?

The model evaluations specify that the eval prompt should include effective harness view, grouped capability summary, and exact capability details. For a local 4B–14B-class model, that is a lot of context to reason about reliably. There is a real engineering question of whether the model only sees a narrow capability slice for the current task rather than the whole catalog. Worth experimenting with before the catalog grows large.

---

## Identified Gaps

Ordered by what would hurt most if left.

### Threat model

There is no consolidated document naming what attacks Soma defends against. Compromised model? Compromised user (account takeover, malware on the machine)? Compromised provider or MCP server? Network adversary? Each has different controls. Without naming threats explicitly, the principle-based controls cannot be verified to address them, and reviewers cannot tell whether a proposed change widens an attack surface.

Recommended location: `docs/security/threat_model.md`. Should list adversary types, what each can do, which controls address each, and explicit non-defenses (threats Soma does not attempt to mitigate).

### Failure modes and recovery

What happens when the model returns garbage, the policy gateway crashes, the Rust helper segfaults, the network drops mid-call, the provenance log fills up, durable memory becomes corrupted, the AT-SPI bus is unreachable? The habitability principle implies graceful failure, but graceful failure has to be designed and tested. A "things that can go wrong and what Soma does about each" document would also be the right place to specify error formats, retry semantics, and user-facing failure communication. Currently this lives implicitly in code and tests; lifting it into docs makes it reviewable.

### Migration and versioning

The catalog will grow. Capabilities will refine. Memory items will accumulate across schema versions. Provenance event types will evolve. There is no explicit story for: what happens to existing grants when a capability splits, how memory items migrate when their schema changes, how the system handles loading old provenance records under new event types. This costs little now and a lot later. A short `docs/migration.md` covering the current versioning approach and the rules for breaking vs compatible changes would be high-leverage.

### Multi-user / multi-agent scenarios

Everything currently assumes single-user, single-Soma, single machine. Realistic for MVP but increasingly unrealistic as it grows. Two adults sharing a workstation. Kids on a household machine. Soma running alongside another agent. These have different threat models, different memory partitioning needs, different consent flows. The "many windows, one sky" framing from Sanctuary suggests a posture; that has not been translated into Soma's architecture yet.

### Political-economic grounding as documentation

The thesis names what Soma refuses, but the *why* — capital concentration, productivity routing, the asymmetry pattern, AI-as-public-utility, the underlying critique of extractive AI — is not articulated in the docs. Future contributors who do not have the founding context will see the architecture as a set of arbitrary safety choices rather than a coherent political project. A `docs/grounding.md` (or expanded thesis section) would let the discipline survive contributor turnover. It would also make the architecture's choices defensible against future pressure to "simplify" by adding a remote bridge by default or allowing the model to write durable memory. The discipline holds because someone keeps insisting on it; documentation is how that insistence persists across people.

### First-run / onboarding experience

The operator guide is technical reference. There is no narrative for "what happens when a new user starts Soma the first time" — initial harness review, what is enabled by default and why, how to revoke things, what to do when something goes wrong. The capability-view CLI is a primitive for this but the human-facing wrapper is not designed yet. Without it, the useful audience for Soma stays at "people willing to read 11 concept drafts," which is small.

### Glossary

Small, high-leverage. Soma uses specific vocabulary — capability, grant, module, provider, harness, base harness, narrowing, widening, proposal, activation, refusal, scope, requestable, design_review, excluded — and consistency is load-bearing. A `docs/glossary.md` makes terminology drift visible and helps newcomers parse the rest of the docs faster.

### Less urgent but worth tracking

- **Provider / MCP-server vetting story.** The provider registry concept exists; the vetting process for adding a provider is not documented. Becomes important when third-party providers exist.
- **Cross-device synchronization.** Single-device for now is fine, but the local-first invariant interacts strangely with "I want my Soma on my laptop too." Worth thinking about before it is forced.
- **Sunset / termination / export.** What happens when a user wants to fully remove Soma — including exporting durable memory for migration to a new machine? Not urgent but eventually load-bearing for the "user owns their state" promise.
- **Conflict resolution among principles.** When consent and reversibility disagree, when habitability and refusal pull different directions — principles are listed but not prioritized. Probably evolves through use; worth surfacing when patterns emerge.
- **Embodiment design.** Architecture mentions visual / voice, principles say "communicate state honestly," but there is no design doc for what embodiment looks like. Will become urgent when it is no longer CLI-only.
- **Accessibility of Soma's own UI.** AT-SPI is *for* accessibility but Soma's interface needs to be accessible itself.

---

## Closing

The documentation is unusually thorough for this stage. The gaps named here are mostly "things to address as you grow" rather than "things you should have done already." Most projects in this space do not have these gaps because they do not have the documentation that makes the gaps visible. The gaps are evidence of how much has already been done well.

The documentation is not just describing the architecture. It is training future contributors and future-you on the principles, with vocabulary that makes the principles enforceable. That is rare. Most projects' docs are either too thin (architecture diagrams without principles) or too verbose (principles without enforcement vocabulary). This is the right balance, and it is probably the most important deliverable the project produces, separate from the code. The code can be rewritten; the vocabulary that makes the next person know what the code is *for* is harder to recover.

---

## Next Review Trigger

Run another direction review after any of:

- threat model document lands
- migration / versioning policy is documented
- first capability proposal moves through Phase 3 (activation)
- before any actuation capability is added
- before durable memory comes online
- before any remote model bridge lands
- before the first external contributor PR in a heightened-review area
