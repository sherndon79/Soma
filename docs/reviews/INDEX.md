# Review Index

This index groups review notes by thread. Review files remain historical snapshots; canonical docs
carry the resulting project posture.

## General Project Direction

- [Documentation and Direction Review - 2026-05-06](./2026-05-06_documentation_and_direction_review.md)
  - early project framing and documentation direction
- [AGENTS.md Review - 2026-05-07](./2026-05-07_agents_md_review.md)
  - project steering guidance review
- [Post-Escalation Draft Commits Review - 2026-05-08](./2026-05-08_post_escalation_draft_commits_review.md)
  - review of escalation, capability, and planning draft commits
- [Implementation and Review Scope Guides Review - 2026-05-09](./2026-05-09_implementation_and_review_scope_guides_review.md)
  - review of implementation-guide and review-scope guidance

## Desktop Traversal Activation Thread

This thread tracks disabled-first recursive AT-SPI traversal activation. The public Node endpoint is
now active behind disclosure-registry authorization, traversal-authorized response validation, and
summary-only provenance.

- [Traversal Activation Gates Review](./2026-05-09_traversal_activation_gates_review.md)
  - pre-promotion gate review for traversal activation conditions
- [Traversal Activation Progress Review](./2026-05-09_traversal_activation_progress_review.md)
  - first broad progress review of the traversal activation thread
- [Traversal Request Enablement Readiness Review](./2026-05-09_traversal_request_enablement_readiness_review.md)
  - review of request validation, root authorization, helper, and provenance readiness
- [Traversal Pipeline Activation Readiness Review](./2026-05-09_traversal_pipeline_activation_readiness_review.md)
  - review before internal traversal pipeline construction
- [Traversal Unavailable Output Contract Review](./2026-05-09_traversal_unavailable_output_contract_review.md)
  - review of unavailable traversal output contract
- [Rust Unavailable Traversal Output Review](./2026-05-09_rust_unavailable_traversal_output_review.md)
  - review of Rust unavailable traversal output before command activation
- [Traversal Helper Output Contract Review](./2026-05-09_traversal_helper_output_contract_review.md)
  - review of Rust-shaped traversal helper output fixtures and Node validation
- [Traversal Command Activation Scaffold Review](./2026-05-09_traversal_command_activation_scaffold_review.md)
  - review of command activation scaffold while the helper command still refused
- [Fake Busctl Traversal Harness Review](./2026-05-09_fake_busctl_traversal_harness_review.md)
  - review of fake-`busctl` integration harness for public command activation
- [Rust Traversal Helper Command Activation Review](./2026-05-09_rust_traversal_helper_command_activation_review.md)
  - review after the Rust helper command became active while Node endpoint stayed refused
- [Traversal Endpoint Activation Scaffold Review](./2026-05-09_traversal_endpoint_activation_scaffold_review.md)
  - review of endpoint activation fixture scaffold
- [Extended Traversal Endpoint Fixture Review](./2026-05-09_extended_traversal_endpoint_fixture_review.md)
  - review after helper-output-failure and narrowing/revocation fixture cases landed
- [Final Traversal Endpoint Enablement Review](./2026-05-09_final_traversal_endpoint_enablement_review.md)
  - final review before attempting public Node endpoint activation
- [Traversal Activation Thread Review, Pass 2](./2026-05-09_traversal_activation_thread_review.md)
  - broad thread review with addendum noting later fixture and final-review commits
- [Traversal Endpoint Activation Review](./2026-05-10_traversal_endpoint_activation_review.md)
  - post-activation review accepting the endpoint activation
- [Traversal Artifact Lifecycle Disposition Review](./2026-05-10_traversal_artifact_lifecycle_disposition_review.md)
  - per-artifact disposition for Future-prefixed traversal APIs, fixtures, and schemas

## Sensorium Integration Thread

This thread tracks the disabled-first integration of the external Sensorium node on `jetsorano`.
The HTTP seam now exists, but the default server posture remains subscriber-not-configured and no
Sensorium grants ship by default.

- [Sensorium HTTP Seam Review](./2026-05-15_sensorium_http_seam_review.md)
  - review after the injected HTTP subscription seam landed with validation, provider host checks,
    and fail-closed no-grant behavior
- [Sensorium Runtime Opt-In Review](./2026-05-15_sensorium_runtime_opt_in_review.md)
  - review after server startup gained explicit `SOMA_SENSORIUM_ENABLED` wiring for the real helper
    and subscriber while preserving default-off behavior
- [Sensorium Grant Constraint Review](./2026-05-15_sensorium_grant_constraint_review.md)
  - review after active grant constraints started bounding Sensorium subscription requests before
    subscriber invocation
- [Sensorium Durable Grant Review Design](./2026-05-15_sensorium_durable_grant_review_design.md)
  - review after session-first Sensorium grant review fields and migration triggers were documented
- [Sensorium Grant Proposal Template Review](./2026-05-15_sensorium_grant_proposal_template_review.md)
  - review after a non-writing Sensorium proposal template was added
- [Sensorium Proposal Review Surface](./2026-05-15_sensorium_proposal_review_surface.md)
  - review after the Sensorium proposal template became inspectable through API and CLI surfaces
- [Sensorium Proposal Creation Surface](./2026-05-15_sensorium_proposal_creation_surface.md)
  - review after Sensorium template validation began storing pending proposals with review context

## Current Review Triggers

- Run a focused review after the next traversal behavior change.
- Run a focused review after Sensorium grant creation prerequisites or implementation are added.
- Revisit compatibility delegates after a broader draft-lifecycle policy is formalized.
- Add new thread sections here when review density for another capability starts to grow.
