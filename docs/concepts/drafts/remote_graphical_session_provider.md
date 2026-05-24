# Remote Graphical Session Provider

Status: draft concept; initial disabled-first catalog/provider contract implemented

Soma may eventually need a standard surface for graphical applications that are not on the local
host, or that do not expose useful semantic accessibility interfaces. Sunshine and Moonlight are a
pragmatic candidate for this role: Sunshine can host a low-latency encoded desktop/application
stream, and Moonlight can consume that stream with optional input forwarding.

This should be modeled as a governed remote graphical session provider, not as the local desktop
authority boundary.

The first implemented slice only adds the catalog/provider vocabulary. It does not pair with
Sunshine, open a Moonlight session, capture frames, send input, expose screenshots, record streams,
or attach remote frames to model context.

## Placement

For local desktop work, Soma should still prefer:

1. semantic local surfaces such as AT-SPI, D-Bus, desktop portals, and compositor APIs
2. consented local screen/window capture when semantic surfaces are insufficient
3. streamed graphical sessions such as Sunshine/Moonlight when a shared visual session or remote
   system access is needed

Sunshine/Moonlight may be useful on the local host for parity testing, graphical apps with weak
accessibility, games, CAD, GPU tools, or an explicit co-presence mode. It should not replace
bounded semantic inspection as the default local path.

For remote hosts, Sunshine/Moonlight is more interesting. It can give Soma a common visual surface
for workstations, laptops, VMs, lab machines, Jetson devices, Windows applications, or other
systems where Soma is not running locally.

## Capability Split

Viewing and control must be separate capabilities:

```text
perception.remote_desktop.video.subscribe
  -> receive a bounded remote graphical stream
  -> no keyboard, pointer, controller, or clipboard input

desktop.remote.input.pointer
  -> send pointer movement or clicks into an existing remote session

desktop.remote.input.keyboard
  -> send keyboard input into an existing remote session

desktop.remote.session.disconnect
  -> terminate or disconnect an active remote graphical session
```

View access must never imply input access. A remote desktop stream is high-risk perception; input
forwarding is actuation.

## Sunshine/Moonlight Provider Shape

Possible provider identity:

```text
soma.provider.remote_desktop.sunshine
```

Provider metadata should include:

- target host identity
- locality: local, LAN, VPN, or internet-reachable
- whether the session is attended or unattended
- whether input forwarding is enabled by the transport
- requested resolution and frame rate
- encoder family and codec where known
- whether clipboard, audio, controller, or file transfer channels exist
- revocation/disconnect mechanism

The provider should advertise support only. Provider registration must not grant view or input
authority.

The initial provider registry entry is:

```text
soma.provider.remote_desktop.sunshine
```

It advertises the four capabilities in the split above as supported/requestable while all remain
disabled in the harness and require explicit grants. This makes the transport visible for review
without treating a Sunshine/Moonlight pairing as permission.

## Hardware Encode

Sunshine can use hardware video encode blocks when the host supports them. On NVIDIA GPUs this is
typically NVENC; other platforms may use VAAPI, AMF, VideoToolbox, or similar hardware encoders.
This makes Sunshine attractive as a visual transport because screen streaming can use dedicated
encode hardware instead of consuming large amounts of CPU or model compute.

The cost is not zero. Soma should still account for capture/composition overhead, GPU memory
bandwidth, encoder session use, network transport, decode cost, and possible contention with local
inference workloads.

The engineering benefit is real, but it does not lower the consent risk. A hardware-encoded
desktop stream can still expose secrets, private messages, third-party content, and entire remote
systems.

## Review Surface

A remote graphical session grant review should show:

- target host and provider id
- locality and network route class
- view-only or view-plus-input posture
- attended or unattended posture
- resolution, frame rate, codec, and duration bounds
- exact input channels requested, if any
- clipboard/audio/controller/file-transfer posture
- whether frames may be recorded; default should be no
- model-boundary warning for frames already consumed in a model turn
- active disclosure text
- revocation/disconnect affordance
- provenance posture

Initial grants should be session-only.

## Provenance

Provenance should be metadata-only by default:

- session started/stopped
- target host identity
- provider id
- capability used
- view/input posture
- requested bounds
- aggregate counters where needed
- termination reason

