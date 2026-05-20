import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { buildCapabilityView } from "./capabilityCatalog.js";
import { assessCognitiveLoad } from "./cognitiveLoad.js";
import { CapabilityProposalStore, summarizeNotifications } from "./capabilityProposals.js";
import { inspectDesktopBrokerEnvironment, inspectFocusedDesktopObject } from "./desktopBroker.js";
import { DesktopDisclosureRegistry } from "./desktopDisclosureRegistry.js";
import { runInternalDesktopTraversalRequest } from "./desktopTraversalPipeline.js";
import { validateDesktopTraversalRequest } from "./desktopTraversalRequest.js";
import { assessEscalationTriggers } from "./escalationTriggers.js";
import { readScopedTextFile } from "./fileAccess.js";
import { createGrant, listGrants, revokeGrant, summarizeGrants } from "./grants.js";
import { requireCapability } from "./harness.js";
import {
  adoptSelfApplyModule,
  applyActiveModules,
  dropModule,
  findModule,
  listVisibleModules,
} from "./harnessModules.js";
import { readJson, writeError, writeJson } from "./http.js";
import { createProvenance } from "./provenance.js";
import { ProvenanceLog } from "./provenanceLog.js";
import {
  capabilityForRuntimeProfile,
  publicRuntimeProfiles,
  resolveRuntimeProfile,
} from "./runtimeProfiles.js";
import { enforceSensoriumGrantConstraints } from "./sensoriumGrantConstraints.js";
import {
  buildSensoriumGrantCreateCandidateFromProposal,
} from "./sensoriumGrantCreateCandidate.js";
import { buildSensoriumGrantProposalTemplate } from "./sensoriumGrantProposalTemplate.js";
import { validateSensoriumSubscriptionRequest } from "./sensoriumSubscriptionRequest.js";
import {
  modelVisualAttachGrantCandidateReviewText,
  modelVisualAttachProposalReviewText,
} from "./modelVisualAttachReviewSurface.js";
import { validateModelVisualAttachRequest } from "./modelVisualAttachRequest.js";
import { createModelVisualAttachmentProvenanceSummary } from "./modelVisualAttachmentProvenance.js";
import { SessionMemory } from "./sessionMemory.js";

export function createApp({
  harness,
  capabilityCatalog,
  providerRegistry,
  moduleRegistry,
  runtimeProfiles,
  modelClient,
  sessionMemory,
  capabilityProposals,
  grantStore,
  provenanceLog,
  desktopDisclosureRegistry,
  sensoriumSubscriber,
  logger = console,
} = {}) {
  return createServer(createRequestHandler({
    harness,
    capabilityCatalog,
    providerRegistry,
    moduleRegistry,
    runtimeProfiles,
    modelClient,
    sessionMemory,
    capabilityProposals,
    grantStore,
    provenanceLog,
    desktopDisclosureRegistry,
    sensoriumSubscriber,
    logger,
  }));
}

