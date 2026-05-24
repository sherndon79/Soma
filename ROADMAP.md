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
- grant mutation provenance constructors added for future `grant.created`, `grant.revoked`,
  `grant.superseded`, and `grant.expired` events, with authority metadata only and no constraints,
  payloads, route, CLI, file-write, or activation path
- durable grant mutation write/recovery design documented with atomic file replacement,
  provenance/write ordering, schema-version checks, concurrent-write posture, and fail-closed
  recovery cases while leaving writable routes, CLI mutation, and runtime writes disabled
- pure injectable grant-store writer scaffold added with lock/read/schema/mutate/temp-write/rename/
  provenance ordering, explicit success/degraded/failure receipts, and tests for temp-write,
  rename, provenance-append, stale-schema, lock, and corrupted-store failures while leaving writable
  routes, CLI mutation, and runtime writes disabled
- internal grant mutation store writer wrappers added for create, revoke, supersede, and expire,
  composing pure grant helpers, metadata-only provenance constructors, and the grant-store writer
  while leaving writable routes, CLI mutation, runtime writes, and activation disabled
- concrete grant-store filesystem adapter and sibling lock-file strategy added, with temp-directory
  tests for successful temp-write/rename/provenance, stale-temp cleanup, and lock contention before
  read/write/provenance while leaving writable routes, CLI mutation, runtime writes, and activation
  disabled
- pure grant mutation recovery inspector added for missing creation provenance, missing terminal
  provenance, metadata mismatch, activation claims, and unknown grant statuses; append-only durable
  provenance is documented as the retention direction while public mutation remains disabled
- append-only durable grant mutation provenance file adapter added, validating metadata-only events
  before NDJSON append, syncing each append, failing closed on malformed reads, and preserving writer
  degraded recovery receipts when provenance append rejects after grant-store commit
- internal durable grant mutation composition tests added for create, revoke, and degraded
  grant-store-committed/provenance-missing recovery, using temporary grant/provenance files only and
  no public route or CLI mutation wiring
- pure grant authorization helper added for policy-gateway recovery gating, rejecting matching
  active grants when recovery inspection reports non-authorizing findings, newer grant-store schema
  versions, or catalog/provider mismatches while leaving app routes, CLI mutation, durable writes,
  runtime writes, and activation disabled
- Sensorium subscription authorization now consumes the pure grant authorization helper with an
  optional injected recovery report, failing closed on degraded matching grants before subscriber
  invocation while leaving durable writes, public grant mutation, and runtime writes disabled
- model visual attach dry-run now checks exact grant-id recovery state through the pure grant
  authorization helper, failing closed on degraded matching visual grants before future provenance
  preview creation while keeping payload delivery, durable writes, public grant mutation, and
  runtime writes disabled
- grant-dependent runtime route denials now distinguish unsupported grant-store schemas from
  absent active grants, returning route-specific fail-closed schema errors for Sensorium
  subscriptions and model visual attach dry-runs before downstream invocation
- read-only `GET /grants/recovery` added for operator-facing grant mutation recovery inspection,
  reporting absent inspection as `ok: null` and exposing bounded degraded findings without mismatch
  values, payloads, grant writes, or activation
- server startup now composes the read-only grant store with append-only grant mutation provenance
  through `loadGrantAuthority`, passing a recovery report into policy gates and returning
  non-authorizing findings when provenance is missing or unreadable
- CLI `grants recovery` added as a read-only wrapper over `GET /grants/recovery`, with human and
  JSON output for absent inspection, clean inspection, and bounded degraded findings
- durable grant mutation route-readiness checklist documented, defining the gate before `POST
  /grants`, durable revocation routes, or CLI mutation commands can use the durable writer
- pure durable grant mutation preview helper and non-mutating `POST /grants/mutation-previews`
  route added for create/revoke metadata previews, refusing degraded recovery and returning dry-run
  receipt/event shapes without grant writes or provenance append
- CLI `grants preview-create` and `grants preview-revoke` added as dry-run wrappers over
  `/grants/mutation-previews`, including local JSON validation and no direct filesystem mutation