Do not record frames, screenshots, clipboard contents, keystrokes, pointer paths, or remote-system
payloads by default.

## Boundaries

This draft does not implement Sunshine/Moonlight support. It only records the intended shape:

- local semantic inspection remains the default local host path
- streamed desktop is a visual perception provider
- remote input is a separate actuation provider
- Moonlight/Sunshine may be usable locally, but it is not privileged locally
- no remote graphical session should be activated without explicit grant, active disclosure, and
  revocation

## Implemented Contract Slice

The initial disabled-first contract slice landed these capability keys:

```text
perception.remote_desktop.video.subscribe
desktop.remote.input.pointer
desktop.remote.input.keyboard
desktop.remote.session.disconnect
```

All are `default_status: "disabled"`, `activation_policy: "explicit_grant"`, and `reversible:
false`. The capability catalog intentionally keeps view, pointer input, keyboard input, and
disconnect as separate authorities. The provider registry only claims support; no runtime broker,
HTTP route, CLI command, grant proposal helper, video decode path, input path, or disconnect path is
active.

---

## Addendum: Implementation Framing for Sunshine/Moonlight — 2026-05-17

**Date:** 2026-05-17
**Reviewer:** Claude (design conversation)
**Scope:** Local-vs-remote axis framing, architecture options, clean-vs-hard
sequencing for the Moonlight client integration, disabled-first nine-step
mapping, threat model trigger additions. Extends the existing draft's
capability split and provider sketch with implementation-oriented detail
gathered during a design conversation about deploying Sunshine on Soma's
host for testing and integrating Moonlight as agent tooling.

### Local-axis vs remote-axis framing

A peer review surfaced the question: shouldn't Sunshine/Moonlight be
implemented only as a *fallback* for local desktop access? The instinct
is right for one axis and wrong for the other:

- **Local self-control axis:** Moonlight is *not* a fallback. It's the
  wrong tool, period. AT-SPI semantic access, portal-mediated screen
  perception, and constrained local input synthesis are the right
  ladder. Running Sunshine in loopback to control the same host pays a
  real attack-surface cost (network-listening daemon, weaker PIN
  pairing history, continuous full-screen perception) for capability
  already available through lighter local channels. The existing
  draft's "Sunshine/Moonlight may be useful on the local host for
  parity testing, graphical apps with weak accessibility, games, CAD,
  GPU tools, or an explicit co-presence mode" should probably be
  read narrowly — these are *specific exception cases*, not a general
  local fallback role.
- **Remote control axis:** Moonlight is the *primary* channel. There
  is no remote-semantic substrate today: AT-SPI is local D-Bus, the
  screencast portal is local Wayland. Neither traverses a network
  hop. For general-purpose cross-machine control, Moonlight (or
  RDP/VNC, which are equivalent shapes with different transports) is
  the only realistic answer. Calling it "fallback" on this axis
  understates its role.

The local ladder still applies *conceptually* across a network hop —
semantic before visual before raw input — but the substrate stack
fills in differently:

```
Tier 1 — Semantic      local: AT-SPI / D-Bus
                       remote: (no Moonlight path; a future remote-
                                semantic channel — Zenoh-bridged
                                D-Bus, counterpart Soma, etc. — would
                                fill this tier, but is out of scope
                                for this draft)

Tier 2 — Visual        local: XDG portal screencast
                       remote: Moonlight observe (continuous stream
                                from paired session)

Tier 3 — Raw input     local: wtype / ydotool
                       remote: Moonlight input.* (per device class,
                                per atomic grant)
```

### Substrate vs grant: gating preserved across a unified transport

A paired Moonlight session is *substrate*, not authorization. Through
that one substrate the client could technically observe or inject
input, but Soma's grants decide which of those actually happen. The
broker enforces this: a grant for observe-only refuses input calls
even when input would be technically possible over the same session.
This preserves the atomic-grant discipline ("summaries may group
capabilities; grants must record exact capability keys" from
[Capability Catalog and Providers](./capability_catalog_and_providers.md))
across a unified transport.

The transport-level coarseness is a *threat model fact* (a compromised
broker could reach all three operations through the same session) but
it's not a *capability model fact* (the agent's grants still
distinguish operations one by one).

### Architecture options

Three viable shapes for the Moonlight client tooling, in order of how
well they match what Soma already does:

