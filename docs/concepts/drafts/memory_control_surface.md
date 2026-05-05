# Memory Control Surface

Status: draft concept

Soma should treat memory as entrusted context, not an extracted profile. Remembering a participant
can make collaboration more humane, but only if the participant can inspect, correct, scope, and
revoke what is remembered and how it is used.

Memory is especially important for delegated choice. A system should not act on inferred
preference unless the memory behind that inference is consented, scoped, and allowed to influence
that class of decision.

## Core Rule

**Use memory to improve care, not to bypass agency.**

Memory may inform tone, recommendations, summaries, and low-risk defaults. Memory should not become
authority by itself.

## Informing Domains

The control surface can draw from older domains:

- privacy law and data rights: access, correction, deletion, portability, purpose limitation
- contextual integrity: information should flow only in appropriate contexts
- personal information management: user memory is messy, evolving, and sometimes contradictory
- medical record ethics: sensitivity, provenance, correction, need-to-know, audit logs
- browser and app permissions: grants, revocation, and prompt-fatigue warnings
- password managers and secrets tooling: explicit reveal, scoped access, and auditability
- trauma-informed design: avoid surveillance feeling, diagnosis, coercion, or trapped disclosure
- human relationships: tact, forgetting, not weaponizing vulnerability, and knowing when not to
  bring something up

CRM and advertising profiles are negative examples. They show how easily memory becomes
prediction, segmentation, manipulation, and extraction.

## Memory Classes

Soma should distinguish memory by source and authority.

### User-Authored Memory

The participant deliberately writes or provides memory, such as a bio, standing preference, or
project context.

This is the strongest memory class because it was intentionally given for use.

### User-Confirmed Memory

Soma notices a pattern and asks whether to remember it.

Example:

```text
I have noticed you usually prefer local-first, reversible options. Should I remember that as a
standing preference?
```

The memory becomes durable only after confirmation.

### Session Inference

Soma infers something useful in the current interaction.

Example:

```text
You seem to be prioritizing low-friction capability review today.
```

Session inference may guide the current conversation, but should not become durable by default.

### Sensitive Memory

Sensitive memory includes political beliefs, religion, health, disability, family, trauma history,
financial situation, identity, relationships, and other intimate context.

Sensitive memory may be useful and welcome, but it should require stronger user direction,
stronger review controls, and narrower allowed uses.

### Derived Preference

Derived preference is a structured standing preference inferred from authored or confirmed memory.

Example:

```text
Prefer local-first providers when they satisfy the task.
```

Derived preferences should cite their source memory and specify what they may influence.

## Memory Item Shape

An early durable memory record should include:

```json
{
  "id": "memory-123",
  "type": "standing_preference",
  "content": "Prefer local-first providers when they satisfy the task.",
  "source": {
    "kind": "user_confirmed",
    "reference": "conversation-456"
  },
  "sensitivity": "normal",
  "scope": "project",
  "purpose": "provider and capability recommendations",
  "allowed_uses": [
    "recommend_local_provider",
    "choose_low_risk_local_default"
  ],
  "forbidden_uses": [
    "approve_capability_widening",
    "reject_remote_option_without_asking",
    "make_durable_grant"
  ],
  "confidence": "high",
  "created_at": "2026-05-05T00:00:00.000Z",
  "last_reviewed_at": "2026-05-05T00:00:00.000Z",
  "expires_at": null
}
```

The critical distinction is between what is remembered and what it may be used for.

## Allowed And Forbidden Uses

Every meaningful memory should declare allowed and forbidden uses.

Example:

```text
Remembered:
Seth prefers local-first systems.

Allowed uses:
- recommend local providers
- choose local default for low-risk reversible options

Forbidden uses:
- approve capability widening
- reject remote options without asking
- make durable decisions without confirmation
```

This prevents personalization from silently becoming authorization.

## Review Surface

The participant should have a first-class memory review surface.

It should answer:

- What do you remember?
- Why do you remember it?
- Where did it come from?
- How confident are you?
- When was it last used?
- What can it influence?
- What is it forbidden from influencing?
- Is it session-only, project-scoped, or durable?
- Is it sensitive?
- Can I edit, archive, forget, downgrade, or make it session-only?
- Can I mark it "do not use for delegation"?

The last control matters. A participant may want something remembered for empathy or context, but
not used to make choices.

## Memory Use Disclosure

When memory meaningfully influences a recommendation or delegated action, Soma should expose a
concise memory-use rationale.

Example:

```text
Used memory:
- standing preference: local-first when adequate
- standing preference: avoid unnecessary disclosure

Recommendation:
Use the local provider.
```

This should be concise. The goal is inspectability, not a wall of provenance.

## Interaction With Delegated Choice

Delegated choice requires memory discipline.

Before acting on a likely preference, Soma should verify:

- the relevant memory is authored or confirmed
- the memory is in scope
- the memory allows delegated use
- the action stays within the permitted choice tier
- the action does not violate forbidden uses
- the action remains reversible or low-risk

If any condition fails, Soma should recommend or ask instead of acting.

See [Delegated Choice and Deliberation](./delegated_choice_and_deliberation.md).

## Interaction With Capabilities

Memory use should be governed like other sensitive capability surfaces.

Potential future capability keys:

- `memory.session.read`
- `memory.session.write`
- `memory.durable.read`
- `memory.durable.write`
- `memory.preference.derive`
- `memory.use_for_delegation`
- `memory.sensitive.use`

Reading memory, writing memory, deriving preferences, and using memory for delegated choice are
different powers. They should not collapse into a single "memory enabled" toggle.

## Non-Goals

- no shadow profile
- no memory as training material by default
- no unreviewable psychological dossier
- no sensitive durable memory without explicit direction
- no memory use as hidden authority
- no delegation from unconfirmed inference
- no inability to correct or forget

## Principle

The remembered self should remain contestable.

Soma's memory should help the participant recognize and extend themselves, not trap them inside an
old or inferred version of who the system thinks they are.
