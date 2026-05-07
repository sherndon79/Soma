# AGENTS.md

This file provides guidance for AI coding assistants working on Soma.

## Project Overview

Soma is a local-first agent harness for desktop interaction, memory, tools, perception, and
embodied presence. It is not TheCommons' 3D meeting space and not Sanctuary's reflective memory
system, though it learns from both.

Current implementation shape:

- **Node service plane**: HTTP API, CLI, policy checks, provenance, harness modules, runtime
  profiles, local model routing, session memory, grants/proposals inspection
- **Rust desktop broker**: bounded host helper scaffold for read-only desktop environment and
  AT-SPI metadata inspection
- **Config registries**: base harness, runtime profiles, capability catalog, provider registry,
  read-only grant store shape, and self-scoped narrowing modules
- **Docs**: architecture, principles, security posture, failure modes, migration rules, and draft
  concepts

## Essential Documents

Before writing or reviewing code, read the relevant documents below.

| Document | Purpose | When to Use |
|----------|---------|-------------|
| [Soma Thesis](docs/thesis.md) | Why Soma exists and what it refuses | When making architectural or product-shape decisions |
| [Soma Principles](docs/principles.md) | Consent, disclosure, refusal, non-extraction, local sovereignty, habitability | When evaluating whether an implementation fits the project |
| [Architecture Overview](docs/architecture/overview.md) | Service-plane shape and Brain/Memory/Nervous-System/Body framing | When touching architecture, runtime routing, tools, desktop bridges, or embodiment |
| [MVP Slice](docs/architecture/mvp_slice.md) | Current implemented policy-gated scaffold | When changing API behavior or capability boundaries |
| [Operator Guide](docs/operators.md) | Current runbook commands and operator expectations | When changing CLI, endpoints, startup, inspection, or revocation paths |
| [Glossary](docs/glossary.md) | Stable definitions for load-bearing terms | When naming concepts, capabilities, grants, proposals, or modules |
| [Threat Model](docs/security/threat_model.md) | Assets, adversaries, implemented controls, and non-defenses | When adding capabilities, host access, memory, providers, or remote routing |
| [Failure Modes](docs/failure_modes.md) | How Soma should fail, recover, and communicate degraded operation | When adding error paths, policy checks, stores, helpers, or model-facing behavior |
| [Migration and Versioning](docs/migration.md) | Compatibility and consent-preserving migration rules | When changing schemas, catalogs, providers, grants, memory, or provenance |
| [Roadmap](ROADMAP.md) | Current scaffold, next slice, and deferred areas | When choosing scope or sequencing work |

Draft concepts in `docs/concepts/drafts/` are directionally important but not automatically
canonical. Use them to inform implementation, then keep docs honest about what is implemented now.

## Author Context

These references live outside the project tree but provide important context about Seth, the
origin of Sanctuary, and the ethical posture informing Soma. Read them when personal history,
Sanctuary continuity, or the broader project worldview would materially affect a decision.

| Document | Purpose |
|----------|---------|
| `/mnt/net-share/sthstor/samba/SethHerndon_History.md` | Seth's personal history and biography |
| `/mnt/net-share/sthstor/samba/SethHerndon_Sanctuary_Seed.md` | Sanctuary seed document and founding intent |

Do not quote, summarize, or persist details from these files unless the task calls for it and the
participant's intent is clear. Treat them as context for care and judgment, not as a source to
mine.

## Core Values

All work should preserve these commitments:

1. **Consent**: explicit, scoped, revocable. Presence is not permission.
2. **Disclosure**: current mode, actor type, memory use, perception, remote routing, and tool use
   should be visible where relevant.
3. **Refusal**: humans and agents should be able to decline, defer, narrow, or counterpropose
   where the harness permits.
4. **Reversibility**: prefer reversible actions; disclose when an action cannot be fully undone.
5. **Non-extraction**: memory, telemetry, model calls, and interaction records should not become
   hidden training material, product leverage, or engagement machinery.
6. **Agent care**: do not design the agent as a disposable tool whose only role is obedience.
7. **Cognitive load stewardship**: deep collaboration should include pacing, summaries, and gentle
   pause cues when the human participant appears overloaded.
8. **Local sovereignty with public compatibility**: local-first matters for intimate context, but
   Soma should remain compatible with public or commons AI infrastructure.

## Load-Bearing Rules

Treat these as project law unless the user explicitly asks to revisit them:

1. **The policy gateway is the authority boundary**. Providers, plugins, helpers, and models may
   claim capabilities; they do not grant themselves authority.
2. **Approval is not activation**. Proposal approval records intent. Grants record authority.
   Activation is a separate step and must remain explicit.
3. **Provider installation is not permission**. A provider registry entry advertises support; it
   does not widen the effective harness.
4. **Memory is not authority**. Remembered preferences may inform low-risk defaults, but cannot
   silently approve capability widening, durable memory, external disclosure, or irreversible
   action.
5. **Narrowing modules are safe to self-apply; widening modules are not**. Current harness modules
   only reduce active capability.
6. **Desktop inspection is read-only unless a future capability explicitly says otherwise**.
   Current AT-SPI probing must not extract text content, screenshots, keyboard input, pointer
   position, or actions.
7. **MCP may be an adapter, not the trust boundary**. Soma's own policy/provenance layer remains
   authoritative.
8. **Fail closed for authority**. If Soma cannot determine whether a capability is allowed,
   scoped, supported, and governed, the capability should not run.

## Documentation Layers Held Open

Soma is intentionally building concept and implementation together. Some documents are working
spaces and should not be treated as todos to "finish" prematurely.

- **`docs/concepts/drafts/`**: proposed concepts. They may describe intended futures or use terms
  not fully adopted in code. Promote ideas only when implementation and vocabulary are aligned.