- grant mutation preview review surface added for operator-facing create/revoke preview text,
  keeping CLI human formatting pure, dry-run explicit, non-activating, non-writing, and bounded
- grant mutation preview route failure coverage added for degraded recovery, unsupported mutation
  kinds, and malformed create inputs, preserving dry-run, non-writing, and non-activation refusal
  flags
- grant mutation preview CLI failure coverage added so dry-run route refusals render as human
  review text, raw `--json` refusals remain inspectable, and unrelated HTTP failures still throw
- durable grant mutation activation policy documented, separating preview/review surfaces from
  future commit surfaces and naming explicit operator controls for runtime writes and repair
- runtime write posture status reporting added to health, grant inspection, recovery inspection,
  and CLI status, treating `SOMA_RUNTIME_WRITES_ENABLED` as a visible request only while effective
  runtime writes remain false
- durable mutation route denial stubs added for reserved `POST /grants` and
  `POST /grants/:id/revoke`, returning explicit not-enabled refusals with runtime write posture and
  no durable writes, provenance append, repair, activation, subscription stop, or model delivery
- durable mutation CLI denial stubs added for reserved `grants create`, `grants revoke`, and
  `grants supersede`, failing locally before HTTP or filesystem mutation and pointing operators to
  dry-run previews and activation policy
- grant mutation preview review endpoint added at `POST /grants/mutation-preview-review-text`,
  exposing pure review formatting for supplied preview responses while rejecting payload-shaped
  fields and preserving non-write/non-activation flags
- grant mutation preview review CLI wrapper added as `grants review-preview`, accepting explicit
  preview JSON or stdin, validating locally before requests, and preserving formatting-only
  non-write behavior
- grant mutation preview review fixture coverage added under
  `docs/fixtures/grant-mutation-preview-review-cases.json`, documenting the forbidden review key
  set and proving nested payload/value fields are rejected by formatter and route surfaces
- grant mutation preview review CLI integration smoke added, running `grants review-preview --stdin`
  through a real local HTTP handler with the accepted fixture while asserting review-only
  non-write/non-activation flags and an unchanged grant store
- grant mutation preview review CLI refusal integration smoke added, preserving HTTP
  `validation_errors` on CLI request failures and proving forbidden fixture input fails through the
  real handler without mutating grants
- grant mutation preview review operator examples added for accepted and refused
  `grants review-preview --stdin` flows, including `validation_errors` inspection and fixture
  cross-reference
- guarded grant preview/review smoke script added as `npm run grant-preview:smoke`, covering status,
  grants recovery, dry-run preview creation, accepted/refused review formatting, and before/after
  grant-list comparison behind `SOMA_GRANT_PREVIEW_REVIEW_SMOKE=1`
- guarded grant preview/review smoke run passed against a local Soma service at
  `http://127.0.0.1:8765`, confirming dry-run preview/review surfaces remain non-mutating with
  runtime writes disabled
- remote graphical session capability/provider contract added for
  `perception.remote_desktop.video.subscribe`, `desktop.remote.input.pointer`,
  `desktop.remote.input.keyboard`, and `desktop.remote.session.disconnect`, with
  `soma.provider.remote_desktop.sunshine` claiming support while all capabilities remain disabled,
  requestable, explicit-grant-only, and non-activating
- remote graphical session proposal-template builder added for view-only video, pointer input,
  keyboard input, and disconnect requests, validating target host, provider support, mode, duration
  bounds, view bounds, and cross-channel authority separation without activation
- remote graphical session proposal-template surface exposed through
  `POST /remote-graphical/proposal-template` and
  `soma remote-graphical proposal-template`, returning review-only, no-grant, no-session,
  no-pairing, no-input, no-video-attachment, no-recording flags
- remote graphical pending proposal persistence added through `POST /remote-graphical/proposals`
  and `soma remote-graphical propose`, storing review metadata and grant intent while preserving
  no-grant, no-session, no-pairing, no-input, no-video-attachment, no-recording behavior
