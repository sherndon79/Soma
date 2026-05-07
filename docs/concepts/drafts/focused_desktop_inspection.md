# Focused Desktop Inspection

Status: initial bounded implementation

Focused desktop inspection is the next likely desktop capability after the current bounded AT-SPI
application/root-object probe. It should answer a narrow question: "what kind of object is
currently focused?" It should not become a general screen reader, OCR path, or hidden text
extraction feature.

## Capability Boundary

Focused inspection should require `desktop.inspect.focus`.

It should not be covered by `desktop.inspect.accessibility_tree`, because focus is more revealing
than a general root-object sample. A focused object can identify the exact control, field, browser
frame, active document area, or application region the human is working in.

The base harness currently includes `desktop.inspect.focus` as disabled. The first implementation
keeps it disabled and requestable rather than enabled by default.

## Initial Scope

The first focused inspection mode should return only:

- broker source
- desktop session and session type
- focus availability
- focused object service and object path
- focused object role
- focused object child count
- focused application/root service reference when available
- whether text/name/description/action metadata was withheld

It should not return by default:

- object name
- object description
- text content
- selected text
- value text
- document title
- browser tab title
- state lists that reveal sensitive content
- available actions
- screenshots
- OCR output
- pointer or keyboard state

Names, descriptions, text, values, states, and actions should require `desktop.inspect.text` or a
future more precise capability. They should not be added as a convenience field to the focused
inspection result.

## Proposed Response Shape

```json
{
  "mode": "read_only_focused_object_probe",
  "broker_source": "rust_helper",
  "platform": "linux",
  "desktop_session": "ubuntu:GNOME",
  "session_type": "wayland",
  "focus_available": true,
  "focused_object": {
    "service": ":1.13",
    "path": "/org/a11y/atspi/accessible/1",
    "role": "frame",
    "child_count": 2,
    "application": {
      "service": ":1.13",
      "path": "/org/a11y/atspi/accessible/root"
    }
  },
  "text_content_included": false,
  "withheld_fields": [
    "name",
    "description",
    "text",
    "states",
    "actions"
  ]
}
```

If focus is unavailable, the response should be explicit rather than falling back to a broad
desktop tree:

```json
{
  "mode": "read_only_focused_object_probe",
  "broker_source": "rust_helper",
  "focus_available": false,
  "focused_object": null,
  "unavailable_reason": "focus_unavailable",
  "text_content_included": false
}
```

## API Shape

Preferred endpoint:

```text
POST /desktop/inspect/focus
```

Request body:

```json
{
  "include_text": false
}
```

For MVP, `include_text` is rejected and the endpoint always returns `text_content_included: false`.

## Provenance

Focused inspection provenance should record:

- `event_type=desktop.inspect.focus`
- `capability=desktop.inspect.focus`
- requested text inclusion
- whether focus was available
- broker source
- inspection mode
- desktop session and session type
- focused role
- focused child count
- `text_content_included=false`

It should not store the focused object name, description, text content, selected text, or available
actions.

## CLI Shape

Preferred command:

```bash
npm run cli -- desktop focus
```

Expected default output:

```text
Focused desktop object
  available: yes
  broker: rust_helper
  session: ubuntu:GNOME (wayland)
  role: frame
  child count: 2
  text content included: no
  provenance: ...
```

Full JSON should require `--json`.

## Implementation Notes

On AT-SPI, focus discovery may require listening to focus events or querying state through the
registry/accessibility object graph. The implementation should prefer a direct semantic focus
source if available. It should avoid broad traversal as a fallback unless the operator explicitly
requests it through the existing tree inspection path.

If the helper cannot reliably identify focus, it should return `focus_available=false` with a
reason. It should not guess from the first application, active window, or pointer location.

The current Rust helper attempts a bounded semantic lookup by calling
`org.a11y.atspi.Collection.GetActiveDescendant` on application root objects discovered from the
AT-SPI bus. When an active descendant is returned, Soma queries only `GetRoleName` and
`ChildCount` for that object. If the interface is unsupported or returns no descendant, the helper
returns `focus_available=false` with `unavailable_reason=active_descendant_unavailable`.

## Non-Goals

- no actuation
- no screenshots
- no OCR
- no raw screen capture
- no model-driven desktop actions
- no browser automation
- no child names or text by default

## Current Implementation Status

- `POST /desktop/inspect/focus` exists.
- `npm run cli -- desktop focus` exists.
- `desktop.inspect.focus` remains disabled in the base harness.
- `soma.provider.desktop-broker` advertises `desktop.inspect.focus` support so the capability is
  requestable.
- The Rust helper supports `inspect-focus` and attempts `GetActiveDescendant` on AT-SPI collection
  roots.
- The JavaScript fallback also returns explicit focus unavailable rather than guessing from a broad
  desktop tree.
- Helper output is schema-checked to reject names, descriptions, text, states, actions, or other
  over-disclosing fields.
- Provenance records focus availability, role, child count, requested text inclusion, broker
  source, mode, and session metadata without storing focused text or names.
