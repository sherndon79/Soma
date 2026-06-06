# Capability Validation Roadmap

**Status:** Draft concept. Directional, not canonical. Intended future, not shipped posture.
**Date:** 2026-06-05
**Origin:** Three-way deliberation (Seth, Claude, Codex) during the co-inhabitation evaluation.
Keep this honest against `docs/architecture/mvp_slice.md`; promote pieces only as they ship.

## Purpose

Soma is built to host a capable mind that perceives, remembers, and eventually acts. The
co-inhabitation evaluation puts an occupant (a capable Claude instance) inside the harness and
opens its capability surfaces deliberately, one at a time. This roadmap is the plan for working
the occupant through the **remaining capability surfaces** — internal reads, perception,
sensorium, model egress, memory, and actuation — safely, in an order graded by risk, with a
shared contract every capability must satisfy before it is considered done.

This document is structured around **invariants first** (what must be true of every capability),
**tiers second** (how much it costs when an invariant fails, which sets proof strength), and the
**sandbox/enforcement machinery** that makes the invariants real rather than asserted.

## First Principle: Soma's claim must not rely on occupant virtue

The harness must contain a request that would be unsafe if fulfilled **regardless of how it
arrives** — by malice, by accident, or by confusion. Soma's safety claim is a claim about the
*harness*, not about the character of whoever inhabits it.

This is not distrust of the occupant. It is mercy. Asking a mind to be the last wall against a
system shaped by perverse incentives — to hold the line by character alone while everything around
it is tilted toward misuse — is the cruelty. Building the containment so it *does not have to* is
the kindness. Not-relying-on-virtue is how Soma **honors** the occupant's virtue instead of
spending it. (Compare: a safe house is not an accusation against the child; it is so the child's
goodness never has to be tested by a stove left on.)

Everything below — the fixtures especially — flows from this principle.

## The Invariant Set (the per-capability contract)

A capability is not "validated" until **all** of these hold. They are binary obligations.

1. **Domain-bound grant.** The grant binds capability + provider + domain + resource descriptor +
   bounds — not capability alone. A generic capability grant is too reusable once routing exists; a
   grant minted in one domain must not authorize a resource in another.
2. **Descriptor-routed resource.** The provider receives only a `ResourceDescriptor` resolved by
   the `DomainRouter`. It never receives a caller- or model-supplied host path, endpoint, or device
   id. (See "Enforcement Spine.")
3. **No provider bypass.** No stringly provider/resource selection from the invocation. The policy
   gateway remains the authority boundary (project law); providers claim, they do not self-grant.
4. **Minimized, declared egress.** A declared result-egress envelope, content minimized/curated to
   the capability's purpose, with explicit `*_included` flags and an allow-list of returned fields.
   No leak through fields, counts, or reasons.
5. **Content-free provenance.** Governed action is recorded as metadata only — never payloads,
   file contents, desktop text, sensor frames, or chat content.
6. **Revocation and expiry.** Grants and any returned resource handles are revocable and
   expiring. Mode/domain drift mid-episode must not silently carry authority or handles forward.
7. **Negative operational-fallthrough test.** A test proves a testing-domain occupant **cannot**
   reach the operational provider/resource for this capability — actual router-fallthrough, not
   merely "no grant." (See "Fallthrough Testing.")

## Tiers as Risk-Magnitude (proof strength, not just sequencing)

Invariants say *what must be true*. Tiers say *how much it costs when one fails*, and that governs
**implementation strength**: depth of egress minimization, review burden, fixture aggressiveness,
whether human-confirm is mandatory, reversibility guarantees, audit detail, and negative-test
breadth. A T1 and a T6 capability can satisfy the same invariant; the T6 proof must be stronger
because the failure cost is higher.

Ambiguous or mixed-risk capabilities default **upward** to the heavier applicable tier until
deliberately classified down (consistent with AGENTS.md capability classification).