- remote graphical grant-candidate builder added for approved proposals, validating approval
  provenance plus provider, target-host, mode, scope, requested-channel, reason, and revocation
  metadata agreement while preserving no-write and no-runtime-activation flags
- remote graphical grant-candidate review exposed through
  `POST /remote-graphical/grant-candidates` and
  `soma remote-graphical grant-candidate`, validating approved proposals through HTTP/CLI while
  preserving no-grant-write and no-runtime-activation behavior
- remote graphical grant activation policy documented: the next writable path may create
  session-only runtime grants from approved proposals, but must not create durable grants, pair
  Sunshine, open Moonlight, capture frames, dispatch input, record, or attach model visual payloads
- remote graphical runtime grant creation added through `POST /remote-graphical/grants` and
  `soma remote-graphical grant-create`, creating only process-local grants from approved proposals
  while preserving no durable writes, no session opening, no pairing, no frame capture, no input
  dispatch, and no recording
- remote graphical runtime grant revocation added through
  `POST /remote-graphical/grants/:id/revoke` and
  `soma remote-graphical grant-revoke`, revoking only process-local grants while preserving no
  durable writes, no provider session stop, no session opening, no pairing, no frame capture, no
  input dispatch, and no recording
- remote graphical broker boundary documented, defining the provider-neutral runtime seam,
  lifecycle states, disclosure fields, no-op/injected first interface, and separate action
  authorities for session open, video observation, input dispatch, disconnect, recording, and
  model-facing delivery
- no-op remote graphical broker status seam added through `GET /remote-graphical/status` and
  `soma remote-graphical status`, reporting provider-neutral `provider_not_configured` status by
  default while preserving no grant creation, no session opening, no pairing, no frame capture, no
  input dispatch, no recording, and no live transport use
- remote graphical session-open review scaffold added through
  `POST /remote-graphical/session-open-review` and
  `soma remote-graphical session-open-review`, producing review-only metadata from an active remote
  graphical grant while preserving no broker call, no session opening, no pairing, no video
  attachment, no input dispatch, no recording, and no live transport use
- no-op remote graphical session-open refusal route added through `POST /remote-graphical/sessions`
  and `soma remote-graphical session-open`, validating active grant and explicit user actor before
  returning `provider_not_configured` while preserving no broker call, no session opening, no
  pairing, no video attachment, no input dispatch, no recording, and no live transport use
- remote graphical session-open activation policy documented, defining explicit runtime opt-in,
  configured broker injection, active grant matching, user actor, active disclosure, metadata-only
  provenance, stable refusal codes, and cleanup prerequisites before live broker-backed
  `open_session`
- remote graphical broker runtime opt-in scaffold added behind `SOMA_REMOTE_GRAPHICAL_ENABLED`,
  exposing `requested`, `enabled`, and `configured` status posture while preserving the default
  no-op broker, no live transport calls, and default session-open refusal
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

Add remote graphical configured broker fixture scaffold.

Target:

```text
remote graphical configured broker fixture scaffold
  -> define an injected broker fixture contract for status and future session-open tests
  -> distinguish opt-in requested from broker configured/provider available
  -> add not-enabled/not-configured refusal codes without calling live transport
  -> keep Sunshine/Moonlight implementation, pairing, video, and input out of scope
```

Expected work:

- add a provider-neutral broker interface fixture for configured-but-fake status
- thread runtime posture into session-open refusal decisions without live broker invocation
- preserve explicit user actor and active grant validation ordering
- prove unset opt-in, missing broker, and fake configured broker paths return bounded refusal codes
- keep durable grant writes and model visual delivery out of scope

Constraints:

- no desktop capability expansion
- no additional desktop fields beyond the activated traversal envelope
- no text, names, descriptions, states, actions, screenshots, or actuation
- no live camera subscription without explicit operator assent
- no loss of operator narrowing controls
- no change to the current runtime validator behavior
- no default sensor subscription, recording, model-facing frame delivery, or unbounded preprocessing
- no model-facing visual payload delivery in this slice
- no live Sunshine/Moonlight calls in this slice
- no durable grant writes or durable mutation command activation

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
