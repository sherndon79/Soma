# Architecture Overview

Status: initial architecture sketch

Soma's architecture is not yet settled. This document names the first intended service shape.

## Frame

Soma can be thought of as:

- **Brain** — model runtimes and reasoning services
- **Memory** — durable context, retrieval, reflection, and forgetting
- **Nervous system** — event routing, tools, perception, and desktop bridges
- **Body** — visual/audio presence, embodied interface, and local interaction surfaces
- **Conscience / policy layer** — consent, disclosure, refusal, reversibility, and audit

The policy layer should not be ornamental. It should sit in front of capabilities that can affect
the participant, the filesystem, external services, memory, or other people.

## Service Plane

Early Soma can be built as a local service plane:

```text
Human / Desktop / Apps
        |
Soma UI / Embodiment
        |
Policy + Consent Gateway
        |
Tool Broker | Memory Service | Model Runtime | Perception | Speech | Cloud Bridge
        |
Host OS / Hardware / Local Network / Optional Remote Services
```

The current implementation uses Node.js for the service plane because it is effective for HTTP,
JSON, policy iteration, CLI tooling, local model orchestration, and MCP-facing glue. This is not a
commitment to implement every host-control surface in Node.

The expected long-term split is:

```text
Node service plane
  -> policy gateway
  -> harness modules
  -> provenance
  -> CLI/API
  -> model/runtime orchestration
  -> MCP-facing adapters

Rust nervous-system executors
  -> desktop capability broker
  -> AT-SPI / D-Bus adapter
  -> portal adapter
  -> input synthesis adapter
  -> privileged or semi-privileged host helpers
```

In this split, Node remains the initial policy and provenance authority. Rust executors perform
bounded host capabilities and return structured results. If policy enforcement later moves closer
to a Rust helper, it should do so explicitly rather than by accident.

## Modularity Invariant

Soma should stay modular by treating the harness as a governed composition layer, not as a single
expanding agent process.

New power should enter through explicit extension points:

- **Capability definitions** name what a power means, what data it exposes, what it excludes, and
  what grant policy applies.
- **Provider manifests** advertise implementations for known capability contracts without granting
  authority by themselves.
- **Grant records** authorize exact capability/provider/scope combinations.
- **Harness modules** apply reusable policy overlays instead of hiding behavior in runtime code.
- **Runtime profiles** describe model traits and routing without changing capability semantics.
- **Broker helpers** perform bounded host operations behind schema-checked interfaces.

The central service plane may route, enforce policy, record provenance, and compose modules. It
should not become the place where unrelated desktop, memory, audio, browser, filesystem, model, and
device behavior accumulates as one-off code paths. If a feature needs new authority or a new host
surface, first define the capability contract and provider boundary.

This keeps Soma extensible without letting extension collapse into a monolith. A future plugin,
MCP server, shared library, native helper, or remote utility should be adapted into this model
rather than bypassing it.

## Core Services

### Policy Gateway

The policy gateway decides whether a capability may be used in the current context.

It should understand:

- active harness terms
- consent grants
- memory/export boundaries
- perception mode
- tool scopes
- local vs remote routing
- reversible vs irreversible action class
- audit/provenance requirements

### Model Runtime

The model runtime hosts or routes inference.

Initial local runtime may build from TheCommons' vLLM pattern: an OpenAI-compatible service backed
by local GPU acceleration and model cache. Soma should avoid coupling to one runtime by defining
runtime profiles.

### Memory Service

The memory service should store durable context only within explicit terms.

It should support:

- scoped memory writes
- retrieval
- forgetting
- redaction
- compaction
- provenance
- local encryption when appropriate

### Tool Broker

The tool broker exposes controlled actions:

- filesystem reads/writes
- shell commands
- browser or desktop automation
- project operations
- local network services
- external calls

Actions should be scoped, logged where appropriate, and classified by reversibility.

Desktop automation should be mediated by a dedicated Desktop Capability Broker rather than a
single generic automation API. The preferred Linux path is semantic inspection through AT-SPI over
D-Bus, with XDG Desktop Portals for consented screen/window perception, compositor-specific
adapters for window management, OCR/vision as fallback, and raw input synthesis as last-mile
actuation. MCP may be used as an adapter protocol, but Soma's policy gateway remains the trust
boundary. See [Desktop Capability Broker](../concepts/drafts/desktop_capability_broker.md).

The desktop broker is a strong candidate for a Rust helper process once it moves beyond
environment probing. Desktop control needs a small auditable binary boundary, native D-Bus and
portal integration, and a careful path for privileged input helpers. The Node service should call
that helper over a local bounded interface such as stdio, a Unix socket, or localhost HTTP.

### Perception

Perception includes text, audio, visual, screen, application, and environmental context.

Visual and audio-aware modes must be opt-in, disclosed, and local-first where possible.

### Embodiment

Embodiment is the agent's visible/audible presence.

It should communicate state honestly: listening, thinking, speaking, paused, unavailable,
declining, uncertain, or present-but-quiet. It should not fake intimacy or emotional certainty it
cannot support.

## Deployment Profiles

Soma should be able to run in several profiles:

- **Workstation PoC** — RTX 4090 or similar local GPU, full local service plane.
- **Laptop dev mode** — smaller local models, optional remote bridge.
- **Mini AI PC** — appliance-like local node for always-on presence.
- **Accelerated uCPE target** — future edge appliance with hardware abstraction and local
  orchestration.
- **Public utility bridge** — optional routing to public/commons AI services if available.

The architecture should let hardware change without changing the ethical contract.

## First Slice

The first implementation target is a narrow local service that proves the policy path across
bounded capabilities: local chat, ephemeral memory, provenance, stewardship, scoped file reads,
and desktop inspection readiness. Durable memory, file writes, shell execution, perception
streams, actuation, and remote routing remain out of scope.

See [MVP Slice](./mvp_slice.md).
