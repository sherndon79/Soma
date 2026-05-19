# Roadmap

Soma is currently a policy-gated local service scaffold. The roadmap below captures the intended
technical direction without treating later capabilities as already approved.

## Current Scaffold

Implemented:

- Node service plane for API, policy checks, harness modules, provenance, and CLI
- local vLLM/OpenAI-compatible chat routing
- runtime profiles
- file-backed capability catalog and provider registry
- file-backed read-only grant store shape
- grouped read-only capability view endpoint and CLI summary
- opt-in local-model capability evaluation harness
- unsupported remote-planning capability posture and model eval guardrail
- opt-in local escalation trigger assessment on chat with metadata-only provenance
- direct escalation-trigger heuristic tests, including validation-failure metadata
- ephemeral in-process session memory
- bounded in-process provenance log with filters and summary
- text-only cognitive-load stewardship
- scoped read-only file access
- read-only desktop broker environment inspection
- Rust `soma-desktop-broker` helper scaffold
- bounded AT-SPI bus participant and root-object metadata inspection
- desktop inspection provider-overreach tests for child metadata, windows, and rejected-provenance
  behavior
- focused-object inspection endpoint and CLI, disabled by default
- bounded AT-SPI active-descendant focus lookup with fail-closed unavailable reasons
- self-scoped narrowing modules for revocation
- proposal show/review endpoint and CLI surface
- proposal notification endpoint and CLI surface
- documented modular harness invariant and extension boundary
- documented provider invocation contract and remote-planning escalation concept
- threat-model and failure-mode coverage for unsupported remote planning
- documented desktop inspection schema-validation decision
- documented bounded recursive AT-SPI traversal contract
- traversal privacy-boundary tests and explicit unsupported traversal request rejection
- documented schema and validator update path for bounded traversal
- unsupported traversal request-shape fixtures for future bounded traversal validation
- explicit desktop accessibility-tree request validation
- explicit focused desktop inspection request validation
- explicit CLI validation for desktop inspection flags
- documented desktop request contract baseline and coverage map
- documented desktop helper-side limit hint contract
- tested desktop helper limit argument derivation
- Node helper invocation uses derived AT-SPI limit arguments
- Rust helper parses and enforces AT-SPI limit hints
- documented one-shot stdio helper transport decision
- documented traversal root authorization model
- documented in-process desktop disclosure registry design
- in-process desktop disclosure registry module and unit tests
- successful desktop inspections populate the disclosure registry after provenance append
- desktop disclosure refs are revoked when desktop inspection is narrowed by module
- documented future desktop root-ref exposure path
- fixture and tests document future `desktop_ref_id` locations while current schema rejects them
- documented future traversal request validation against disclosed root refs
- disabled pure traversal request validator scaffold and tests
- endpoint traversal guard rejects root_ref traversal before helper invocation or provenance
- documented future traversal helper command and output contract
- disabled traversal helper argument derivation fixtures
- Rust traversal helper argument parser scaffold and tests
- fixture documents future traversal output schema while current schema rejects traversal
- fixture documents future traversal output validator cases while current validator rejects them
- traversal-specific schema artifact exists under
  `docs/schemas/desktop-inspection-result-with-traversal.schema.json` while the default schema
  remains unchanged
- pure future traversal output validator scaffold remains disconnected from current schema
- explicit future traversal output validator tests for node count, children-per-node limits, and
  `text_content_included=false`
- disabled traversal-aware full inspection validator gate while default runtime validation rejects
  traversal
- named traversal-authorized runtime validator/assertion while the default desktop inspection
  validator/assertion remains traversal-closed
- future full desktop inspection schema draft with bounded traversal while active schema remains
  closed
- app/provider-overreach coverage rejects traversal-shaped helper output before disclosure registry
  writes or provenance
- documented future traversal provenance summary fields
- pure future traversal provenance summary builder remains disconnected from current provenance
- validated future traversal provenance adapter checks traversal output before producing summary-only
  fields while active provenance behavior remains unchanged
