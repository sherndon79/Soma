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
- [Local AI Service Plane](./concepts/drafts/local_ai_service_plane.md)
- [Memory Control Surface](./concepts/drafts/memory_control_surface.md)
- [Model Capability Evaluations](./concepts/drafts/model_capability_evaluations.md)
- [Reversibility and Disclosure](./concepts/drafts/reversibility_and_disclosure.md)
- [Traversal Root Authorization](./concepts/drafts/traversal_root_authorization.md)

## Related Projects

- **TheCommons** — a 3D meeting space and shared world that has already developed strong
  participation-law patterns: consent, disclosure, adaptive harness terms, reusable modules, and
  refusal semantics.
- **Sanctuary** — reflective memory, continuity, and sense-making.

Soma should learn from both without becoming subordinate to either.
