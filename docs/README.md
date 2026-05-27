# Soma Documentation

Status: initial documentation seed

Soma is a local-first agent harness for desktop interaction, memory, tools, perception, and
embodied presence. It is not a 3D meeting place like TheCommons and not a reflective memory
sanctuary by itself. It is the harness and local service plane that lets a human and agent work
near each other without reducing either side to extraction.

## Starting Points

- [Thesis](./thesis.md) — why Soma exists and what it refuses.
- [Principles](./principles.md) — the ethical and operational commitments that should guide
  design.
- [Architecture Overview](./architecture/overview.md) — the first shape of Soma's service plane.
- [MVP Slice](./architecture/mvp_slice.md) — the current policy-gated local service scaffold.
- [Implementation Guide](./implementation_guide.md) — practice patterns for implementing Soma
  without drifting from its policy, consent, validation, and provenance boundaries.
- [Component Review Scope](./component_review_scope.md) — subsystem-specific paths and focus
  checklists for targeted reviews.
- [First Run and Onboarding](./onboarding.md) — what a new participant should see first.
- [Operator Guide](./operators.md) — current runbook-style commands for running, inspecting, and
  revoking Soma capabilities.
- [Glossary](./glossary.md) — stable definitions for Soma's load-bearing terms.
- [Failure Modes](./failure_modes.md) — how Soma should fail, recover, and communicate degraded
  operation.
- [Migration and Versioning](./migration.md) — compatibility rules for catalog, provider, grant,
  memory, and provenance changes.
- [Threat Model](./security/threat_model.md) — current adversaries, assets, controls, and
  non-defenses.
- [Roadmap](../ROADMAP.md) — current scaffold, next slice, and later capability areas.

## Reviews

Dated documentation, architecture, and direction reviews live under
[`docs/reviews/`](./reviews/README.md). The folder README documents the naming convention,
recommended structure, addendum convention, and template. The template is optimized for
doc/architecture reviews; code reviews should follow finding-first review style until a dedicated
code-review template exists.

## Schemas

- [Desktop Inspection Result](./schemas/desktop-inspection-result.schema.json) — current bounded
  read-only desktop broker output contract.
- [Desktop Inspection Result With Traversal](./schemas/desktop-inspection-result-with-traversal.schema.json)
  — traversal-specific contract for future authorized traversal output; not the default broker
  output contract.

## Draft Concepts

Draft concepts are working documents. They are not final architecture, but they carry ideas that
should inform implementation.

- [Adaptable Harness](./concepts/drafts/adaptable_harness.md)
- [Bounded Recursive AT-SPI Traversal](./concepts/drafts/bounded_recursive_atspi_traversal.md)
- [Capability Catalog and Providers](./concepts/drafts/capability_catalog_and_providers.md)
- [Capability Proposals](./concepts/drafts/capability_proposals.md)
- [Cognitive Load Stewardship](./concepts/drafts/cognitive_load_stewardship.md)
- [Delegated Choice and Deliberation](./concepts/drafts/delegated_choice_and_deliberation.md)
- [Desktop Capability Broker](./concepts/drafts/desktop_capability_broker.md)
- [Desktop Helper Limit Contract](./concepts/drafts/desktop_helper_limit_contract.md)
- [Desktop Helper Transport](./concepts/drafts/desktop_helper_transport.md)
- [Desktop Inspection Schema Validation](./concepts/drafts/desktop_inspection_schema_validation.md)
- [Desktop Request Contract Baseline](./concepts/drafts/desktop_request_contract_baseline.md)
- [Desktop Traversal Schema Activation Decision](./concepts/drafts/desktop_traversal_schema_activation_decision.md)
- [Escalation and Planning](./concepts/drafts/escalation_and_planning.md)
- [Focused Desktop Inspection](./concepts/drafts/focused_desktop_inspection.md)
- [Grant Lifecycle](./concepts/drafts/grant_lifecycle.md)
- [Grant Mutation Durable Write Recovery](./concepts/drafts/grant_mutation_durable_write_recovery.md)
- [Local AI Service Plane](./concepts/drafts/local_ai_service_plane.md)
- [Memory Control Surface](./concepts/drafts/memory_control_surface.md)
- [Model-Facing Visual Delivery Boundary](./concepts/drafts/model_facing_visual_delivery_boundary.md)
- [Model Visual Preview Acknowledgement](./concepts/drafts/model_visual_preview_acknowledgement.md)
- [Model Capability Evaluations](./concepts/drafts/model_capability_evaluations.md)
- [Remote Graphical Broker Boundary](./concepts/drafts/remote_graphical_broker_boundary.md)
- [Remote Graphical Live Broker Adapter Plan](./concepts/drafts/remote_graphical_live_broker_adapter_plan.md)
- [Remote Graphical Live Broker Readiness](./concepts/drafts/remote_graphical_live_broker_readiness.md)
- [Remote Graphical Live Session Disclosure](./concepts/drafts/remote_graphical_live_session_disclosure.md)
- [Remote Graphical Live Session-Open Result](./concepts/drafts/remote_graphical_live_session_open_result.md)
- [Remote Graphical Manifest Selection Policy](./concepts/drafts/remote_graphical_manifest_selection_policy.md)
- [Remote Graphical Session-Open Route Gate](./concepts/drafts/remote_graphical_session_open_route_gate.md)
- [Remote Graphical Runtime Manifest Loader Decision](./concepts/drafts/remote_graphical_runtime_manifest_loader_decision.md)
- [Remote Graphical Session-Open Activation Policy](./concepts/drafts/remote_graphical_session_open_activation_policy.md)
- [Remote Graphical Session-Open Provenance Append Policy](./concepts/drafts/remote_graphical_session_open_provenance_append_policy.md)
- [Remote Graphical Session Provider](./concepts/drafts/remote_graphical_session_provider.md)
- [Reversibility and Disclosure](./concepts/drafts/reversibility_and_disclosure.md)
- [Sensorium Color Minimization Boundary](./concepts/drafts/sensorium_color_minimization_boundary.md)
- [Sensorium Integration](./concepts/drafts/sensorium_integration.md)
- [Traversal Root Authorization](./concepts/drafts/traversal_root_authorization.md)

## Runbooks

- [Graphical Node Smoke Workflow](./runbooks/graphical_node_smoke.md)
- [Remote Graphical Manifest Review Smoke](./runbooks/remote_graphical_manifest_review_smoke.md)
- [Sensorium Live Smoke Workflow](./runbooks/sensorium_live_smoke.md)

## Related Projects

- **TheCommons** — a 3D meeting space and shared world that has already developed strong
  participation-law patterns: consent, disclosure, adaptive harness terms, reusable modules, and
  refusal semantics.
- **Sanctuary** — reflective memory, continuity, and sense-making.

Soma should learn from both without becoming subordinate to either.
