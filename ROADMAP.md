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
- documented implementation guide and component review scope
- CI for Node tests and Rust helper build

Current authority boundary:

- Node owns policy, provenance, CLI/API, harness modules, and model routing.
- Rust helpers execute bounded host capabilities and return structured results.
- MCP may become an adapter/facade layer, but not the trust boundary.
- New behavior should enter through capability definitions, provider manifests, grants, harness
  modules, runtime profiles, or bounded broker helpers rather than central one-off handlers.

## Next Slice

Add explicit Sensorium session grant creation path after approved proposal.

Target:

```text
sensorium session grant creation
  -> create an active session grant only from a validated approved-proposal candidate
  -> preserve explicit user decision and review provenance
  -> keep grant creation separate from subscription activation
  -> keep Sensorium grants out of default config
  -> keep subscription route bounded by active grant constraints
```

Expected work:

- add a narrow grant creation endpoint or CLI command that consumes the validated candidate
- require explicit user actor and approved proposal provenance
- preserve exact provider, topic, and constraints from the approved proposal candidate
- return `activation_performed: false` and do not start a Sensorium subscription
- add tests for successful session grant creation and failed candidate validation
- do not add Sensorium grants to `config/grants.json`
- do not add CLI activation for Sensorium subscriptions in this slice
- do not activate subscriptions from grant creation
- keep provenance metadata-only; do not record frames or payloads

Constraints:

- no desktop capability expansion
- no additional desktop fields beyond the activated traversal envelope
- no text, names, descriptions, states, actions, screenshots, or actuation
- no loss of operator narrowing controls
- no change to the current runtime validator behavior
- no default sensor subscription, frame decoding, recording, or preprocessing

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
