# Governance

Soma is an early local-first agent harness. Project governance should preserve the architecture's
core commitments as capability expands.

## Review Principles

Changes should be reviewed against these questions:

- Does the capability pass through Soma policy before use?
- Is consent explicit, scoped, and revocable?
- Is the action's reversibility honestly represented?
- Is provenance recorded without turning logs into another memory surface?
- Does the change keep local-first behavior where intimate context, memory, perception, or
  desktop actuation are involved?
- Does any MCP adapter remain behind Soma policy rather than becoming the trust boundary?

## Heightened Review Areas

These areas require extra care before merge:

- durable memory
- remote model routing
- filesystem writes
- shell execution
- desktop actuation
- screen, camera, or microphone perception
- input synthesis through tools such as `wtype`, `ydotool`, `uinput`, or `xdotool`
- any bridge that could disclose private context outside the local machine

## Current Authority Boundary

The Node service plane currently owns policy, harness modules, provenance, CLI/API, and model
routing.

Rust nervous-system helpers may execute bounded host capabilities, but they should not silently
widen their own authority. Moving policy enforcement into a helper should be an explicit design
decision documented before implementation.
