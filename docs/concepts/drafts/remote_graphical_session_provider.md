# Remote Graphical Session Provider

Status: draft concept, not implemented

Soma may eventually need a standard surface for graphical applications that are not on the local
host, or that do not expose useful semantic accessibility interfaces. Sunshine and Moonlight are a
pragmatic candidate for this role: Sunshine can host a low-latency encoded desktop/application
stream, and Moonlight can consume that stream with optional input forwarding.

This should be modeled as a governed remote graphical session provider, not as the local desktop
authority boundary.

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