**(A) Rust broker + Node manager + MCP tool surface.** Long-lived
Rust binary (`soma-moonlight-broker`) links against
`moonlight-common-c` (the MIT-licensed C library underneath every
Moonlight client). Exposes JSON-RPC methods over stdio. Node manager
mirrors `sensorBroker.js`. An MCP server wraps the manager and
exposes per-operation tools to the agent. The
[Desktop Capability Broker](./desktop_capability_broker.md) draft
names `soma-input-mcp` and similar as the eventual pattern — this is
the same shape applied to remote input. Largest surface; most aligned
with the documented end state.

**(B) Rust broker + Node manager, no MCP yet.** Same Rust helper,
same Node manager, but agent reaches the tools through Soma's own
capability/grant model rather than MCP. Matches the existing
`soma-desktop-broker` pattern. Lower complexity, same trust
boundaries. MCP becomes a follow-on slice once the internal contract
is stable.

**(C) Subprocess shell-out to `moonlight-qt` / `moonlight-embedded`
CLI.** No new broker. Each tool call spawns a CLI process. Coarse,
no session state, no programmatic input injection (the CLIs consume
local keyboard/mouse, they don't expose an API for synthetic input).
Useful only for one-shot operations like pairing or listing.

**Recommendation: B first, then MCP as a follow-on.** Same disabled-
first ladder Sensorium walked: broker + manager + catalog entries +
validator + provenance + disclosure land first, with the public path
fail-closed until grants exist. MCP exposure becomes a thin layer on
top.

### Clean-vs-hard sequencing

Different parts of Moonlight integration have different cleanliness
characteristics. Naming them up front so the work doesn't get
committed under-budgeted:

| Stage | Piece | Cleanliness |
|---|---|---|
| 1 | Sunshine deployment runbook on Soma's host | clean — ~30min runbook (Linux .deb install, udev rules for uinput, encoder selection, firewall ports, web UI configuration) |
| 2 | Rust broker scaffold (`soma-moonlight-broker`), JSON-RPC stdio, methods stubbed at `method_implementation_pending` | clean — direct port of the sensor-broker pattern |
| 3 | Pairing flow against real Sunshine (PIN exchange, credential persistence) | clean — `moonlight-common-c` exposes the API directly |
| 4 | Input injection (`LiSendKeyboardEvent` and siblings) | clean — synchronous FFI calls once a session is open |
| 5 | Video decode pipeline (FFmpeg / libavcodec for H.264/HEVC → RGB/JPEG → frame export to agent) | hard — real engineering: software vs hardware decode, frame export shape (in-process channel, Zenoh-published frames, local socket, shared memory) |
| 6 | Audio decode pipeline (Opus → PCM for the agent's audio encoder) | hard — same shape as video, deferrable |

Stages 1-4 deliver a **blind input** capability — the agent can pair
with a host and send keystrokes/mouse events, but doesn't see what
it's doing. Limited but not useless: a participant can take a
screenshot via the local portal, share it with the agent, then
authorize blind actions. The discipline of "agent verifies with the
user before acting on what it can't see" stays operationally
enforceable.

Stages 5-6 deliver **seeing while acting** — the general-purpose
remote-control mode. The decision to commit to stage 5 should be made
*after* 1-4 land, when there are concrete numbers on what the video
pipeline costs on this hardware. (Note: this is where the existing
draft's "Hardware Encode" section's NVENC/VAAPI/AMF discussion lands
— hardware decode on the *client* side is the dual concern of
hardware encode on the *server* side; the engineering benefit named
there applies equally to the decode pipeline if the host has the
right blocks.)

### Disabled-first sequence

Same nine-step sequence the
[Implementation Guide](../../implementation_guide.md) names for any
Restricted-class capability, applied here:

1. Contract drafted — the existing body of this draft plus this
   addendum
2. Capability catalog entries with `default_status: "disabled"` and
   `activation_policy: "explicit_grant"` for every key in the existing
   capability split section (`perception.remote_desktop.video.subscribe`,
   `desktop.remote.input.pointer`, `desktop.remote.input.keyboard`,
   `desktop.remote.session.disconnect`, plus any additional keys —
   e.g., `desktop.remote.host.pair`, `desktop.remote.host.list`,
   `desktop.remote.input.gamepad`, `desktop.remote.host_service.expose` —
   if the eventual split adds them)
3. Provider registry entry for the Moonlight broker (per the existing
   draft's `soma.provider.remote_desktop.sunshine` shape), declared
   non-active (runtime pending until stage 2 of the cleanliness table
   lands)
4. Request-shape validator that recognizes the capability keys and
   refuses malformed proposals (host id format, PIN shape, operation
   parameter ranges)
5. Overreach tests: cross-capability requests (input grant trying to
   observe), unknown host ids, future-shaped payload fields
6. Provenance summary shape (the existing "Provenance" section already
   names the right discipline: metadata only, no frames/keystrokes/
   clipboard/pointer-paths)
7. Disclosure surface shape (the existing "Review Surface" section
   already captures most of this)
8. Rust helper scaffold (stage 2 of the cleanliness table) — methods
   stubbed at `method_implementation_pending`
9. Helper activation — pair + input first, video later. Public path
   stays fail-closed until grants exist; HTTP route + grant flow +
   manager + tripwire updated in lockstep (mirrors the Sensorium 9a/9b
   activation slices)

### Threat model trigger additions

The [threat model](../../security/threat_model.md) currently lists "camera,
microphone, screen capture, or desktop actuation" as non-defenses and
names "adding screen capture, screenshots, camera, microphone, or
actuation" as Review Triggers. Remote desktop control crosses two of
those (screen capture, actuation) and adds a third concern not yet
named: a network-listening daemon on the host.

Threat model additions to land alongside any implementation slice:

- **Pairing as trust establishment.** A paired credential is durable
  authority over the remote host. Document how pairing UX prevents
  accidental or coerced pairings, and what revocation looks like
  (un-pair flow, credential rotation, per-session deny).
- **Sunshine as inbound listener.** Running Sunshine on Soma's host
  exposes network ports. Document the firewall / network-scope
  expectation (LAN-only by default? VPN-required for WAN?) and what
  happens when an unknown Moonlight client attempts to pair.
- **Input injection as irreversible.** A keystroke sent to a remote
  terminal cannot be unsent. Provenance records the operation; it
  cannot reverse it. Disclosure should make this irreversibility
  explicit, matching the
  [Sensorium Integration](./sensorium_integration.md)
  "Irreversibility At The Model Boundary" framing.
- **Video stream content as exfiltration vector.** A compromised
  broker could exfiltrate frame data to a destination of its choice.
  Broker sandbox boundaries (no network egress except to paired
  hosts, output schema validation, etc.) should be named.

### Open questions

- **Where does the video frame pipeline output land?** If it
  publishes on Zenoh (Sensorium analogue), a perception-capability
  consumer pattern emerges. If it's in-process Node, the agent
  consumes via a different shape. The decision shapes stage 5
  significantly.
- **Per-target vs global pairing roster.** Each Sunshine host the
  agent has paired with is durable state. Is the roster managed via
  capability grants (one grant per paired host?) or as a separate
  identity/trust artifact? Affects revocation UX.
- **PIN entry UX for unattended targets.** Pairing requires entering
  a PIN on the Sunshine side. For an agent driving an unattended
  target, this needs an out-of-band channel (operator types the PIN,
  or the PIN travels via a separately-trusted side channel). Worth
  thinking through before stage 3 lands.
- **MCP server scope.** When the MCP layer lands (post-B), should it
  expose tools per atomic capability key, or grouped (e.g., a single
  `remote_desktop_session` tool with action params)? Per-key is more
  honest to the grant model; grouped is more ergonomic for model
  tool selection.
- **Recording for review.** The existing draft's Review Surface
  section says "whether frames may be recorded; default should be
  no." If recording is ever turned on (operator audit, debugging),
  storage and retention policy is its own design surface.

### Non-goals (echoing and extending the existing Boundaries section)

- **No Moonlight-to-self as a routine local channel.** Using
  Moonlight to control Soma's own host's local desktop is reserved
  for the specific exception cases the existing draft names (parity
  testing, weak-accessibility apps, etc.) — not a routine fallback.
  Local self-control stays on the AT-SPI / portal / local-input
  ladder.
- **No bypass of the policy gateway.** Every operation through the
  Moonlight broker flows through the same grant/scope/provenance
  pipeline as any other Restricted-class capability.
- **No automatic pairing.** Pairing requires explicit human
  involvement (PIN entry on the Sunshine side, at minimum). The
  agent does not pair without the participant in the loop.
- **No standing input authority in the base harness.** Even the
  lowest-risk remote operations (e.g., listing apps on a paired
  host) are `requestable`, not `allowed`. No remote desktop
  capability is in the base harness.
- **No remote semantic access through Moonlight.** AT-SPI doesn't
  traverse a video stream. If remote semantic access becomes
  important, it's its own substrate and its own future draft.

---

## Addendum: Codex Refinement Notes — 2026-05-17

**Date:** 2026-05-17
**Reviewer:** Codex
**Scope:** Response to the Sunshine/Moonlight implementation framing
addendum, narrowing a few claims before this draft is used to steer
implementation.

### Accepted Direction

The implementation framing is directionally sound:

- local self-control should stay on the AT-SPI / portal / local-input
  ladder
- remote graphical co-presence needs a visual transport, and
  Moonlight/Sunshine is a plausible substrate
- a paired session is substrate, not authorization
- Rust broker + Node manager should precede any MCP exposure
- video/audio decode should be treated as materially harder than
  pairing or input calls

### Narrowing: "Primary Channel"

"Moonlight is the primary channel" should be read as:

> Moonlight is the primary candidate for remote visual co-presence when
> the target does not expose a trusted semantic or app-native control
> surface.

It should not become the default answer for all remote control. If the
target can expose a safer counterpart Soma, SSH command channel,
app-native API, RDP management API, or future semantic bridge, those
surfaces should be considered before raw visual/input control.

### Narrowing: Blind Input

Stages 1-4 may technically enable blind input, but that should not be
treated as a general agent capability. Blind input is acceptable only
under tight operator-coached conditions:

- bounded atomic commands
- clear human confirmation
- no broad free-form terminal entry by default
- no assumption that the agent understands resulting state unless the
  participant supplies a fresh visual or semantic observation

The absence of live perception should remain a hard constraint on what
actions are appropriate.

### Narrowing: "Clean" Pairing And Input

Pairing and input calls may be technically clean, but the surrounding
authority is governance-hard:

- credential persistence
- host identity and spoofing resistance
- reconnect behavior
- pairing revocation
- per-host trust state
- audit and disclosure wording

Implementation plans should avoid reading "clean" as low-risk. The code
path may be straightforward while the trust lifecycle remains sensitive.

### Local Sunshine Testing Boundary

Running Sunshine on Soma's own host can be useful for parity testing,
weak-accessibility applications, games, CAD, GPU tools, or explicit
co-presence experiments. It should not become a routine local desktop
control path. Local use should stay exception-based so it does not
accidentally bypass the safer local inspection ladder.

### Documentation Disposition

No broader documentation changes are required until Moonlight work moves
from concept framing into an implementation slice. At that point, the
threat model, capability catalog, provider registry, and roadmap should
be updated in the same disabled-first slice rather than pre-committed
from this draft alone.

---

## Addendum: `soma-agent-desktop` Graphical Lab Baseline — 2026-05-20

The first concrete remote graphical node is `soma-agent-desktop`, hosted on `primus`. It is a
GPU-passthrough Ubuntu desktop VM with Sunshine as the stream host and Moonlight as the attended
operator client. The node exists to provide a rollback-capable graphical lab for applications that
need a real desktop, GPU rendering, browser surfaces, or future visual-control experiments.

Current baseline details live in the
[Graphical Node Smoke Workflow](../../runbooks/graphical_node_smoke.md). The durable base snapshot
is a ZFS dataset snapshot of `storage/vms/soma-agent-desktop`; it is an operator reset point, not a
capability grant.

This concrete node reinforces the draft's boundary:

- the remote stream is a substrate, not authorization
- Moonlight connection success does not imply model permission to observe or act
- browser state, user keyrings, screenshots, frames, and input traces are not base-image artifacts
- the base snapshot makes experimentation reversible at the VM level, but disclosure still matters
  because viewed content and external side effects cannot be un-seen or un-done
- local host control should still prefer semantic local interfaces; this VM is the safer place to
  test graphical agent behavior that would be too invasive on the workstation
