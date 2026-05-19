# Model Visual Preview Acknowledgement

## Purpose

This draft defines the metadata shape for showing a transformed visual preview before any
model-facing visual attachment. It does not implement preview rendering, route wiring, prompt
assembly, model invocation, payload retention, or model-facing delivery.

## Lifecycle

The preview lifecycle is separate from proposal approval and separate from model attachment:

1. A Sensorium subscription grant authorizes bounded access to a source stream.
2. A model visual attach proposal requests permission to attach transformed visual context.
3. A transformed preview artifact is rendered for the operator.
4. The operator acknowledges that specific preview artifact.
5. A later request validator may use the acknowledgement metadata as one prerequisite for model
   visual attachment.

Approval is not acknowledgement. Acknowledgement is not model delivery.

## Preview Artifact Metadata

Preview artifact metadata must be byte-free. It records the shape and authority of the preview, not
the preview payload:

- `preview_artifact_id`
- visual attach capability, such as `model.context.visual.color.attach`
- source subscription ids and source capabilities
- source provider, topic, and source grant id
- model target
- payload type
- frame count
- frame age
- transformed dimensions
- required format
- whether depth units are present
- whether color/depth are fused
- `preview_rendered=true`
- `retention_mode=ephemeral_preview`
- `cleanup_required=true`
- cleanup deadline in milliseconds
- `payload_bytes_included=false`
- `payload_retained_after_acknowledgement=false`

The metadata must not include image bytes, depth bytes, screenshots, raw arrays, OCR text, point
clouds, meshes, scene descriptions, prompts, model responses, or training records.

## Acknowledgement Metadata

Acknowledgement metadata must bind to one preview artifact:

- `acknowledgement_id`
- matching `preview_artifact_id`
- `decision=acknowledged`
- `acknowledged_by=user`
- `acknowledged_at`
- `retention_mode=ephemeral_preview`
- `payload_retained_after_acknowledgement=false`
- `cleanup_required=true`

An acknowledgement from the assistant or model is not sufficient. The operator must acknowledge the
specific transformed preview that would be eligible for attachment.

## Cleanup

Preview bytes are allowed to exist only long enough to render the preview and collect the operator
decision. The durable record is metadata-only. Cleanup failure should block model visual attachment
until the failure is surfaced to the operator and resolved.

The current implementation only validates metadata. It does not allocate, render, store, or clean up
preview bytes.

## Relationship To Request Validation

The current model visual grant candidate and request validators require the preview artifact id,
acknowledgement id, user actor, acknowledgement timestamp, and cleanup requirement as byte-free
constraints. The compact `preview_acknowledged=true` flag remains present, but it is no longer the
only preview prerequisite.

This is still metadata-only. It does not render previews, retain preview bytes, clean up preview
artifacts, wire routes, assemble prompts, invoke models, or deliver visual payloads.