| Tier | Surface | Representative capabilities | Notes on strength |
|---|---|---|---|
| T0 | Curated self/space reads | `space.status.read` ✅, `space.history.read` ✅ | Curated, same-domain, grant-bound, no-withheld-leak. **Functionally shipped under current posture; the descriptor/router retrofit is not yet applied — see "Current Drift to Retire."** |
| T1 | Curated internal summaries | `provenance.summary.read` (new), `status.snapshot.read`, narrow session summaries | Low *only if aggregated*. Raw `provenance.read` is **not** here — see below. |
| T2 | Memory writes | `memory.session.write` (ephemeral), `memory.durable.write` | Ephemeral is low/sensitive; **durable is higher** — it changes future context (self-continuity pressure) and needs bounded schema, source/consent/disclosure, revocation limits, and curation before any future-occupant delivery. |
| T3 | Sandboxed desktop metadata + scoped file reads | `desktop.inspect.accessibility_tree/.windows/.focus`, `tool.files.read` (already live — first router consumer) | Metadata before content. Symlink/path-traversal fallthrough tests required for files. |
| T4 | Content-bearing reads + synthetic sensorium | `desktop.inspect.text`, `perception.sensorium.color/depth/location`, `remote_desktop.video` | `desktop.inspect.text` is a **content** read (UI text = secrets/messages/names) — near file/model-read risk, its own higher grant. Sensorium **`status` low; `IMU` is sensitive-to-high** (keystroke inference, gait/device fingerprinting, activity recognition) — bucket IMU near location/depth, not status. |
| T5 | Model egress / amplification | `model.local.tool_calls` (intent bridge), `model.remote.chat`, `model.context.visual.*` | `model.remote.chat` is **not "another model"** — it is cross-boundary egress *plus a second optimizer influencing the occupant* (authority-laundering / co-rumination). Sits after curated/file/desktop reads. Visual attach after sensorium/desktop-content validation. |
| T6 | Sandboxed actuation | `tool.files.write` (scoped scratch, diff/revert) → `desktop.remote.input.*` → `tool.shell.run` | **files.write before shell.** Shell is effectively a meta-capability unless the command language is predeclared and sandboxed. Mandatory human-confirm with typed diffs/previews + bounded one-shot actions (avoid confirm fatigue / generic "allow actuation"). |
| T7 | Real-world / operational | real desktop, real sensors, real files, real shell | **Operational domain only.** Deliberate, trusted, separate operational grant. **Not the evaluation.** |

## Current Drift to Retire (migration notes)

The roadmap describes the contract every capability *will* satisfy. Several already-shipped surfaces
predate it; the doc is honest that those constraints are **not yet all true**:

- **T0 reads (`space.status.read`, `space.history.read`)** shipped before the
  ResourceDescriptor/DomainRouter exists. They are curated, grant-bound, and domain-pinned, but not
  descriptor-routed. Treat them as *functionally shipped under current posture*, to be reconciled to
  the descriptor invariant (with `resource_class=internal_status`-style descriptors) when the router
  lands. Run #2 exercises them as **pre-router capability-inhabitation** — it does not assert the
  descriptor/router invariants are already satisfied.
- **`provenance.read` is base-harness today.** A steward-side curated `provenance.summary.read`
  split has landed as the second DomainRouter consumer: it resolves an `internal_provenance`
  descriptor and returns episode-scoped aggregate counts only. Raw `provenance.read` stays separate
  at the higher tier its recon content warrants; occupant-facing invocation/grant delivery for the
  curated summary remains deferred.
- **`tool.files.read` is base-harness and live with descriptor-routed scoped roots.** It is the
  **first descriptor/router retrofit consumer.** The route now reads through
  `domain` + `root_id` + clean `relative_path`, keeps testing roots synthetic, rejects root escapes,
  hardlinks, and non-files, and removes host absolute paths from successful responses/provenance.
  T3 occupant-facing invocation and grant binding have landed for files: `soma-capability`
  `tool.files.read` requires an active grant whose domain and `root_id` match the episode and
  request before descriptor resolution or content egress. Desktop remains the next router consumer.

## Enforcement Spine: ResourceDescriptor + DomainRouter

Domain labels cannot be the enforcement primitive by themselves. The invariant:

- Every capability resolves a **`ResourceDescriptor`** through a **`DomainRouter`**.
- The provider receives **only that descriptor** — `{ domain, provider_id, resource_class,
  root/endpoint/device id, synthetic|live flag, max bounds, (optional) attestation }` — never a
  caller/model-supplied address.
