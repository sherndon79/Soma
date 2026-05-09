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
- CI for Node tests and Rust helper build

Current authority boundary:

- Node owns policy, provenance, CLI/API, harness modules, and model routing.
- Rust helpers execute bounded host capabilities and return structured results.
- MCP may become an adapter/facade layer, but not the trust boundary.
- New behavior should enter through capability definitions, provider manifests, grants, harness
  modules, runtime profiles, or bounded broker helpers rather than central one-off handlers.

## Next Slice

Add disabled traversal helper argument derivation fixtures.

Target:

```text
authorized traversal request
  -> helper args from authorized root
  -> helper not invoked by endpoint
  -> no traversal implementation
```

Expected work:

- add a pure helper-argument derivation function for future traversal
- test root service/path and traversal limits map to helper args
- keep current `desktopBrokerHelperArgs` behavior unchanged
- keep endpoint traversal guard unchanged
- preserve current response bodies and schemas
- keep current runtime behavior unchanged

Constraints:

- no desktop capability expansion
- no new desktop fields in runtime responses
- no text, names, descriptions, states, actions, screenshots, or actuation
- no loss of operator narrowing controls
- no change to the current runtime validator behavior

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
