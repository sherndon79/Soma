# Soma Component Review Scope

Status: current review reference

Use this document to scope reviews when a full-repo review is unnecessary. Pick the component or
components touched by a change, inspect the primary paths, then apply the review focus.

Still follow `docs/reviews/README.md` for review structure and `docs/implementation_guide.md` for
implementation posture.

## Policy Gateway And Harness Modules

Primary paths:

- `src/app.js`
- `src/harness.js`
- `src/harnessModules.js`
- `config/base-harness.json`
- `config/harness-modules.json`

Supporting docs:

- `docs/architecture/mvp_slice.md`
- `docs/concepts/drafts/adaptable_harness.md`
- `docs/concepts/drafts/capability_proposals.md`

Review focus:

- capability checks happen before work
- approval is not treated as activation
- narrowing modules cannot widen access
- module adoption/drop provenance is correct
- revocation side effects run for affected capabilities

## Capability Catalog, Provider Registry, And Grants

Primary paths:

- `src/capabilityCatalog.js`
- `src/grants.js`
- `src/grantAuthority.js`
- `config/capability-catalog.json`
- `config/provider-registry.json`
- `config/grants.example.json`

The live `config/grants.json` and `config/grant-mutations.ndjson` are gitignored runtime authority,
not review fixtures. Inspect them only when the current task explicitly includes local authority
state.

Supporting docs:

- `docs/concepts/drafts/capability_catalog_and_providers.md`
- `docs/concepts/drafts/grant_lifecycle.md`
- `docs/migration.md`

Review focus:

- catalog status distinguishes active, requestable, unsupported, design-review, forbidden, and
  excluded states
- provider registration does not imply authority
- grant schema changes preserve consent and migration rules
- unsupported capabilities do not become proposals or live routes by accident

## Provenance And Audit

Primary paths:

- `src/provenance.js`
- `src/provenanceLog.js`
- `src/app.js`
- tests covering `/provenance` and `/provenance/summary`

Supporting docs:

- `docs/operators.md`
- `docs/failure_modes.md`
- relevant capability-specific provenance drafts

Review focus:

- event types are stable and machine-readable
- sensitive payloads are summarized rather than copied
- denied or schema-rejected helper output does not record success provenance
- filters and summaries remain bounded
- provenance shape changes update migration guidance when needed

## Local Model Routing And Escalation Triggers

Primary paths:

- `src/modelClient.js`
- `src/escalationTriggers.js`
- `src/capabilityEval.js`
- `src/app.js`
- `src/cli.js`
- `config/runtime-profiles.json`

Supporting docs:

- `docs/concepts/drafts/local_ai_service_plane.md`
- `docs/concepts/drafts/escalation_and_planning.md`
- `docs/concepts/drafts/model_capability_evaluations.md`
- `docs/security/threat_model.md`
- `docs/failure_modes.md`

Review focus:

- local/remote route disclosure is accurate
- escalation triggers remain advisory metadata, not routing decisions
- remote planning remains unsupported unless a provider and threat posture are deliberately added
- failed or malformed model responses do not broaden capability
- participant-facing and operator-facing surfaces are not conflated

## Session Memory And Future Durable Memory

Primary paths:

- `src/sessionMemory.js`
- `src/app.js`
- memory-related tests

Supporting docs:

- `docs/concepts/drafts/memory_control_surface.md`
- `docs/migration.md`
- `docs/principles.md`

Review focus:

- session memory stays ephemeral unless durable memory is explicitly implemented
- memory writes are capability-gated
- memory does not become authority
- future durable memory changes include review, allowed uses, forbidden uses, and deletion paths

## Cognitive Load Stewardship

Primary paths:

- `src/cognitiveLoad.js`
- `src/app.js`
- `docs/concepts/drafts/cognitive_load_stewardship.md`

Supporting docs:

- `docs/principles.md`
- `docs/failure_modes.md`
- `docs/operators.md`

Review focus:

- stewardship remains advisory and non-diagnostic
- overwhelm signals do not become surveillance or coercive intervention
- reminders are phrased as optional care, not commands
- cognitive-load observations are not persisted beyond their authorized scope
- no visual, biometric, or durable inference behavior is implied by text-only heuristics

## File Access

Primary paths:

- `src/fileAccess.js`
- `src/app.js`
- `config/base-harness.json`

Supporting docs:

- `docs/operators.md`
- `docs/security/threat_model.md`
- `docs/failure_modes.md`