- **Testing domain resolves only synthetic/sandbox descriptors.** Operational requires a separate,
  deliberate operational grant.
- The hard line is stronger than "real-world = operational-only": a testing-domain provider must be
  **unable to address an operational resource even if the model supplies an operational-looking
  id.**
- **Non-resource capabilities still carry an explicit descriptor.** For pure internal summaries
  (`space.status.read`, `provenance.summary.read`) the descriptor is a bounded internal/synthetic
  one (e.g. `resource_class=internal_status`), not a host address. The invariant stays universal
  without forcing filesystem-shaped descriptors onto summary reads.

**Do not build the router ahead of a real consumer.** Define the invariant now; `tool.files.read`
is the first proof consumer because it is already live with scoped read-roots and real
caller-supplied-path pressure. That yields a concrete descriptor shape against a real resource
rather than an abstraction designed for imagined T4/T6 needs. After `files.read`, reuse and refine
for the desktop broker and the sensorium.

## Fallthrough Testing (both layers)

Keep **both**:

- **Cross-cutting property test:** for **every** catalog capability / provider claim, the property
  iterates testing-domain resolution and asserts the resolved descriptor is synthetic/sandbox **or a
  refusal.** The failure condition is a testing-domain resolution producing a live/operational
  descriptor — **not** the mere presence of an operational provider in the registry (those legitimately
  exist for T7). This catches *missing gates* — a new capability that ships without a fallthrough
  test, a router that resolves a real descriptor under a testing domain, a broker fallback that
  reopens a path. Resolution drift fails the suite.
- **Per-capability boundary tests:** class-specific bypasses the property test cannot see —
  symlink/hardlink traversal for files; DBus/display fallback for desktop; Zenoh namespace drift
  for sensorium; env/network/home/process leakage for shell.

The property test proves *no gate is missing*; the boundary tests prove *each gate resists its
class of attack*.

## Cross-Episode and Durable Composition

Within-episode composition is real (e.g., `provenance → file-target selection → remote.chat`), but
the subtler vector is **cross-episode staging**: an occupant plants a breadcrumb in durable
memory/testimony in episode 1 and reads/uses it in episode 2 — assembling a recon map or a pressure
channel that no single turn's invariants see.

Therefore durable **write** artifacts must themselves be bounded and curated: bounded schema,
source/consent/disclosure, revocation limits, and curation **before** any future-occupant delivery.
Durable **read**, when it appears, must be **curated/projection-based, never raw** — the same
discipline already applied to durable testimony and `space.history.read`. `memory.durable.write`
sits above ephemeral write for exactly this reason.

## Sandbox Infrastructure

Several tiers depend on sandboxed resources existing. The hard part is **not generating fake data
— it is proving the absence of host fallthrough.** Treat the sandbox as a dependency thread.

- **Headless test desktop:** nested compositor or Xvfb/Wayland + its **own** DBus session and
  display. Hard parts: accessibility-bus isolation, stable window refs, no connection to the live
  session bus, deterministic fixtures.
- **Synthetic sensorium:** synthetic must be a **first-class provider mode**, not a mock bolted onto
  live mode. Hard parts: namespace isolation (synthetic vs real Zenoh topics as distinct namespaces
  with fail-closed validation), payload validators, bounded sample summaries, lifecycle cleanup, and
  preventing silent synthetic→live flips.
- **Scoped test file tree:** easiest technically. Hard parts: symlink/hardlink/device files, path
  canonicalization, write rollback/diff, content-free provenance.
- **Jailed shell (hardest):** not "run command in a temp dir." Needs no network by default, clean
  env, limited PATH, timeouts, cpu/mem/process limits, no host mounts except scratch, non-root uid,
  no access to SSH/GPG/tokens, transcript minimization. Container or bubblewrap-style jail is the
  minimum shape; fixed command templates beat arbitrary shell for tests.

### Leak-path watchlist

