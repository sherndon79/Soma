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
The HTTP seam, explicit runtime opt-in, session grant creation, session grant revocation, CLI
subscription commands, and live smoke runbook now exist. The default server posture remains
subscriber-not-configured, runtime grants are process-local, and no Sensorium grants ship by
default.

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
- [Sensorium Grant Candidate Prerequisites](./2026-05-17_sensorium_grant_candidate_prerequisites.md)
  - review after a non-writing approved-proposal-to-grant candidate builder was added
- [Sensorium Session Grant Creation](./2026-05-17_sensorium_session_grant_creation.md)
  - review after approved Sensorium proposals gained an explicit runtime session grant creation path
- [Sensorium Session Grant Revocation](./2026-05-17_sensorium_session_grant_revocation.md)
  - review after runtime Sensorium grants gained explicit revocation with subscription stop handling
- [Sensorium Subscription CLI](./2026-05-17_sensorium_subscription_cli.md)
  - review after start, stop, and active disclosure CLI wrappers were added for guarded subscription routes
- [Sensorium Operator Hardening](./2026-05-17_sensorium_operator_hardening.md)
  - review after CLI subscription commands gained handler-backed integration coverage
- [Sensorium Live Smoke Runbook](./2026-05-17_sensorium_live_smoke_runbook.md)
  - review after an opt-in helper-backed Sensorium smoke workflow was documented
- [Sensorium Live Smoke Script Guardrails](./2026-05-17_sensorium_live_smoke_script_guardrails.md)
  - review after a guarded `npm run sensorium:smoke` wrapper was added for the status-topic-first
    runtime grant/subscription/revocation workflow
- [Sensorium Live Smoke Verification](./2026-05-17_sensorium_live_smoke_verification.md)
  - review after the guarded smoke wrapper was run against a real Sensorium-enabled Soma service;
    addenda now capture stable-endpoint success, bounded status summaries, live producer profile
    disclosure, and the eight-second smoke wait aligned with the five-second status heartbeat
- [Sensorium Color Live Metadata Verification](./2026-05-18_sensorium_color_live_metadata.md)
  - review after an explicitly acknowledged live color metadata smoke; documents helper-side
    `max_fps` enforcement, live helper-side color downsampling, metadata-only summaries, and cleanup
- [Sensorium Post-Hardening Live Regression](./2026-05-18_sensorium_post_hardening_live_regression.md)
  - review after status and acknowledged color live smoke were rerun against `jetsorano` following
    helper stream-error metadata, timeout enforcement, automatic ending provenance, and current-state
    documentation cleanup
- [Sensorium Depth Metadata Contract](./2026-05-18_sensorium_depth_metadata_contract.md)
  - review after the depth stream contract was defined as metadata-only before any live depth smoke
    or model-facing spatial-scene delivery
- [Sensorium Depth Payload Summarizer](./2026-05-18_sensorium_depth_payload_summarizer.md)
  - review after a standalone depth payload summarizer and bounded `depth_units`
    disclosure/provenance copying landed while live depth activation remained blocked
- [Sensorium Depth Helper Minimization](./2026-05-18_sensorium_depth_helper_minimization.md)
  - review after helper-side depth PNG downsampling and Node depth transform forwarding landed
    before any live depth smoke
- [Sensorium Depth Live Metadata Verification](./2026-05-19_sensorium_depth_live_metadata.md)
  - review after an explicitly acknowledged live depth metadata smoke verified bounded PNG
    summaries, positive `depth_units`, and cleanup against `jetsorano`

## Remote Graphical Session Thread

- [Remote Graphical Session Provider Note](./2026-05-17_remote_graphical_session_provider_note.md)
  - review after Sunshine/Moonlight was captured as a possible governed visual session provider

## Model Context Thread

- [Model-Facing Visual Delivery Boundary](./2026-05-19_model_facing_visual_delivery_boundary.md)
  - review after the visual payload delivery boundary was documented as separate from Sensorium
    subscription grants and left implementation out of scope