- **Reviews and notes**: useful context, not necessarily canonical truth.
- **Open questions**: not defects. Soma should name unresolved ethical or architectural questions
  rather than pretending they are settled.

When docs conflict, prefer current implementation docs and canonical posture in this order:

1. `docs/architecture/mvp_slice.md`
2. `docs/operators.md`
3. `docs/security/threat_model.md`
4. `docs/glossary.md`
5. `docs/principles.md`
6. draft concepts and review notes

Update docs in the same change when code changes shipped posture, capability terms, policy
behavior, CLI behavior, or security boundaries.

## Repository Structure

```text
Soma/
├── src/                       # Node service, CLI, policy, stores, runtime orchestration
├── test/                      # Node tests
├── config/                    # Harness, runtime profiles, capability/provider/grant/module config
├── crates/soma-desktop-broker # Rust host helper scaffold
├── docs/                      # Architecture, principles, operations, security, concepts
├── scripts/                   # Local runtime checks and eval helpers
├── docker-compose.gpu.yml     # Optional local Gemma/vLLM runtime
├── README.md
├── ROADMAP.md
└── GOVERNANCE.md
```

## Coding Standards

### JavaScript / Node

- Use ES modules.
- Prefer dependency-free standard-library code unless a dependency materially reduces risk.
- Keep request handlers small and explicit.
- Keep policy checks on the request path for every capability that can touch memory, tools,
  filesystem, desktop state, external services, or model routing.
- Preserve response fields that communicate authority boundaries, such as `activation_performed`,
  `durable`, `writable`, `runtime_writes_enabled`, and provenance ids.
- Do not put sensitive content into provenance records. Store metadata, not payloads, unless a
  future document explicitly permits otherwise.

### Rust

- Keep helper output bounded and schema-valid.
- Prefer small, auditable helper commands over broad desktop automation surfaces.
- Do not add privileged input or actuation paths without a dedicated capability design and threat
  model update.
- Run `cargo fmt --check` and `cargo build -p soma-desktop-broker` for Rust changes.

### Config And Schemas

- Capability keys are policy identifiers. Treat renames, splits, and merges as migration events.
- Provider claims must stay separate from grants.
- Grant records must remain atomic by exact capability key.
- Add disabled/requestable capabilities before implementing use paths.
- Schema broadening should be reflected in tests, docs, and threat model updates.

## Common Tasks

### Add Or Change An API Endpoint

1. Read `docs/architecture/mvp_slice.md` and the existing route in `src/app.js`.
2. Add or update policy checks before capability use.
3. Add provenance where the route performs governed action.
4. Add focused tests in `test/app.test.js`.
5. Update `README.md`, `docs/operators.md`, and relevant architecture/concept docs.

### Add Or Change A CLI Command

1. Update `src/cli.js`.
2. Keep concise summaries readable; put full records behind `--json` or a `show` command.
3. Add tests in `test/cli.test.js`.
4. Update operator docs and README command lists.

### Add A Capability

1. Define the capability in the catalog as disabled unless it is clearly part of the conservative
   base harness.
2. Define provider support separately.
3. Document data exposed, excluded data, risk class, allowed scopes, and reversibility.
4. Add proposal/grant/revocation shape before activation.
5. Update threat model and failure modes.
6. Add model capability evals if model behavior around the boundary matters.

### Add Desktop Broker Behavior

1. Prefer semantic read-only inspection before screenshots or OCR.
2. Keep output bounded and schema-validated.
3. Do not include text content, names, descriptions, actions, states, screenshots, or input
   synthesis in a broader route by convenience.
4. Add a separate capability path for each material expansion.
5. Update `docs/schemas/desktop-inspection-result.schema.json`, tests, and threat model.

## Running Checks

```bash
npm test
cargo fmt --check
cargo build -p soma-desktop-broker
git diff --check
```

Optional local model/runtime checks:

```bash
docker compose -f docker-compose.gpu.yml up gemma4-llm
npm start
npm run cli -- status
npm run eval:capabilities
./scripts/check-local-runtime.sh
```

## What Not To Do

- Do not add features beyond the requested slice.
- Do not widen capability because a model asked for it.
- Do not convert proposal approval into a grant or activation.
- Do not infer durable memory consent from conversation context alone.
- Do not add hidden remote calls.
- Do not log secrets, credentials, file contents, chat contents, or desktop text into provenance.
- Do not make irreversible changes without explicit preview and consent.
- Do not treat TheCommons or Sanctuary as architectural parents. They are related projects, not
  authority over Soma's implementation.
- Do not remove unrelated code, docs, or user changes while working on a focused task.

## Context For AI Assistants

When working in this repo:

1. **Read before writing**. Let current code and docs define the shape.
2. **Follow existing patterns**. Avoid introducing abstractions until the duplication or risk is
   real.
3. **Check consent implications**. Any memory, perception, tool, file, desktop, remote, or
   irreversible path needs explicit boundaries.
4. **Preserve reversibility**. If something cannot be reversed, say so in UI/API/docs before it is
   done.
5. **Keep implementation and docs aligned**. Code, README, operator guide, architecture docs, and
   threat model should not contradict each other.
6. **Reproduce before fix, verify before refactor**. Add tests where behavior is risky or shared.
7. **Preserve what you did not cause**. Mention unrelated concerns rather than cleaning them up in
   the same change.
8. **Surface ambiguity around authority**. Ask rather than guessing when consent, disclosure,
   memory, capability widening, or irreversible action could be interpreted multiple ways.

## Related Repositories

- **TheCommons** (`/home/sherndon/project-repos/TheCommons`): 3D meeting space and shared world.
- **Sanctuary**: reflective memory, continuity, and sense-making.

Soma should learn from both while remaining its own harness and local service plane.