export function createRequestHandler({
  harness,
  capabilityCatalog,
  providerRegistry,
  moduleRegistry = { schema_version: 1, modules: [] },
  runtimeProfiles,
  modelClient,
  sessionMemory = new SessionMemory(),
  capabilityProposals = new CapabilityProposalStore(),
  grantStore = { schema_version: 1, grants: [] },
  provenanceLog = new ProvenanceLog(),
  desktopDisclosureRegistry = new DesktopDisclosureRegistry(),
  sensoriumSubscriber = null,
  logger = console,
} = {}) {
  if (!harness) {
    throw new Error("createRequestHandler requires a harness.");
  }
  if (!runtimeProfiles) {
    throw new Error("createRequestHandler requires runtimeProfiles.");
  }
  if (!modelClient) {
    throw new Error("createRequestHandler requires a modelClient.");
  }
  let activeModules = [];
  if (typeof sensoriumSubscriber?.onSubscriptionEnded === "function") {
    sensoriumSubscriber.onSubscriptionEnded(({ subscription_id, endSummary } = {}) => {
      if (!endSummary) {
        return;
      }
      const event = provenanceLog.append(createSensoriumProvenanceEvent({
        summary: endSummary,
        caller: "soma.sensorium.automatic-end",
      }));
      logger.info?.("soma.provenance", event);
      logger.info?.("soma.sensorium.subscription_ended", {
        subscription_id: subscription_id ?? "",
        provenance_id: event.id,
        termination_reason: endSummary.termination_reason ?? "",
      });
    });
  }

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const effectiveHarness = applyActiveModules(harness, activeModules);

      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/harness") {
        writeJson(res, 200, {
          ...effectiveHarness,
          runtime_profiles: publicRuntimeProfiles(runtimeProfiles),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/capability-view") {
        writeJson(res, 200, buildCapabilityView({
          catalog: capabilityCatalog,
          providerRegistry,
          harness: effectiveHarness,
        }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/model-visual/review-text") {
        const body = await readJson(req);
        const kind = String(body?.kind ?? "").trim();
        const reviewResponse = body?.review_response ?? body?.response;
        if (!["proposal", "grant_candidate"].includes(kind) || !isPlainObject(reviewResponse)) {
          writeError(res, {
            statusCode: 400,
            code: "model_visual_review_request_invalid",
            message: "Model visual review text requires kind=proposal or kind=grant_candidate and a review_response object.",
          });
          return;
        }

        const text = kind === "proposal"
          ? modelVisualAttachProposalReviewText(reviewResponse)
          : modelVisualAttachGrantCandidateReviewText(reviewResponse);
        writeJson(res, 200, {
          kind,
          text,
          review_only: true,
          activation_performed: false,
          grant_written: false,
          subscription_activated: false,
          model_delivery_performed: false,
          payload_attached: false,
          payload_bytes_included: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/model-visual/attach-requests/dry-run") {
        const body = await readJson(req);
        const request = validateModelVisualAttachRequest(body, {
          grants: grantStore.grants ?? [],
        });
        const futureProvenancePreview = createModelVisualAttachmentProvenanceSummary({
          request,
        });
        writeJson(res, 200, {
          request,
          future_provenance_preview: futureProvenancePreview,
          future_provenance_appended: false,
          dry_run: true,
          accepted: true,
          activation_performed: false,
          grant_written: false,
          subscription_activated: false,
          model_delivery_performed: false,
          payload_attached: false,
          payload_bytes_included: false,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/harness-modules") {
        writeJson(res, 200, {
          modules: listVisibleModules(moduleRegistry),
          active_modules: activeModules,
          pending_capability_proposals: capabilityProposals.pendingCount(),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/capability-proposals") {
        writeJson(res, 200, {
          proposals: capabilityProposals.list({
            status: url.searchParams.get("status") ?? "",
          }),
          durable: false,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/notifications") {
        const notifications = capabilityProposals.notifications({
          status: url.searchParams.get("status") ?? "pending",
        });
        writeJson(res, 200, {
          notifications,
          summary: summarizeNotifications(notifications),
          activation_performed: false,
          durable: false,
        });
        return;
      }

      const proposalShowMatch = url.pathname.match(/^\/capability-proposals\/([^/]+)$/);
      if (req.method === "GET" && proposalShowMatch) {
        const [, proposalId] = proposalShowMatch;
        writeJson(res, 200, {
          proposal: capabilityProposals.find(proposalId),
          activation_performed: false,
          durable: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/sensorium/proposal-template") {
        const body = await readJson(req);
        const template = buildSensoriumGrantProposalTemplate({
          catalog: capabilityCatalog,
          providerRegistry,
          requested_by: body?.requested_by,
          capability: body?.capability,
          provider: body?.provider,
          topic: body?.topic,
          constraints: body?.constraints ?? {},
          requested_scope: body?.requested_scope ?? "session",
          reason: body?.reason,
          fallback: body?.fallback,
        });
        writeJson(res, 200, {
          ...template,
          review_only: true,
          grant_written: false,
          subscription_activated: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/sensorium/proposals") {
        const body = await readJson(req);
        const template = buildSensoriumGrantProposalTemplate({
          catalog: capabilityCatalog,
          providerRegistry,
          requested_by: body?.requested_by,
          capability: body?.capability,
          provider: body?.provider,
          topic: body?.topic,
          constraints: body?.constraints ?? {},
          requested_scope: body?.requested_scope ?? "session",
          reason: body?.reason,
          fallback: body?.fallback,
        });
        const proposal = capabilityProposals.create({
          ...template.proposal,
          review_context: template.review,
          grant_intent: template.grant_intent,
        }, {
          allowReviewMetadata: true,
        });
        const event = provenanceLog.append(createCapabilityProposalEvent({
          proposal,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        proposal.provenance_id = event.id;
        logger.info?.("soma.provenance", event);
        writeJson(res, 201, {
          proposal,
          notification: proposal.notification,
          review: template.review,
          grant_intent: template.grant_intent,
          provenance_id: event.id,
          activation_performed: false,
          durable: false,
          grant_written: false,
          subscription_activated: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/sensorium/grants") {
        const body = await readJson(req);
        const actor = String(body?.actor ?? body?.approved_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "sensorium_grant_create_requires_user_actor",
            message: "Sensorium grant creation requires an explicit user actor.",
          });
          return;
        }

        const proposal = capabilityProposals.find(String(body?.proposal_id ?? ""));
        const candidate = buildSensoriumGrantCreateCandidateFromProposal(proposal, {
          catalog: capabilityCatalog,
          providerRegistry,
          now: () => new Date().toISOString(),
          createId: () => `grant-sensorium-${cryptoRandomId()}`,
        });
        const nextGrantStore = createGrant(
          grantStore,
          candidate.grant_create_input,
          {
            catalog: capabilityCatalog,
            providerRegistry,
          },
        );
        grantStore = nextGrantStore;
        const grant = nextGrantStore.grants.find(
          (entry) => entry.id === candidate.grant_create_input.id,
        );
        const event = provenanceLog.append(createSensoriumGrantCreatedEvent({
          grant,
          proposal,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 201, {
          grant,
          source_proposal_id: proposal.id,
          provenance_id: event.id,
          activation_performed: false,
          durable: false,
          file_written: false,
          grant_written: true,
          subscription_activated: false,
        });
        return;
      }

      const sensoriumGrantRevokeMatch = url.pathname.match(/^\/sensorium\/grants\/([^/]+)\/revoke$/);
      if (req.method === "POST" && sensoriumGrantRevokeMatch) {
        const body = await readJson(req);
        const grantId = sensoriumGrantRevokeMatch[1];
        const actor = String(body?.actor ?? body?.revoked_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "sensorium_grant_revoke_requires_user_actor",
            message: "Sensorium grant revocation requires an explicit user actor.",
          });
          return;
        }

        const grantBeforeRevocation = (grantStore.grants ?? []).find(
          (entry) => entry.id === grantId,
        );
        if (!grantBeforeRevocation) {
          writeError(res, {
            statusCode: 400,
            code: "unknown_grant",
            message: "Grant mutation requires an existing grant.",
          });
          return;
        }

        if (!isSensoriumSubscribeCapability(grantBeforeRevocation.capability)) {
          writeError(res, {
            statusCode: 400,
            code: "sensorium_grant_revoke_requires_sensorium_grant",
            message: "Sensorium grant revocation requires a Sensorium subscription grant.",
          });
          return;
        }

        const reason = String(body?.reason ?? body?.revocation_reason ?? "").trim();
        if (!reason) {
          writeError(res, {
            statusCode: 400,
            code: "missing_revocation_reason",
            message: "Sensorium grant revocation requires a reason.",
          });
          return;
        }

        let stopResult = { stopped: [], stopped_count: 0 };
        if (
          grantBeforeRevocation?.status === "active" &&
          typeof sensoriumSubscriber?.stopByGrantId === "function"
        ) {
          try {
            stopResult = await sensoriumSubscriber.stopByGrantId(grantId, {
              terminationReason: "revoked",
              errorClass: "grant_revoked",
            });
          } catch (err) {
            writeError(res, {
              statusCode: err.statusCode ?? 400,
              code: err.code ?? "sensorium_subscription_stop_failed",
              message: err.message ?? "subscription stop failed during grant revocation",
            });
            return;
          }
        }

        const nextGrantStore = revokeGrant(grantStore, {
          id: grantId,
          actor,
          reason,
        });
        grantStore = nextGrantStore;
        const grant = nextGrantStore.mutation.grant;
        const event = provenanceLog.append(createSensoriumGrantRevokedEvent({
          grant,
          previousGrant: grantBeforeRevocation,
          caller: req.headers["x-soma-caller"] ?? "",
          stoppedSubscriptions: stopResult.stopped,
          changed: nextGrantStore.mutation.changed,
        }));
        logger.info?.("soma.provenance", event);

        const subscriptionEvents = [];
        for (const stopped of stopResult.stopped) {
          const subscriptionEvent = provenanceLog.append(createSensoriumProvenanceEvent({
            summary: stopped.endSummary,
            caller: req.headers["x-soma-caller"] ?? "",
          }));
          subscriptionEvents.push(subscriptionEvent);
        }

        writeJson(res, 200, {
          grant,
          changed: nextGrantStore.mutation.changed,
          provenance_id: event.id,
          stopped_subscriptions: stopResult.stopped.map((stopped, index) => ({
            subscription_id: stopped.subscription_id,
            end_summary: stopped.endSummary,
            provenance_id: subscriptionEvents[index]?.id ?? "",
          })),
          stopped_subscription_count: stopResult.stopped_count,
          activation_performed: false,
          durable: false,
          file_written: false,
          grant_written: true,
          subscription_activated: false,
        });
        return;
      }

      // ── Sensorium subscription routes (step 9e activation) ────────
      //
      // The public seam. POST starts a subscription, DELETE stops one,
      // GET lists active subscriptions. The path is fail-closed by
      // absence of an active grant: with the default config/grants.json
      // (no Sensorium grants), POST returns 403. Tests can inject a
      // grantStore fixture to exercise the success path.
      //
      // If sensoriumSubscriber is not configured (deployments that
      // don't want Sensorium support), all three routes return 503
      // — a deliberate refuse-cleanly stance rather than 404, so the
      // operator sees "support not configured" rather than "endpoint
      // does not exist."
      if (
        url.pathname === "/sensorium/subscriptions" ||
        url.pathname.startsWith("/sensorium/subscriptions/")
      ) {
        if (!sensoriumSubscriber) {
          writeError(res, {
            statusCode: 503,
            code: "sensorium_subscriber_not_configured",
            message: "Sensorium subscription routes are not enabled on this Soma instance.",
          });
          return;
        }

        if (req.method === "GET" && url.pathname === "/sensorium/subscriptions") {
          writeJson(res, 200, sensoriumSubscriber.describeActive());
          return;
        }

        if (req.method === "POST" && url.pathname === "/sensorium/subscriptions") {
          const body = await readJson(req);
          const capability = typeof body?.capability === "string" ? body.capability : "";
          const scope = typeof body?.scope === "string" ? body.scope : "session";

          let validatedRequest;
          try {
            validatedRequest = validateSensoriumSubscriptionRequest(
              {
                topic: body?.topic,
                constraints: body?.constraints ?? {},
              },
              { capability },
            );
          } catch (err) {
            writeError(res, {
              statusCode: 400,
              code: err.code ?? "sensorium_subscription_request_invalid",
              message: err.message ?? "Sensorium subscription request is invalid.",
              validation_errors: err.validation_errors,
            });
            return;
          }

          // Grant lookup. A subscription is authorized only when an
          // ACTIVE grant exists for the requested capability. With the
          // default file-backed grant store (no Sensorium grants), this
          // is the fail-closed point.
          const grant = (grantStore.grants ?? []).find(
            (g) => (
              g.status === "active" &&
              g.capability === capability &&
              (g.scope ?? "session") === scope
            ),
          );
          if (!grant) {
            writeError(res, {
              statusCode: 403,
              code: "sensorium_subscription_no_grant",
              message: `No active grant authorizes ${capability}. Approval is not activation; an explicit grant is required.`,
            });
            return;
          }

          const provider = findProvider(providerRegistry, grant.provider);
          if (!provider || !providerSupportsCapability(provider, capability)) {
            writeError(res, {
              statusCode: 403,
              code: "sensorium_subscription_provider_not_authorized",
              message: `Grant ${grant.id} references a provider that does not support ${capability}.`,
            });
            return;
          }

          if (!providerHostMatchesTopic(provider, validatedRequest.topic)) {
            writeError(res, {
              statusCode: 403,
              code: "sensorium_subscription_topic_not_authorized",
              message: `Grant ${grant.id} does not authorize ${validatedRequest.topic}.`,
            });
            return;
          }

          if (!grantTopicMatchesTopic(grant, validatedRequest.topic)) {
            writeError(res, {
              statusCode: 403,
              code: "sensorium_subscription_topic_not_authorized",
              message: `Grant ${grant.id} does not authorize ${validatedRequest.topic}.`,
            });
            return;
          }

          let boundedRequest;
          try {
            boundedRequest = enforceSensoriumGrantConstraints({
              request: validatedRequest,
              grant,
            });
          } catch (err) {
            writeError(res, {
              statusCode: err.statusCode ?? 403,
              code: err.code ?? "sensorium_subscription_grant_constraints_exceeded",
              message: err.message ?? "Sensorium subscription request exceeds grant constraints.",
              validation_errors: err.validation_errors,
            });
            return;
          }

          let startResult;
          try {
            startResult = await sensoriumSubscriber.start({
              capability,
              provider: grant.provider,
              grantId: grant.id,
              scope,
              body: {
                topic: boundedRequest.topic,
                constraints: boundedRequest.constraints,
              },
            });
          } catch (err) {
            writeError(res, {
              statusCode: err.statusCode ?? 400,
              code: err.code ?? "sensorium_subscription_start_failed",
              message: err.message ?? "subscription start failed",
              validation_errors: err.validation_errors,
            });
            return;
          }

          const event = provenanceLog.append(createSensoriumProvenanceEvent({
            summary: startResult.startSummary,
            caller: req.headers["x-soma-caller"] ?? "",
          }));
          writeJson(res, 201, {
            subscription_id: startResult.subscription_id,
            topic: startResult.topic,
            started_at: startResult.started_at,
            provenance_id: event.id,
            grant_id: grant.id,
            activation_performed: true,
          });
          return;
        }

        const stopMatch = url.pathname.match(/^\/sensorium\/subscriptions\/([^/]+)$/);
        if (req.method === "DELETE" && stopMatch) {
          const subscriptionId = stopMatch[1];
          let stopResult;
          try {
            stopResult = await sensoriumSubscriber.stop(subscriptionId, {
              terminationReason: "clean_stop",
            });
          } catch (err) {
            const code = err.code ?? "sensorium_subscription_stop_failed";
            writeError(res, {
              statusCode: code === "subscription_not_found" ? 404 : 400,
              code,
              message: err.message ?? "subscription stop failed",
            });
            return;
          }

          const event = provenanceLog.append(createSensoriumProvenanceEvent({
            summary: stopResult.endSummary,
            caller: req.headers["x-soma-caller"] ?? "",
          }));
          writeJson(res, 200, {
            subscription_id: subscriptionId,
            end_summary: stopResult.endSummary,
            provenance_id: event.id,
          });
          return;
        }

        writeError(res, {
          statusCode: 405,
          code: "method_not_allowed",
          message: `Method ${req.method} not allowed for ${url.pathname}`,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/grants") {
        writeJson(res, 200, {
          grants: listGrants(grantStore, {
            status: url.searchParams.get("status") ?? "",
          }),
          summary: summarizeGrants(grantStore),
          schema_version: grantStore.schema_version ?? 1,
          examples_available: Array.isArray(grantStore.examples) && grantStore.examples.length > 0,
          file_backed: true,
          writable: false,
          runtime_writes_enabled: false,
          activation_performed: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/capability-proposals") {
        const body = await readJson(req);
        const proposal = capabilityProposals.create(body);
        const event = provenanceLog.append(createCapabilityProposalEvent({
          proposal,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        proposal.provenance_id = event.id;
        logger.info?.("soma.provenance", event);
        writeJson(res, 201, {
          proposal,
          notification: proposal.notification,
          provenance_id: event.id,
          activation_performed: false,
          durable: false,
        });
        return;
      }

      const proposalDecisionMatch = url.pathname.match(/^\/capability-proposals\/([^/]+)\/(approve|deny)$/);
      if (req.method === "POST" && proposalDecisionMatch) {
        const [, proposalId, action] = proposalDecisionMatch;
        const body = await readJson(req);
        const proposal = capabilityProposals.decide(
          proposalId,
          body,
          action === "approve" ? "approved" : "denied",
        );
        const event = provenanceLog.append(createCapabilityProposalDecisionEvent({
          proposal,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        proposal.decision.provenance_id = event.id;
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          proposal,
          decision: proposal.decision,
          provenance_id: event.id,
          activation_performed: false,
          durable: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/harness-modules/adopt") {
        const body = await readJson(req);
        const moduleId = String(body.module_id ?? "");
        activeModules = adoptSelfApplyModule(moduleRegistry, activeModules, moduleId);
        const adoptedModule = findModule(moduleRegistry, moduleId);
        revokeDesktopDisclosureForDisabledCapabilities(
          desktopDisclosureRegistry,
          adoptedModule?.overlay?.disabled_capabilities ?? [],
        );
        const event = provenanceLog.append(createHarnessModuleEvent({
          eventType: "harness.module.adopted",
          moduleId,
          activeModules,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, { active_modules: activeModules });
        return;
      }

      if (req.method === "POST" && url.pathname === "/harness-modules/drop") {
        const body = await readJson(req);
        const moduleId = String(body.module_id ?? "");
        activeModules = dropModule(activeModules, moduleId);
        const event = provenanceLog.append(createHarnessModuleEvent({
          eventType: "harness.module.dropped",
          moduleId,
          activeModules,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, { active_modules: activeModules });
        return;
      }

      if (req.method === "GET" && url.pathname === "/session-memory") {
        requireCapability(effectiveHarness, "memory.session.read");
        writeJson(res, 200, {
          entries: sessionMemory.list(),
          durable: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/session-memory") {
        requireCapability(effectiveHarness, "memory.session.write");
        const body = await readJson(req);
        const entry = sessionMemory.add(normalizeMemoryEntry(body));
        const event = provenanceLog.append(createSessionMemoryEvent({
          eventType: "memory.session.written",
          role: entry.role,
          source: entry.source,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 201, { entry, durable: false, provenance_id: event.id });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/session-memory") {
        requireCapability(effectiveHarness, "memory.session.write");
        const removed = sessionMemory.clear();
        const event = provenanceLog.append(createSessionMemoryEvent({
          eventType: "memory.session.cleared",
          removed,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, { removed, durable: false, provenance_id: event.id });
        return;
      }

      if (req.method === "GET" && url.pathname === "/provenance") {
        requireCapability(effectiveHarness, "provenance.read");
        const filters = parseProvenanceFilters(url.searchParams);
        writeJson(res, 200, {
          entries: provenanceLog.query(filters),
          filters,
          durable: false,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/provenance/summary") {
        requireCapability(effectiveHarness, "provenance.read");
        writeJson(res, 200, {
          summary: provenanceLog.summary(),
          durable: false,
        });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/provenance") {
        requireCapability(effectiveHarness, "provenance.clear");
        const removed = provenanceLog.clear();
        writeJson(res, 200, { removed, durable: false });
        return;
      }

      if (req.method === "POST" && url.pathname === "/stewardship/cognitive-load") {
        requireCapability(effectiveHarness, "stewardship.cognitive_load.assess");
        const body = await readJson(req);
        const messages = normalizeMessages(body.messages);
        const assessment = assessCognitiveLoad(messages);
        const event = provenanceLog.append(createStewardshipAssessmentEvent({
          assessment,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          assessment,
          provenance_id: event.id,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/files/read") {
        requireCapability(effectiveHarness, "tool.files.read");
        const body = await readJson(req);
        const file = await readScopedTextFile({
          requestedPath: body.path,
          roots: effectiveHarness.filesystem?.read_roots ?? [],
          maxBytes: effectiveHarness.filesystem?.max_read_bytes,
        });
        const event = provenanceLog.append(createFileReadEvent({
          file,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          path: file.path,
          bytes: file.bytes,
          content: file.content,
          provenance_id: event.id,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/desktop/inspect/accessibility-tree") {
        requireCapability(effectiveHarness, "desktop.inspect.accessibility_tree");
        const body = await readJson(req);
        if (body?.traversal !== undefined) {
          const traversalRequest = validateDesktopTraversalRequest(body, {
            authorizeRootRef: (args) => desktopDisclosureRegistry.authorizeRootRef(args),
            capability: "desktop.inspect.accessibility_tree",
          });
          const inspection = await inspectDesktopBrokerEnvironment({ mode: "atspi" });
          const traversalResult = await runInternalDesktopTraversalRequest({
            body,
            traversalRequest,
            inspection,
            desktopDisclosureRegistry,
            provenanceLog,
            caller: req.headers["x-soma-caller"] ?? "",
          });
          logger.info?.("soma.provenance", traversalResult.provenance);
          writeJson(res, 200, {
            inspection: traversalResult.inspection,
            provenance_id: traversalResult.provenance?.id ?? null,
          });
          return;
        }
        const desktopRequest = validateDesktopInspectionRequest(body);
        const inspection = await inspectDesktopBrokerEnvironment({
          mode: desktopRequest.mode,
          maxApps: desktopRequest.max_apps,
          maxChildren: desktopRequest.max_children,
        });
        const event = provenanceLog.append(createDesktopInspectionEvent({
          inspection,
          request: desktopRequest,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        desktopDisclosureRegistry.recordFromAccessibilityTree({
          inspection,
          provenanceId: event.id,
          capability: "desktop.inspect.accessibility_tree",
        });
        writeJson(res, 200, {
          inspection,
          provenance_id: event.id,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/desktop/inspect/focus") {
        requireCapability(effectiveHarness, "desktop.inspect.focus");
        const body = await readJson(req);
        const focusRequest = validateFocusedDesktopInspectionRequest(body);
        const inspection = await inspectFocusedDesktopObject();
        const event = provenanceLog.append(createFocusedDesktopInspectionEvent({
          inspection,
          request: focusRequest,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        desktopDisclosureRegistry.recordFromFocusedInspection({
          inspection,
          provenanceId: event.id,
          capability: "desktop.inspect.focus",
        });
        writeJson(res, 200, {
          inspection,
          provenance_id: event.id,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/chat") {
        const body = await readJson(req);
        const messages = normalizeMessages(body.messages);
        const useSessionMemory = Boolean(body.use_session_memory);
        const writeSessionMemory = Boolean(body.write_session_memory);
        const assessLoad = Boolean(body.assess_cognitive_load);
        const assessEscalation = Boolean(body.assess_escalation);
        let cognitiveLoadAssessment = null;
        let escalationAssessment = null;
        if (assessLoad) {
          requireCapability(effectiveHarness, "stewardship.cognitive_load.assess");
          cognitiveLoadAssessment = assessCognitiveLoad(messages);
        }
        const runtimeProfile = resolveRuntimeProfile(runtimeProfiles, body.model_profile);
        const capability = capabilityForRuntimeProfile(runtimeProfile);
        const provenance = createProvenance({
          capability,
          modelProfile: runtimeProfile.id,
          route: runtimeProfile.route,
          caller: req.headers["x-soma-caller"] ?? "",
          memoryRead: useSessionMemory,
          memoryWritten: writeSessionMemory,
          cognitiveLoadAssessed: assessLoad,
          escalationAssessed: assessEscalation,
        });
        let memoryContext = "";

        try {
          if (useSessionMemory) {
            requireCapability(effectiveHarness, "memory.session.read");
            memoryContext = sessionMemory.asContext();
          }
          if (writeSessionMemory) {
            requireCapability(effectiveHarness, "memory.session.write");
          }
          requireCapability(effectiveHarness, capability);
        } catch (error) {
          const deniedProvenance = {
            ...provenance,
            event_type: "model.chat.denied",
            allowed: false,
            denial_reason: error.code ?? "request_denied",
          };
          provenanceLog.append(deniedProvenance);
          logger.info?.("soma.provenance", deniedProvenance);
          throw error;
        }

        const profileClient = modelClient.withProfile ? modelClient.withProfile(runtimeProfile) : modelClient;
        const modelMessages = memoryContext ? prependSessionMemory(messages, memoryContext) : messages;

        const completion = await profileClient.chat({
          messages: modelMessages,
          model: runtimeProfile.model,
          maxTokens: numberOrDefault(body.max_tokens, 512),
          temperature: numberOrDefault(body.temperature, 0.7),
        });

        if (writeSessionMemory) {
          const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
          if (lastUserMessage) {
            sessionMemory.add({
              role: "user",
              content: lastUserMessage.content,
              source: "chat",
            });
          }
          sessionMemory.add({
            role: "assistant",
            content: completion.text,
            source: "chat",
          });
        }

        if (assessEscalation) {
          escalationAssessment = assessEscalationTriggers({
            messages,
            completionText: completion.text,
            capabilityView: buildCapabilityView({
              catalog: capabilityCatalog,
              providerRegistry,
              harness: effectiveHarness,
            }),
          });
        }

        const allowedProvenance = {
          ...provenance,
          event_type: "model.chat.completed",
          allowed: true,
          escalation_triggers_fired: escalationAssessment?.triggers_fired ?? false,
          escalation_trigger_families: escalationAssessment?.trigger_families ?? [],
          remote_planning_status: escalationAssessment?.remote_planning_status ?? "",
        };
        provenanceLog.append(allowedProvenance);
        logger.info?.("soma.provenance", allowedProvenance);
        let escalationProvenanceId = null;
        if (escalationAssessment?.triggers_fired) {
          const escalationEvent = provenanceLog.append(createEscalationProposedEvent({
            assessment: escalationAssessment,
            caller: req.headers["x-soma-caller"] ?? "",
          }));
          escalationProvenanceId = escalationEvent.id;
          logger.info?.("soma.provenance", escalationEvent);
        }

        writeJson(res, 200, {
          text: completion.text,
          model: completion.model,
          model_profile: runtimeProfile.id,
          finish_reason: completion.finish_reason,
          tokens_used: completion.tokens_used,
          capability_used: capability,
          provenance_id: provenance.id,
          remote_service_used: Boolean(runtimeProfile.remote_service),
          memory_read: useSessionMemory,
          memory_written: writeSessionMemory,
          cognitive_load_assessment: cognitiveLoadAssessment,
          escalation_assessment: escalationAssessment
            ? {
                ...escalationAssessment,
                provenance_id: escalationProvenanceId,
              }
            : null,
        });
        return;
      }

      writeJson(res, 404, { error: "not_found", message: "Route not found." });
    } catch (error) {
      writeError(res, error);
    }
  };
}

function normalizeMemoryEntry(entry) {
  const role = String(entry?.role ?? "").trim();
  const content = String(entry?.content ?? "");
  const source = String(entry?.source ?? "manual").trim() || "manual";
  if (!["system", "user", "assistant", "note"].includes(role) || content.length === 0) {
    const error = new Error("Memory entry must include a valid role and non-empty content.");
    error.statusCode = 400;
    error.code = "invalid_memory_entry";
    throw error;
  }
  return { role, content, source };
}

function validateDesktopInspectionRequest(body) {
  const allowedKeys = new Set(["mode", "max_apps", "max_children"]);
  const errors = [];

  if (!isPlainObject(body)) {
    errors.push("request must be an object");
  } else {
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        errors.push(`request.${key} is not allowed`);
      }
    }

    if (body.mode !== undefined && !["environment", "atspi"].includes(body.mode)) {
      errors.push("request.mode must be environment or atspi");
    }
    validateOptionalIntegerLimit(body.max_apps, "request.max_apps", 1, 64, errors);
    validateOptionalIntegerLimit(body.max_children, "request.max_children", 0, 8, errors);
  }

  if (errors.length > 0) {
    const error = new Error(`Desktop inspection request is invalid: ${errors.join("; ")}`);
    error.statusCode = 400;
    error.code = "desktop_inspection_request_invalid";
    error.validation_errors = errors;
    throw error;
  }

  return {
    mode: body.mode === "atspi" ? "atspi" : "environment",
    max_apps: body.max_apps,
    max_children: body.max_children,
  };
}

function validateOptionalIntegerLimit(value, path, minimum, maximum, errors) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${path} must be an integer from ${minimum} to ${maximum}`);
  }
}

function validateFocusedDesktopInspectionRequest(body) {
  const allowedKeys = new Set(["include_text"]);
  const errors = [];

  if (!isPlainObject(body)) {
    errors.push("request must be an object");
  } else {
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        errors.push(`request.${key} is not allowed`);
      }
    }

    if (body.include_text === true) {
      const error = new Error("Focused desktop inspection does not include text content.");
      error.statusCode = 403;
      error.code = "focused_desktop_text_not_allowed";
      throw error;
    }
    if (body.include_text !== undefined && body.include_text !== false) {
      errors.push("request.include_text must be false when provided");
    }
  }

  if (errors.length > 0) {
    const error = new Error(`Focused desktop inspection request is invalid: ${errors.join("; ")}`);
    error.statusCode = 400;
    error.code = "focused_desktop_inspection_request_invalid";
    error.validation_errors = errors;
    throw error;
  }

  return {
    include_text: body.include_text === true,
  };
}

function parseProvenanceFilters(searchParams) {
  const allowedParam = searchParams.get("allowed");
  const filters = {
    allowed: null,
    capability: searchParams.get("capability") ?? "",
    eventType: searchParams.get("event_type") ?? "",
    limit: null,
  };

  if (allowedParam === "true") {
    filters.allowed = true;
  } else if (allowedParam === "false") {
    filters.allowed = false;
  }

  const limitParam = searchParams.get("limit");
  if (limitParam !== null) {
    const limit = Number(limitParam);
    if (Number.isInteger(limit) && limit > 0) {
      filters.limit = limit;
    }
  }

  return filters;
}

function createHarnessModuleEvent({ eventType, moduleId, activeModules, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: eventType,
    capability: "harness.module.configure",
    module_id: moduleId,
    active_modules: [...activeModules],
    caller_identity: caller,
    allowed: true,
    memory_written: false,
    remote_service_used: false,
  };
}

function createCapabilityProposalEvent({ proposal, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "capability.proposal.created",
    capability: "capability.proposal.create",
    caller_identity: caller,
    allowed: true,
    proposal_id: proposal.id,
    proposal_status: proposal.status,
    requested_by: proposal.requested_by,
    requested_capability: proposal.capability,
    requested_scope: proposal.requested_scope,
    proposal_reason: proposal.reason,
    proposal_risk: proposal.risk,
    proposal_fallback: proposal.fallback,
    data_exposed: proposal.data_exposed,
    excluded_data: proposal.excluded_data,
    review_context_type: proposal.review_context?.capability ? "sensorium_grant_review" : "",
    review_provider: proposal.review_context?.provider ?? "",
    review_topic: proposal.review_context?.topic ?? "",
    review_stream_type: proposal.review_context?.stream_type ?? "",
    review_risk_class: proposal.review_context?.risk_class ?? "",
    grant_intent_provider: proposal.grant_intent?.provider ?? "",
    grant_intent_scope: proposal.grant_intent?.scope ?? "",
    activation_performed: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createCapabilityProposalDecisionEvent({ proposal, caller }) {
  const approved = proposal.status === "approved";
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: approved ? "capability.proposal.approved" : "capability.proposal.denied",
    capability: "capability.proposal.decide",
    caller_identity: caller,
    allowed: true,
    proposal_id: proposal.id,
    proposal_status: proposal.status,
    requested_by: proposal.requested_by,
    requested_capability: proposal.capability,
    requested_scope: proposal.requested_scope,
    approved_scope: proposal.decision?.approved_scope ?? null,
    denial_reason: proposal.decision?.denial_reason ?? null,
    decided_by: proposal.decision?.decided_by ?? "",
    activation_performed: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createSensoriumGrantCreatedEvent({ grant, proposal, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "perception.sensorium.grant.created",
    capability: "perception.sensorium.grant.create",
    caller_identity: caller,
    allowed: true,
    proposal_id: proposal.id ?? "",
    grant_id: grant.id,
    requested_capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    topic: grant.constraints?.topic ?? "",
    max_seconds: grant.constraints?.max_seconds ?? null,
    max_fps: grant.constraints?.max_fps ?? null,
    format_required: grant.constraints?.format_required ?? "",
    downsample_to: grant.constraints?.downsample_to ?? [],
    activation_performed: false,
    grant_written: true,
    file_written: false,
    subscription_activated: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createSensoriumGrantRevokedEvent({
  grant,
  previousGrant,
  caller,
  stoppedSubscriptions = [],
  changed,
}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "perception.sensorium.grant.revoked",
    capability: "perception.sensorium.grant.revoke",
    caller_identity: caller,
    allowed: true,
    grant_id: grant.id,
    previous_status: previousGrant?.status ?? "",
    status: grant.status,
    requested_capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    topic: grant.constraints?.topic ?? "",
    revoked_by: grant.revoked_by,
    revocation_reason: grant.revocation_reason,
    changed: Boolean(changed),
    stopped_subscription_count: stoppedSubscriptions.length,
    stopped_subscription_ids: stoppedSubscriptions.map((entry) => entry.subscription_id),
    activation_performed: false,
    grant_written: true,
    file_written: false,
    subscription_activated: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createStewardshipAssessmentEvent({ assessment, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "stewardship.cognitive_load.assessed",
    capability: "stewardship.cognitive_load.assess",
    caller_identity: caller,
    allowed: true,
    cognitive_load_assessed: true,
    cognitive_load_advisory_needed: assessment.advisory_needed,
    cognitive_load_confidence: assessment.confidence,
    memory_written: false,
    remote_service_used: false,
  };
}

function createEscalationProposedEvent({ assessment, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "model.local.escalation_proposed",
    capability: "model.local.chat",
    caller_identity: caller,
    allowed: true,
    escalation_triggers_fired: assessment.triggers_fired,
    escalation_trigger_families: assessment.trigger_families,
    remote_planning_capability: assessment.remote_planning_capability,
    remote_planning_status: assessment.remote_planning_status,
    remote_planning_available: assessment.remote_planning_available,
    memory_written: false,
    remote_service_used: false,
  };
}

function createSessionMemoryEvent({ eventType, role = "", source = "", removed = null, caller }) {
  const event = {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: eventType,
    capability: "memory.session.write",
    caller_identity: caller,
    allowed: true,
    memory_written: eventType === "memory.session.written",
    remote_service_used: false,
  };

  if (role) {
    event.memory_role = role;
  }
  if (source) {
    event.memory_source = source;
  }
  if (removed !== null) {
    event.memory_entries_removed = removed;
  }

  return event;
}

function createFileReadEvent({ file, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "tool.files.read",
    capability: "tool.files.read",
    caller_identity: caller,
    allowed: true,
    file_path: file.path,
    file_root: file.root,
    file_bytes: file.bytes,
    memory_written: false,
    remote_service_used: false,
  };
}

function createDesktopInspectionEvent({ inspection, request = {}, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.inspect.accessibility_tree",
    capability: "desktop.inspect.accessibility_tree",
    caller_identity: caller,
    allowed: true,
    desktop_session: inspection.desktop_session,
    session_type: inspection.session_type,
    broker_source: inspection.broker_source,
    inspection_mode: inspection.mode,
    requested_mode: normalizeDesktopInspectionRequestedMode(request.mode),
    requested_max_apps: nullableFiniteNumber(request.max_apps),
    requested_max_children: nullableFiniteNumber(request.max_children),
    dbus_session_bus_available: inspection.dbus_session_bus_available,
    atspi_likely_available: inspection.atspi_likely_available,
    application_count: inspection.application_count ?? null,
    root_object_available_count: inspection.root_object_available_count ?? null,
    window_count: inspection.window_count ?? null,
    tree_available: inspection.tree_available,
    memory_written: false,
    remote_service_used: false,
  };
}

function createFocusedDesktopInspectionEvent({ inspection, request = {}, caller }) {
  const focusedObject = inspection.focused_object ?? {};
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.inspect.focus",
    capability: "desktop.inspect.focus",
    caller_identity: caller,
    allowed: true,
    desktop_session: inspection.desktop_session,
    session_type: inspection.session_type,
    broker_source: inspection.broker_source,
    inspection_mode: inspection.mode,
    requested_include_text: request.include_text === true,
    focus_available: inspection.focus_available,
    focused_role: focusedObject.role ?? "",
    focused_child_count: focusedObject.child_count ?? null,
    text_content_included: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function revokeDesktopDisclosureForDisabledCapabilities(desktopDisclosureRegistry, disabledCapabilities) {
  for (const capability of disabledCapabilities) {
    if (typeof capability === "string" && capability.startsWith("desktop.inspect.")) {
      desktopDisclosureRegistry.revokeByCapability(capability);
    }
  }
}

function normalizeDesktopInspectionRequestedMode(mode) {
  return mode === "atspi" ? "atspi" : "environment";
}

function nullableFiniteNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cryptoRandomId() {
  return randomUUID();
}

// Sensorium provenance event wrapper. The summary objects from
// sensoriumSubscriptionProvenance.js are intentionally caller-shape-agnostic
// (no id, no caller_identity) — they describe the subscription
// lifecycle event itself. The provenance LOG entry adds an id and
// caller identity around that summary so the audit trail is uniform
// with other Soma provenance events.
function createSensoriumProvenanceEvent({ summary, caller }) {
  return {
    id: randomUUID(),
    caller_identity: typeof caller === "string" ? caller : "",
    ...copySensoriumSubscriptionSummary(summary),
  };
}

function copySensoriumSubscriptionSummary(summary = {}) {
  const allowedByEvent = {
    "perception.sensorium.subscription_started": [
      "event_type",
      "timestamp",
      "capability",
      "provider",
      "grant_id",
      "scope",
      "topic",
      "constraints_declared",
      "text_content_included",
      "frames_recorded",
    ],
    "perception.sensorium.subscription_ended": [
      "event_type",
      "timestamp",
      "capability",
      "provider",
      "grant_id",
      "scope",
      "topic",
      "started_at",
      "ended_at",
      "duration_seconds",
      "termination_reason",
      "frames_consumed",
      "schema_version_observed",
      "schema_mismatches",
      "first_frame_number",
      "last_frame_number",
      "error_class",
      "status_summary_observed",
      "stream_summary_observed",
      "text_content_included",
      "frames_recorded",
    ],
  };
  const allowed = allowedByEvent[summary?.event_type] ?? [];
  const out = {};
  for (const key of allowed) {
    if (summary[key] !== undefined) {
      out[key] = summary[key];
    }
  }
  return out;
}

function findProvider(providerRegistry = {}, providerId = "") {
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  return providers.find((provider) => provider.id === providerId) ?? null;
}

function providerSupportsCapability(provider = {}, capability = "") {
  const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
  return capabilities.some((entry) => {
    if (typeof entry === "string") {
      return entry === capability;
    }
    return entry?.key === capability;
  });
}

function providerHostMatchesTopic(provider = {}, topic = "") {
  if (!provider.host_segment) {
    return true;
  }
  return topic.startsWith(`sensor/${provider.host_segment}/`);
}

function grantTopicMatchesTopic(grant = {}, topic = "") {
  const grantTopic = typeof grant.constraints?.topic === "string" ? grant.constraints.topic : "";
  return !grantTopic || grantTopic === topic;
}

function isSensoriumSubscribeCapability(capability = "") {
  return capability.startsWith("perception.sensorium.") && capability.endsWith(".subscribe");
}

function prependSessionMemory(messages, memoryContext) {
  return [
    {
      role: "system",
      content: `Ephemeral session memory for this process only. It is not durable memory.\n${memoryContext}`,
    },
    ...messages,
  ];
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    const error = new Error("messages must be a non-empty array.");
    error.statusCode = 400;
    error.code = "invalid_messages";
    throw error;
  }

  return messages.map((message) => {
    const role = String(message?.role ?? "").trim();
    const content = String(message?.content ?? "");
    if (!["system", "user", "assistant", "tool"].includes(role) || content.length === 0) {
      const error = new Error("Each message must include a valid role and non-empty content.");
      error.statusCode = 400;
      error.code = "invalid_messages";
      throw error;
    }
    return { role, content };
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
