# Inference Substrate — `infer` (design plan, draft)

**Status:** design draft for review (Seth) + execution (Codex). Not started. Supersedes the
"should Soma own the voice images?" question — the answer is *neither Soma nor TheCommons*.

## Problem

The local inference services — LLM, speech-to-text, text-to-speech — are shared infrastructure
consumed by **multiple** parties: Soma (Quest work), TheCommons (3D-space voice), and **Hermes, a
third-party harness**. Today they're mislocated:

- Images are built and tagged under `thecommons/*:dev` (TheCommons owns the build).
- The STT/TTS **service source** lives in `TheCommons/services/{whisper-stt,kokoro-tts}`, and a copy of
  `kokoro-tts` has already started drifting into `Soma/services/` — the same duplication we just
  eliminated for model weights.
- Container/config names drifted toward one consumer (`soma-brain`, `soma-*`).

Putting shared substrate inside any one consumer is a category error: it makes the *other* consumers
(Hermes, TheCommons) implicitly depend on that consumer being present and up. **Soma is a harness — a
consumer of inference, not the substrate that provides it.** "TheCommons owns it" is wrong for the same
reason; "Soma owns it" is the same mistake wearing a different name.

## Decision

A dedicated inference-substrate layer, **`infer`**, that is a *peer* to the harnesses — owned by none of
them. It owns the inference containers, their compose, the STT/TTS service source, and its own
lifecycle. Consumers point at stable endpoints. This is the software realization of the already-stated
"inference as an always-on utility/appliance, peer to the network appliance" thesis, and it is the clean
prerequisite for the dedicated inference box: when the box arrives, `infer` relocates to it and consumers
change only an endpoint host.

## Nomenclature (functional, model-agnostic)

Two naming registers, kept strictly apart:
- **Beings and places** (evocative, carry continuity/selfhood): Sanctuary, the-between, agent names.
  Never used for utilities.
- **Utilities** (deliberately boring, functional): the inference layer.

So the substrate is named for its *function*, never the model, and never from the identity register:

| Layer | Name | Never |
|---|---|---|
| Namespace | `infer` | ~~hearth, soma, thecommons~~ (identity/consumer names) |
| LLM / reasoning | `infer-llm` | ~~qwen, gemma, brain~~ |
| Speech → text | `infer-stt` | ~~whisper~~ |
| Text → speech | `infer-tts` | ~~kokoro~~ |

- Container/service names: `infer-llm`, `infer-stt`, `infer-tts`.
- Image tags: `infer/llm`, `infer/stt`, `infer/tts`.
- `soma-brain` → `infer-llm` (drops both the consumer prefix and the anthropomorphic "brain").

## Contract (what consumers rely on)

- **Stable endpoints per function** (the consumption contract, unchanged across model swaps):
  `infer-llm` `:8000/v1` (OpenAI-compatible), `infer-stt` `:4001`, `infer-tts` `:4010`.
- **Model identity is DATA, discoverable at runtime — never in the name.** Every service exposes:
  - `GET /health` — liveness only, fast (for systemd + the `agents` dependency check): `{"status":"ok"}`
  - `GET /info` — identity: `{"function":"stt","model":"faster-whisper-large-v3-turbo","revision":"…","runtime":"…","ready":true}`
  - The LLM already satisfies this: `/v1/models` reports the alias (`infer-llm`), `/props` reports the
    real GGUF + params. STT/TTS FastAPI wrappers must **add `/info`** (currently `/health` is liveness only).
- Model swaps change the `/info` payload only — never a name, endpoint, or any consumer config.

## Ownership split

**`infer` owns:**
- the substrate compose YAML(s) for `infer-llm` / `infer-stt` / `infer-tts`
- the STT/TTS **service source** (Dockerfiles + code), moved out of both TheCommons and Soma
- image builds/tags `infer/*`
- the model library at **`/home/infer/models`** (moved from `/home/models`, same-fs rename; `/srv/models`
  bind retired)
- **its own invocation** — a systemd **system** unit brings the substrate up as an always-on utility
  (survives logout); NOT a harness launcher. `/home/infer` is both the code home and the invocation space

**Consumers (Soma, Hermes, TheCommons) own only their consumption:**
- which endpoint + function name they call
- they do NOT define or own the substrate's lifecycle
- `agents` may `/health`-check `infer-llm` as a dependency, but must not be responsible for bringing it up

## Migration steps (Codex-executed, staged; reversible; verify each consumer against endpoints)

1. **Create the `infer` layer at `/home/infer`** — a **git repo** at the `/home` top level, deliberately
   OUTSIDE `~/project-repos` (that's for harnesses/projects; `infer` is infrastructure, not a harness).
   Layout:
   ```
   /home/infer/               (git repo — the substrate home + invocation space)
     docker-compose.yml        # infra YAMLs (versioned)
     services/{stt,tts}/       # STT/TTS service source (versioned)
     systemd/                  # unit file(s) (versioned)
     models/                   # weight library, GITIGNORED — moved from /home/models
       {gguf,whisper,kokoro,hf}/
     README.md                 # this doc
   ```
   Move `/home/models` → `/home/infer/models` (same-fs rename on the 2TB btrfs, instant) and **retire the
   `/srv/models` bind** + its fstab entry — the compose references `/home/infer/models` (or `./models`)
   directly, which is simpler and drops the boot-order dependency.
2. **Relocate STT/TTS source** into `infer/services/{stt,tts}`; reconcile the `kokoro-tts` duplication
   (verify Soma's vs TheCommons' copy, pick canonical, delete both stray copies); build `infer/stt`,
   `infer/tts`.
3. **Add `/info`** to the STT/TTS wrappers (function + model + revision + runtime).
4. **Rename** `soma-brain` → `infer-llm` (service/container/`--alias`) using the stable-name discipline.
5. **Repoint consumers:** remove the inference services from Soma's + TheCommons' composes (they consume,
   not define); Hermes `model.default: infer-llm` + endpoint; `agents` `MODEL=infer-llm`.
6. **systemd:** a **system** unit runs `docker compose` from `/home/infer` as an always-on service (survives
   logout); consumers depend on the endpoints being up, not on bringing them up.
7. **Retire** the inference blocks from Soma's + TheCommons' composes entirely (both fully consume `infer`);
   remove the stray STT/TTS service copies.

## Decisions (all resolved 2026-08-17, Seth)

- **Home of `infer`: `/home/infer`** — a git repo at the `/home` top level, outside `~/project-repos`
  (which is for harnesses/projects), structurally marking inference as infrastructure. `models/`
  gitignored inside it; `/home/models`→`/home/infer/models`; `/srv/models` bind retired.
- **systemd: SYSTEM service** — truly always-on, survives logout. A system-level unit (root) runs
  `docker compose` from `/home/infer`; consumers just depend on the endpoints being up.
- **TheCommons: FULLY CONSUMES `infer`** — its compose stops defining whisper/kokoro/LLM entirely (no
  independent voice stack); it points at the `infer` endpoints like any other consumer. One substrate,
  zero duplication.
- **Image distribution: DEFERRED** — local `docker build` on the box for now; revisit a small local
  registry only when the dedicated inference box exists and needs to pull the same images.

## Related

- `reference_soma_inference_stack.md` (current stack + `/srv/models` library + soma-brain, to be renamed)
- `project_dedicated_inference_server.md` (the always-on-utility thesis; `infer` is its software form and
  the box's prerequisite)
- `project_hermes_soma_integration.md` (Hermes is a first-class consumer of `infer-llm`)
