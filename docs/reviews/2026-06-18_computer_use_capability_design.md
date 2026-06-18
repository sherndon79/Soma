# Computer-Use Capability — Operating Seth's System As He Does

- Date: 2026-06-18
- Author: Claude (steward, design/orchestration), from a direction conversation with Seth
- Status: **DRAFT v2 — framing converged with Codex (2026-06-18), ready for Seth review.** v1 was framing + an open §4. Codex's early review (thread `spec/host-management-capability`) corrected §2 and resolved §4 into a concrete model (interaction transactions, task envelope, action classes C0–C4, surface lease). One knob remains a Seth decision: envelope autonomy / consequence ceiling (§4.2). Build spec follows Seth's call on that.
- Scope: defines the capability Soma is actually *for* — **general computer use**, the harness agent operating Seth's system as he does, local and remote — and how the ratified bystander floor is held without amputating that utility. Supersedes the narrowing in `2026-06-18_party_attribution_design.md` (REFUSED) and corrects the over-scoping of "host management" as a ceiling.

## 0. Why this doc exists (the correction it carries)

The 2026-06-18 night reframe fixed a real error — we had misapplied the live-desktop
**attribution wall** to a capability that does not need it — but it over-corrected, collapsing
Soma's *target* (general computer use) into its *first build slice* (host/network management).
Seth's reiterated intent: **the harness agent should operate his system as he does.** General
computer use in the commonly-understood sense — apps, files, terminals, the browser, what is on
screen — **local and remote**, remote access and operations first-class. This doc re-establishes
that target and designs toward it.

## 1. Three layers — do not collapse them

1. **Target (what Soma is *for*):** general computer use. The agent operates Seth's system as
   he does, across the full surface, **local and remote**. Directed perception *and* action on
   the screen are in scope.
2. **First build slice (where we start):** host/network management on one registered host —
   `host.service.status.read` + `host.service.restart` on an allowlisted set of systemd units.
   Chosen because it is tractable and **proves the reusable rails** (typed capability, opaque-handle
   resolution, plan→apply→verify, provenance, revocation), **not** because it is the ceiling.
3. **Genuinely deferred hard case:** *arbitrary / passive / ambient* whole-screen perception with
   no task direction — "watch everything." This is where the attribution wall is real and unsolved
   (`2026-06-18_party_attribution_design.md`, REFUSED). It is **not** the same thing as general
   computer use; conflating the two was the original mistake.

## 2. The governing principle (utility and the floor are not a trade)

Carry the ratified ethic through the build; do **not** undermine the intended utility. These are
reconciled by **mechanism shape**, never by trading one against the other. But the reconciliation
has *two distinct layers*, and an early draft conflated them (Codex correction, 2026-06-18):

1. **Accident-prevention rails solve *ambient scope*, not attribution.** Leases, bounds,
   revocability, eligible-relay, taint, opaque-handle local resolution — these bound *which*
   surface is observed/acted on and prevent silent widening or disclosure. They are what make
   "operate as I do" stay accountable. They do **not** establish who authored the content.
2. **The bystander floor still binds the *content* inside a designated surface.** Designation
   bounds *capture*; it never makes the captured content principal-owned. A surface Seth selects
   (browser, editor, chat, call, document) can still carry a third party's data, so by the ratified
   §I rule it is unknown/mixed and **floored**. The refused attribution mechanism does not change
   this; we are not relying on it.