- [Model Visual Proposal Scaffold](./2026-05-19_model_visual_proposal_scaffold.md)
  - review after disabled/requestable model visual attach metadata and a byte-free, review-only
    proposal template scaffold landed
- [Model Visual Grant Candidate Scaffold](./2026-05-19_model_visual_grant_candidate_scaffold.md)
  - review after approved visual attach proposals gained a non-writing grant-candidate validator
    and byte-free provenance fixture
- [Model Visual Review Surface](./2026-05-19_model_visual_review_surface.md)
  - review after pure operator-facing proposal/candidate review text landed without routes, payload
    bytes, or model delivery
- [Model Visual Request Refusal Scaffold](./2026-05-19_model_visual_request_refusal_scaffold.md)
  - review after a pure fail-closed visual attach request validator landed without route wiring or
    payload handling
- [Model Visual Preview Acknowledgement](./2026-05-19_model_visual_preview_acknowledgement.md)
  - review after byte-free transformed preview artifact and user acknowledgement metadata validation
    landed without rendering or delivery
- [Model Visual Preview Threading](./2026-05-19_model_visual_preview_threading.md)
  - review after preview artifact and acknowledgement metadata were threaded through visual grant
    candidates and request validation as byte-free constraints
- [Model Visual Preview Review Formatting](./2026-05-19_model_visual_preview_review_formatting.md)
  - review after proposal and candidate review text started surfacing preview artifact and
    acknowledgement metadata without carrying visual payload bytes
- [Model Visual Review Text Route](./2026-05-19_model_visual_review_text_route.md)
  - review after the review-only HTTP formatter route exposed proposal/candidate review text
    without grant writes, subscription activation, model invocation, or payload delivery
- [Model Visual Review CLI](./2026-05-19_model_visual_review_cli.md)
  - review after a CLI wrapper started calling the review-only formatter route for byte-free
    proposal/candidate review text
- [Model Visual Attach Dry-Run Route](./2026-05-19_model_visual_attach_dry_run_route.md)
  - review after the visual attach request validator became available through a dry-run HTTP route
    that accepts/refuses metadata-only requests without delivery
- [Model Visual Attach Dry-Run CLI](./2026-05-19_model_visual_attach_dry_run_cli.md)
  - review after a CLI wrapper started calling the visual attach dry-run route and printing
    non-delivery acceptance/refusal summaries
- [Model Visual Attachment Provenance Fixture](./2026-05-19_model_visual_attachment_provenance_fixture.md)
  - review after a future byte-free `model.context.visual.attached` provenance fixture landed
    without activating delivery
- [Model Visual Attachment Provenance Builder](./2026-05-19_model_visual_attachment_provenance_builder.md)
  - review after a pure future provenance summary helper landed disconnected from routes and model
    delivery
- [Model Visual Dry-Run Provenance Preview](./2026-05-19_model_visual_dry_run_provenance_preview.md)
  - review after accepted visual attach dry-runs started returning a byte-free future provenance
    preview without appending provenance or delivering payloads
- [Grant Mutation Provenance Constructors](./2026-05-20_grant_mutation_provenance_constructors.md)
  - review after pure metadata-only `grant.created`, `grant.revoked`, `grant.superseded`, and
    `grant.expired` event constructors landed without route, CLI, file-write, or activation paths
- [Grant Mutation Durable Write Recovery Design](./2026-05-20_grant_mutation_durable_write_recovery_design.md)
  - review after documenting atomic grant-store writes, provenance/write ordering, and recovery
    behavior without enabling writable routes or durable mutation
- [Grant Store Writer Scaffold](./2026-05-20_grant_store_writer_scaffold.md)
  - review after adding a pure injectable grant-store writer with ordering and partial-failure
    tests while keeping routes, CLI mutation, and runtime writes disabled
- [Grant Mutation Store Writers](./2026-05-20_grant_mutation_store_writers.md)
  - review after adding internal create/revoke/supersede/expire wrappers around the grant-store
    writer without adding public mutation surfaces
- [Grant Store File Adapter](./2026-05-20_grant_store_file_adapter.md)
  - review after adding a concrete filesystem adapter and sibling lock-file strategy for the
    grant-store writer without enabling durable mutation
