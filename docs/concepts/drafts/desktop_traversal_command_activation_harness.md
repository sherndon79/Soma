# Desktop Traversal Command Activation Harness

Status: design draft, not implemented

This draft defines deterministic integration coverage for the future public
`inspect-atspi-traversal` command before command activation. It does not activate traversal, change
endpoint behavior, or expand the active desktop inspection schema.

## Purpose

The internal Rust command-output seam proves traversal stdout can be assembled from injected
providers, but it does not exercise the public command dispatch path. Before `main` routes
`inspect-atspi-traversal` into traversal output, integration tests need a deterministic way to run the
real binary without depending on the developer or CI desktop session.

## Selected Strategy

Use a fake `busctl` executable placed earlier in `PATH` for integration tests.

Reasons:

- exercises the real compiled `soma-desktop-broker` binary
- exercises the real public command dispatch path
- keeps the production code free of test-only fixture modes
- avoids a live AT-SPI session dependency
- makes unavailable behavior deterministic by controlling the fake `GetAddress` response

The fake `busctl` must be created in a temporary directory by the Rust integration test and removed
with the test temp directory. The test should prepend that directory to `PATH` only for the child
process running `soma-desktop-broker`.

## Fake `busctl` Contract

The activated traversal command will issue these calls:

```text
busctl --user call org.a11y.Bus /org/a11y/bus org.a11y.Bus GetAddress
busctl --address <address> call <service> <path> org.a11y.atspi.Accessible GetRoleName
busctl --address <address> get-property <service> <path> org.a11y.atspi.Accessible ChildCount
busctl --address <address> call <service> <path> org.a11y.atspi.Accessible GetChildren
```

The fake should return busctl-shaped stdout that the existing parsers already understand:

```text
s "unix:path=/tmp/fake-atspi"
s "application"
i 1
a(so) 1 ":1.42" "/org/a11y/atspi/accessible/1"
```

For child nodes, it can return:

```text
s "frame"
i 0
a(so) 0
```

## Test Cases Before Activation

### Success

Run:

```text
soma-desktop-broker inspect-atspi-traversal \
  --root-service :1.42 \
  --root-path /org/a11y/atspi/accessible/root \
  --max-depth 2 \
  --max-nodes 64 \
  --max-children-per-node 8
```

Expected once activation lands:

- exit code `0`
- stdout is valid traversal JSON
- root echoes the authorized concrete service/path
- nodes include root and bounded child nodes
- limits echo effective limits
- `text_content_included=false`
- protected fields are absent
- stderr is empty

### Unavailable

Run the same command with fake `busctl` configured to fail or return no address for `GetAddress`.

Expected once activation lands:

- exit code `0`
- stdout is valid unavailable traversal JSON
- `nodes: []`
- `truncated: false`
- `unavailable_reason: "atspi_bus_address_unavailable"`
- protected fields are absent
- stderr is empty

### Malformed Arguments

Continue to run malformed arguments without fake AT-SPI dependency:

```text
soma-desktop-broker inspect-atspi-traversal --root-ref desktop-ref-1
```

Expected before and after activation:

- exit code `2`
- stdout is empty
- stderr contains the parser error
- fake `busctl` is not invoked

### Disabled Command Guard

Until activation lands, keep the existing integration test proving valid traversal args return:

- exit code `2`
- empty stdout
- `inspect-atspi-traversal is not implemented`

The activation slice should replace this test with the success/unavailable public command tests in
the same commit that changes command dispatch.

## Safety Invariants

The integration harness must not:

- require a live AT-SPI bus
- read names, descriptions, text, states, actions, screenshots, pointer state, or keyboard state
- pass `root_ref` to Rust
- relax helper-side traversal limits
- change Node endpoint behavior
- make the default Node runtime validator accept traversal

## Activation Sequence

1. Add fake-`busctl` test helper while the public command remains disabled.
2. Keep the current disabled-command integration test passing.
3. Add activated-command tests as pending design notes or in the activation commit.
4. Change command dispatch from `not implemented` to `inspect_atspi_traversal_json`.
5. Replace the disabled-command valid-args assertion with success and unavailable assertions.
6. Keep Node endpoint traversal refusal active until the later request-enablement gate.