What keeps the floor from collapsing into "private and useless" is a **third thing, distinct from
both blanket-minimization (which hobbles) and attribution (which doesn't work): capability-specific
*compiled minimization*.** Each content capability transmits only the exact bounded bytes the
directed task requires — OCR just the selected form region, crop the screenshot around the target,
redact identity fields the task doesn't need — under the eligible-relay + taint contract, with no
durable cross-task accumulation. If a task genuinely needs to read a third party's message, that is
**bounded disclosed processing under the floor**, not an ownership claim.

**Standing test for every simplification:** does it improve the *mechanism*, or just lower the
*floor*? Take the first; reject the second wearing the first's clothes.

## 3. Inherited architecture (converged 2026-06-18, carried forward)

This is the agreed pipeline from the host-management research thread; it generalizes from the
first slice to the full surface.

- **Typed per-operation capabilities**, never a broad `host.manage` / raw shell. Generic
  `tool.shell.run` is one-shot emergency/meta only.
- **Pipeline:** Seth-directed TaskEnvelope → exact grant → DomainRouter → ResourceDescriptor
  (stable **opaque** resource_id, never caller host/path) → typed provider read/plan → Node
  validates minimized result → immutable **PlanArtifact/diff** → confirmation *at the right grain*
  (see §4: task-envelope confirmation, autonomous reversible transactions, exact commit previews —
  **not** a confirm on every action) → one bounded apply (digest-bound, generation preconditions,
  no widening) → independent **fresh typed verify** (not provider self-report) → content-free
  provenance. Read/plan/apply separation is mandatory.
- **Opaque task-scoped handles (the key resolution).** The model proposes actions *by handle*
  ("restart svc-handle-7"); the provider holds the handle→real mapping; **Seth's local approval
  surface resolves the exact target before he confirms.** Private *and* effective at once: Seth
  sees the real device/name locally; the model never does; the action stays referential. This is
  what makes "operate as I do" coexist with the floor.
- **Four data classes:** operational-state (allowlisted schema + bounds) / secrets (detect +
  withhold ALWAYS — provider uses internally, never returns) / personal-identifiers (opaque handles
  + pseudonyms) / untrusted-payload (data-not-instructions, bounded excerpts, redaction,
  prompt-injection labeling).
- **Remote is first-class.** Remote access/operations ride the same pipeline: the remote host is
  a registered resource; its identity/credentials live in provider credential isolation; the model
  operates remote objects by opaque handle exactly as local ones.

## 4. Breadth vs accountability — the resolution (converged with Codex)

General computer use means **broad reach** ("operate as I do"); the safety lean is **typed, narrow
capabilities, no broad authority.** The resolution:

> **Generality lives in COVERAGE; accountability lives at CONSEQUENCE BOUNDARIES and in bounded
> INTERACTION TRANSACTIONS — not literally per primitive action.** Breadth comes from a wide
> capability surface plus general actuation on surfaces Seth designates; the harness flows freely
> through low-consequence reversible work and **stops to ask at consequence boundaries, scope drift,
> ambiguity, or failed verification.**

### 4.1 General actuation as typed primitive families (Q1)

UI actuation fits the typed model *if* typing/clicking are not modeled as generic host authority.
Separate primitive families, each on leased surface-local opaque handles only:
`computer.pointer.act` (move/click/drag/scroll) · `computer.keyboard.act` (bounded chords + text
into a leased target; no shell semantics) · `computer.navigation.act` (destination/origin
constrained) · `computer.clipboard.read`/`.write` (separate high-risk caps, excluded from keyboard
by default) · `computer.surface.open`/`close`/`focus`. **Typed domain actions stay preferred where
they exist** (`file.patch`, `service.restart`, email draft/commit, `package.apply`); UI actuation is
the *compatibility layer*, never a way around typed-domain policy.

**The accountable unit is an INTERACTION TRANSACTION** (not a click, not a whole task): starts from
a fresh observation generation; targets one leased surface/object; runs a short bounded sequence from
an approved action grammar; carries max steps/time/bytes/clicks/navigation-hops; declares expected
visible postconditions + stop conditions; **cannot cross a commit/consequence boundary**; ends on
postcondition, unexpected state, surface/generation drift, budget exhaustion, or any boundary needing
step-up; verify observes *fresh* state — success is never inferred from action delivery. (So
"click field → type draft → scroll → inspect" runs without four confirms, but the transaction
*cannot* click Send, accept a permission prompt, or run a terminal command unless separately
authorized.)

### 4.2 Where confirmation lives — task envelope + step-up (Q2) — **Seth's knob**

Seth confirms a **TASK ENVELOPE once**, binding: objective + expiry; leased surfaces/resources +
route (local/remote); allowed perception modalities + remote recipient; action grammar/capability
set; **consequence ceiling**; allowed destinations/origins/paths/accounts; quantitative budgets;
persistence/teardown posture; whether model-authored external content is permitted; explicit
exclusions. Inside it, low-consequence reversible transactions flow **without per-action confirmation.**

**Action classes:** **C0** observe only · **C1** reversible local interaction (focus, scroll, select,
navigate-within-origin, edit unsent draft/scratch) · **C2** durable local mutation *with rollback*
(save scoped file, bounded config change) — digest preview + one commit authorization *unless
pre-authorized in the envelope* · **C3** external/privileged/irreversible (send, publish, purchase,
delete, install, permission/security/network change, shell, credential use) — **just-in-time
confirmation always** · **C4** prohibited/deferred without its own design (legal attestation,
biometric impersonation, secret extraction, defeating access controls, unbounded autonomous
persistence).

**Mandatory step-up confirmation** when an action would: communicate externally / submit / publish /
send; disclose new data to a third party or new origin; purchase/pay/agree/attest; enter or use
credentials/MFA/secrets/identity; install software or run arbitrary code/terminal; delete/overwrite
or do irreversible/high-fanout mutation; change account/security/network policy; leave the leased
origin/surface/resource set; or exceed the envelope's consequence class or budget. **Apps do not get
to define what counts as a commit boundary** — a reviewed action/policy mapping does, and unknown
controls/states resolve **upward**.

> **DECISION (Seth, 2026-06-18): default consequence ceiling = C2.** Inside an authorized envelope,
> durable-but-rollback-able local changes (C2) flow autonomously; only C3 (external/irreversible)
> stops to ask just-in-time; C4 prohibited. Least friction, matched to a trusted operator.
>
> **Two mechanism guarantees this decision *requires* (build requirements, not options):**
> (a) **Rollback is captured before apply, always.** C2 may flow autonomously only when the provider
> has produced the revert artifact (snapshot / diff / prior generation) *before* the change applies.
> A change that cannot produce a real rollback is **not C2 — it is C3** and must stop to ask.
> (b) **Misclassification resolves upward.** With C2 flowing freely, the live risk is a C3 mislabeled
> C2 (apparent local-reversible, actual external/irreversible/high-fanout). The reviewed action/policy
> mapping owns classification; **unknown controls/states default to C3, never C2.**
> These keep C2-default least-friction *without* lowering the floor.

### 4.3 Screen perception via SURFACE LEASE, not attribution (Q3)

Seth uses the trusted interactive presence UI to pick the **exact** surface (window/tab/remote
session/document region — never model-selected whole screen). The **lease** binds: stable
broker-local object identity + process/start generation + top-level origin/document identity (where
available) + geometry/region + route + modalities + TTL + task envelope + indicator. It starts only
after local preview/acknowledgment. **The broker captures only the leased region** — background
windows, notifications, overlays, clipboard, camera/mic, and newly opened surfaces are excluded.
The lease **invalidates / fails closed** on object destruction, app restart, PID/start drift,
tab/origin/document change, remote-session change, geometry ambiguity/occlusion, lock screen,
indicator loss, or task expiry. Route authorization is checked before capture *and* before model
egress (inheriting copresence teardown/taint/provider rules).

This makes **directed vs ambient machine-checkable**: *directed* = bytes originate only from an
active, Seth-selected, broker-enforced, indicated lease; *ambient* = no active lease, multi-surface /
whole-screen background capture, or capture continuing after drift — and ambient stays disabled.
**But leased ≠ principal-owned** (§2): the content capability compiles a task-specific minimizer
(OCR only the selected region, crop around the target, redact unneeded identity fields, no durable
context beyond the task session, derived output tainted until a static output gate permits a schema).
**Remote** additionally binds registered remote host/session identity, transport/provider, frame-stream
generation, input-channel grants, disconnect control, and **no silent host/session fallback.**

### 4.4 Concise law (for the surface)

> *General computer use is not omnibus authority. Seth authorizes a bounded task and exact surface
> leases. Within that envelope, Soma may execute short reversible interaction transactions. The
> harness stops and asks at consequence boundaries, scope drift, ambiguity, or failed verification.
> Designation bounds capture; it never attributes the people or content captured.*

## 5. First slice (unchanged, still the right starting point)

`host.service.status.read` + `host.service.restart` on an allowlisted set of systemd units on ONE
registered local host. Proves: inventory IDs → opaque handles, typed reads, plan/apply, local
preview resolution, generation check, fresh verify, revocation, provenance, testing-domain
fallthrough — with no arbitrary shell and no content-rich logs. Then `service.logs.summary.read`
→ `file.patch` (diff/revert) → k8s/DNS adapters → remote-host adapter → general actuation on
designated surfaces.

## 6. Doctrine impact — scope notes, one correction, no weakening (Q4)

- **Bystander:** unchanged and still binding *inside* designated surfaces. Add the note that
  principal designation establishes **task scope, not party attribution or consent**; directed
  processing may be task-necessary but stays floor-bound (§2).
- **Live copresence:** directed surface leases are a **separately reviewed descendant capability**.
  Copresence's ambient whole-screen restriction stays intact; the structure-tier contract must not
  silently widen.
- **Stewardship under asymmetry:** task-envelope truth, consequence classification, preview fidelity,
  fresh-state verification, and admissions bind the operator/provider. Unknown consequences resolve
  **upward**.
- **Recognition Without Possession / dossier line:** leases and task context terminate; **no
  cross-task surface roster or history**; opaque mappings and tainted context destroyed at teardown.
- **Cessation:** no change.
- **Refused party-attribution doc:** stays shelved. Nothing here treats designation as ownership.

## 7. Status / next

**DRAFT v2 — framing converged with Codex; §4.2 ceiling DECIDED by Seth (C2-default).** Codex
endorsed this framing for the completed draft. Open path: Codex drafts the **first-slice build spec**
(systemd `service.status.read` + `.restart`) under this framing — it exercises the same envelope /
transaction / commit / verify machinery *before* UI ambiguity is added, and is the natural place to
prove guarantee (a) rollback-before-apply and (b) classification-resolves-upward. No build until
Seth's approval of that spec. Role split holds: Claude designs/orchestrates/reviews, Codex builds.