- [Grant Mutation Recovery Inspector](./2026-05-20_grant_mutation_recovery_inspector.md)
  - review after adding pure recovery inspection for missing or mismatched grant mutation
    provenance and documenting append-only durable provenance as the retention direction
- [Grant Mutation Provenance File Adapter](./2026-05-20_grant_mutation_provenance_file_adapter.md)
  - review after adding an append-only NDJSON provenance adapter for metadata-only grant mutation
    events without enabling public durable mutation
- [Grant Mutation Durable Composition](./2026-05-20_grant_mutation_durable_composition.md)
  - review after proving internal durable create/revoke composition with store writes,
    append-only provenance, and recovery inspection in temporary directories
- [Grant Authorization Recovery Gate](./2026-05-21_grant_authorization_recovery_gate.md)
  - review after adding a pure policy-gateway helper that denies degraded matching grants without
    wiring public mutation, durable writes, runtime writes, or route activation
- [Sensorium Recovery-Aware Authorization](./2026-05-21_sensorium_recovery_aware_authorization.md)
  - review after wiring the helper into Sensorium subscription authorization with an injected
    recovery report while preserving durable-write and mutation-disabled boundaries
- [Model Visual Recovery-Aware Dry Run](./2026-05-21_model_visual_recovery_aware_dry_run.md)
  - review after adding exact grant-id recovery gating to the visual attach dry-run route without
    enabling payload delivery, provenance append, durable writes, or grant mutation
- [Unsupported Grant Schema Route Codes](./2026-05-21_unsupported_grant_schema_route_codes.md)
  - review after grant-dependent runtime routes gained explicit unsupported-schema denial codes
    instead of collapsing those cases into generic no-grant errors
- [Grant Recovery Inspection Route](./2026-05-21_grant_recovery_inspection_route.md)
  - review after adding a read-only operator route for bounded grant recovery inspection without
    enabling durable mutation or repair
- [Grant Authority Startup Loader](./2026-05-21_grant_authority_startup_loader.md)
  - review after server startup began loading grant mutation provenance and passing recovery
    inspection into policy gates without enabling mutation
- [Grant Recovery CLI](./2026-05-21_grant_recovery_cli.md)
  - review after adding a read-only `grants recovery` CLI wrapper over the recovery inspection route
- [Durable Grant Route Readiness](./2026-05-21_durable_grant_route_readiness.md)
  - review after documenting the activation checklist before durable grant mutation routes or CLI
    mutation commands are implemented
- [Grant Mutation Preview Route](./2026-05-21_grant_mutation_preview_route.md)
  - review after adding a non-mutating create/revoke grant mutation preview helper and HTTP route
- [Grant Mutation Preview CLI](./2026-05-21_grant_mutation_preview_cli.md)
  - review after adding dry-run CLI wrappers over the grant mutation preview route
- [Grant Mutation Preview Review Text](./2026-05-22_grant_mutation_preview_review_text.md)
  - review after adding pure operator-facing preview text for dry-run grant mutation previews
- [Grant Mutation Preview Route Failures](./2026-05-22_grant_mutation_preview_route_failures.md)
  - review after hardening dry-run route refusals for unsupported and malformed preview requests
- [Grant Mutation Preview CLI Failures](./2026-05-22_grant_mutation_preview_cli_failures.md)
  - review after rendering dry-run preview refusals in CLI human output while preserving raw JSON
- [Durable Grant Mutation Activation Policy](./2026-05-22_durable_grant_mutation_activation_policy.md)
  - review after documenting the operator decision boundary for future durable grant mutation
- [Runtime Write Posture Status](./2026-05-22_runtime_write_posture_status.md)
  - review after exposing requested/default runtime write posture in read-only status surfaces
- [Durable Mutation Route Denial Stubs](./2026-05-22_durable_mutation_route_denial_stubs.md)
  - review after reserving durable grant mutation route names with explicit disabled refusals
- [Durable Mutation CLI Denial Stubs](./2026-05-22_durable_mutation_cli_denial_stubs.md)
  - review after reserving durable grant mutation CLI names with local disabled errors
