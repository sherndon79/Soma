# Local AI Service Plane

Status: draft concept

Soma should treat local AI capability as a service plane, not a single model process.

TheCommons already demonstrates an early version of this pattern with GPU-backed services:

- vLLM serving a local Gemma model through an OpenAI-compatible API
- Whisper STT
- Kokoro TTS
- voice and Echo services consuming local inference over the internal compose network

Soma can generalize that pattern without binding itself to TheCommons.

## Purpose

The local service plane should provide:

- local model serving
- speech-to-text and text-to-speech
- embeddings and retrieval
- memory services
- tool brokerage
- perception processing
- policy enforcement
- observability
- optional remote bridges

The goal is not only local inference. The goal is local governed capability.

## Workstation PoC

The first practical target can be Seth's existing workstation:

- NVIDIA RTX 4090
- local containerized model runtime
- local model cache
- local speech services
- local memory/vector services
- local policy gateway
- desktop bridge and tool broker

This is enough to validate architecture before any custom hardware exists.

The MVP includes `docker-compose.gpu.yml`, which mirrors the current TheCommons Gemma/vLLM
runtime enough to test the local model path. STT and TTS are intentionally not included yet.
Voice crosses into perception, embodiment, transcript memory, and cognitive load stewardship, so
it should wait for explicit audio harness terms.

## Future Hardware Profiles

Soma should keep hardware abstract.

Potential profiles:

- CPU-only dev mode
- CUDA workstation
- ROCm workstation
- Vulkan/llama.cpp local mode
- mini AI PC
- USB/Thunderbolt accelerator
- accelerated uCPE-style appliance
- public/remote bridge

The same harness terms should apply regardless of hardware.

## Runtime Profiles

Runtime profiles should describe capability honestly:

- model id and provenance
- local or remote
- context length
- tool-call support
- vision/audio support
- quantization
- memory footprint
- expected latency
- allowed data classes
- whether outputs may be logged

The policy gateway should be able to route based on these profiles.

## Service Boundary

An early local plane could look like:

```text
soma-ui
  -> soma-policy
      -> soma-model-runtime
      -> soma-memory
      -> soma-tools
      -> soma-speech
      -> soma-perception
      -> soma-cloud-bridge
```

The policy service should be on the path for any sensitive capability rather than bolted on after
the fact.

## Language And Process Boundary

The service plane does not need to be implemented in one language.

Current direction:

- **Node.js** for the early Soma service plane: API, policy iteration, harness modules,
  provenance, CLI, runtime orchestration, and MCP-facing glue.
- **Rust** for future nervous-system executors: desktop broker, AT-SPI/D-Bus integration,
  XDG Desktop Portals, input synthesis, and other host-control helpers.

The important boundary is not language preference. The important boundary is authority:

- Soma policy decides whether a capability is allowed.
- A helper performs a bounded operation.
- Soma records provenance before and after sensitive work.
- The helper does not silently widen its own authority.

Early helper communication can be simple:

- stdio JSON-RPC
- Unix domain socket
- localhost HTTP bound to loopback only

The first version should favor boring observability and narrow inputs over clever transport.
The current Rust desktop helper scaffold starts even simpler: a one-shot `inspect-environment`
command that emits JSON over stdout. Soma uses it when the compiled helper is present and falls
back to the Node environment probe otherwise.

## Accelerated uCPE Direction

Longer term, Soma may fit an accelerated uCPE-like device:

- commodity edge hardware
- hardware acceleration
- modular workloads
- local management plane
- service isolation
- recoverable upgrades
- observable health
- optional upstream connectivity

This draws from Seth's Edge Gateway/uCPE experience while changing the purpose: not enterprise
network-function deployment, but sovereign local AI capability.

## Open Questions

- Which runtime should be the first Soma default: vLLM, llama.cpp, Ollama, SGLang, or a thin
  abstraction over several?
- What service owns memory writes?
- Should the policy gateway be a library, service, or both?
- How should desktop tool grants be represented?
- How much of TheCommons' Go harness model should influence Soma's first implementation?
- What belongs in local-only mode versus a consented remote bridge?
