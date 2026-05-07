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
- ephemeral in-process session memory
- bounded in-process provenance log with filters and summary
- text-only cognitive-load stewardship
- scoped read-only file access
- read-only desktop broker environment inspection
- Rust `soma-desktop-broker` helper scaffold
- bounded AT-SPI bus participant and root-object metadata inspection
- focused-object inspection endpoint and CLI, disabled by default
- bounded AT-SPI active-descendant focus lookup with fail-closed unavailable reasons
- self-scoped narrowing modules for revocation
- proposal show/review endpoint and CLI surface
- proposal notification endpoint and CLI surface
- documented modular harness invariant and extension boundary
- CI for Node tests and Rust helper build

Current authority boundary:

- Node owns policy, provenance, CLI/API, harness modules, and model routing.
- Rust helpers execute bounded host capabilities and return structured results.
- MCP may become an adapter/facade layer, but not the trust boundary.
- New behavior should enter through capability definitions, provider manifests, grants, harness
  modules, runtime profiles, or bounded broker helpers rather than central one-off handlers.

## Next Slice

Make the provider/broker boundary more concrete so Soma stays modular as capabilities grow.

Target:

```text
capability contract
  -> provider manifest
  -> policy-checked invocation
  -> schema-checked broker result
  -> provenance record
```

Expected work:

- define the first provider invocation contract in docs
- ensure desktop broker calls remain behind capability-specific adapters
- add tests that reject provider overreach for focused inspection and tree inspection
- keep helper output schema-checked before provenance records are written
- preserve the distinction between provider support and user-granted authority

Constraints:

- no generic all-powerful desktop provider
- no plugin installation as permission
- no model-defined capability keys for activation
- no bypass around the catalog/provider/grant path
- no merging desktop, memory, audio, filesystem, and model behavior into a single broker

## Near-Term

- Add writable grant/revocation mutation only after the grant lifecycle prerequisites are met.
- Consider replacing the hand-rolled desktop inspection validator with a JSON Schema validator if
  the schema becomes broader or externally consumed.
- Expand bounded AT-SPI inspection from shallow child metadata into opt-in recursive traversal only
  after focused inspection boundaries are validated.
- Preserve operator narrowing controls as traversal expands.
- Add a separate `desktop.inspect.text` grant path before any child names, descriptions, text
  content, states, or actions are exposed.
- Expand provenance for future desktop inspection modes without storing large trees by default.
- Add a clearer module/provenance operator surface.
- Decide whether Rust helper communication should remain one-shot stdio or move to JSON-RPC over
  stdio/Unix socket.

## Later

These require explicit design review before implementation:

- durable memory
- vector retrieval
- remote model/public utility bridge
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