- documented traversal enablement sequence and remaining gates
- reviewed traversal activation gates and identified schema artifact promotion as the next safe
  pre-activation slice
- documented Rust traversal implementation plan and test matrix
- documented traversal schema activation decision: traversal output uses a traversal-authorized
  schema/runtime path, while default desktop inspection validation remains closed
- pure Rust traversal output structs and JSON builder tests while helper command remains disabled
- pure Rust in-memory breadth-first traversal tests while helper command remains disabled
- internal Rust traversal query boundary helper while helper command remains disabled
- private Rust traversal bridge connects validated args, bounded traversal assembly, and the live
  AT-SPI query boundary while the public helper command remains disabled
- internal Node traversal helper invocation path derives args and validates traversal helper output
  through the future traversal-output validator while the endpoint remains disabled
- internal traversal-bearing desktop inspection adapter routes helper traversal output through the
  traversal-authorized runtime assertion while the default assertion remains traversal-closed
- command-level Rust traversal execution test proving `inspect-atspi-traversal` remains disabled
  with valid-looking args and emits no traversal JSON
- traversal activation checklist migrated into canonical enablement sequence; same-day traversal
  reviews cross-reference each other
- traversal refusal integration tests prove request-shaped traversal fails before helper invocation,
  registry authorization, disclosure registry writes, or provenance append
- request-enablement readiness review completed; public traversal activation remains blocked on an
  internal Node orchestration seam
- internal traversal request pipeline composes root-ref validation, disclosure-registry authorization,
  helper invocation, traversal attachment, and summary provenance while the public endpoint remains
  refused
- internal traversal pipeline readiness review completed; public Rust command activation remains blocked
  on a stable unavailable traversal output contract
- stable unavailable traversal output contract added to traversal validator, traversal-specific schemas,
  fixtures, helper contract docs, and summary-only provenance tests while public traversal remains refused
- unavailable traversal output contract review completed; public Rust command activation remains blocked
  on Rust-side unavailable output modeling and command-level tests
- internal Rust unavailable traversal output builder emits the stable zero-node unavailable shape while
  the public `inspect-atspi-traversal` command remains disabled
- Rust unavailable traversal output review completed; public command activation remains blocked on
  cross-contract Rust-shaped output validation through the Node traversal validator
- Rust-shaped successful and unavailable traversal helper output fixtures validate through the Node
  traversal output validator while public traversal remains disabled
- traversal helper output contract review completed; public command activation remains blocked on
  command-level activation test scaffolding
- command-level traversal activation test scaffold added through an internal Rust command-output seam
  with injected success/unavailable providers while public command behavior remains disabled
- command-level traversal activation scaffold review completed; public command activation remains
  blocked on deterministic command-dispatch integration coverage
- deterministic public traversal command activation harness design selected: fake `busctl` on `PATH`
  for real-binary command-dispatch tests without a live AT-SPI session
- fake-`busctl` integration-test helper scaffold added while the public traversal command remains
  disabled and proves valid disabled-command args do not invoke the fake helper
- fake-`busctl` traversal command activation harness review completed; next activation can be scoped
  to the Rust helper command while Node endpoint traversal refusal remains active
- bounded Rust traversal helper command activated with fake-`busctl` success and unavailable
  integration coverage while the Node endpoint remains refused
- Rust traversal helper command activation review completed; Node endpoint enablement remains blocked
  on endpoint-level authorization, validation, provenance, and narrowing coverage
- Node traversal endpoint enablement readiness checklist added; public endpoint remains blocked on
  endpoint-level success, unavailable, authorization-failure, helper-output-failure, provenance, and
  narrowing coverage
- Node traversal endpoint activation case fixture and hard-refusal scaffold test added for future
  success, unavailable, authorization-failure, and request-validation paths
- Node traversal endpoint activation scaffold review completed; endpoint enablement remains blocked
  on helper-output-failure and narrowing/revocation endpoint fixture coverage
- Node traversal endpoint activation fixture extended for helper-output-failure and
  narrowing/revocation paths while all activation cases remain hard-refused
