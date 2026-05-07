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
- self-scoped narrowing modules for revocation
- proposal show/review endpoint and CLI surface
- CI for Node tests and Rust helper build

Current authority boundary:

- Node owns policy, provenance, CLI/API, harness modules, and model routing.
- Rust helpers execute bounded host capabilities and return structured results.
- MCP may become an adapter/facade layer, but not the trust boundary.

## Next Slice

Expand the read-only AT-SPI inspection path from shallow child metadata to a bounded accessibility
tree.

Target:

```bash
soma-desktop-broker inspect-atspi
```

Expected shape:

```json
{
  "mode": "atspi_read_only_probe",
  "broker_source": "rust_helper",
  "tree_available": true,
  "applications": [
    {
      "name": "Example",
      "role": "application",
      "child_count": 4,
      "children_sample": [],
      "child_metadata_sample": []
    }
  ]
}
```

Constraints:

- read-only
- bounded output
- no text extraction by default
- no screenshots
- no pointer or keyboard actuation
- no model-driven desktop actions
- provenance records broker source, inspection mode, tree availability, and application count

## Near-Term

- Add proposal notification surfacing and revocation records without activation.
- Add writable grant/revocation design before implementing activation.
- Add focused-object inspection behind disabled `desktop.inspect.focus`, following the focused
  inspection draft.
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