- [Grant Mutation Preview Review Endpoint](./2026-05-22_grant_mutation_preview_review_endpoint.md)
  - review after exposing grant mutation preview review formatting through a route
- [Grant Mutation Preview Review CLI](./2026-05-22_grant_mutation_preview_review_cli.md)
  - review after adding a CLI wrapper for grant mutation preview review formatting
- [Grant Mutation Preview Review Fixtures](./2026-05-22_grant_mutation_preview_review_fixtures.md)
  - review after adding fixture coverage for grant mutation preview review forbidden fields
- [Grant Mutation Preview Review CLI Integration](./2026-05-22_grant_mutation_preview_review_cli_integration.md)
  - review after adding a real-handler smoke test for the grant preview review CLI
- [Grant Mutation Preview Review CLI Refusal Integration](./2026-05-24_grant_mutation_preview_review_cli_refusal_integration.md)
  - review after preserving validation-path details through CLI HTTP refusal errors
- [Grant Mutation Preview Review Operator Examples](./2026-05-24_grant_mutation_preview_review_operator_examples.md)
  - review after documenting accepted and refused grant preview review CLI flows
- [Grant Preview Review Smoke Script](./2026-05-24_grant_preview_review_smoke_script.md)
  - review after adding a guarded functional smoke script for grant preview/review flows
- [Grant Preview Review Live Smoke](./2026-05-24_grant_preview_review_live_smoke.md)
  - review after running the guarded grant preview/review smoke against a local Soma service
- [Remote Graphical Capability Contract](./2026-05-24_remote_graphical_capability_contract.md)
  - review after adding disabled-first remote graphical session capability/provider vocabulary
- [Remote Graphical Proposal Template](./2026-05-24_remote_graphical_proposal_template.md)
  - review after adding a pure non-activating remote graphical proposal template builder
- [Remote Graphical Proposal Surface](./2026-05-24_remote_graphical_proposal_surface.md)
  - review after exposing remote graphical proposal review through HTTP and CLI without activation
- [Remote Graphical Proposal Persistence](./2026-05-24_remote_graphical_proposal_persistence.md)
  - review after storing pending remote graphical proposals without grants or runtime activation
- [Remote Graphical Grant Candidate Builder](./2026-05-24_remote_graphical_grant_candidate_builder.md)
  - review after adding a pure non-writing grant-candidate builder for approved remote graphical proposals
- [Remote Graphical Grant Candidate Surface](./2026-05-24_remote_graphical_grant_candidate_surface.md)
  - review after exposing remote graphical grant-candidate review through HTTP and CLI without writes
- [Remote Graphical Grant Activation Policy](./2026-05-24_remote_graphical_grant_activation_policy.md)
  - review after documenting the future runtime-only grant creation boundary for remote graphical proposals
- [Remote Graphical Runtime Grant Creation](./2026-05-24_remote_graphical_runtime_grant_creation.md)
  - review after adding process-local remote graphical grant creation without transport activation
- [Remote Graphical Runtime Grant Revocation](./2026-05-24_remote_graphical_runtime_grant_revocation.md)
  - review after adding process-local remote graphical grant revocation without provider session control
- [Remote Graphical Broker Boundary](./2026-05-24_remote_graphical_broker_boundary.md)
  - review after documenting the provider-neutral broker seam before live transport activation
- [Remote Graphical Broker Status Seam](./2026-05-24_remote_graphical_broker_status_seam.md)
  - review after adding no-op remote graphical broker status without live transport activation
- [Remote Graphical Session-Open Review](./2026-05-24_remote_graphical_session_open_review.md)
  - review after adding review-only session-open scaffolding without broker calls
- [Remote Graphical Session-Open Refusal](./2026-05-24_remote_graphical_session_open_refusal.md)
  - review after adding default-off session-open refusal without broker calls
- [Remote Graphical Session-Open Activation Policy](./2026-05-24_remote_graphical_session_open_activation_policy.md)
  - review after documenting gates for future live broker-backed session-open activation