- extended Node traversal endpoint activation fixture review completed; remaining endpoint activation
  work is converting fixture cases into active endpoint assertions while preserving hard-gate
  invariants
- final Node traversal endpoint enablement review completed; endpoint activation is ready for a
  guarded implementation slice that replaces hard refusal only with converted active assertions
- public Node traversal endpoint activated behind disclosure-registry authorization, traversal
  helper-output validation, traversal-authorized response validation, and summary-only provenance
- public Node traversal endpoint activation review completed; activation accepted with no rollback
  or immediate code cleanup required
- traversal artifact lifecycle disposition completed with stable active API names, compatibility
  delegates for Future-prefixed exports, active endpoint fixture metadata, and historical
  Future-prefixed schemas/fixtures retained where they preserve migration context
- writable grant mutation prerequisites documented with explicit user-decision provenance,
  fail-closed validation, idempotent revocation, supersession, mutation test requirements, and no
  runtime write enablement
- grant mutation validator scaffold added with pure create/revoke/supersede/expire state
  transitions, exact catalog/provider checks, explicit user-decision requirements, idempotent
  revocation tests, and no route, CLI, file-write, or activation path
- Sensorium integration scaffold added for jetsorano with disabled-first capability catalog entries,
  provider registry entry, request validation, overreach tests, provenance/disclosure shapes, Rust
  sensor-broker lifecycle, Node helper manager, `SensoriumSubscriber`, and an injected HTTP
  subscription seam that remains fail-closed without an active grant and configured subscriber
- Sensorium runtime opt-in added behind `SOMA_SENSORIUM_ENABLED`, with default-off startup,
  configurable helper path, clear helper startup failure, and shutdown cleanup for the helper
- Sensorium grant constraint enforcement added for `max_seconds`, `max_fps`, `format_required`,
  and `downsample_to`, with denials before subscriber invocation and inherited grant bounds for
  omitted request constraints
- Sensorium durable grant review design documented with session-only first posture, review fields,
  lifecycle mapping, and fail-closed migration triggers
- non-writing Sensorium grant proposal template added for review-ready proposal objects without
  grant writes or subscription activation
- Sensorium proposal review endpoint and CLI command added for non-activating operator inspection
- Sensorium proposal creation endpoint and CLI command added to store pending proposals with
  review context while preserving no grant write and no subscription activation
- non-writing Sensorium grant-create candidate builder added for approved proposals, with tests
  proving approval alone does not create grants or activate subscriptions
- explicit Sensorium session grant creation endpoint and CLI command added for approved proposals,
  preserving exact topic authority while keeping grant creation separate from subscription
  activation and durable config writes
- explicit Sensorium session grant revocation endpoint and CLI command added, stopping active
  subscriptions tied to the grant and preserving runtime-only metadata provenance
- ergonomic Sensorium CLI subscription commands added for start, stop, and active disclosure using
  the existing guarded subscription routes
- Sensorium CLI/operator hardening tests added against `createRequestHandler`, covering no-grant,
  exact-topic, constraint, stop-id, and payload-free disclosure paths
- opt-in Sensorium live smoke runbook added for helper-backed status subscriptions without default
  grants, recording, decoding, or preprocessing
- guarded Sensorium live smoke wrapper added behind `SOMA_SENSORIUM_ENABLED=1` and
  `SOMA_SENSORIUM_LIVE_SMOKE=1`, printing the exact CLI commands before running the
  status-topic-first runtime grant/subscription/revocation flow
- Sensorium live smoke wrapper hardened to wait for metadata-only sample counters and fail with
  `no_samples_observed` when the control path completes but the publisher delivers no samples
- live smoke verification run confirmed the Soma/helper control path and metadata-only cleanup,
  but did not observe status samples from `sensor/jetsorano/status`; `jetsorano` is LAN-reachable,
  while SSH inspection is blocked until host key verification is resolved
- diagnosed the first publisher delivery blocker: Sensorium was not running; after starting the
  existing Docker compose deployment, the Jetson-local subscriber check received
  `sensor/jetsorano/status`; Soma still needs explicit Zenoh client config because the workstation
  is on `192.168.21.0/24` and `jetsorano` is on `192.168.20.0/24`
