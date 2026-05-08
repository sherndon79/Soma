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
- CI for Node tests and Rust helper build

Current authority boundary:

- Node owns policy, provenance, CLI/API, harness modules, and model routing.
- Rust helpers execute bounded host capabilities and return structured results.
- MCP may become an adapter/facade layer, but not the trust boundary.
- New behavior should enter through capability definitions, provider manifests, grants, harness
  modules, runtime profiles, or bounded broker helpers rather than central one-off handlers.

## Next Slice

Decide whether the desktop inspection validator should move from hand-rolled checks to JSON
Schema-backed validation before broader output shapes are added.

Target:

```text
current schema document
  -> runtime validator comparison
  -> migration recommendation
  -> no behavioral broadening
```

Expected work:

- review current hand-rolled validator against `docs/schemas/desktop-inspection-result.schema.json`
- identify gaps between documented schema and runtime checks
- decide whether to add a JSON Schema dependency now or defer until traversal expands
- document the decision and migration trigger
- keep existing validator behavior and tests unchanged unless a safe replacement is implemented

Constraints:

- no schema broadening
- no new desktop fields
- no traversal expansion
- no dependency addition unless the benefit is clear and tests stay equivalent

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
