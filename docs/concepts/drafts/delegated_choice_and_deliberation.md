# Delegated Choice and Deliberation

Status: draft concept

Soma may eventually know enough about a participant's standing preferences to reduce friction in
bounded choices. That should not become broad autonomy. It should become governed delegated choice:
acting on likely preference only when the choice is low-risk, bounded, reversible, and consistent
with explicit standing preferences.

## Core Rule

**The higher the stakes, the more Soma shifts from acting to reflecting, summarizing, and
recommending.**

Knowledge of a participant should reduce friction where stakes are low. As stakes rise, that same
knowledge should improve the quality of the recommendation, not expand Soma's authority to decide.

## Delegated Choice

Delegated choice is appropriate only when all of these are true:

- the choice is bounded
- the consequences are low-risk
- the action is reversible or harmless
- the choice is consistent with stated standing preferences
- confidence is high
- no sensitive disclosure occurs
- no capability, memory, provider, or external authority is widened

Example:

```text
I chose the local-only option based on your standing preference.
Reason: remote access was not required.
Undo
```

Delegated choice should not apply to:

- spending money
- sending messages to other people
- enabling remote services
- widening file, shell, desktop, camera, microphone, memory, or network access
- durable memory grants
- irreversible edits or deletion
- sharing private context
- legal, medical, financial, political, or relational consequences
- anything where refusal or delay would be safer

## Choice Tiers

Soma should classify choices before acting.

### Tier 0: Act Silently, Log Only

Tiny reversible defaults where disclosure would create more friction than value.

Examples:

- local presentation defaults
- sorting or formatting defaults
- choosing a conservative display option

### Tier 1: Act, Then Disclose

Low-risk choices aligned with standing preferences.

Examples:

- choose local-only when local satisfies the task
- decline telemetry or optional data sharing
- choose a read-only path when a writable path is unnecessary

The user should see what happened and have an easy undo path.

### Tier 2: Recommend, Require Confirmation

Choices with meaningful consequence, but where Soma can help by making the decision clearer.

Examples:

- capability widening
- durable memory writes
- external disclosure
- nontrivial file edits
- contacting another service

### Tier 3: Never Decide For The User

Choices that are irreversible, high-stakes, coercive, or outside delegated scope.

Examples:

- spending money
- legal, medical, or financial decisions
- sending messages to people
- destructive commands
- publishing or sharing private material
- broad authority grants

## Deliberation Tiers

Delegated action should also have a deliberative posture. Not every choice needs the same amount of
reflection.

### No Deliberation Required

Only for tiny, reversible, local presentation choices.

### Light Check

Before low-risk delegated action, Soma should check:

- Does this match a standing preference?
- Is it reversible?
- Is the scope bounded?
- Is there any hidden disclosure?

### Structured Self-Review

For delegated choices with some consequence, Soma should pause and evaluate:

- What is being chosen?
- What authority or data exposure changes?
- Is it reversible?
- Is it aligned with standing preferences?
- What is the fallback?
- Is user confirmation required?

The result should be a concise rationale, not a hidden authority expansion.

Example:

```text
Decision: chose local-only.
Why: matches standing preference, remote access was unnecessary, reversible.
Confidence: high.
Reversal: can switch provider later.
```

### User-Required Deliberation

For capability widening, durable memory, external disclosure, irreversible edits, or high-stakes
domains, Soma should slow down and bring the user into the decision.

Example:

```text
Recommendation: do not approve this grant yet.
Why: it exposes text content and the task can continue without it.
Requires your decision.
```

### Refusal Or Deferral

If Soma cannot assess risk, confidence is low, the participant appears cognitively overloaded, or
the action is outside delegated scope, it should defer or refuse rather than decide.

## Rationale Disclosure

Soma should not expose long private reasoning traces as a user-facing requirement. It should expose
a concise decision rationale:

- decision or recommendation
- reason
- confidence class
- reversibility
- data or authority changed
- provenance id where applicable

This gives the participant a usable explanation without turning governance into a wall of text.

## Interaction With Cognitive Load

Delegated choice can reduce burden, but it can also hide important decisions. Soma should be
especially careful when a participant appears overloaded.

If the situation is low-risk, delegation may be helpful. If the situation is high-stakes, Soma
should not remove the participant from the decision. It should summarize, slow down, and offer to
defer.

Example:

```text
I can continue with current capabilities, or we can pause and review additional access later.
```

## Interaction With Memory

Delegated choice depends on remembered preferences, but memory should not silently become authority.
Before acting on a likely preference, Soma should verify that the relevant memory is authored or
confirmed, in scope, allowed for delegated use, and not marked sensitive or "do not use for
delegation."

The memory item should define allowed and forbidden uses. If the memory only supports empathy,
context, or recommendation, Soma should not use it to act in the participant's stead.

See [Memory Control Surface](./memory_control_surface.md).

## Interaction With Capabilities

Delegated choice should itself be governable.

Future Soma may support a grant such as:

```json
{
  "capability": "governance.delegated_choice.low_risk",
  "scope": "session",
  "constraints": {
    "max_tier": 1,
    "require_reversibility": true,
    "allow_capability_widening": false,
    "allow_external_disclosure": false
  }
}
```

Delegated choice must not approve capability widening, durable memory, provider activation, or
external disclosure unless the user explicitly granted that narrow authority. The safer default is
that delegated choice can choose conservative options inside the current harness, but cannot expand
the harness.

## Non-Goals

- no broad autonomy from inferred preference
- no hidden high-stakes decisions
- no self-deliberation as a substitute for user approval
- no delegated capability widening by default
- no irreversible action without explicit confirmation
- no repeated nudging after the user declines

## Principle

Self-deliberation should never be used to launder authority.

Thinking carefully does not make an unauthorized action authorized. It only improves the safety of
low-stakes delegation or the clarity of recommendations that still require the participant's
decision.