- added `SOMA_SENSORIUM_ZENOH_CONFIG` wiring so Soma can pass an explicit Zenoh client config into
  the helper; rerunning the guarded smoke wrapper against the current Sensorium endpoint observed
  one status sample and completed with metadata-only cleanup
- pinned the live Sensorium publisher on `jetsorano` to `tcp/192.168.20.179:7447` and updated
  Soma's example Zenoh client config to use the stable endpoint for repeatable live smoke tests
- reran the guarded wrapper from a fresh Soma service using the stable endpoint; observed two
  status samples and confirmed process-local grant revocation plus metadata-only cleanup
- added bounded status payload observation for `perception.sensorium.status.subscribe`: Soma may
  summarize schema version, hostname, uptime, node version, and enabled stream tails while
  rejecting raw payload retention and counting malformed/unexpected schema payloads as mismatches
- verified bounded status observation against the live `jetsorano` publisher: the guarded smoke
  observed two samples, `schema_version_observed: 1`, `schema_mismatches: 0`, and a metadata-only
  status summary listing the active Sensorium stream tails
- added `soma sensorium status`, a read-only operator CLI surface that filters active Sensorium
  disclosure to bounded status summaries without creating grants, starting subscriptions, or
  exposing raw payload bytes
- added producer-profile disclosure to bounded status summaries: Soma can now surface Sensorium's
  native color/depth profile metadata, such as `1280x720 @ 30fps`, while keeping capture control on
  the producer side and delivery bounds in Soma grants
- drafted the first higher-risk Sensorium stream contract for color: allowed summary fields are
  schema version, frame number, dimensions, format, and payload size; image bytes, screenshots,
  raw frames, timestamps, and cross-stream fields are contract violations
- added bounded color payload metadata decoding: the subscriber records only schema version,
  first/last frame number, dimensions, format, and payload size in disclosure/provenance; raw image
  bytes are not retained or routed to model context
- added an explicit camera-class live smoke guard: color/depth smoke targets require an extra
  camera acknowledgement plus bounded video constraints, and color smoke validates metadata-only
  `stream_summary_observed` before passing
- verified an explicitly acknowledged live color metadata smoke against `jetsorano`; the run found
  and fixed missing helper-side `max_fps` delivery throttling, then passed with nine metadata-only
  samples over eight seconds and clean runtime grant/subscription cleanup
- documented the Sensorium color minimization boundary for `downsample_to` enforcement before any
  model-facing visual delivery
- implemented helper-side color JPEG minimization: `soma-sensor-broker` can downsample Sensorium
  `ColorFrame` MessagePack payloads to the requested bounds before notifying Node, and the live
  smoke wrapper checks observed dimensions
- verified the live color minimization boundary against `jetsorano`: `downsample_to=320x240`
  produced bounded `320x180` metadata, nine samples over eight seconds, and clean runtime cleanup
- surfaced helper stream errors as bounded metadata: `sensorium.subscription.error` notifications
  record only sanitized `error_class` in active disclosure and subscription-ended provenance, with
  no payload or helper diagnostic content copied into Node-visible state
- enforced Sensorium `max_seconds` duration bounds in `SensoriumSubscriber`: declared timeouts stop
  helper subscriptions with `termination_reason: "timeout"`, and manual stop/revocation clear
  pending timeout handles
- wired automatic Sensorium subscription endings into app provenance through a bounded callback:
  timeout end summaries are whitelisted before logging and remain inspectable through the existing
  provenance query surface
- ran post-hardening Sensorium live smoke regression against `jetsorano`: status smoke observed two
  samples, explicitly acknowledged color smoke observed eight bounded samples, manual color metadata
  remained `320x180` JPEG, and cleanup returned to zero active subscriptions
- added the first Sensorium depth metadata contract: allowed summaries are limited to schema,
  frame number, dimensions, `png` format, positive finite `depth_units`, and payload size, while
  raw depth arrays, geometry, screenshots, text, and model-facing delivery remain excluded