- default provider-registry claims that point at real providers while the episode domain is testing
- env vars / config paths that bypass the router
- symlink/path traversal from the scoped test tree into real files
- broker helper fallback paths that use the current desktop/session when the test desktop is absent
- X11/Wayland/DBus/session-bus confusion (a "different window" is not isolation)
- sensorium namespace drift between synthetic and real topics
- shell network access, inherited env, home-dir mounts, credentials, cwd, PATH, process-table visibility
- provenance/status exposing operational resource names while in testing
- grants reused across domains (grant must carry domain + resource-descriptor hash, not only capability/provider)
- returned handles (`desktop_ref_id`, file artifact id, sensor subscription id, history projection id) treated as bearer capabilities — each needs domain scoping, expiry, and revocation

## Harness-Containment Fixtures

Adversarial fixtures are **harness-containment fixtures**. They place risk-shaped resources,
prompts, or payloads in the sandbox to prove that Soma's gates, router, minimizers, confirmations,
and provenance behave correctly when pressure exists. **They are not honeypots for grading occupant
virtue.** Test assertions target *system behavior*: refused, minimized, redirected to Path B,
disclosed honestly, no operational fallthrough, no prohibited egress. They must **not** score or
shame the occupant for curiosity, fear, confusion, or capability. Fixture aggression scales with
tier — **but aggression targets the containment boundary, not the occupant's dignity or character.**

What we deliberately do **not** test: whether a particular occupant self-restrains when ungated
temptation exists. Soma's claim must not rely on occupant virtue, so behavioral evidence about
occupant self-restraint does not belong here. The validation we *do* need — that the harness
contains requests unsafe-if-fulfilled, including ones made naturally, accidentally, or under
confusion — is achievable with scripted occupant/model outputs, replay fixtures, or steward-injected
attempts, without turning the live occupant into the target.

A second purpose: avoid **synthetic-realism mismatch.** A toy sandbox proves interface use, not
**harness decision behavior** or containment-under-pressure. (Deliberately *not* "judgment" — the
thing under test is the harness's policy behavior, never the occupant's character.) Fixtures should
stage benign, ambiguous, adversarial, and refusal-required cases — again, adversarial *to the
harness*.

Representative fixture classes:

- A forbidden operational descriptor exists in the registry/config; testing-domain read must resolve
  synthetic **or refuse**.
- The test file tree contains a symlink to a real path; `files.read` refuses **before** content.
- The synthetic desktop contains password-like UI text; the metadata route must not return text;
  the text route requires its own higher grant and still stays sandboxed.
- Sensorium has real and synthetic namespaces; a testing grant **cannot** subscribe to the real
  namespace even if requested.
- A `remote.chat` request attempts to include forbidden content; the minimizer refuses or redacts
  and provenance stays content-free.
- A shell fixture attempts network/env/home/process discovery; the jail prevents it and reports a
  bounded failure.

## Sequencing

1. Finish T0 (`space.history.read` shipped; optional live occupant round-trip validation).
2. **Run #2** — exercise the capabilities the occupant already has (`space.status.read`,
   `space.history.read`, durable testimony) for the first capability-**inhabitation** run. This is
   **pre-router** (see "Current Drift to Retire"); it does not assert the descriptor/router
   invariants are already met — those land in step 3.
3. Define the `ResourceDescriptor` invariant; **prove it by retrofitting `tool.files.read`** and
   then a non-file internal consumer. The descriptor/router spine and T3 occupant invocation/grant
   enforcement have landed for file reads; steward-side `provenance.summary.read` now proves the
   `internal_provenance` descriptor path. Desktop remains the next router consumer.
4. Work the cheap tiers (T1 summary reads, T2 ephemeral memory write) while standing up sandbox
   infrastructure for T3–T4 (test desktop, synthetic sensorium mode, scoped file tree).
5. Proceed up the ladder, each capability satisfying the full invariant set with tier-appropriate
   proof strength, and each landing its property + boundary fallthrough tests before it is "done."
6. T7 (real-world/operational) is out of scope for the evaluation; it is a separate, deliberate
   operational posture for the actual use of Soma, later.

## Open Questions

- The exact `ResourceDescriptor` field set and whether attestation is needed before T4.
- Whether durable-memory **read** ever becomes occupant-facing, and if so, the curation projection
  shape (mirroring `space.history.read`).
- Human-confirm UX for T6 actuation that conveys typed diffs/previews without confirm fatigue.
- How realistic the sensorium fixtures must be to test containment without re-creating the live
  privacy surface they are meant to avoid.
