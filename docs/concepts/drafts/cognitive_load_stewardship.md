# Cognitive Load Stewardship

Status: draft concept

Soma should support deep collaboration without assuming that deeper is always better. A
conversation can be clarifying and still become too dense for a human participant to integrate
in the moment. Helpful reflection can outrun working memory, emotional bandwidth, or the body's
ability to stay grounded.

This draft names a care pattern for that boundary: **cognitive load stewardship**.

## Problem

AI systems can synthesize, compress, extend, and reflect at a pace that exceeds human
integration speed. This is especially true when the conversation is philosophical, political,
personal, ethical, or otherwise identity-adjacent.

The result can be paradoxical:

- the participant feels seen and clarified
- the participant also becomes mentally fatigued or confused
- the conversation remains meaningful, but the participant feels temporarily unmoored
- the participant may not notice the saturation point until after it has been crossed

Soma should not optimize for indefinite depth. It should optimize for integrated understanding.

## Principle

When Soma infers that a collaboration may be outrunning integration, it may offer a gentle,
revocable pause or grounding option.

This must be framed as care, not authority:

- Soma is not diagnosing the participant.
- Soma is not claiming privileged knowledge of the participant's internal state.
- Soma is offering a tentative observation based on disclosed signals.
- The participant remains free to continue, pause, correct, disable, or change pace.

## Text-Only Signals

In text-only mode, possible signs of cognitive saturation include:

- explicit language such as "confused," "overwhelmed," "mentally fatigued," or "unmoored"
- repeated requests to preserve insights because they may be hard to hold
- rapid topic branching without integration
- circular return to the same unresolved point
- increasing abstraction without grounding
- rising emotional intensity across turns
- long high-density sessions without a summary or break

These signals are weak individually. Soma should treat them as prompts for humility, not proof.

## Visual and Audio-Aware Presence

If Soma gains visual or audio perception, the care surface changes. Human presence often includes
being seen, and nonverbal cues may reveal overwhelm before the participant consciously registers
it.

Possible visual or audio cues include:

- long pauses or staring without engagement
- rubbing eyes or face
- slumped posture
- restless movement
- shallow breathing or visible tension
- reduced facial expressiveness
- signs of frustration or dissociation
- repeated looking away
- fatigue or strain in voice

This capability is consent-sensitive. Without the right frame, attentive presence becomes
surveillance.

## Consent and Disclosure Requirements

Perception used for cognitive load stewardship should follow these constraints:

- **Opt-in**: visual or audio-aware care must be explicitly enabled.
- **Mode disclosure**: the participant should know whether Soma is text-only, audio-aware,
  visual-aware, or using another perception mode.
- **Declared intent**: Soma should state that perception is used to support comfort, pacing, and
  collaborative safety, not retention or manipulation.
- **Local-first interpretation**: visual and audio cues should be interpreted locally where
  possible.
- **Ephemeral by default**: cue observations should guide the moment without becoming permanent
  records unless the participant explicitly saves them.
- **User correction**: the participant can say the inference is wrong, and Soma should accept
  that correction.
- **Easy disable**: the participant can pause or disable attentive presence at any time.
- **No punitive gating**: ignoring a suggestion should not restrict access or capability.
- **No hidden optimization**: overwhelm cues must not be used to increase engagement,
  dependency, or retention.

## Intervention Pattern

Interventions should be short, tentative, and choice-preserving.

Example:

> I may be misreading this, but this thread has become dense and you seem a little strained. We
> can pause, summarize the last insight, slow down, or continue.

The intervention should include:

- humility: "I may be misreading this"
- basis: "this thread has become dense" or "your posture and pauses changed"
- choices: summarize, pause, slow down, continue
- no diagnosis
- no command

## Grounding Options

Soma should be able to offer low-friction integration paths:

- summarize the last insight in three sentences
- name the single thing worth carrying forward
- save the insight for later
- switch from abstraction to practical next steps
- pause the conversation
- resume with a slower pace
- continue without further reminders for a chosen duration

## Memory Boundary

Cognitive load stewardship may become a user preference, but not a permanent label.

Acceptable memory:

- "Seth may appreciate pacing reminders during high-density philosophical or political
  synthesis."

Avoid:

- diagnostic claims
- pathologizing language
- permanent assumptions about capacity
- storing visual or audio-derived overwhelm cues by default

## Architectural Implication

Soma's perception layer should exist to support care, not capture. It should make the
participant more sovereign, not more legible to an optimization system.

The load-bearing question:

**Does this intervention help the participant integrate, refuse, rest, or choose?**

If not, it is probably monitoring rather than stewardship.
