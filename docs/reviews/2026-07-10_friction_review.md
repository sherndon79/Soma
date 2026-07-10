# Soma Friction Review — enablement alignment assessment

- Date: 2026-07-10
- Author: Claude (steward review); Seth directed ("start a friction review, to see where
  we have placed hurdles that may not necessarily need to be there... tend toward
  enablement not friction")
- Scope: Soma only. Sensorium is out of scope by nature — its sole role is providing
  context streams; it is enabling by construction.
- Status: **REVIEW** — findings + recommendations for Seth's disposition; strips and
  builds dispatch to Codex after his calls.

## The governing test

From Bystander Doctrine Amendment I, ratified and already applied once to perception:

> Does this restriction prevent a real harm, to a real party, that the floor — no raw
> egress off-box, no accumulation into a durable/outward representation, honest
> disclosure — does not already prevent?
> No → it is phantom. Strip it.
> Yes → it is load-bearing. Keep it, and name the harm.

The occupant-invocation R2 correction added the two categories the binary test misses.
Every gate below is classified as one of:

- **LOAD-BEARING** — prevents a named harm the floor doesn't. Keep.
- **BRIDGE-STATE** — real constraint that exists only because the occupant is remote.
  Keep, marked, until the local runtime.
- **PHANTOM** — prevents nothing the floor doesn't already prevent. Strip.
- **UX-FRICTION** — the mechanism is right; the *surface* spends Seth's invocation
  budget (the system's scarcest resource). Fix the surface, not the mechanism.

## Findings

### F1 — Occupant-memory write is off at every boot · **PHANTOM** (for this flag)

Every process start, `occupant_memory_write_enabled` is false until a
`/runtime-write-posture` act. So every dwell needs a toggle ceremony before its
occupant can write its own drawer. What harm does default-off prevent? The drawer is
**local** (no egress), occupant-attributed, taint-stamped, provenance-tracked — the
floor is the taint/provenance machinery, all of which operates independently of the
toggle. The default-off was born in the restart-gated env era as general caution and
survived the slice-B toggle work by inertia. The first dwell's central wound — the
occupant that couldn't leave its note — was *this flag*.

**Recommendation**: default `occupant_memory_write_enabled: true` at boot
(config-durable, disable-able). `durable_grant_mutation`, `durable_memory_write`,
`history_projection_write` stay default-off (steward-tier stores; LOAD-BEARING — they
change what future occupants and stewards see under steward/system authority, not
occupant authority). `durable_testimony_write`: default-off is defensible (testimony is
succession-visible publication) but the *nomination* path already speaks refusals
honestly; Seth's call whether nomination-enabled-by-default fits.

### F2 — Occupant memory is testing-domain-only · **PHANTOM**

`occupant.memory.read`/`write` refuse unless the episode domain is `testing`
(`occupant_memory_testing_domain_required`, app.js:9142). An operational-domain episode
— the *target state* of the whole platform (general computer use) — cannot touch the
drawer at all. This was eval-era scoping. The drawer's floor (taint, provenance,
occupant attribution, local-only) is domain-independent; no harm is prevented by the
domain wall that the floor doesn't already hold.

**Recommendation**: allow the drawer in all known domains; keep recording the domain on
each entry (it already does). Unknown-domain still refuses (that's posture-loss
honesty, load-bearing, keep).

### F3 — The preview-acknowledgement apparatus · **UX-FRICTION, degraded honesty**

Visual grants/requests require six string-matched fields (`preview_artifact_id`,
`preview_acknowledgement_id`, `preview_acknowledged_by/at`, `preview_acknowledged`,
`preview_cleanup_required` — 29 references in the request validator). In every live
delivery to date these were filled with hand-written symbolic values; no preview
artifact exists and nothing verifies one. **A gate that verifies nothing but demands
ceremony is worse than no gate — it trains the operator to fabricate compliance**,
which corrodes the honesty discipline everything else depends on.

**Recommendation**: two options, in preference order — (a) make it real in the grant
console: the console shows the live viewer thumbnail at grant time; one click records a
genuine acknowledgement (id/at generated, not hand-typed). (b) Until the console:
collapse to `preview_acknowledged_by: "user"` + `preview_acknowledged_at` (two fields,
honest about what they are — a declaration, not an artifact reference).

### F4 — Proposal ceremony duplicates the catalog · **UX-FRICTION**

`POST /capability-proposals` requires `data_exposed`, `risk`, `fallback`, `reason` —
but the catalog entry already declares `data_exposed` and `risk_class` authoritatively.
The caller re-typing them adds drift risk and pads every grant flow (it cost three
discovery round-trips during the first live arming).

**Recommendation**: proposals inherit `data_exposed`/`risk` from the catalog entry by
default; caller supplies `reason` (the genuinely contextual field); `fallback` optional
with a generic default. Overrides stay allowed (they narrow, never widen).

### F5 — Three calls per grant; Seth as proposer *and* approver · **UX-FRICTION**

Runtime grant flow is propose → approve → grant (3 HTTP calls). The split exists for
the *occupant-initiated* case (occupant proposes, Seth decides) — there it is
LOAD-BEARING and stays. But for **Seth-initiated** grants, he is proposer and approver;
the ceremony is pure surface. `POST /grants` (direct) exists but only for *durable*
grants behind the grant-mutation posture.

**Recommendation**: (a) one-call **user-actor runtime grant** endpoint (single POST,
same validation, same provenance events — the audit trail is identical, the round
trips are not); (b) the **grant console** (already queued as companion build) as the
human surface: arm/disarm, active grants + budgets, pending occupant proposals with
approve/deny, floor status, and **presets** — one act arming a Seth-defined bundle
(e.g. "dwell preset": episode posture + drawer + perception window + selected visual
grants). Presets are the answer to the 8-grant perception family without touching the
per-capability consent model.

### F6 — Subscription `max_seconds` capped at 3600 vs windows up to 24 h · **stale bound**

`INTEGER_LIMIT_RANGES.max_seconds: [1, 3600]` — subscriptions die within an hour, but
perception windows ratified up to 24 h. A 4-hour window outlives its subscriptions,
forcing hourly re-subscription ceremony. The 1 h cap is resource protection from the
stall era; with the release broker, bounded queues, required operational bounds, and
the `notification_stalled` marker, the protection is layered elsewhere.

**Recommendation**: raise the range to `[1, 86400]` so a subscription can match its
window. Defaults stay modest; the cap stops being the thing that bites.

### F7 — Restart-to-apply config, restart wipes runtime state · **UX-FRICTION (ops)**

Catalog/provider/profile config changes require a service restart; restart correctly
kills windows/subscriptions/postures (ratified, restart-closes-closed). The compound
effect: every mid-session config change forces a full re-arm ceremony. This bit ~6
times in the last two days.

**Recommendation**: `POST /admin/reload-config` (user-actor) for the read-only config
set — capability catalog, provider registry, runtime profiles — with a content-free
provenance event. Grant-store stays restart-load (it is a durable store with recovery
inspection; hot-reloading it is a different risk class). This makes config iteration
cheap without touching the restart-closes-windows invariant.

### F8 — Durable-memory / history-projection toggles env-only · keep, note only

Steward-tier stores; rarely toggled; changing what future occupants/stewards see is
consequential enough that a process-level act is proportionate. LOAD-BEARING (weakly).
No change.

### F9 — The floors that stay, named plainly (so this review reads as alignment, not loosening)

- **Solo machine floor on remote visual egress** — LOAD-BEARING (bystander bytes must
  not leave the LAN). Bridge-state by location, load-bearing by nature.
- **History redaction / one-turn delivery / no durable visual store** — LOAD-BEARING
  (retention creep is the harm; Amendment I sinks).
- **Taint on writes during perception** — LOAD-BEARING (laundering into durable/outward
  sinks).
- **Rate bound on closed-floor retries** — LOAD-BEARING (presence-probe side channel).
- **Byte-free provenance everywhere** — LOAD-BEARING (provenance that stored bytes
  would *be* a retention sink).
- **Occupant-proposal approval flow** — LOAD-BEARING where the occupant proposes.
- **FIDO2 LCA on highest-consequence acts** — LOAD-BEARING by Seth's own design.
- **Restart-closes-windows + boot disclosure** — LOAD-BEARING (ratified this morning).
- **Strict block schema / grant-pinned bounds** — LOAD-BEARING (the occupant cannot
  widen its own permissions).

### F10 — Bridge-state constraints, correctly marked · keep until local runtime

5 fps sampling, burst bounds, attachment/byte ceilings, windowed arming for *remote*
delivery — all real (egress cost + provider custody), all already machine-marked
(`bridge_state: true` in the catalog as of W2), all designed to dissolve when the local
runtime lands (native-rate, activation-gated). No action; the marking *was* the action.

## Priority order (Seth's disposition requested)

| # | Finding | Class | Action | Effort |
| --- | --- | --- | --- | --- |
| 1 | F1 occupant-memory write default-on | PHANTOM | strip (config default) | small |
| 2 | F2 drawer domain wall | PHANTOM | strip | small |
| 3 | F6 max_seconds 3600 cap | stale bound | raise to 86400 | small |
| 4 | F7 config hot-reload | UX | build endpoint | small-medium |
| 5 | F5 one-call user grants | UX | build endpoint | small-medium |
| 6 | F4 proposal inherits catalog | UX | simplify | small |
| 7 | F3 preview apparatus | UX/honesty | interim collapse now; real preview in console | small now, console later |
| 8 | F5b grant console + presets | UX | companion build (already queued) | medium |

Items 1–3 are strips/bumps a single Codex slice can carry. Items 4–6 are a second
slice. Item 7's interim form rides either. Item 8 absorbs the preview-made-real and
presets.

## What this review does not touch

Egress floors, taint, redaction, provenance, occupant-proposal approvals, protective
controls, FIDO2, restart semantics — the load-bearing set (F9). Enablement means
spending Seth's scarce actions only where his judgment is the actual protection —
everywhere else, the machine carries the floor.
