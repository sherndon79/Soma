# Model-Facing Visual Delivery Boundary

## Purpose

Soma can now verify Sensorium color and depth streams as metadata-only subscriptions. That does not
authorize sending frames, transformed images, depth maps, or derived spatial payloads into model
context.

This document defines the boundary that must exist before any camera/depth payload becomes
model-facing. It is intentionally design-only. No implementation or live model delivery is enabled
by this draft.

## Current Posture

Implemented:

- Sensorium status, color, and depth subscriptions require explicit grants.
- Camera-class live smoke requires explicit acknowledgement.
- Helper-side color JPEG and depth PNG minimization can enforce `downsample_to` before sample bytes
  cross into Node-visible state.
- Active disclosure and provenance record bounded metadata summaries only.

Not implemented:

- model-facing image delivery
- model-facing depth delivery
- multimodal prompt assembly
- frame recording
- screenshot capture
- point clouds, meshes, or derived scene geometry
- visual memory writes

## Capability Separation

Sensorium subscription capabilities are not model-delivery capabilities.

Existing subscription capabilities authorize bounded access to a producer stream:

- `perception.sensorium.color.subscribe`
- `perception.sensorium.depth.subscribe`

Future model-facing delivery should require separate capabilities, for example:

- `model.context.visual.color.attach`
- `model.context.visual.depth.attach`
- `model.context.visual.composite.attach`

These names are draft placeholders. The important boundary is semantic: subscribing to a stream is
permission to observe and summarize it under disclosure; attaching a payload to a model turn is a
separate irreversible act.

## Required Grant Fields

A model-facing visual grant should require:

- source subscription id or source capability/provider/topic tuple
- payload type: color, depth, or composite
- maximum frame count per model turn
- maximum dimensions after helper minimization
- required format after minimization
- maximum age of frame eligible for delivery
- whether still frames, frame sequences, or fused color/depth pairs are allowed
- whether user-visible preview is required
- retention mode, defaulting to no payload retention
- explicit denial of memory writes unless a separate memory grant exists

The default should be one-shot, single-turn delivery. Session delivery should require stronger
review because it can silently turn perception into continuous model context.

## Disclosure Preview

Before visual payload delivery, Soma should show a participant-facing preview that includes:

- source host and topic
- capability and grant id
- payload type
- transformed dimensions and format
- frame count
- frame age
- whether depth units are included
- whether color and depth are fused
- whether payload bytes will be retained after the turn
- the exact model/provider receiving the payload

The preview should not include hidden content outside the transformed payload. If a preview cannot be
shown or acknowledged, delivery fails closed.

## Payload Rules

Allowed only after a model-facing visual grant:

- transformed color frame bytes that already passed helper-side minimization
- transformed depth frame bytes that already passed helper-side minimization
- bounded metadata already visible in `stream_summary_observed`

Still excluded by default:

- original full-resolution frames
- raw uncompressed depth arrays
- screenshots outside Sensorium scope
- point clouds
- meshes
- OCR/text extraction
- scene descriptions generated before the user preview
- hidden recordings
- background delivery to a model without a visible turn

Any derived visual artifact should be treated as a new payload class, not as harmless metadata.

## Provenance

Provenance should record the shape of model-facing delivery without storing frame bytes:

- event type, such as `model.context.visual.attached`
- source subscription id
- source provider and topic
- visual capability used
- model/provider receiving the payload
- payload type
- frame count
- transformed dimensions and format
- depth units presence, when relevant
- max frame age
- retention mode
- preview acknowledged by whom and when
- whether memory write was separately authorized

Provenance must not store image bytes, depth bytes, screenshots, raw arrays, point clouds, meshes, or
model-generated scene descriptions unless a later explicit retention capability exists.

## Retention

Default retention mode: `none`.

Allowed future retention modes should be narrow and explicit:

- `turn_only`: payload exists only for prompt assembly and model invocation.
- `ephemeral_preview`: payload exists only long enough to show the user the preview.
- `operator_saved`: user explicitly saves a transformed artifact outside the hidden pipeline.

Durable retention, visual memory, dataset creation, or training use require separate capabilities and
must never be implied by model-facing delivery.

## Activation Gates

Before implementation:

- capability catalog entries exist for model-facing visual attach operations
- grant proposal templates include preview, retention, and memory-write fields
- request validators reject payload classes not explicitly granted
- provenance schema is documented and tested without storing bytes
- tests prove subscription grants alone cannot attach visual payloads to model context
- tests prove preview refusal prevents model delivery
- tests prove memory writes require a distinct memory grant

Before any live test:

- use transformed helper-minimized payloads only
- use one-shot scope only
- require explicit operator acknowledgement
- show the preview before model invocation
- confirm cleanup removes ephemeral payload bytes

## Non-Goals

This draft does not implement visual delivery.

It also does not authorize:

- desktop screenshots
- browser screenshots
- camera recording
- live streaming to a model
- hidden scene understanding
- actuation based on visual input
- durable visual memory