Review focus:

- reads stay inside granted roots
- byte limits are enforced
- errors do not leak unnecessary filesystem detail
- future write/delete behavior is not implied by read access

## Desktop Broker And Rust Helper

Primary paths:

- `src/desktopBroker.js`
- `src/desktopInspectionSchema.js`
- `crates/soma-desktop-broker/src/main.rs`
- `docs/schemas/desktop-inspection-result.schema.json`

Supporting docs:

- `docs/concepts/drafts/desktop_capability_broker.md`
- `docs/concepts/drafts/desktop_helper_limit_contract.md`
- `docs/concepts/drafts/desktop_helper_transport.md`
- `docs/concepts/drafts/desktop_inspection_schema_validation.md`
- `docs/concepts/drafts/desktop_request_contract_baseline.md`

Review focus:

- Node remains policy/provenance/output-validation authority
- Rust helper only executes bounded host queries
- helper args are derived from validated Node requests
- request limits and helper hard caps align
- helper output overreach fails before response/provenance
- no text, screenshots, keyboard, pointer, actions, or actuation appear under read-only inspection

## Desktop Disclosure Registry And Root References

Primary paths:

- `src/desktopDisclosureRegistry.js`
- `src/app.js`
- tests for registry and module revocation

Supporting docs:

- `docs/concepts/drafts/desktop_disclosure_registry.md`
- `docs/concepts/drafts/traversal_root_authorization.md`
- `docs/concepts/drafts/desktop_root_ref_exposure.md`

Review focus:

- root refs derive only from objects already disclosed or explicitly selected
- raw service/path roots are not accepted from models
- TTL, revocation, and inactive-capability checks fail closed
- module narrowing revokes relevant refs
- registry ids are Node-owned and never helper-owned

## Bounded AT-SPI Traversal

Primary paths:

- `src/desktopTraversalRequest.js`
- `src/desktopTraversalOutput.js`
- `src/desktopTraversalProvenance.js`
- `src/desktopInspectionSchema.js`
- `src/desktopBroker.js`
- `crates/soma-desktop-broker/src/main.rs`
- future traversal schemas and fixtures under `docs/schemas/` and `docs/fixtures/`

Supporting docs:

- `docs/concepts/drafts/bounded_recursive_atspi_traversal.md`
- `docs/concepts/drafts/desktop_traversal_enablement_sequence.md`
- `docs/concepts/drafts/desktop_traversal_helper_contract.md`
- `docs/concepts/drafts/desktop_traversal_provenance.md`
- `docs/concepts/drafts/desktop_traversal_request_validation.md`
- `docs/concepts/drafts/desktop_traversal_rust_implementation_plan.md`

Review focus:

- endpoint remains disabled until activation gates are complete
- traversal roots require authorized `root_ref`
- traversal output omits protected fields
- traversal is bounded by depth, node count, and children per node
- provenance stores summary fields, not traversal trees
- future fixtures are not mistaken for active contract

## CLI And Operator Surfaces

Primary paths:

- `src/cli.js`
- `src/server.js`
- `docs/operators.md`
- CLI tests

Supporting docs:

- `docs/onboarding.md`
- `docs/failure_modes.md`

Review focus:

- CLI flags map to API request fields exactly
- operator-facing surfaces do not imply participant consent
- JSON output remains stable enough for scripts
- refusal/error text is actionable without exposing sensitive detail

## Reviews, Migration, And Documentation Lifecycle

Primary paths:

- `docs/reviews/`
- `docs/reviews/README.md`
- `docs/reviews/TEMPLATE.md`
- `docs/migration.md`
- `docs/README.md`
- `AGENTS.md`

Supporting docs:

- `docs/implementation_guide.md`
- `ROADMAP.md`

Review focus:

- reviews remain historical context, not canonical truth
- addenda append rather than rewrite review bodies
- canonical docs receive resolved posture changes
- draft promotion/retirement follows migration and documentation lifecycle policy
- review templates match the kind of review being performed

## Future High-Risk Areas

Use this section when design starts, even before implementation.

Areas:

- durable memory
- remote planning providers
- desktop text inspection
- STT/TTS and native audio
- visual perception and embodiment
- browser automation
- filesystem writes
- shell execution
- desktop actuation

Review focus:

- explicit design review before implementation
- threat model and failure modes updated
- participant/user-facing consent surface designed
- irreversible disclosure/actions minimized and previewed
- disabled-first scaffolding used before activation