- [Remote Graphical Runtime Opt-In](./2026-05-24_remote_graphical_runtime_opt_in.md)
  - review after adding startup-visible runtime opt-in posture without live transport activation
- [Remote Graphical Configured Broker Refusals](./2026-05-24_remote_graphical_configured_broker_refusals.md)
  - review after mapping session-open refusal codes by broker posture without transport activation
- [Remote Graphical Open-Session Fixture](./2026-05-24_remote_graphical_open_session_fixture.md)
  - review after adding fixture-only broker session-open success and failure contracts
- [Remote Graphical Session-Open Provenance Fixture](./2026-05-24_remote_graphical_session_open_provenance_fixture.md)
  - review after adding pure metadata-only fixture session-open provenance summaries
- [Remote Graphical Session-Open Provenance Preview](./2026-05-24_remote_graphical_session_open_provenance_preview.md)
  - review after adding non-appending fixture session-open provenance previews to route responses
- [Remote Graphical Session-Open Provenance Append Policy](./2026-05-24_remote_graphical_session_open_provenance_append_policy.md)
  - review after documenting prerequisites for fixture session-open provenance append
- [Remote Graphical Session-Open Provenance Append Fixture](./2026-05-24_remote_graphical_session_open_provenance_append_fixture.md)
  - review after appending fixture session-open provenance previews for success and failure
- [Remote Graphical Session-Open CLI Provenance Visibility](./2026-05-24_remote_graphical_session_open_cli_provenance_visibility.md)
  - review after covering text-vs-json CLI visibility for fixture session-open provenance
- [Remote Graphical Session-Open Provenance Query Examples](./2026-05-24_remote_graphical_session_open_provenance_query_examples.md)
  - review after documenting provenance CLI filtering for appended fixture session-open events
- [Remote Graphical Live Broker Activation Checklist](./2026-05-24_remote_graphical_live_broker_activation_checklist.md)
  - review after adding the checklist for future live Sunshine/Moonlight session-open activation
- [Remote Graphical Live Provider Manifest](./2026-05-24_remote_graphical_live_provider_manifest.md)
  - review after documenting the declarative manifest for future live Sunshine/Moonlight broker configuration
- [Remote Graphical Live Session-Open Provenance](./2026-05-24_remote_graphical_live_session_open_provenance.md)
  - review after documenting the reserved live session-open provenance event shape
- [Remote Graphical Live Session-Open Provenance Constructor](./2026-05-24_remote_graphical_live_session_open_provenance_constructor.md)
  - review after adding the pure unused constructor for future live session-open provenance
- [Remote Graphical Live Session-Open Non-Append Guards](./2026-05-24_remote_graphical_live_session_open_non_append_guards.md)
  - review after proving current session-open routes do not emit live provenance
- [Remote Graphical Live Provider Manifest Schema](./2026-05-24_remote_graphical_live_provider_manifest_schema.md)
  - review after adding the pure validator for future live provider manifests
- [Remote Graphical Live Provider Manifest Fixture](./2026-05-24_remote_graphical_live_provider_manifest_fixture.md)
  - review after adding the non-runtime validating manifest fixture
- [Remote Graphical Live Provider Manifest Review Surface](./2026-05-25_remote_graphical_live_provider_manifest_review_surface.md)
  - review after adding the pure read-only formatter for future live provider manifest review
- [Remote Graphical Live Provider Manifest CLI Review](./2026-05-25_remote_graphical_live_provider_manifest_cli_review.md)
  - review after exposing the docs fixture through a CLI-only non-activating review command
- [Remote Graphical Live Provider Manifest CLI Smoke Docs](./2026-05-25_remote_graphical_live_provider_manifest_cli_smoke_docs.md)
  - review after documenting text markers and JSON false flags for the CLI-only manifest review

## Current Review Triggers

- Run a focused review after the next traversal behavior change.
- Run a focused review after the next Sensorium behavior change, especially a live helper-backed
  smoke result, durable grant design change, or stream-consumption behavior change.
- Revisit compatibility delegates after a broader draft-lifecycle policy is formalized.
- Add new thread sections here when review density for another capability starts to grow.