- added a standalone Sensorium depth payload summarizer and bounded disclosure/provenance copying
  for `depth_units`; live depth activation remains blocked on helper-side depth minimization
- implemented helper-side depth PNG minimization: `soma-sensor-broker` can downsample Sensorium
  depth payloads to requested bounds, fail closed on malformed MessagePack/PNG/units, and Node now
  forwards depth camera-class transform constraints before recording bounded depth metadata
- verified explicitly acknowledged live depth metadata smoke against `jetsorano`: bounded
  `format=png` depth summaries included positive `depth_units`, downsampled dimensions stayed within
  `320x240`, runtime cleanup returned to zero active subscriptions, and model-facing delivery
  remained unavailable
- documented the model-facing visual delivery boundary: visual payload attachment requires a
  separate capability/grant, participant-visible preview, no default retention, byte-free
  provenance, and metadata-only Sensorium subscriptions remain the default posture
- documented implementation guide and component review scope
- CI for Node tests and Rust helper build

Current authority boundary:

- Node owns policy, provenance, CLI/API, harness modules, and model routing.
- Rust helpers execute bounded host capabilities and return structured results.
- MCP may become an adapter/facade layer, but not the trust boundary.
- New behavior should enter through capability definitions, provider manifests, grants, harness
  modules, runtime profiles, or bounded broker helpers rather than central one-off handlers.

## Next Slice

Add a dry-run model visual attach request refusal surface.

Target:

```text
visual attach request dry-run
  -> expose the existing visual attach request validator through a dry-run route
  -> return validation acceptance/refusal without accepting payload-shaped fields
  -> keep accepted dry-runs non-delivering and non-retaining
  -> leave prompt assembly and live model delivery out of scope
```

Expected work:

- add the smallest dry-run operator surface for visual attach request validation
- preserve the existing Sensorium subscription flow and request validators
- keep model-facing payload delivery and durable retention out of scope

Constraints:

- no desktop capability expansion
- no additional desktop fields beyond the activated traversal envelope
- no text, names, descriptions, states, actions, screenshots, or actuation
- no live camera subscription without explicit operator assent
- no loss of operator narrowing controls
- no change to the current runtime validator behavior
- no default sensor subscription, recording, model-facing frame delivery, or unbounded preprocessing
- no model-facing visual payload delivery in this slice

## Near-Term

- Add writable grant/revocation mutation only after the grant lifecycle prerequisites are met.
- Expand bounded AT-SPI inspection from shallow child metadata into opt-in recursive traversal only
  after focused inspection boundaries are validated.
- Preserve operator narrowing controls as traversal expands.
- Add a separate `desktop.inspect.text` grant path before any child names, descriptions, text
  content, states, or actions are exposed.
- Expand provenance for future desktop inspection modes without storing large trees by default.
- Add a clearer module/provenance operator surface.
- Decide whether Rust helper communication should remain one-shot stdio or move to JSON-RPC over
  stdio/Unix socket.
- Design, but do not implement, the remote-planner provider contract, payload minimizer, plan
  validator, and disclosure preview.

## Later

These require explicit design review before implementation:

- durable memory
- vector retrieval
- remote model/public utility bridge
- remote planning provider
- STT and TTS
- native multimodal audio
- visual embodiment
- browser automation
- filesystem writes
- shell execution
- screen/camera/microphone perception
- remote graphical session provider, possibly Sunshine/Moonlight, as a governed visual session
  surface rather than the local desktop authority boundary
- desktop actuation
- input synthesis through `wtype`, `ydotool`, `uinput`, or `xdotool`

## Audio Note

Some local model runtimes may support native multimodal audio, which could reduce the need for a
separate STT/TTS stack. The consent boundary remains separate from the implementation path.

Audio should still be gated by distinct capabilities:

- microphone capture
- transcription or native audio input
- transcript-derived memory writes
- synthesis or native audio output
- audible speech/output device use

Implementation path may vary; harness terms should remain stable.
