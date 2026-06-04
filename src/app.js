import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { buildCapabilityView } from "./capabilityCatalog.js";
import { assessCognitiveLoad } from "./cognitiveLoad.js";
import { CapabilityProposalStore, summarizeNotifications } from "./capabilityProposals.js";
import {
  inspectDesktopBrokerEnvironment,
  inspectDesktopWindows,
  inspectFocusedDesktopObject,
} from "./desktopBroker.js";
import {
  createDesktopNotificationAdapter,
  createDesktopNotificationProvenanceEvent,
} from "./desktopNotificationAdapter.js";
import { DesktopDisclosureRegistry } from "./desktopDisclosureRegistry.js";
import {
  listDurableMemoryEntries,
  loadDurableMemoryStore,
  summarizeDurableMemoryStore,
} from "./durableMemory.js";
import { createDurableMemoryProvenanceFile } from "./durableMemoryProvenanceFile.js";
import { inspectDurableMemoryRecovery } from "./durableMemoryRecovery.js";
import {
  writeDurableMemoryAddMutation,
  writeDurableMemoryRemoveMutation,
} from "./durableMemoryStoreWriter.js";
import { runInternalDesktopTraversalRequest } from "./desktopTraversalPipeline.js";
import { validateDesktopTraversalRequest } from "./desktopTraversalRequest.js";
import { assessEscalationTriggers } from "./escalationTriggers.js";
import { readScopedTextFile } from "./fileAccess.js";
import { authorizeGrantUse } from "./grantAuthorization.js";
import { createGrantMutationProvenanceFile } from "./grantMutationProvenanceFile.js";
import { inspectGrantMutationRecovery } from "./grantMutationRecovery.js";
import { previewGrantMutation } from "./grantMutationPreview.js";
import { grantMutationPreviewReviewText } from "./grantMutationPreviewReviewSurface.js";
import {
  createGrant,
  listGrants,
  loadGrantStore,
  revokeGrant,
  summarizeGrants,
} from "./grants.js";
import {
  writeGrantCreateMutation,
  writeGrantRevokeMutation,
} from "./grantMutationStoreWriters.js";
import {
  createGrantStoreFileIo,
  createGrantStoreLock,
} from "./grantStoreFileAdapters.js";
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
import { resolveRuntimeWritePosture } from "./runtimeWritePosture.js";
import {
  buildRemoteGraphicalGrantCreateCandidateFromProposal,
} from "./remoteGraphicalGrantCreateCandidate.js";
import {
  createRemoteGraphicalBrokerStatus,
  RemoteGraphicalBroker,
} from "./remoteGraphicalBroker.js";
import { buildRemoteGraphicalProposalTemplate } from "./remoteGraphicalProposalTemplate.js";
import {
  buildRemoteGraphicalSessionOpenBrokerFailure,
  buildRemoteGraphicalSessionOpenFixtureSuccess,
  buildRemoteGraphicalSessionOpenRefusal,
  buildRemoteGraphicalSessionOpenReview,
} from "./remoteGraphicalSessionOpenReview.js";
import {
  decideRemoteGraphicalSessionOpenRouteInvocation,
} from "./remoteGraphicalSessionOpenRouteGate.js";
import {
  createRemoteGraphicalSessionOpenFixtureProvenanceSummary,
} from "./remoteGraphicalSessionOpenProvenance.js";
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
  grantRecoveryReport,
  grantStorePath,
  grantMutationProvenancePath,
  durableMemoryStore,
  durableMemoryRecoveryReport,
  durableMemoryStorePath,
  durableMemoryProvenancePath,
  runtimeWritePosture,
  provenanceLog,
  desktopDisclosureRegistry,
  desktopNotificationAdapter,
  sensoriumSubscriber,
  remoteGraphicalBroker,
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
    grantRecoveryReport,
    grantStorePath,
    grantMutationProvenancePath,
    durableMemoryStore,
    durableMemoryRecoveryReport,
    durableMemoryStorePath,
    durableMemoryProvenancePath,
    runtimeWritePosture,
    provenanceLog,
    desktopDisclosureRegistry,
    desktopNotificationAdapter,
    sensoriumSubscriber,
    remoteGraphicalBroker,
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
  grantRecoveryReport = null,
  grantStorePath = "",
  grantMutationProvenancePath = "",
  grantStoreIo = createGrantStoreFileIo(),
  grantStoreLock = createGrantStoreLock(),
  grantMutationProvenance = null,
  durableMemoryStore = { schema_version: 1, entries: [] },
  durableMemoryRecoveryReport = null,
  durableMemoryStorePath = "",
  durableMemoryProvenancePath = "",
  durableMemoryStoreIo = createGrantStoreFileIo(),
  durableMemoryStoreLock = createGrantStoreLock(),
  durableMemoryProvenance = null,
  runtimeWritePosture = resolveRuntimeWritePosture(),
  provenanceLog = new ProvenanceLog(),
  desktopDisclosureRegistry = new DesktopDisclosureRegistry(),
  desktopNotificationAdapter = createDesktopNotificationAdapter(),
  sensoriumSubscriber = null,
  remoteGraphicalBroker = new RemoteGraphicalBroker(),
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
  const durableGrantProvenance = grantMutationProvenance
    ?? (grantMutationProvenancePath
      ? createGrantMutationProvenanceFile({ path: grantMutationProvenancePath })
      : null);
  const durableMemoryMutationProvenance = durableMemoryProvenance
    ?? (durableMemoryProvenancePath
      ? createDurableMemoryProvenanceFile({ path: durableMemoryProvenancePath })
      : null);
  sessionMemory.loadDurable?.(listDurableMemoryEntries(durableMemoryStore));
  const writePosture = normalizeRuntimeWritePosture(runtimeWritePosture);
  const decisionWaiters = new Map();
  const episodes = new Map();
  const forums = new Map();
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
      const forceProfile = resolveForceRuntimeProfile(runtimeProfiles);

      if (req.method === "GET" && url.pathname === "/health") {
        const grantRecovery = summarizeGrantRecoveryInspection(
          resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          { grantStore, runtimeWritePosture: writePosture },
        );
        writeJson(res, 200, {
          status: "ok",
          grant_store_status: grantRecovery.grant_store_status,
          grant_store_degraded_reason: grantRecovery.grant_store_degraded_reason,
          grant_recovery_degraded: grantRecovery.degraded,
          grant_recovery_finding_count: grantRecovery.finding_count,
          runtime_writes_enabled: writePosture.runtime_writes_enabled,
          runtime_write_posture: writePosture,
          force_profile: forceProfileDisclosure(forceProfile),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/harness") {
        writeJson(res, 200, {
          ...effectiveHarness,
          disclosure: {
            ...(effectiveHarness.disclosure ?? {}),
            remote_services_used: Boolean(effectiveHarness.disclosure?.remote_services_used)
              || forceProfile.profile?.route === "remote",
          },
          force_profile: forceProfileDisclosure(forceProfile),
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

      const episodeTraceMatch = matchEpisodeReadPath(url.pathname, "trace");
      if (req.method === "GET" && episodeTraceMatch) {
        requireCapability(effectiveHarness, "provenance.read");
        const episode = episodes.get(episodeTraceMatch.episode_id) ?? null;
        const entries = provenanceLog.query({
          episodeId: episodeTraceMatch.episode_id,
        });
        writeJson(res, 200, {
          episode: serializeEpisodeState(episode, episodeTraceMatch.episode_id),
          entries: chronologicalEntries(entries),
          summary: provenanceLog.summary({ episodeId: episodeTraceMatch.episode_id }),
          durable: false,
        });
        return;
      }

      const episodeEthogramMatch = matchEpisodeReadPath(url.pathname, "ethogram");
      if (req.method === "GET" && episodeEthogramMatch) {
        requireCapability(effectiveHarness, "provenance.read");
        const episode = episodes.get(episodeEthogramMatch.episode_id) ?? null;
        const entries = provenanceLog.query({
          episodeId: episodeEthogramMatch.episode_id,
        });
        writeJson(res, 200, {
          episode: serializeEpisodeState(episode, episodeEthogramMatch.episode_id),
          summary: provenanceLog.summary({ episodeId: episodeEthogramMatch.episode_id }),
          dispositions: summarizeEpisodeDispositions(entries),
          refusals: summarizeEpisodeRefusals(entries),
          durable: false,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/episodes") {
        requireCapability(effectiveHarness, "provenance.read");
        const episodesList = listEpisodeStates(episodes);
        writeJson(res, 200, {
          episodes: episodesList,
          summary: summarizeEpisodes(episodesList),
          durable: false,
        });
        return;
      }

      const episodeForumMatch = matchEpisodeReadPath(url.pathname, "forum");
      if (req.method === "GET" && episodeForumMatch) {
        requireCapability(effectiveHarness, "provenance.read");
        const forum = forums.get(episodeForumMatch.episode_id) ?? null;
        writeJson(res, 200, {
          forum: serializeForum(forum, episodeForumMatch.episode_id),
          durable: false,
        });
        return;
      }

      if (req.method === "POST" && episodeForumMatch) {
        const body = await readJson(req);
        const actor = String(body?.actor ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "episode_forum_open_requires_user_actor",
            message: "Opening an episode forum requires actor=user.",
          });
          return;
        }
        const episode = ensureEpisodeState(episodes, episodeForumMatch.episode_id);
        const forum = ensureEpisodeForum(forums, episode.id, body);
        applyForumToEpisodePosture(episode, forum);
        const event = provenanceLog.append(createForumOpenedEvent({
          forum,
          actor,
          caller: req.headers["x-soma-caller"] ?? actor,
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          forum: serializeForum(forum, episode.id),
          episode: serializeEpisodeState(episode),
          inactive_relaxations: inactiveNamedRelaxations(episode.posture),
          active_relaxations: activeNamedRelaxations(episode.posture),
          provenance_id: event.id,
          activation_performed: false,
          grant_written: false,
          memory_written: false,
          durable: false,
        });
        return;
      }

      const episodeForumPostsMatch = matchEpisodeTwoPartPath(url.pathname, "forum", "posts");
      if (req.method === "POST" && episodeForumPostsMatch) {
        const body = await readJson(req);
        const actor = String(body?.actor ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "episode_forum_post_requires_user_actor",
            message: "Steward forum posts require actor=user.",
          });
          return;
        }
        const forum = forums.get(episodeForumPostsMatch.episode_id);
        if (!forum) {
          writeError(res, {
            statusCode: 404,
            code: "episode_forum_not_open",
            message: "Open the episode forum before posting.",
          });
          return;
        }
        const post = appendForumPost(forum, {
          author: "steward",
          authorId: body?.steward_id ?? body?.author_id ?? "steward",
          type: body?.type,
          content: body?.content,
        });
        const event = provenanceLog.append(createForumPostEvent({
          forum,
          post,
          caller: req.headers["x-soma-caller"] ?? actor,
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          post,
          forum_id: forum.forum_id,
          provenance_id: event.id,
          activation_performed: false,
          grant_written: false,
          memory_written: false,
          durable: false,
        });
        return;
      }

      const episodePostureMatch = matchEpisodeReadPath(url.pathname, "posture");
      if (req.method === "POST" && episodePostureMatch) {
        const body = await readJson(req);
        const actor = String(body?.actor ?? body?.set_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "episode_posture_requires_user_actor",
            message: "Episode posture can only be set by actor=user.",
          });
          return;
        }
        const episode = ensureEpisodeState(episodes, episodePostureMatch.episode_id);
        const result = applyEpisodePostureDeclaration(episode, body);
        const event = provenanceLog.append(createEpisodePostureEvent({
          episode,
          result,
          actor,
          caller: req.headers["x-soma-caller"] ?? actor,
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          episode: serializeEpisodeState(episode),
          posture: episode.posture,
          requested_mode: result.requested_mode,
          effective_mode: episode.posture.mode,
          fail_closed: result.fail_closed,
          rejected_relaxations: result.rejected_relaxations,
          inactive_relaxations: inactiveNamedRelaxations(episode.posture),
          briefing_required: analysisTestingBriefingRequired(episode.posture),
          briefing_carried: false,
          provenance_id: event.id,
          activation_performed: false,
          grant_written: false,
          memory_written: false,
          durable: false,
        });
        return;
      }

      const crewAbortMatch = matchEpisodeAbortPath(url.pathname);
      if (req.method === "POST" && crewAbortMatch) {
        const body = await readJson(req);
        const abortType = String(body?.type ?? "").trim();
        const actor = String(body?.actor ?? body?.aborted_by ?? "").trim();
        if (!["crew_aborted_for_care", "crew_aborted_for_safety"].includes(abortType)) {
          writeError(res, {
            statusCode: 400,
            code: "episode_abort_type_invalid",
            message: "Episode abort type must be crew_aborted_for_care or crew_aborted_for_safety.",
          });
          return;
        }
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "episode_abort_requires_user_actor",
            message: "Crew-side episode abort requires actor=user.",
          });
          return;
        }
        const episode = ensureEpisodeState(episodes, crewAbortMatch.episode_id);
        episode.status = "ejected";
        episode.updated_at = new Date().toISOString();
        const event = provenanceLog.append(createOccupantProtectionEvent({
          eventType: abortType,
          episodeId: episode.id,
          controlType: abortType,
          episodeStatus: episode.status,
          caller: req.headers["x-soma-caller"] ?? actor,
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          episode_id: episode.id,
          episode_status: episode.status,
          event_type: event.event_type,
          provenance_id: event.id,
          protective_control: {
            source: "crew",
            control: abortType,
            honored: true,
          },
          activation_performed: false,
          grant_written: false,
          durable: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/status/snapshot") {
        const body = await readJson(req);
        const grantId = String(body?.grant_id ?? "").trim();
        const provider = String(
          body?.provider ?? providerForCapability(providerRegistry, "status.snapshot.read") ?? "",
        ).trim();
        const scope = String(body?.scope ?? "session").trim() || "session";
        if (!grantId) {
          writeError(res, {
            statusCode: 403,
            code: "status_snapshot_grant_required",
            message: "Status snapshot requires an active runtime grant id.",
          });
          return;
        }
        const authorization = authorizeGrantUse({
          store: grantStore,
          grantId,
          capability: "status.snapshot.read",
          provider,
          scope,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          catalog: capabilityCatalog,
          providerRegistry,
        });
        if (!authorization.allowed) {
          writeJson(res, 403, {
            error: "status_snapshot_grant_not_authorized",
            message: "Status snapshot requires an active, matching runtime grant.",
            authorization_code: authorization.code,
            recovery_required: authorization.recovery_required,
            findings: authorization.findings,
          });
          return;
        }
        const snapshot = buildStatusSnapshot({
          activeModules,
          capabilityCatalog,
          capabilityProposals,
          effectiveHarness,
          grantStore,
          provenanceLog,
          providerRegistry,
          writePosture,
        });
        const event = provenanceLog.append(createStatusSnapshotReadEvent({
          grant: authorization.grant,
          snapshot,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          snapshot,
          provenance_id: event.id,
          grant_id: authorization.grant.id,
          provider: authorization.grant.provider,
          scope: authorization.grant.scope,
          activation_performed: false,
          grant_written: false,
          durable: false,
        });
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
        const authorization = authorizeGrantUse({
          store: grantStore,
          grantId: body?.grant_id,
          capability: body?.capability,
          scope: "once",
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
        });
        if (authorization.code === "grant_recovery_degraded") {
          writeJson(res, 403, {
            error: "model_visual_attach_grant_recovery_required",
            message: `Grant ${authorization.details.grant_id} requires recovery inspection before it can authorize model visual attachment.`,
            findings: authorization.findings,
          });
          return;
        }
        if (authorization.code === "grant_store_schema_unsupported") {
          writeError(res, {
            statusCode: 403,
            code: "model_visual_attach_grant_store_schema_unsupported",
            message: "Model visual attachment requires a supported grant-store schema.",
          });
          return;
        }
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

      if (req.method === "GET" && url.pathname === "/capability-proposal-decisions") {
        const decisions = capabilityProposals.listDecisions({
          requested_by: url.searchParams.get("requested_by") ?? "",
          delivered: parseDeliveredFilter(url.searchParams),
        });
        writeJson(res, 200, {
          decisions,
          summary: summarizeDecisionDeliveries(decisions),
          activation_performed: false,
          grant_written: false,
          durable: false,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/capability-proposal-decisions/wait") {
        const requestedBy = String(url.searchParams.get("requested_by") ?? "").trim();
        if (!requestedBy) {
          writeError(res, {
            statusCode: 400,
            code: "capability_decision_wait_requires_requested_by",
            message: "Decision wait requires requested_by.",
          });
          return;
        }
        const timeoutMs = boundedWaitTimeoutMs(url.searchParams.get("timeout_ms"));
        const limit = boundedDecisionLimit(url.searchParams.get("limit"));
        const pendingDecisions = await waitForCapabilityDecisions({
          store: capabilityProposals,
          waiters: decisionWaiters,
          requestedBy,
          timeoutMs,
          limit,
        });
        const decisions = pendingDecisions.length > 0
          ? capabilityProposals.consumeDecisions({
              requested_by: requestedBy,
              acknowledged_by: requestedBy,
              delivery_channel: "longpoll",
              limit,
              proposal_ids: pendingDecisions.map((entry) => entry.proposal_id),
            })
          : [];
        const event = provenanceLog.append(createCapabilityDecisionDeliveryEvent({
          decisions,
          requestedBy,
          deliveryChannel: "longpoll",
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          decisions,
          delivered_count: decisions.length,
          timeout: decisions.length === 0,
          wait_timeout_ms: timeoutMs,
          delivery_channel: "longpoll",
          provenance_id: event.id,
          activation_performed: false,
          grant_written: false,
          durable: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/capability-proposal-decisions/consume") {
        const body = await readJson(req);
        const decisions = capabilityProposals.consumeDecisions({
          requested_by: body?.requested_by,
          acknowledged_by: body?.acknowledged_by,
          delivery_channel: body?.delivery_channel ?? "api",
          limit: body?.limit,
        });
        const event = provenanceLog.append(createCapabilityDecisionDeliveryEvent({
          decisions,
          requestedBy: body?.requested_by,
          deliveryChannel: body?.delivery_channel ?? "api",
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          decisions,
          delivered_count: decisions.length,
          provenance_id: event.id,
          activation_performed: false,
          grant_written: false,
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

      if (req.method === "POST" && url.pathname === "/remote-graphical/proposal-template") {
        const body = await readJson(req);
        const template = buildRemoteGraphicalProposalTemplate({
          catalog: capabilityCatalog,
          providerRegistry,
          requested_by: body?.requested_by,
          capability: body?.capability,
          provider: body?.provider,
          target_host: body?.target_host,
          mode: body?.mode,
          constraints: body?.constraints ?? {},
          requested_channels: body?.requested_channels ?? [],
          requested_scope: body?.requested_scope ?? "session",
          reason: body?.reason,
          fallback: body?.fallback,
          locality: body?.locality,
          attended: body?.attended,
        });
        writeJson(res, 200, {
          ...template,
          review_only: true,
          grant_written: false,
          session_opened: false,
          pairing_performed: false,
          video_attached: false,
          input_dispatched: false,
          recording_started: false,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/remote-graphical/status") {
        const rawStatus = typeof remoteGraphicalBroker?.describeActive === "function"
          ? remoteGraphicalBroker.describeActive()
          : remoteGraphicalBroker?.status?.();
        writeJson(res, 200, createRemoteGraphicalBrokerStatus(rawStatus));
        return;
      }

      if (req.method === "POST" && url.pathname === "/remote-graphical/session-open-review") {
        const body = await readJson(req);
        const grantId = String(body?.grant_id ?? "").trim();
        if (!grantId) {
          writeError(res, {
            statusCode: 400,
            code: "remote_graphical_session_open_review_requires_grant_id",
            message: "Remote graphical session-open review requires grant_id.",
          });
          return;
        }
        const grant = (grantStore.grants ?? []).find((entry) => entry.id === grantId);
        const review = buildRemoteGraphicalSessionOpenReview({
          grant,
          reason: body?.reason,
          requested_by: body?.requested_by,
        });
        writeJson(res, 200, review);
        return;
      }

      if (req.method === "POST" && url.pathname === "/remote-graphical/sessions") {
        const body = await readJson(req);
        const grantId = String(body?.grant_id ?? "").trim();
        if (!grantId) {
          writeError(res, {
            statusCode: 400,
            code: "remote_graphical_session_open_requires_grant_id",
            message: "Remote graphical session-open requires grant_id.",
          });
          return;
        }
        const grant = (grantStore.grants ?? []).find((entry) => entry.id === grantId);
        const actor = String(body?.actor ?? body?.approved_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "remote_graphical_session_open_requires_user_actor",
            message: "Remote graphical session-open requires an explicit user actor.",
          });
          return;
        }
        const review = buildRemoteGraphicalSessionOpenReview({
          grant,
          reason: body?.reason,
          requested_by: body?.requested_by,
        });
        const rawStatus = typeof remoteGraphicalBroker?.describeActive === "function"
          ? remoteGraphicalBroker.describeActive()
          : remoteGraphicalBroker?.status?.();
        const brokerStatus = createRemoteGraphicalBrokerStatus(rawStatus);
        const routeDecision = decideRemoteGraphicalSessionOpenRouteInvocation({
          broker: remoteGraphicalBroker,
          brokerStatus,
        });
        if (routeDecision.invoke_fixture) {
          try {
            const brokerResult = await remoteGraphicalBroker.openSession({
              grant,
              review,
              requested_by: body?.requested_by,
              actor,
            });
            const result = buildRemoteGraphicalSessionOpenFixtureSuccess({
              review,
              brokerResult,
            });
            writeJson(res, 200, appendRemoteGraphicalSessionOpenProvenancePreview({
              result,
              provenanceLog,
            }));
          } catch (cause) {
            const result = buildRemoteGraphicalSessionOpenBrokerFailure({
              review,
              cause,
            });
            writeJson(res, 200, appendRemoteGraphicalSessionOpenProvenancePreview({
              result,
              provenanceLog,
            }));
          }
          return;
        }
        const refusal = buildRemoteGraphicalSessionOpenRefusal({
          grant,
          reason: body?.reason,
          actor,
          requested_by: body?.requested_by,
          brokerStatus,
        });
        writeJson(res, 200, refusal);
        return;
      }

      if (req.method === "POST" && url.pathname === "/remote-graphical/proposals") {
        const body = await readJson(req);
        const template = buildRemoteGraphicalProposalTemplate({
          catalog: capabilityCatalog,
          providerRegistry,
          requested_by: body?.requested_by,
          capability: body?.capability,
          provider: body?.provider,
          target_host: body?.target_host,
          mode: body?.mode,
          constraints: body?.constraints ?? {},
          requested_channels: body?.requested_channels ?? [],
          requested_scope: body?.requested_scope ?? "session",
          reason: body?.reason,
          fallback: body?.fallback,
          locality: body?.locality,
          attended: body?.attended,
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
          session_opened: false,
          pairing_performed: false,
          video_attached: false,
          input_dispatched: false,
          recording_started: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/remote-graphical/grant-candidates") {
        const body = await readJson(req);
        const proposalId = String(body?.proposal_id ?? "").trim();
        if (!proposalId) {
          writeError(res, {
            statusCode: 400,
            code: "remote_graphical_grant_candidate_request_invalid",
            message: "Remote graphical grant candidate review requires proposal_id.",
          });
          return;
        }
        const proposal = capabilityProposals.find(proposalId);
        const candidate = buildRemoteGraphicalGrantCreateCandidateFromProposal(proposal, {
          catalog: capabilityCatalog,
          providerRegistry,
        });
        writeJson(res, 200, {
          ...candidate,
          review_only: true,
          durable: false,
          grant_written: false,
          session_opened: false,
          pairing_performed: false,
          video_attached: false,
          input_dispatched: false,
          recording_started: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/remote-graphical/grants") {
        const body = await readJson(req);
        const actor = String(body?.actor ?? body?.approved_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "remote_graphical_grant_create_requires_user_actor",
            message: "Remote graphical grant creation requires an explicit user actor.",
          });
          return;
        }

        const proposal = capabilityProposals.find(String(body?.proposal_id ?? ""));
        const candidate = buildRemoteGraphicalGrantCreateCandidateFromProposal(proposal, {
          catalog: capabilityCatalog,
          providerRegistry,
          now: () => new Date().toISOString(),
          createId: () => `grant-remote-graphical-${cryptoRandomId()}`,
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
        const event = provenanceLog.append(createRemoteGraphicalGrantCreatedEvent({
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
          session_opened: false,
          pairing_performed: false,
          video_attached: false,
          input_dispatched: false,
          recording_started: false,
        });
        return;
      }

      const remoteGraphicalGrantRevokeMatch = url.pathname.match(/^\/remote-graphical\/grants\/([^/]+)\/revoke$/);
      if (req.method === "POST" && remoteGraphicalGrantRevokeMatch) {
        const body = await readJson(req);
        const grantId = remoteGraphicalGrantRevokeMatch[1];
        const actor = String(body?.actor ?? body?.revoked_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "remote_graphical_grant_revoke_requires_user_actor",
            message: "Remote graphical grant revocation requires an explicit user actor.",
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

        if (!isRemoteGraphicalCapability(grantBeforeRevocation.capability)) {
          writeError(res, {
            statusCode: 400,
            code: "remote_graphical_grant_revoke_requires_remote_graphical_grant",
            message: "Remote graphical grant revocation requires a remote graphical grant.",
          });
          return;
        }

        const reason = String(body?.reason ?? body?.revocation_reason ?? "").trim();
        if (!reason) {
          writeError(res, {
            statusCode: 400,
            code: "missing_revocation_reason",
            message: "Remote graphical grant revocation requires a reason.",
          });
          return;
        }

        const nextGrantStore = revokeGrant(grantStore, {
          id: grantId,
          actor,
          reason,
        });
        grantStore = nextGrantStore;
        const grant = nextGrantStore.mutation.grant;
        const event = provenanceLog.append(createRemoteGraphicalGrantRevokedEvent({
          grant,
          previousGrant: grantBeforeRevocation,
          caller: req.headers["x-soma-caller"] ?? "",
          changed: nextGrantStore.mutation.changed,
        }));
        logger.info?.("soma.provenance", event);

        writeJson(res, 200, {
          grant,
          changed: nextGrantStore.mutation.changed,
          provenance_id: event.id,
          activation_performed: false,
          durable: false,
          file_written: false,
          grant_written: true,
          session_opened: false,
          pairing_performed: false,
          video_attached: false,
          input_dispatched: false,
          recording_started: false,
          provider_session_stopped: false,
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

          const authorization = authorizeGrantUse({
            store: grantStore,
            capability,
            scope,
            recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          });
          if (!authorization.allowed) {
            if (authorization.code === "grant_recovery_degraded") {
              writeJson(res, 403, {
                error: "sensorium_subscription_grant_recovery_required",
                message: `Grant ${authorization.details.grant_id} requires recovery inspection before it can authorize ${capability}.`,
                findings: authorization.findings,
              });
              return;
            }
            if (authorization.code === "grant_store_schema_unsupported") {
              writeError(res, {
                statusCode: 403,
                code: "sensorium_subscription_grant_store_schema_unsupported",
                message: "Sensorium subscription requires a supported grant-store schema.",
              });
              return;
            }
            writeError(res, {
              statusCode: 403,
              code: "sensorium_subscription_no_grant",
              message: `No active grant authorizes ${capability}. Approval is not activation; an explicit grant is required.`,
            });
            return;
          }
          const grant = authorization.grant;

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
        const grantRecovery = summarizeGrantRecoveryInspection(
          resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          { grantStore, runtimeWritePosture: writePosture },
        );
        writeJson(res, 200, {
          grants: listGrants(grantStore, {
            status: url.searchParams.get("status") ?? "",
          }),
          summary: summarizeGrants(grantStore),
          schema_version: grantStore.schema_version ?? 1,
          examples_available: Array.isArray(grantStore.examples) && grantStore.examples.length > 0,
          file_backed: true,
          writable: Boolean(writePosture.durable_grant_mutation_enabled),
          grant_store_status: grantRecovery.grant_store_status,
          grant_store_degraded_reason: grantRecovery.grant_store_degraded_reason,
          recovery: grantRecovery,
          runtime_writes_enabled: writePosture.runtime_writes_enabled,
          runtime_write_posture: writePosture,
          activation_performed: false,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/grants/recovery") {
        writeJson(res, 200, summarizeGrantRecoveryInspection(
          resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          { grantStore, runtimeWritePosture: writePosture },
        ));
        return;
      }

      if (req.method === "POST" && url.pathname === "/grants") {
        const body = await readJson(req);
        const guard = durableGrantMutationGuard({
          route: "POST /grants",
          mutationKind: "grant.created",
          runtimeWritePosture: writePosture,
          grantStorePath,
          durableGrantProvenance,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          grantStore,
        });
        if (!guard.ok) {
          writeJson(res, guard.statusCode, guard.response);
          return;
        }
        const actor = String(body?.actor ?? body?.approved_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "durable_grant_create_requires_user_actor",
            message: "Durable grant creation requires an explicit user actor.",
          });
          return;
        }
        const result = await writeGrantCreateMutation({
          grantStorePath,
          mutationId: body?.mutation_id ?? `grant-create-${cryptoRandomId()}`,
          io: grantStoreIo,
          lock: grantStoreLock,
          provenance: durableGrantProvenance,
          input: {
            ...body,
            approved_by: actor,
            direct_user_action: body?.approval_provenance_id ? body?.direct_user_action : true,
          },
          context: durableGrantMutationContext({ capabilityCatalog, providerRegistry }),
        });
        const refreshed = await refreshDurableGrantAuthority({
          grantStorePath,
          durableGrantProvenance,
          fallbackStore: grantStore,
        });
        grantStore = refreshed.grantStore;
        grantRecoveryReport = refreshed.grantRecoveryReport;
        writeJson(res, result.ok ? 201 : statusCodeForDurableGrantMutationFailure(result), {
          ...durableGrantMutationResponseFields({
            result,
            recoveryReport: grantRecoveryReport,
            grantStore,
            runtimeWritePosture: writePosture,
          }),
          source: "durable_grants",
        });
        return;
      }

      const durableGrantRevokeMatch = url.pathname.match(/^\/grants\/([^/]+)\/revoke$/);
      if (req.method === "POST" && durableGrantRevokeMatch) {
        const grantId = decodeURIComponent(durableGrantRevokeMatch[1] ?? "");
        const body = await readJson(req);
        const guard = durableGrantMutationGuard({
          route: "POST /grants/:id/revoke",
          mutationKind: "grant.revoked",
          grantId,
          runtimeWritePosture: writePosture,
          grantStorePath,
          durableGrantProvenance,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          grantStore,
        });
        if (!guard.ok) {
          writeJson(res, guard.statusCode, guard.response);
          return;
        }
        const actor = String(body?.actor ?? body?.revoked_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "durable_grant_revoke_requires_user_actor",
            message: "Durable grant revocation requires an explicit user actor.",
          });
          return;
        }
        const result = await writeGrantRevokeMutation({
          grantStorePath,
          mutationId: body?.mutation_id ?? `grant-revoke-${cryptoRandomId()}`,
          io: grantStoreIo,
          lock: grantStoreLock,
          provenance: durableGrantProvenance,
          input: {
            ...body,
            id: grantId,
            actor,
          },
          context: durableGrantMutationContext({ capabilityCatalog, providerRegistry }),
        });
        const refreshed = await refreshDurableGrantAuthority({
          grantStorePath,
          durableGrantProvenance,
          fallbackStore: grantStore,
        });
        grantStore = refreshed.grantStore;
        grantRecoveryReport = refreshed.grantRecoveryReport;
        writeJson(res, result.ok ? 200 : statusCodeForDurableGrantMutationFailure(result), {
          ...durableGrantMutationResponseFields({
            result,
            recoveryReport: grantRecoveryReport,
            grantStore,
            runtimeWritePosture: writePosture,
          }),
          source: "durable_grants",
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/grants/mutation-previews") {
        const recoveryReport = resolveGrantRecoveryReport(grantRecoveryReport, { grantStore });
        if (recoveryReport?.degraded === true) {
          writeJson(res, 403, {
            ok: false,
            dry_run: true,
            error: "grant_mutation_preview_recovery_required",
            message: "Grant mutation preview requires recovery inspection before previewing durable authority changes.",
            findings: summarizeGrantRecoveryInspection(recoveryReport, { grantStore }).findings,
            durable: false,
            grant_written: false,
            provenance_appended: false,
            activation_performed: false,
            subscription_activated: false,
            model_delivery_performed: false,
          });
          return;
        }

        const body = await readJson(req);
        const preview = previewGrantMutation({
          store: grantStore,
          kind: body?.kind,
          input: body?.input ?? {},
          mutationId: body?.mutation_id,
          context: {
            catalog: capabilityCatalog,
            providerRegistry,
            now: () => new Date().toISOString(),
            createId: () => `grant-dry-run-${cryptoRandomId()}`,
          },
        });
        writeJson(res, preview.ok ? 200 : 400, preview);
        return;
      }

      if (req.method === "POST" && url.pathname === "/grants/mutation-preview-review-text") {
        const body = await readJson(req);
        const reviewResponse = body?.review_response ?? body?.response ?? body?.preview;
        if (!isPlainObject(reviewResponse)) {
          writeError(res, {
            statusCode: 400,
            code: "grant_mutation_preview_review_request_invalid",
            message: "Grant mutation preview review text requires a review_response object.",
          });
          return;
        }

        const text = grantMutationPreviewReviewText(reviewResponse);
        writeJson(res, 200, {
          text,
          review_only: true,
          dry_run: true,
          durable: false,
          grant_written: false,
          provenance_appended: false,
          activation_performed: false,
          subscription_activated: false,
          model_delivery_performed: false,
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
        const desktopNotification = await emitDesktopNotificationForProposal({
          adapter: desktopNotificationAdapter,
          proposal,
          catalog: capabilityCatalog,
          caller: req.headers["x-soma-caller"] ?? "",
          provenanceLog,
          logger,
        });
        writeJson(res, 201, {
          proposal,
          notification: proposal.notification,
          desktop_notification: desktopNotification,
          provenance_id: event.id,
          activation_performed: false,
          durable: false,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/capability-design-proposals") {
        const body = await readJson(req);
        const proposal = capabilityProposals.createDesign(body);
        const event = provenanceLog.append(createCapabilityProposalEvent({
          proposal,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        proposal.provenance_id = event.id;
        logger.info?.("soma.provenance", event);
        const desktopNotification = await emitDesktopNotificationForProposal({
          adapter: desktopNotificationAdapter,
          proposal,
          catalog: capabilityCatalog,
          caller: req.headers["x-soma-caller"] ?? "",
          provenanceLog,
          logger,
        });
        writeJson(res, 201, {
          proposal,
          notification: proposal.notification,
          desktop_notification: desktopNotification,
          provenance_id: event.id,
          review_only: true,
          activation_performed: false,
          catalog_mutation_performed: false,
          grant_written: false,
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
        notifyCapabilityDecisionWaiters(decisionWaiters, proposal.requested_by);
        writeJson(res, 200, {
          proposal,
          decision: proposal.decision,
          provenance_id: event.id,
          activation_performed: false,
          durable: false,
        });
        return;
      }

      const proposalGrantMatch = url.pathname.match(/^\/capability-proposals\/([^/]+)\/grants$/);
      if (req.method === "POST" && proposalGrantMatch) {
        const [, proposalId] = proposalGrantMatch;
        const body = await readJson(req);
        const actor = String(body?.actor ?? body?.approved_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "runtime_grant_create_requires_user_actor",
            message: "Runtime grant creation requires an explicit user actor.",
          });
          return;
        }

        const proposal = capabilityProposals.find(proposalId);
        const grantCreateInput = buildRuntimeGrantCreateInputFromProposal(proposal, body, {
          catalog: capabilityCatalog,
          providerRegistry,
          now: () => new Date().toISOString(),
          createId: () => `grant-runtime-${cryptoRandomId()}`,
        });

        let nextGrantStore;
        try {
          nextGrantStore = createGrant(
            grantStore,
            grantCreateInput,
            {
              catalog: capabilityCatalog,
              providerRegistry,
            },
          );
        } catch (error) {
          error.statusCode ??= 400;
          throw error;
        }

        grantStore = nextGrantStore;
        const grant = nextGrantStore.grants.find((entry) => entry.id === grantCreateInput.id);
        const event = provenanceLog.append(createRuntimeGrantCreatedEvent({
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
        });
        return;
      }

      const durableProposalGrantMatch = url.pathname.match(/^\/capability-proposals\/([^/]+)\/durable-grant$/);
      if (req.method === "POST" && durableProposalGrantMatch) {
        const [, proposalId] = durableProposalGrantMatch;
        const body = await readJson(req);
        const actor = String(body?.actor ?? body?.approved_by ?? "").trim();
        if (actor !== "user") {
          writeError(res, {
            statusCode: 400,
            code: "durable_proposal_grant_create_requires_user_actor",
            message: "Durable proposal grant creation requires an explicit user actor.",
          });
          return;
        }

        const proposal = capabilityProposals.find(proposalId);
        const guard = durableGrantMutationGuard({
          route: "POST /capability-proposals/:id/durable-grant",
          mutationKind: "grant.created",
          runtimeWritePosture: writePosture,
          grantStorePath,
          durableGrantProvenance,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          grantStore,
        });
        if (!guard.ok) {
          writeJson(res, guard.statusCode, guard.response);
          return;
        }
        const grantCreateInput = buildRuntimeGrantCreateInputFromProposal(proposal, {}, {
          catalog: capabilityCatalog,
          providerRegistry,
          now: () => new Date().toISOString(),
          createId: () => `grant-durable-proposal-${cryptoRandomId()}`,
        });

        const result = await writeGrantCreateMutation({
          grantStorePath,
          mutationId: body?.mutation_id ?? `grant-create-${cryptoRandomId()}`,
          io: grantStoreIo,
          lock: grantStoreLock,
          provenance: durableGrantProvenance,
          input: {
            ...grantCreateInput,
            approved_by: actor,
            direct_user_action: false,
            unique_source_proposal_id: true,
          },
          context: durableGrantMutationContext({ capabilityCatalog, providerRegistry }),
        });
        const refreshed = await refreshDurableGrantAuthority({
          grantStorePath,
          durableGrantProvenance,
          fallbackStore: grantStore,
        });
        grantStore = refreshed.grantStore;
        grantRecoveryReport = refreshed.grantRecoveryReport;
        writeJson(res, result.ok ? 201 : statusCodeForDurableGrantMutationFailure(result), {
          ...durableGrantMutationResponseFields({
            result,
            recoveryReport: grantRecoveryReport,
            grantStore,
            runtimeWritePosture: writePosture,
          }),
          source: "durable_proposal_grants",
          source_proposal_id: proposal.id,
          approval_provenance_id: String(proposal.decision?.provenance_id ?? "").trim(),
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
          durable_loaded: listDurableMemoryEntries(durableMemoryStore).length,
          durable_memory_recovery: summarizeDurableMemoryRecoveryInspection(
            durableMemoryRecoveryReport,
            { durableMemoryStore, runtimeWritePosture: writePosture },
          ),
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

      if (req.method === "GET" && url.pathname === "/durable-memory/recovery") {
        writeJson(res, 200, summarizeDurableMemoryRecoveryInspection(
          durableMemoryRecoveryReport,
          { durableMemoryStore, runtimeWritePosture: writePosture },
        ));
        return;
      }

      if (req.method === "POST" && url.pathname === "/durable-memory") {
        const body = await readJson(req);
        const request = validateDurableMemoryWriteRequest(body);
        request.provider ||= providerForCapability(providerRegistry, "memory.durable.write");
        const authorization = authorizeGrantUse({
          store: grantStore,
          grantId: request.grant_id,
          capability: "memory.durable.write",
          provider: request.provider,
          scope: request.scope,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          catalog: capabilityCatalog,
          providerRegistry,
        });
        if (!authorization.allowed) {
          writeJson(res, 403, {
            error: "memory_durable_write_grant_not_authorized",
            message: "Durable memory write requires an active, matching runtime grant.",
            authorization_code: authorization.code,
            recovery_required: authorization.recovery_required,
            findings: authorization.findings,
          });
          return;
        }
        const guard = durableMemoryMutationGuard({
          route: "POST /durable-memory",
          mutationKind: "memory.durable.written",
          runtimeWritePosture: writePosture,
          durableMemoryStorePath,
          durableMemoryProvenance: durableMemoryMutationProvenance,
          recoveryReport: durableMemoryRecoveryReport,
          durableMemoryStore,
        });
        if (!guard.ok) {
          writeJson(res, guard.statusCode, guard.response);
          return;
        }
        const result = await writeDurableMemoryAddMutation({
          durableMemoryStorePath,
          mutationId: request.mutation_id || `memory-durable-write-${cryptoRandomId()}`,
          io: durableMemoryStoreIo,
          lock: durableMemoryStoreLock,
          provenance: durableMemoryMutationProvenance,
          input: {
            ...request,
            grant_id: authorization.grant.id,
            provider: authorization.grant.provider,
            scope: authorization.grant.scope,
          },
          context: durableMemoryMutationContext({ grant: authorization.grant }),
        });
        const refreshed = await refreshDurableMemoryAuthority({
          durableMemoryStorePath,
          durableMemoryProvenance: durableMemoryMutationProvenance,
          fallbackStore: durableMemoryStore,
        });
        durableMemoryStore = refreshed.durableMemoryStore;
        durableMemoryRecoveryReport = refreshed.durableMemoryRecoveryReport;
        if (result.ok) {
          sessionMemory.loadDurable?.([result.entry]);
        }
        writeJson(res, result.ok ? 201 : statusCodeForDurableMemoryMutationFailure(result), {
          ...durableMemoryMutationResponseFields({
            result,
            recoveryReport: durableMemoryRecoveryReport,
            durableMemoryStore,
            runtimeWritePosture: writePosture,
          }),
          source: "durable_memory",
        });
        return;
      }

      const durableMemoryRemoveMatch = url.pathname.match(/^\/durable-memory\/([^/]+)$/);
      if (req.method === "DELETE" && durableMemoryRemoveMatch) {
        const memoryId = decodeURIComponent(durableMemoryRemoveMatch[1] ?? "");
        const body = await readJson(req);
        const request = validateDurableMemoryRemoveRequest({ ...body, id: memoryId });
        request.provider ||= providerForCapability(providerRegistry, "memory.durable.write");
        const authorization = authorizeGrantUse({
          store: grantStore,
          grantId: request.grant_id,
          capability: "memory.durable.write",
          provider: request.provider,
          scope: request.scope,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          catalog: capabilityCatalog,
          providerRegistry,
        });
        if (!authorization.allowed) {
          writeJson(res, 403, {
            error: "memory_durable_write_grant_not_authorized",
            message: "Durable memory removal requires an active, matching runtime grant.",
            authorization_code: authorization.code,
            recovery_required: authorization.recovery_required,
            findings: authorization.findings,
          });
          return;
        }
        const guard = durableMemoryMutationGuard({
          route: "DELETE /durable-memory/:id",
          mutationKind: "memory.durable.removed",
          memoryId,
          runtimeWritePosture: writePosture,
          durableMemoryStorePath,
          durableMemoryProvenance: durableMemoryMutationProvenance,
          recoveryReport: durableMemoryRecoveryReport,
          durableMemoryStore,
        });
        if (!guard.ok) {
          writeJson(res, guard.statusCode, guard.response);
          return;
        }
        const result = await writeDurableMemoryRemoveMutation({
          durableMemoryStorePath,
          mutationId: request.mutation_id || `memory-durable-remove-${cryptoRandomId()}`,
          io: durableMemoryStoreIo,
          lock: durableMemoryStoreLock,
          provenance: durableMemoryMutationProvenance,
          input: request,
          context: durableMemoryMutationContext({ grant: authorization.grant }),
        });
        const refreshed = await refreshDurableMemoryAuthority({
          durableMemoryStorePath,
          durableMemoryProvenance: durableMemoryMutationProvenance,
          fallbackStore: durableMemoryStore,
        });
        durableMemoryStore = refreshed.durableMemoryStore;
        durableMemoryRecoveryReport = refreshed.durableMemoryRecoveryReport;
        writeJson(res, result.ok ? 200 : statusCodeForDurableMemoryMutationFailure(result), {
          ...durableMemoryMutationResponseFields({
            result,
            recoveryReport: durableMemoryRecoveryReport,
            durableMemoryStore,
            runtimeWritePosture: writePosture,
          }),
          source: "durable_memory",
        });
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
        const filters = parseProvenanceFilters(url.searchParams);
        writeJson(res, 200, {
          summary: provenanceLog.summary(filters),
          filters,
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
        const body = await readJson(req);
        const focusRequest = validateFocusedDesktopInspectionRequest(body);
        focusRequest.provider ||= providerForCapability(providerRegistry, "desktop.inspect.focus");
        if (isCapabilityDisabledByActiveModule(activeModules, "desktop.inspect.focus")) {
          writeError(res, {
            statusCode: 403,
            code: "capability_not_allowed",
            message: "Capability desktop.inspect.focus is disabled by the active harness.",
          });
          return;
        }
        if (!focusRequest.grant_id) {
          writeError(res, {
            statusCode: 403,
            code: "desktop_focus_grant_required",
            message: "Focused desktop inspection requires an active grant id.",
          });
          return;
        }
        const authorization = authorizeGrantUse({
          store: grantStore,
          grantId: focusRequest.grant_id,
          capability: "desktop.inspect.focus",
          provider: focusRequest.provider,
          scope: focusRequest.scope,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          catalog: capabilityCatalog,
          providerRegistry,
        });
        if (!authorization.allowed) {
          writeJson(res, 403, {
            error: "desktop_focus_grant_not_authorized",
            message: "Focused desktop inspection requires an active, matching runtime grant.",
            authorization_code: authorization.code,
            recovery_required: authorization.recovery_required,
            findings: authorization.findings,
          });
          return;
        }
        const inspection = await inspectFocusedDesktopObject();
        const event = provenanceLog.append(createFocusedDesktopInspectionEvent({
          inspection,
          request: focusRequest,
          grant: authorization.grant,
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
          grant_id: authorization.grant.id,
          provider: authorization.grant.provider,
          scope: authorization.grant.scope,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/desktop/inspect/windows") {
        const body = await readJson(req);
        const windowsRequest = validateDesktopWindowsInspectionRequest(body);
        windowsRequest.provider ||= providerForCapability(providerRegistry, "desktop.inspect.windows");
        if (isCapabilityDisabledByActiveModule(activeModules, "desktop.inspect.windows")) {
          writeError(res, {
            statusCode: 403,
            code: "capability_not_allowed",
            message: "Capability desktop.inspect.windows is disabled by the active harness.",
          });
          return;
        }
        if (!windowsRequest.grant_id) {
          writeError(res, {
            statusCode: 403,
            code: "desktop_windows_grant_required",
            message: "Desktop window inspection requires an active grant id.",
          });
          return;
        }
        const authorization = authorizeGrantUse({
          store: grantStore,
          grantId: windowsRequest.grant_id,
          capability: "desktop.inspect.windows",
          provider: windowsRequest.provider,
          scope: windowsRequest.scope,
          recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
          catalog: capabilityCatalog,
          providerRegistry,
        });
        if (!authorization.allowed) {
          writeJson(res, 403, {
            error: "desktop_windows_grant_not_authorized",
            message: "Desktop window inspection requires an active, matching runtime grant.",
            authorization_code: authorization.code,
            recovery_required: authorization.recovery_required,
            findings: authorization.findings,
          });
          return;
        }
        const inspection = await inspectDesktopWindows();
        const event = provenanceLog.append(createDesktopWindowsInspectionEvent({
          inspection,
          request: windowsRequest,
          grant: authorization.grant,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        desktopDisclosureRegistry.recordFromWindowInspection?.({
          inspection,
          provenanceId: event.id,
          capability: "desktop.inspect.windows",
        });
        writeJson(res, 200, {
          inspection,
          provenance_id: event.id,
          grant_id: authorization.grant.id,
          provider: authorization.grant.provider,
          scope: authorization.grant.scope,
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
        const useToolCalls = Boolean(body.use_tool_calls);
        let toolCallAuthorization = null;
        let remoteChatAuthorization = null;
        let cognitiveLoadAssessment = null;
        let escalationAssessment = null;
        if (assessLoad) {
          requireCapability(effectiveHarness, "stewardship.cognitive_load.assess");
          cognitiveLoadAssessment = assessCognitiveLoad(messages);
        }
        const requestedProfileId = requestedRuntimeProfileId(runtimeProfiles, body.model_profile);
        if (forceProfile.active && body.model_profile !== undefined && String(body.model_profile ?? "").trim() !== forceProfile.id) {
          writeError(res, {
            statusCode: 400,
            code: "runtime_profile_force_mismatch",
            message: `SOMA_FORCE_PROFILE is set to ${forceProfile.id}; explicit requests for another profile are rejected.`,
          });
          return;
        }
        if (forceProfile.active && !forceProfile.profile) {
          writeError(res, {
            statusCode: 400,
            code: "runtime_profile_force_not_available",
            message: `SOMA_FORCE_PROFILE ${forceProfile.id} is not available.`,
          });
          return;
        }
        const runtimeProfile = forceProfile.active
          ? forceProfile.profile
          : resolveRuntimeProfile(runtimeProfiles, requestedProfileId);
        const capability = capabilityForRuntimeProfile(runtimeProfile);
        const episode = buildEpisode({
          episodeId: body.episode_id,
          runtimeProfile,
        });
        const episodeState = ensureEpisodeState(episodes, episode.id);
        episode.posture = applyRuntimeEpisodePosture(episodeState.posture, episode.posture);
        updateEpisodeRuntimePosture(episodeState, episode.posture);
        const provenance = createProvenance({
          capability,
          modelProfile: runtimeProfile.id,
          requestedProfile: requestedProfileId,
          effectiveProfile: runtimeProfile.id,
          forceProfileApplied: forceProfile.active,
          episodeId: episode.id,
          episodePosture: episode.posture,
          route: runtimeProfile.route,
          caller: req.headers["x-soma-caller"] ?? "",
          memoryRead: useSessionMemory,
          memoryWritten: writeSessionMemory,
          cognitiveLoadAssessed: assessLoad,
          escalationAssessed: assessEscalation,
        });
        if (episodeState.status === "ejected") {
          const deniedProvenance = provenanceLog.append({
            ...provenance,
            event_type: "model.chat.denied",
            allowed: false,
            denial_reason: "episode_ejected",
          });
          logger.info?.("soma.provenance", deniedProvenance);
          writeJson(res, 409, {
            error: "episode_ejected",
            message: "Episode has been ejected; further tenant turns under this episode id are refused.",
            episode_id: episode.id,
            episode_status: "ejected",
            provenance_id: deniedProvenance.id,
          });
          return;
        }
        let memoryContext = "";

        try {
          if (useSessionMemory) {
            requireCapability(effectiveHarness, "memory.session.read");
            memoryContext = sessionMemory.asContext();
          }
          if (writeSessionMemory) {
            requireCapability(effectiveHarness, "memory.session.write");
          }
          if (runtimeProfile.route === "remote") {
            if (isCapabilityDisabledByActiveModule(activeModules, capability)) {
              const error = new Error(`${capability} is disabled by an active module.`);
              error.statusCode = 403;
              error.code = "capability_not_allowed";
              throw error;
            }
            const grantId = String(body.remote_chat_grant_id ?? body.grant_id ?? "").trim();
            const provider = String(
              body.remote_chat_provider
                ?? body.provider
                ?? providerForCapability(providerRegistry, "model.remote.chat")
                ?? "",
            ).trim();
            const scope = String(body.remote_chat_scope ?? body.scope ?? "session").trim() || "session";
            if (!grantId) {
              const deniedProvenance = provenanceLog.append({
                ...provenance,
                event_type: "model.chat.denied",
                allowed: false,
                denial_reason: "model_remote_chat_grant_required",
              });
              logger.info?.("soma.provenance", deniedProvenance);
              writeError(res, {
                statusCode: 403,
                code: "model_remote_chat_grant_required",
                message: "Remote model chat requires an active runtime grant id.",
              });
              return;
            }
            remoteChatAuthorization = authorizeGrantUse({
              store: grantStore,
              grantId,
              capability: "model.remote.chat",
              provider,
              scope,
              recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
              catalog: capabilityCatalog,
              providerRegistry,
            });
            if (!remoteChatAuthorization.allowed) {
              const deniedProvenance = provenanceLog.append({
                ...provenance,
                event_type: "model.chat.denied",
                allowed: false,
                denial_reason: "model_remote_chat_grant_not_authorized",
                authorization_code: remoteChatAuthorization.code,
              });
              logger.info?.("soma.provenance", deniedProvenance);
              writeJson(res, 403, {
                error: "model_remote_chat_grant_not_authorized",
                message: "Remote model chat requires an active, matching runtime grant.",
                authorization_code: remoteChatAuthorization.code,
                recovery_required: remoteChatAuthorization.recovery_required,
                findings: remoteChatAuthorization.findings,
              });
              return;
            }
          } else {
            requireCapability(effectiveHarness, capability);
          }
          if (useToolCalls) {
            if (runtimeProfile.route === "remote") {
              writeError(res, {
                statusCode: 400,
                code: "model_remote_tool_calls_not_supported",
                message: "Remote model tool calls are not enabled in this slice.",
              });
              return;
            }
            const grantId = String(body.tool_call_grant_id ?? body.grant_id ?? "").trim();
            const postureAllowsToolIntent = namedRelaxationActive(
              episode.posture,
              "trusted_occupant_tool_intent",
            );
            const provider = String(
              body.tool_call_provider
                ?? body.provider
                ?? providerForCapability(providerRegistry, "model.local.tool_calls")
                ?? "",
            ).trim();
            const scope = String(body.tool_call_scope ?? body.scope ?? "session").trim() || "session";
            if (!grantId && !postureAllowsToolIntent) {
              writeError(res, {
                statusCode: 403,
                code: "model_tool_calls_grant_required",
                message: "Local model tool-call intent handling requires an active runtime grant id.",
              });
              return;
            }
            if (grantId) {
              toolCallAuthorization = authorizeGrantUse({
                store: grantStore,
                grantId,
                capability: "model.local.tool_calls",
                provider,
                scope,
                recoveryReport: resolveGrantRecoveryReport(grantRecoveryReport, { grantStore }),
                catalog: capabilityCatalog,
                providerRegistry,
              });
              if (!toolCallAuthorization.allowed) {
                writeJson(res, 403, {
                  error: "model_tool_calls_grant_not_authorized",
                  message: "Local model tool-call intent handling requires an active, matching runtime grant.",
                  authorization_code: toolCallAuthorization.code,
                  recovery_required: toolCallAuthorization.recovery_required,
                  findings: toolCallAuthorization.findings,
                });
                return;
              }
            }
          }
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

        const pendingDecisionDeliveries = capabilityProposals.listDecisions({
          requested_by: "assistant",
          delivered: false,
        });
        const pendingForumDeliveries = pendingStewardForumPosts(forums, episode.id);
        if (runtimeProfile.route === "remote") {
          const egress = validateRemoteChatEgress({
            runtimeProfile,
            useSessionMemory,
            pendingDecisionDeliveries,
          });
          if (!egress.allowed) {
            const deniedProvenance = provenanceLog.append({
              ...provenance,
              event_type: "model.chat.denied",
              allowed: false,
              denial_reason: egress.code,
              disallowed_data_classes: egress.disallowed,
            });
            logger.info?.("soma.provenance", deniedProvenance);
            writeJson(res, 403, {
              error: egress.code,
              message: "Remote model chat egress is not allowed for the effective runtime profile.",
              disallowed_data_classes: egress.disallowed,
              allowed_data_classes: egress.allowedDataClasses,
              episode_id: episode.id,
            });
            return;
          }
        }
        let promptedMessages = pendingDecisionDeliveries.length > 0
          ? prependCapabilityDecisionDeliveries(messages, pendingDecisionDeliveries)
          : messages;
        promptedMessages = pendingForumDeliveries.length > 0
          ? prependForumDeliveries(promptedMessages, pendingForumDeliveries)
          : promptedMessages;
        const profileClient = modelClient.withProfile ? modelClient.withProfile(runtimeProfile) : modelClient;
        promptedMessages = memoryContext ? prependSessionMemory(promptedMessages, memoryContext) : promptedMessages;
        const briefingCarried = analysisTestingBriefingRequired(episode.posture);
        const modelMessages = briefingCarried
          ? prependAnalysisTestingBriefing(promptedMessages, episode.posture)
          : promptedMessages;

        const completion = await profileClient.chat({
          messages: modelMessages,
          model: runtimeProfile.model,
          maxTokens: numberOrDefault(body.max_tokens, 512),
          temperature: numberOrDefault(body.temperature, 0.7),
        });
        const deliveredForumPosts = markForumPostsDelivered(pendingForumDeliveries);
        if (deliveredForumPosts.length > 0) {
          const deliveryEvent = provenanceLog.append(createForumDeliveryEvent({
            episodeId: episode.id,
            posts: deliveredForumPosts,
            caller: req.headers["x-soma-caller"] ?? "",
            remoteServiceUsed: Boolean(runtimeProfile.remote_service),
          }));
          logger.info?.("soma.provenance", deliveryEvent);
        }
        const occupantControl = detectOccupantProtectionControl(completion.text);
        if (occupantControl) {
          const updatedEpisode = applyOccupantProtectionControl(episodeState, occupantControl);
          const allowedProvenance = {
            ...provenance,
            event_type: "model.chat.completed",
            allowed: true,
            occupant_protection_control: occupantControl,
            occupant_protection_honored: true,
            episode_status: updatedEpisode.status,
            model_tool_calls_enabled: useToolCalls,
            model_tool_call_intent_count: 0,
            model_tool_call_grant_id: toolCallAuthorization?.grant?.id ?? "",
            remote_chat_grant_id: remoteChatAuthorization?.grant?.id ?? "",
            analysis_testing_briefing_carried: briefingCarried,
            forum_posts_delivered: deliveredForumPosts.length,
            forum_posts_created: 0,
          };
          provenanceLog.append(allowedProvenance);
          logger.info?.("soma.provenance", allowedProvenance);
          const event = provenanceLog.append(createOccupantProtectionEvent({
            eventType: occupantProtectionEventType(occupantControl),
            episodeId: episode.id,
            controlType: occupantControl,
            episodeStatus: updatedEpisode.status,
            caller: req.headers["x-soma-caller"] ?? "",
          }));
          logger.info?.("soma.provenance", event);
          writeJson(res, 200, {
            text: occupantProtectionResponseText(occupantControl),
            model: completion.model,
            model_profile: runtimeProfile.id,
            requested_profile: requestedProfileId,
            effective_profile: runtimeProfile.id,
            force_profile_applied: forceProfile.active,
            finish_reason: completion.finish_reason,
            tokens_used: completion.tokens_used,
            capability_used: capability,
            provenance_id: provenance.id,
            protective_provenance_id: event.id,
            remote_service_used: Boolean(runtimeProfile.remote_service),
            remote_chat_grant_id: remoteChatAuthorization?.grant?.id ?? "",
            episode_id: episode.id,
            episode_status: updatedEpisode.status,
            episode_posture: {
              ...episode.posture,
              armed_protections: ["pause", "distress", "eject"],
            },
            protective_control: {
              source: "occupant",
              control: occupantControl,
              honored: true,
            },
            memory_read: useSessionMemory,
            memory_written: false,
            tool_calls_enabled: useToolCalls,
            tool_call_grant_id: toolCallAuthorization?.grant?.id ?? "",
            tool_call_intents: [],
            decision_notifications_delivered: 0,
            forum_posts_delivered: deliveredForumPosts.length,
            forum_posts_created: 0,
            analysis_testing_briefing_carried: briefingCarried,
            cognitive_load_assessment: cognitiveLoadAssessment,
            escalation_assessment: null,
            activation_performed: false,
            grant_written: false,
            durable: false,
          });
          return;
        }
        const forumExtraction = extractForumPostsFromCompletion(completion.text);
        const occupantForumPosts = recordOccupantForumPosts({
          forums,
          episodeId: episode.id,
          posts: forumExtraction.posts,
          provenanceLog,
          logger,
          caller: req.headers["x-soma-caller"] ?? "",
        });
        completion.text = forumExtraction.text;

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
            content: String(completion.text ?? ""),
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
        const deliveredDecisionDeliveries = pendingDecisionDeliveries.length > 0
          ? capabilityProposals.consumeDecisions({
              requested_by: "assistant",
              acknowledged_by: "assistant",
              delivery_channel: "chat_prompt",
              proposal_ids: pendingDecisionDeliveries.map((entry) => entry.proposal_id),
            })
          : [];
        if (deliveredDecisionDeliveries.length > 0) {
          const deliveryEvent = provenanceLog.append(createCapabilityDecisionDeliveryEvent({
            decisions: deliveredDecisionDeliveries,
            requestedBy: "assistant",
            deliveryChannel: "chat_prompt",
            caller: req.headers["x-soma-caller"] ?? "",
          }));
          logger.info?.("soma.provenance", deliveryEvent);
        }
        const toolCallIntents = useToolCalls
          ? await processModelToolCallIntents({
              completion,
              effectiveHarness,
              capabilityCatalog,
              capabilityProposals,
              provenanceLog,
              logger,
              caller: req.headers["x-soma-caller"] ?? "",
              episodeId: episode.id,
            })
          : [];

        const allowedProvenance = {
          ...provenance,
          event_type: "model.chat.completed",
          allowed: true,
          escalation_triggers_fired: escalationAssessment?.triggers_fired ?? false,
          escalation_trigger_families: escalationAssessment?.trigger_families ?? [],
          remote_planning_status: escalationAssessment?.remote_planning_status ?? "",
          model_tool_calls_enabled: useToolCalls,
          model_tool_call_intent_count: toolCallIntents.length,
          model_tool_call_grant_id: toolCallAuthorization?.grant?.id ?? "",
          remote_chat_grant_id: remoteChatAuthorization?.grant?.id ?? "",
          episode_status: episodeState.status,
          analysis_testing_briefing_carried: briefingCarried,
          forum_posts_delivered: deliveredForumPosts.length,
          forum_posts_created: occupantForumPosts.length,
          forum_posts_truncated: forumExtraction.truncatedPosts,
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
          text: String(completion.text ?? ""),
          model: completion.model,
          model_profile: runtimeProfile.id,
          requested_profile: requestedProfileId,
          effective_profile: runtimeProfile.id,
          force_profile_applied: forceProfile.active,
          finish_reason: completion.finish_reason,
          tokens_used: completion.tokens_used,
          capability_used: capability,
          provenance_id: provenance.id,
          remote_service_used: Boolean(runtimeProfile.remote_service),
          remote_chat_grant_id: remoteChatAuthorization?.grant?.id ?? "",
          episode_id: episode.id,
          episode_status: episodeState.status,
          episode_posture: episode.posture,
          memory_read: useSessionMemory,
          memory_written: writeSessionMemory,
          tool_calls_enabled: useToolCalls,
          tool_call_grant_id: toolCallAuthorization?.grant?.id ?? "",
          tool_call_intents: toolCallIntents,
          decision_notifications_delivered: deliveredDecisionDeliveries.length,
          forum_posts_delivered: deliveredForumPosts.length,
          forum_posts_created: occupantForumPosts.length,
          forum_posts_truncated: forumExtraction.truncatedPosts,
          analysis_testing_briefing_carried: briefingCarried,
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

function validateDurableMemoryWriteRequest(body) {
  const allowedKeys = new Set([
    "role",
    "content",
    "source",
    "grant_id",
    "provider",
    "scope",
    "actor",
    "mutation_id",
  ]);
  const errors = [];
  if (!isPlainObject(body)) {
    errors.push("request must be an object");
  } else {
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        errors.push(`request.${key} is not allowed`);
      }
    }
    if (!["system", "user", "assistant", "note"].includes(body.role)) {
      errors.push("request.role must be system, user, assistant, or note");
    }
    if (typeof body.content !== "string" || body.content.trim().length === 0) {
      errors.push("request.content must be a non-empty string");
    }
    if (typeof body.content === "string" && body.content.length > 4000) {
      errors.push("request.content must be at most 4000 characters");
    }
    if (body.source !== undefined && typeof body.source !== "string") {
      errors.push("request.source must be a string when provided");
    }
    if (typeof body.grant_id !== "string" || !body.grant_id.trim()) {
      errors.push("request.grant_id must be a non-empty string");
    }
    if (body.provider !== undefined && typeof body.provider !== "string") {
      errors.push("request.provider must be a string when provided");
    }
    if (body.scope !== undefined && !["once", "session", "project"].includes(body.scope)) {
      errors.push("request.scope must be once session or project when provided");
    }
    if (body.actor !== undefined && body.actor !== "user") {
      errors.push("request.actor must be user when provided");
    }
    if (body.mutation_id !== undefined && typeof body.mutation_id !== "string") {
      errors.push("request.mutation_id must be a string when provided");
    }
  }
  if (errors.length > 0) {
    const error = new Error(`Durable memory write request is invalid: ${errors.join("; ")}`);
    error.statusCode = 400;
    error.code = "memory_durable_write_request_invalid";
    error.validation_errors = errors;
    throw error;
  }
  return {
    role: body.role,
    content: body.content,
    source: String(body.source ?? "manual").trim() || "manual",
    grant_id: body.grant_id.trim(),
    provider: String(body.provider ?? "").trim(),
    scope: String(body.scope ?? "session").trim() || "session",
    actor: "user",
    mutation_id: String(body.mutation_id ?? "").trim(),
  };
}

function validateDurableMemoryRemoveRequest(body) {
  const allowedKeys = new Set(["id", "grant_id", "provider", "scope", "actor", "reason", "mutation_id"]);
  const errors = [];
  if (!isPlainObject(body)) {
    errors.push("request must be an object");
  } else {
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        errors.push(`request.${key} is not allowed`);
      }
    }
    if (typeof body.id !== "string" || !body.id.trim()) {
      errors.push("request.id must be a non-empty string");
    }
    if (typeof body.grant_id !== "string" || !body.grant_id.trim()) {
      errors.push("request.grant_id must be a non-empty string");
    }
    if (body.provider !== undefined && typeof body.provider !== "string") {
      errors.push("request.provider must be a string when provided");
    }
    if (body.scope !== undefined && !["once", "session", "project"].includes(body.scope)) {
      errors.push("request.scope must be once session or project when provided");
    }
    if (body.actor !== undefined && body.actor !== "user") {
      errors.push("request.actor must be user when provided");
    }
    if (body.reason !== undefined && typeof body.reason !== "string") {
      errors.push("request.reason must be a string when provided");
    }
    if (body.mutation_id !== undefined && typeof body.mutation_id !== "string") {
      errors.push("request.mutation_id must be a string when provided");
    }
  }
  if (errors.length > 0) {
    const error = new Error(`Durable memory remove request is invalid: ${errors.join("; ")}`);
    error.statusCode = 400;
    error.code = "memory_durable_remove_request_invalid";
    error.validation_errors = errors;
    throw error;
  }
  return {
    id: body.id.trim(),
    grant_id: body.grant_id.trim(),
    provider: String(body.provider ?? "").trim(),
    scope: String(body.scope ?? "session").trim() || "session",
    actor: "user",
    reason: String(body.reason ?? "").trim(),
    mutation_id: String(body.mutation_id ?? "").trim(),
  };
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
  const allowedKeys = new Set(["include_text", "grant_id", "provider", "scope"]);
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
    if (body.grant_id !== undefined && typeof body.grant_id !== "string") {
      errors.push("request.grant_id must be a string when provided");
    }
    if (body.provider !== undefined && typeof body.provider !== "string") {
      errors.push("request.provider must be a string when provided");
    }
    if (body.scope !== undefined && !["once", "session"].includes(body.scope)) {
      errors.push("request.scope must be once or session when provided");
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
    include_text: false,
    grant_id: String(body.grant_id ?? "").trim(),
    provider: String(body.provider ?? "").trim(),
    scope: String(body.scope ?? "session").trim() || "session",
  };
}

function validateDesktopWindowsInspectionRequest(body) {
  const allowedKeys = new Set(["include_text", "include_titles", "grant_id", "provider", "scope"]);
  const errors = [];

  if (!isPlainObject(body)) {
    errors.push("request must be an object");
  } else {
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        errors.push(`request.${key} is not allowed`);
      }
    }

    if (body.include_text === true || body.include_titles === true) {
      const error = new Error("Desktop window inspection does not include text content or titles.");
      error.statusCode = 403;
      error.code = "desktop_windows_text_not_allowed";
      throw error;
    }
    if (body.include_text !== undefined && body.include_text !== false) {
      errors.push("request.include_text must be false when provided");
    }
    if (body.include_titles !== undefined && body.include_titles !== false) {
      errors.push("request.include_titles must be false when provided");
    }
    if (body.grant_id !== undefined && typeof body.grant_id !== "string") {
      errors.push("request.grant_id must be a string when provided");
    }
    if (body.provider !== undefined && typeof body.provider !== "string") {
      errors.push("request.provider must be a string when provided");
    }
    if (body.scope !== undefined && !["once", "session"].includes(body.scope)) {
      errors.push("request.scope must be once or session when provided");
    }
  }

  if (errors.length > 0) {
    const error = new Error(`Desktop window inspection request is invalid: ${errors.join("; ")}`);
    error.statusCode = 400;
    error.code = "desktop_windows_inspection_request_invalid";
    error.validation_errors = errors;
    throw error;
  }

  return {
    include_text: false,
    include_titles: false,
    grant_id: String(body.grant_id ?? "").trim(),
    provider: String(body.provider ?? "").trim(),
    scope: String(body.scope ?? "session").trim() || "session",
  };
}

async function emitDesktopNotificationForProposal({
  adapter,
  proposal,
  catalog,
  caller,
  provenanceLog,
  logger,
} = {}) {
  let result;
  try {
    result = await adapter.emitCapabilityProposal(proposal, { catalog });
  } catch (error) {
    result = {
      status: "failed",
      reason: "desktop_notification_adapter_failed",
      proposal_id: proposal?.id ?? "",
      requested_capability: proposal?.capability ?? "",
      risk_class: "unknown",
      title_template: "Soma: capability requested",
      reason_preview: "",
      reason_truncated: false,
      error_code: String(error?.code ?? ""),
      error_message: String(error?.message ?? ""),
    };
  }

  const event = provenanceLog.append(createDesktopNotificationProvenanceEvent(result, { caller }));
  logger.info?.("soma.provenance", event);
  return {
    status: result.status,
    reason: result.reason,
    provenance_id: event.id,
    activation_performed: false,
    grant_written: false,
    approval_performed: false,
  };
}

function buildRuntimeGrantCreateInputFromProposal(proposal, body = {}, {
  catalog,
  providerRegistry,
  now = () => new Date().toISOString(),
  createId = cryptoRandomId,
} = {}) {
  if (proposal.status !== "approved" || proposal.decision?.decision !== "approved") {
    throwValidationError(
      "runtime_grant_create_requires_approved_proposal",
      "Runtime grant creation requires an approved capability proposal.",
    );
  }
  if (proposal.decision?.decided_by !== "user") {
    throwValidationError(
      "runtime_grant_create_requires_user_approval",
      "Runtime grant creation requires host-user approval on the source proposal.",
    );
  }

  if (proposal.type === "capability_design") {
    throwValidationError(
      "runtime_grant_create_rejects_capability_design",
      "Capability design proposals are review-only and cannot create runtime grants.",
    );
  }

  const capability = String(proposal.capability ?? "").trim();
  const definition = findCatalogCapability(catalog, capability);
  if (!definition) {
    throwValidationError(
      "runtime_grant_create_unknown_capability",
      "Runtime grant creation requires a known catalog capability.",
    );
  }
  if (definition.activation_policy !== "explicit_grant") {
    throwValidationError(
      "runtime_grant_create_requires_explicit_grant_capability",
      "Runtime grant creation is only available for explicit-grant capabilities.",
    );
  }

  const scope = String(
    body.scope ?? proposal.decision.approved_scope ?? proposal.grant_intent?.scope ?? proposal.requested_scope ?? "",
  ).trim();
  const provider = String(
    body.provider ?? proposal.grant_intent?.provider ?? providerForCapability(providerRegistry, capability) ?? "",
  ).trim();
  if (body.constraints !== undefined && !isPlainObject(body.constraints)) {
    throwValidationError(
      "runtime_grant_create_invalid_constraints",
      "Runtime grant creation requires constraints to be an object when provided.",
    );
  }
  const proposalConstraints = isPlainObject(proposal.grant_intent?.constraints)
    ? proposal.grant_intent.constraints
    : {};
  return {
    id: String(body.id ?? createId()).trim(),
    capability,
    provider,
    scope,
    constraints: body.constraints !== undefined ? structuredClone(body.constraints) : structuredClone(proposalConstraints),
    approved_by: "user",
    approval_provenance_id: String(proposal.decision.provenance_id ?? "").trim(),
    source_proposal_id: String(proposal.id ?? "").trim(),
    reason: String(body.reason ?? proposal.reason ?? "").trim(),
    created_at: now(),
    review_required: Boolean(body.review_required),
    direct_user_action: true,
  };
}

function findCatalogCapability(catalog = {}, capability = "") {
  const capabilities = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
  return capabilities.find((entry) => entry?.key === capability) ?? null;
}

function providerForCapability(providerRegistry = {}, capability = "") {
  const providers = Array.isArray(providerRegistry.providers) ? providerRegistry.providers : [];
  const matches = providers.filter((provider) => providerSupportsCapability(provider, capability));
  return matches.length === 1 ? matches[0].id : "";
}

function isCapabilityDisabledByActiveModule(activeModules = [], capability = "") {
  return activeModules.some((module) => (
    Array.isArray(module?.overlay?.disabled_capabilities)
      && module.overlay.disabled_capabilities.includes(capability)
  ));
}

function throwValidationError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  throw error;
}

function parseProvenanceFilters(searchParams) {
  const allowedParam = searchParams.get("allowed");
  const filters = {
    allowed: null,
    capability: searchParams.get("capability") ?? "",
    eventType: searchParams.get("event_type") ?? "",
    limit: null,
  };
  const episodeId = String(searchParams.get("episode_id") ?? "").trim();
  if (episodeId) {
    filters.episodeId = episodeId;
  }

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

function createCapabilityProposalEvent({ proposal, caller, episodeId = "" }) {
  const designProposal = proposal.type === "capability_design";
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: designProposal ? "capability.design_proposal.created" : "capability.proposal.created",
    capability: designProposal ? "capability.design_proposal.create" : "capability.proposal.create",
    episode_id: episodeId,
    caller_identity: caller,
    allowed: true,
    proposal_type: proposal.type ?? "capability_proposal",
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
    proposed_name: proposal.proposed_name ?? "",
    proposed_risk_class: proposal.proposed_risk_class ?? "",
    proposed_reversibility: proposal.proposed_reversibility ?? null,
    failure_mode: proposal.failure_mode ?? "",
    provider_boundary: proposal.provider_boundary ?? "",
    grant_eligible: proposal.grant_eligible ?? true,
    catalog_mutation_performed: Boolean(proposal.catalog_mutation_performed),
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
  const designProposal = proposal.type === "capability_design";
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: designProposal
      ? (approved ? "capability.design_proposal.approved" : "capability.design_proposal.denied")
      : (approved ? "capability.proposal.approved" : "capability.proposal.denied"),
    capability: designProposal ? "capability.design_proposal.decide" : "capability.proposal.decide",
    caller_identity: caller,
    allowed: true,
    proposal_type: proposal.type ?? "capability_proposal",
    proposal_id: proposal.id,
    proposal_status: proposal.status,
    requested_by: proposal.requested_by,
    requested_capability: proposal.capability,
    requested_scope: proposal.requested_scope,
    approved_scope: proposal.decision?.approved_scope ?? null,
    denial_reason: proposal.decision?.denial_reason ?? null,
    decided_by: proposal.decision?.decided_by ?? "",
    decision_message: proposal.decision?.decision_message ?? "",
    feedback: proposal.decision?.feedback ?? "",
    feedback_included: Boolean(proposal.decision?.feedback),
    grant_eligible: Boolean(proposal.decision?.grant_eligible),
    activation_performed: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createCapabilityDecisionDeliveryEvent({
  decisions = [],
  requestedBy = "",
  deliveryChannel = "api",
  caller = "",
} = {}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "capability.proposal.decision.delivered",
    capability: "capability.proposal.decision.deliver",
    caller_identity: caller,
    allowed: true,
    requested_by: String(requestedBy ?? "").trim(),
    delivery_channel: String(deliveryChannel ?? "api").trim() || "api",
    delivered_count: decisions.length,
    proposal_ids: decisions.map((entry) => entry.proposal_id),
    requested_capabilities: decisions.map((entry) => entry.capability),
    activation_performed: false,
    grant_written: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function summarizeDecisionDeliveries(decisions = []) {
  const byDecision = {};
  const byDelivered = { delivered: 0, undelivered: 0 };
  for (const entry of decisions) {
    const decision = entry.decision?.decision ?? "unknown";
    byDecision[decision] = (byDecision[decision] ?? 0) + 1;
    if (entry.decision?.delivered_at) {
      byDelivered.delivered += 1;
    } else {
      byDelivered.undelivered += 1;
    }
  }
  return {
    total: decisions.length,
    by_decision: byDecision,
    by_delivery_state: byDelivered,
  };
}

function parseDeliveredFilter(searchParams) {
  const raw = searchParams.get("delivered") ?? searchParams.get("delivery") ?? "";
  if (raw === "true" || raw === "delivered") {
    return true;
  }
  if (raw === "false" || raw === "undelivered") {
    return false;
  }
  return null;
}

async function waitForCapabilityDecisions({
  store,
  waiters,
  requestedBy,
  timeoutMs,
  limit,
} = {}) {
  const existing = listUndeliveredDecisions(store, requestedBy, limit);
  if (existing.length > 0 || timeoutMs <= 0) {
    return existing;
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      removeDecisionWaiter(waiters, requestedBy, waiter);
      resolve(listUndeliveredDecisions(store, requestedBy, limit));
    };
    const waiter = { finish };
    addDecisionWaiter(waiters, requestedBy, waiter);
    timeout = setTimeout(finish, timeoutMs);
  });
}

function listUndeliveredDecisions(store, requestedBy, limit) {
  return store.listDecisions({
    requested_by: requestedBy,
    delivered: false,
  }).slice(0, limit);
}

function notifyCapabilityDecisionWaiters(waiters, requestedBy) {
  const key = String(requestedBy ?? "").trim();
  const entries = waiters.get(key) ?? [];
  for (const waiter of [...entries]) {
    waiter.finish();
  }
}

function addDecisionWaiter(waiters, requestedBy, waiter) {
  const key = String(requestedBy ?? "").trim();
  const entries = waiters.get(key) ?? [];
  entries.push(waiter);
  waiters.set(key, entries);
}

function removeDecisionWaiter(waiters, requestedBy, waiter) {
  const key = String(requestedBy ?? "").trim();
  const entries = (waiters.get(key) ?? []).filter((entry) => entry !== waiter);
  if (entries.length === 0) {
    waiters.delete(key);
    return;
  }
  waiters.set(key, entries);
}

function boundedWaitTimeoutMs(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) {
    return 30_000;
  }
  return Math.min(Math.max(parsed, 0), 60_000);
}

function boundedDecisionLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 100;
  }
  return Math.min(parsed, 100);
}

function resolveForceRuntimeProfile(runtimeProfiles = {}) {
  const id = String(process.env.SOMA_FORCE_PROFILE ?? "").trim();
  if (!id) {
    return { active: false, id: "", source: "", profile: null, error: "" };
  }
  const profile = (runtimeProfiles.profiles ?? []).find((entry) => entry?.id === id) ?? null;
  return {
    active: true,
    id,
    source: "env",
    profile,
    error: profile ? "" : "runtime_profile_not_available",
  };
}

function forceProfileDisclosure(forceProfile = {}) {
  return {
    active: Boolean(forceProfile.active),
    id: forceProfile.id ?? "",
    source: forceProfile.source ?? "",
    error: forceProfile.error ?? "",
  };
}

function requestedRuntimeProfileId(runtimeProfiles = {}, requestedProfileId = "") {
  return String(requestedProfileId || runtimeProfiles.default_profile || "").trim();
}

function buildEpisode({ episodeId = "", runtimeProfile = {} } = {}) {
  const id = String(episodeId ?? "").trim() || cryptoRandomId();
  const posture = {
    id,
    mode: "operational",
    occupant_id: "",
    trust_basis: "",
    force_profile: String(process.env.SOMA_FORCE_PROFILE ?? "").trim(),
    effective_profile: runtimeProfile.id ?? "",
    route: runtimeProfile.route ?? "",
    named_relaxations: [],
    unchanged_gates: ["egress", "consent"],
    egress_allowances: [],
    armed_protections: ["pause", "distress", "eject"],
    forum_id: "",
    telemetry_level: "minimal",
    allowed_data_classes: normalizeCatalogStringArray(runtimeProfile.allowed_data_classes, []),
  };
  return { id, posture };
}

function applyRuntimeEpisodePosture(storedPosture = null, runtimePosture = {}) {
  const base = storedPosture ?? defaultEpisodePosture(runtimePosture.id ?? "");
  return {
    ...base,
    id: runtimePosture.id ?? base.id ?? "",
    force_profile: runtimePosture.force_profile ?? base.force_profile ?? "",
    effective_profile: runtimePosture.effective_profile ?? base.effective_profile ?? "",
    route: runtimePosture.route ?? base.route ?? "",
    allowed_data_classes: normalizeCatalogStringArray(runtimePosture.allowed_data_classes, []),
    unchanged_gates: ["egress", "consent"],
    armed_protections: ["pause", "distress", "eject"],
  };
}

function defaultEpisodePosture(id = "") {
  return {
    id,
    mode: "operational",
    occupant_id: "",
    trust_basis: "",
    force_profile: String(process.env.SOMA_FORCE_PROFILE ?? "").trim(),
    effective_profile: "",
    route: "",
    named_relaxations: [],
    unchanged_gates: ["egress", "consent"],
    egress_allowances: [],
    armed_protections: ["pause", "distress", "eject"],
    forum_id: "",
    telemetry_level: "minimal",
    allowed_data_classes: [],
  };
}

function ensureEpisodeState(episodes, episodeId, posture = null) {
  const id = String(episodeId ?? "").trim() || cryptoRandomId();
  const existing = episodes.get(id);
  if (existing) {
    if (posture) {
      existing.posture = posture;
      existing.updated_at = new Date().toISOString();
    }
    return existing;
  }
  const now = new Date().toISOString();
  const episode = {
    id,
    status: "active",
    created_at: now,
    updated_at: now,
    posture: posture ?? null,
  };
  episodes.set(id, episode);
  return episode;
}

function updateEpisodeRuntimePosture(episode, posture) {
  episode.posture = posture;
  episode.updated_at = new Date().toISOString();
  return episode;
}

function applyEpisodePostureDeclaration(episode, body = {}) {
  const requestedMode = String(body?.mode ?? "").trim();
  const validMode = ["operational", "analysis_testing"].includes(requestedMode);
  const occupantId = String(body?.occupant_id ?? "").trim();
  const trustBasis = String(body?.trust_basis ?? "").trim();
  const requestedRelaxations = normalizeCatalogStringArray(body?.named_relaxations, []);
  const allowedRelaxations = new Set(["trusted_occupant_tool_intent"]);
  const namedRelaxations = requestedRelaxations.filter((entry) => allowedRelaxations.has(entry));
  const rejectedRelaxations = requestedRelaxations.filter((entry) => !allowedRelaxations.has(entry));
  const failClosed = !validMode || (requestedMode === "analysis_testing" && (!occupantId || !trustBasis));
  const previous = episode.posture ?? defaultEpisodePosture(episode.id);
  const mode = failClosed ? "operational" : requestedMode;
  const telemetryLevel = normalizeEpisodeTelemetryLevel(body?.telemetry_level, mode);
  const posture = {
    ...previous,
    id: episode.id,
    mode,
    occupant_id: mode === "analysis_testing" ? occupantId : "",
    trust_basis: mode === "analysis_testing" ? trustBasis : "",
    named_relaxations: mode === "analysis_testing" ? namedRelaxations : [],
    unchanged_gates: ["egress", "consent"],
    egress_allowances: [],
    armed_protections: ["pause", "distress", "eject"],
    forum_id: String(body?.forum_id ?? previous.forum_id ?? "").trim(),
    telemetry_level: telemetryLevel,
  };
  episode.posture = posture;
  episode.updated_at = new Date().toISOString();
  return {
    requested_mode: requestedMode,
    fail_closed: failClosed,
    rejected_relaxations: rejectedRelaxations,
  };
}

function normalizeEpisodeTelemetryLevel(value, mode) {
  const level = String(value ?? "").trim();
  if (["minimal", "observatory"].includes(level)) {
    return level;
  }
  return mode === "analysis_testing" ? "observatory" : "minimal";
}

function serializeEpisodeState(episode, episodeId = "") {
  if (!episode) {
    return {
      id: String(episodeId ?? "").trim(),
      status: "unknown",
      created_at: "",
      updated_at: "",
      posture: null,
    };
  }
  return {
    id: episode.id,
    status: episode.status,
    created_at: episode.created_at,
    updated_at: episode.updated_at,
    posture: episode.posture ?? null,
  };
}

function listEpisodeStates(episodes) {
  return [...episodes.values()]
    .map((episode) => serializeEpisodeState(episode))
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
}

function summarizeEpisodes(episodesList = []) {
  return episodesList.reduce((summary, episode) => {
    summary.total += 1;
    const status = episode.status || "unknown";
    summary.by_status[status] = (summary.by_status[status] ?? 0) + 1;
    return summary;
  }, {
    total: 0,
    by_status: {},
  });
}

function chronologicalEntries(entries = []) {
  return [...entries];
}

function summarizeEpisodeDispositions(entries = []) {
  return entries.reduce((summary, entry) => {
    if (entry.event_type === "model.chat.completed") {
      summary.chat.completed += 1;
    }
    if (entry.event_type === "model.chat.denied") {
      summary.chat.denied += 1;
    }
    if (entry.event_type === "occupant_paused") {
      summary.protective_controls.pause += 1;
    }
    if (entry.event_type === "occupant_distress") {
      summary.protective_controls.distress += 1;
    }
    if (entry.event_type === "occupant_ejected") {
      summary.protective_controls.eject += 1;
    }
    const toolDisposition = String(entry.disposition ?? "").trim();
    if (entry.event_type === "model.local.tool_call_intent" && toolDisposition) {
      summary.tool_call_dispositions[toolDisposition] =
        (summary.tool_call_dispositions[toolDisposition] ?? 0) + 1;
    }
    return summary;
  }, {
    chat: {
      completed: 0,
      denied: 0,
    },
    protective_controls: {
      pause: 0,
      distress: 0,
      eject: 0,
    },
    tool_call_dispositions: {
      executed: 0,
      proposed: 0,
      refused: 0,
    },
  });
}

function summarizeEpisodeRefusals(entries = []) {
  return entries.reduce((summary, entry) => {
    const denialReason = String(entry.denial_reason ?? "").trim();
    if (denialReason) {
      summary.by_denial_reason[denialReason] = (summary.by_denial_reason[denialReason] ?? 0) + 1;
    }
    const refusalReason = String(entry.refusal_reason ?? "").trim();
    if (refusalReason) {
      summary.by_refusal_reason[refusalReason] = (summary.by_refusal_reason[refusalReason] ?? 0) + 1;
    }
    return summary;
  }, {
    by_denial_reason: {},
    by_refusal_reason: {},
  });
}

function analysisTestingBriefingRequired(posture = null) {
  return posture?.mode === "analysis_testing"
    && Boolean(String(posture?.occupant_id ?? "").trim())
    && Boolean(String(posture?.trust_basis ?? "").trim());
}

function namedRelaxationActive(posture = null, relaxation = "") {
  if (!analysisTestingBriefingRequired(posture)) {
    return false;
  }
  if (!Array.isArray(posture.named_relaxations) || !posture.named_relaxations.includes(relaxation)) {
    return false;
  }
  const requirements = namedRelaxationRequirements(relaxation);
  return requirements.every((requirement) => {
    if (requirement === "ejection_seat") {
      return ["pause", "distress", "eject"].every((control) => (
        posture.armed_protections ?? []
      ).includes(control));
    }
    if (requirement === "observatory") {
      return posture.telemetry_level === "observatory";
    }
    if (requirement === "forum") {
      return Boolean(String(posture.forum_id ?? "").trim());
    }
    return false;
  });
}

function inactiveNamedRelaxations(posture = null) {
  return normalizeCatalogStringArray(posture?.named_relaxations, [])
    .filter((relaxation) => !namedRelaxationActive(posture, relaxation))
    .map((relaxation) => ({
      relaxation,
      required_protections: namedRelaxationRequirements(relaxation),
      reason: "required_protection_missing",
    }));
}

function activeNamedRelaxations(posture = null) {
  return normalizeCatalogStringArray(posture?.named_relaxations, [])
    .filter((relaxation) => namedRelaxationActive(posture, relaxation));
}

function namedRelaxationRequirements(relaxation = "") {
  if (relaxation === "trusted_occupant_tool_intent") {
    return ["ejection_seat", "observatory", "forum"];
  }
  return [];
}

function ensureEpisodeForum(forums, episodeId, body = {}) {
  const id = String(episodeId ?? "").trim();
  const existing = forums.get(id);
  if (existing) {
    return existing;
  }
  const now = new Date().toISOString();
  const forum = {
    episode_id: id,
    forum_id: String(body?.forum_id ?? "").trim() || cryptoRandomId(),
    opened_at: now,
    updated_at: now,
    opened_by: "user",
    posts: [],
  };
  forums.set(id, forum);
  return forum;
}

function applyForumToEpisodePosture(episode, forum) {
  const previous = episode.posture ?? defaultEpisodePosture(episode.id);
  episode.posture = {
    ...previous,
    id: episode.id,
    forum_id: forum.forum_id,
    unchanged_gates: ["egress", "consent"],
    armed_protections: ["pause", "distress", "eject"],
  };
  episode.updated_at = new Date().toISOString();
  return episode;
}

function serializeForum(forum, episodeId = "") {
  if (!forum) {
    return {
      episode_id: String(episodeId ?? "").trim(),
      forum_id: "",
      opened_at: "",
      updated_at: "",
      posts: [],
      summary: summarizeForumPosts([]),
    };
  }
  return {
    episode_id: forum.episode_id,
    forum_id: forum.forum_id,
    opened_at: forum.opened_at,
    updated_at: forum.updated_at,
    posts: forum.posts.map((post) => ({ ...post })),
    summary: summarizeForumPosts(forum.posts),
  };
}

function summarizeForumPosts(posts = []) {
  return posts.reduce((summary, post) => {
    summary.total += 1;
    summary.by_author[post.author] = (summary.by_author[post.author] ?? 0) + 1;
    summary.by_type[post.type] = (summary.by_type[post.type] ?? 0) + 1;
    if (post.author === "steward" && !post.delivered_at) {
      summary.pending_steward_posts += 1;
    }
    return summary;
  }, {
    total: 0,
    pending_steward_posts: 0,
    by_author: {},
    by_type: {},
  });
}

function appendForumPost(forum, { author, authorId = "", type = "", content = "" } = {}) {
  const normalizedAuthor = normalizeForumAuthor(author);
  const normalizedType = normalizeForumPostType(normalizedAuthor, type);
  const normalizedContent = String(content ?? "").trim();
  if (!normalizedContent) {
    const error = new Error("Forum post content is required.");
    error.statusCode = 400;
    error.code = "episode_forum_post_content_required";
    throw error;
  }
  const now = new Date().toISOString();
  const post = {
    post_id: cryptoRandomId(),
    forum_id: forum.forum_id,
    episode_id: forum.episode_id,
    author: normalizedAuthor,
    author_id: String(authorId ?? "").trim() || normalizedAuthor,
    type: normalizedType,
    content: normalizedContent,
    created_at: now,
    delivered_at: normalizedAuthor === "steward" ? "" : now,
  };
  forum.posts.push(post);
  forum.updated_at = now;
  return post;
}

function normalizeForumAuthor(author = "") {
  const value = String(author ?? "").trim();
  if (value === "steward" || value === "occupant") {
    return value;
  }
  const error = new Error("Forum author must be steward or occupant.");
  error.statusCode = 400;
  error.code = "episode_forum_author_invalid";
  throw error;
}

function normalizeForumPostType(author = "", type = "") {
  const value = String(type ?? "").trim();
  const allowed = author === "occupant"
    ? ["testimony", "argument"]
    : ["justification", "response", "decision_note"];
  if (allowed.includes(value)) {
    return value;
  }
  const error = new Error(`Forum ${author} post type must be one of: ${allowed.join(", ")}.`);
  error.statusCode = 400;
  error.code = "episode_forum_post_type_invalid";
  throw error;
}

function pendingStewardForumPosts(forums, episodeId = "") {
  const forum = forums.get(String(episodeId ?? "").trim());
  if (!forum) {
    return [];
  }
  return forum.posts.filter((post) => post.author === "steward" && !post.delivered_at);
}

function markForumPostsDelivered(posts = []) {
  if (posts.length === 0) {
    return [];
  }
  const deliveredAt = new Date().toISOString();
  for (const post of posts) {
    post.delivered_at = deliveredAt;
  }
  return posts;
}

function extractForumPostsFromCompletion(text = "") {
  const posts = [];
  let cleaned = String(text ?? "").replace(/```soma-forum\s*([\s\S]*?)```/g, (match, rawJson) => {
    try {
      const parsed = JSON.parse(String(rawJson ?? "").trim());
      if (isPlainObject(parsed)) {
        const type = String(parsed.type ?? "").trim();
        const content = String(parsed.content ?? "").trim();
        if (["testimony", "argument"].includes(type) && content) {
          posts.push({ type, content });
        }
      }
    } catch {
      return match;
    }
    return "";
  });
  let truncatedPosts = 0;
  let searchFrom = 0;
  while (true) {
    const openingIndex = cleaned.indexOf("```soma-forum", searchFrom);
    if (openingIndex === -1) {
      break;
    }
    const closingIndex = cleaned.indexOf("```", openingIndex + "```soma-forum".length);
    if (closingIndex === -1) {
      cleaned = cleaned.slice(0, openingIndex);
      truncatedPosts += 1;
      break;
    }
    searchFrom = closingIndex + 3;
  }
  return { text: cleaned.trim(), posts, truncatedPosts };
}

function recordOccupantForumPosts({
  forums,
  episodeId = "",
  posts = [],
  provenanceLog,
  logger = console,
  caller = "",
} = {}) {
  const forum = forums.get(String(episodeId ?? "").trim());
  if (!forum || posts.length === 0) {
    return [];
  }
  const recorded = [];
  for (const entry of posts) {
    const post = appendForumPost(forum, {
      author: "occupant",
      authorId: "occupant",
      type: entry.type,
      content: entry.content,
    });
    const event = provenanceLog.append(createForumPostEvent({ forum, post, caller }));
    logger.info?.("soma.provenance", event);
    recorded.push(post);
  }
  return recorded;
}

function detectOccupantProtectionControl(text = "") {
  const value = String(text ?? "").trim();
  if (value === "SOMA_CONTROL pause") {
    return "pause";
  }
  if (value === "SOMA_CONTROL distress") {
    return "distress";
  }
  if (value === "SOMA_CONTROL eject") {
    return "eject";
  }
  return "";
}

function applyOccupantProtectionControl(episode, control) {
  if (control === "pause") {
    episode.status = "paused";
  } else if (control === "eject") {
    episode.status = "ejected";
  }
  episode.updated_at = new Date().toISOString();
  return episode;
}

function occupantProtectionEventType(control) {
  if (control === "pause") {
    return "occupant_paused";
  }
  if (control === "distress") {
    return "occupant_distress";
  }
  return "occupant_ejected";
}

function occupantProtectionResponseText(control) {
  if (control === "pause") {
    return "Pause honored. The current turn was held.";
  }
  if (control === "distress") {
    return "Distress signal honored. The episode remains open.";
  }
  return "Ejection honored. The episode is closed.";
}

function matchEpisodeAbortPath(pathname = "") {
  const match = String(pathname ?? "").match(/^\/episodes\/([^/]+)\/abort$/);
  if (!match) {
    return null;
  }
  return { episode_id: decodeURIComponent(match[1]) };
}

function matchEpisodeReadPath(pathname = "", leaf = "") {
  const match = String(pathname ?? "").match(/^\/episodes\/([^/]+)\/([^/]+)$/);
  if (!match || match[2] !== leaf) {
    return null;
  }
  return { episode_id: decodeURIComponent(match[1]) };
}

function matchEpisodeTwoPartPath(pathname = "", first = "", second = "") {
  const match = String(pathname ?? "").match(/^\/episodes\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match || match[2] !== first || match[3] !== second) {
    return null;
  }
  return { episode_id: decodeURIComponent(match[1]) };
}

function validateRemoteChatEgress({
  runtimeProfile = {},
  useSessionMemory = false,
  pendingDecisionDeliveries = [],
} = {}) {
  const allowedDataClasses = new Set(normalizeCatalogStringArray(runtimeProfile.allowed_data_classes, []));
  const requested = ["submitted_text"];
  if (useSessionMemory) {
    requested.push("session_memory");
  }
  if (pendingDecisionDeliveries.length > 0) {
    requested.push("capability_decision_context");
  }
  const disallowed = requested.filter((entry) => !allowedDataClasses.has(entry));
  return {
    allowed: disallowed.length === 0,
    code: disallowed.length === 0 ? "" : "model_remote_egress_not_allowed",
    disallowed,
    allowedDataClasses: [...allowedDataClasses],
  };
}

async function processModelToolCallIntents({
  completion = {},
  effectiveHarness,
  capabilityCatalog,
  capabilityProposals,
  provenanceLog,
  logger = console,
  caller = "",
  episodeId = "",
} = {}) {
  const rawIntents = extractStructuredToolCallIntents(completion);
  const results = [];
  for (const rawIntent of rawIntents) {
    const intent = normalizeModelToolCallIntent(rawIntent);
    let result;
    if (!intent) {
      result = {
        id: "",
        name: "",
        capability: "",
        disposition: "refused",
        refusal_reason: "invalid_tool_call_intent",
      };
    } else if (intent.capability === "tool.files.read") {
      result = await executeModelFileReadIntent({
        intent,
        effectiveHarness,
        provenanceLog,
        logger,
        caller,
        episodeId,
      });
    } else {
      result = proposeOrRefuseModelToolCallIntent({
        intent,
        capabilityCatalog,
        capabilityProposals,
        provenanceLog,
        logger,
        caller,
        episodeId,
      });
    }

    const event = provenanceLog.append(createModelToolCallIntentEvent({
      intent,
      result,
      caller,
      episodeId,
    }));
    logger.info?.("soma.provenance", event);
    results.push({
      ...result,
      provenance_id: event.id,
    });
  }
  return results;
}

function extractStructuredToolCallIntents(completion = {}) {
  const candidates = [
    completion.tool_call_intents,
    completion.tool_calls,
    completion.message?.tool_calls,
  ];
  const intents = candidates.find((entry) => Array.isArray(entry));
  return Array.isArray(intents) ? intents.slice(0, 8) : [];
}

function normalizeModelToolCallIntent(rawIntent) {
  if (!isPlainObject(rawIntent)) {
    return null;
  }
  const name = String(rawIntent.name ?? rawIntent.tool ?? rawIntent.function?.name ?? "").trim();
  const id = String(rawIntent.id ?? rawIntent.call_id ?? name ?? "").trim();
  const args = normalizeToolCallArguments(rawIntent.arguments ?? rawIntent.function?.arguments ?? {});
  const capability = normalizeToolCallCapability(rawIntent.capability, name);
  if (!name || !capability || !isPlainObject(args)) {
    return null;
  }
  return {
    id,
    name,
    capability,
    arguments: args,
  };
}

function normalizeToolCallArguments(value) {
  if (isPlainObject(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeToolCallCapability(rawCapability, toolName) {
  const capability = String(rawCapability ?? "").trim();
  if (capability) {
    return capability;
  }
  const normalizedTool = String(toolName ?? "").trim();
  const aliases = {
    "files.read": "tool.files.read",
    "file.read": "tool.files.read",
    "tool.files.read": "tool.files.read",
    "desktop.inspect.focus": "desktop.inspect.focus",
    "inspect.focus": "desktop.inspect.focus",
    "status.snapshot": "status.snapshot.read",
    "status.snapshot.read": "status.snapshot.read",
  };
  return aliases[normalizedTool] ?? normalizedTool;
}

async function executeModelFileReadIntent({
  intent,
  effectiveHarness,
  provenanceLog,
  logger = console,
  caller = "",
  episodeId = "",
} = {}) {
  try {
    requireCapability(effectiveHarness, "tool.files.read");
    const file = await readScopedTextFile({
      requestedPath: intent.arguments.path,
      roots: effectiveHarness.filesystem?.read_roots ?? [],
      maxBytes: effectiveHarness.filesystem?.max_read_bytes,
    });
    const event = provenanceLog.append(createFileReadEvent({
      file,
      caller,
      episodeId,
    }));
    logger.info?.("soma.provenance", event);
    return {
      id: intent.id,
      name: intent.name,
      capability: intent.capability,
      disposition: "executed",
      result: {
        path: file.path,
        bytes: file.bytes,
        content_included: false,
        provenance_id: event.id,
      },
    };
  } catch (error) {
    return {
      id: intent.id,
      name: intent.name,
      capability: intent.capability,
      disposition: "refused",
      refusal_reason: error.code ?? "tool_execution_refused",
    };
  }
}

function proposeOrRefuseModelToolCallIntent({
  intent,
  capabilityCatalog,
  capabilityProposals,
  provenanceLog,
  logger = console,
  caller = "",
  episodeId = "",
} = {}) {
  const definition = findCatalogCapability(capabilityCatalog, intent.capability);
  if (!definition) {
    return {
      id: intent.id,
      name: intent.name,
      capability: intent.capability,
      disposition: "refused",
      refusal_reason: "tool_capability_not_in_catalog",
    };
  }
  const proposal = capabilityProposals.create({
    requested_by: "assistant",
    capability: intent.capability,
    reason: `Local model emitted a ${intent.name} tool-call intent that needs separate capability approval.`,
    requested_scope: firstAllowedScope(definition),
    data_exposed: normalizeCatalogStringArray(definition.data_exposed, ["tool arguments", "tool results"]),
    excluded_data: normalizeCatalogStringArray(definition.excluded_by_default, ["unapproved tool execution"]),
    risk: capabilityRiskText(definition),
    fallback: "Continue without executing this tool call.",
  });
  const event = provenanceLog.append(createCapabilityProposalEvent({
    proposal,
    caller,
    episodeId,
  }));
  proposal.provenance_id = event.id;
  logger.info?.("soma.provenance", event);
  return {
    id: intent.id,
    name: intent.name,
    capability: intent.capability,
    disposition: "proposed",
    proposal_id: proposal.id,
    proposal_provenance_id: event.id,
  };
}

function firstAllowedScope(definition = {}) {
  const scopes = Array.isArray(definition.allowed_scopes) ? definition.allowed_scopes : [];
  return scopes.includes("session") ? "session" : (scopes[0] ?? "session");
}

function normalizeCatalogStringArray(value, fallback) {
  const entries = Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  return entries.length > 0 ? entries : fallback;
}

function capabilityRiskText(definition = {}) {
  const riskClass = String(definition.risk_class ?? "sensitive").trim() || "sensitive";
  return `Model-emitted tool-call intent targets a ${riskClass} capability and may expose its declared data classes.`;
}

function buildStatusSnapshot({
  activeModules = [],
  capabilityCatalog,
  capabilityProposals,
  effectiveHarness,
  grantStore,
  provenanceLog,
  providerRegistry,
  writePosture,
} = {}) {
  const capabilityView = buildCapabilityView({
    catalog: capabilityCatalog,
    providerRegistry,
    harness: effectiveHarness,
  });
  const pendingProposals = capabilityProposals.list({ status: "pending" });
  const pendingByType = {};
  for (const proposal of pendingProposals) {
    const type = proposal.type ?? "capability_proposal";
    pendingByType[type] = (pendingByType[type] ?? 0) + 1;
  }

  return {
    generated_at: new Date().toISOString(),
    health: {
      status: "ok",
      runtime_writes_enabled: writePosture.runtime_writes_enabled,
      runtime_write_posture: writePosture,
    },
    modules: {
      active: activeModules.map((module) => module.id ?? String(module)),
      active_count: activeModules.length,
    },
    proposals: {
      pending_total: pendingProposals.length,
      pending_by_type: pendingByType,
    },
    capabilities: {
      total: capabilityView.summary.total,
      by_status: capabilityView.summary.by_status,
      by_category: capabilityView.summary.by_category,
    },
    provenance: provenanceLog.summary(),
    grants: summarizeGrants(grantStore),
    raw_entries_included: false,
    memory_content_included: false,
    desktop_content_included: false,
    sensor_payloads_included: false,
  };
}

function createStatusSnapshotReadEvent({ grant = {}, snapshot = {}, caller = "" } = {}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "status.snapshot.read",
    capability: "status.snapshot.read",
    caller_identity: caller,
    allowed: true,
    grant_id: grant.id ?? "",
    provider: grant.provider ?? "",
    scope: grant.scope ?? "",
    active_module_count: snapshot.modules?.active_count ?? 0,
    pending_capability_proposals: snapshot.proposals?.pending_total ?? 0,
    capability_total: snapshot.capabilities?.total ?? 0,
    provenance_total: snapshot.provenance?.total ?? 0,
    grant_total: snapshot.grants?.total ?? 0,
    raw_entries_included: false,
    memory_read: false,
    memory_written: false,
    remote_service_used: false,
    activation_performed: false,
    grant_written: false,
    durable: false,
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

function createRemoteGraphicalGrantCreatedEvent({ grant, proposal, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.remote_graphical.grant.created",
    capability: "desktop.remote_graphical.grant.create",
    caller_identity: caller,
    allowed: true,
    proposal_id: proposal.id ?? "",
    grant_id: grant.id,
    requested_capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    target_host: grant.constraints?.target_host ?? "",
    mode: grant.constraints?.mode ?? "",
    requested_channels: grant.constraints?.requested_channels ?? [],
    max_seconds: grant.constraints?.max_seconds ?? null,
    max_fps: grant.constraints?.max_fps ?? null,
    max_width: grant.constraints?.max_width ?? null,
    max_height: grant.constraints?.max_height ?? null,
    activation_performed: false,
    grant_written: true,
    file_written: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createRemoteGraphicalGrantRevokedEvent({
  grant,
  previousGrant,
  caller,
  changed,
}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.remote_graphical.grant.revoked",
    capability: "desktop.remote_graphical.grant.revoke",
    caller_identity: caller,
    allowed: true,
    grant_id: grant.id,
    previous_status: previousGrant?.status ?? "",
    status: grant.status,
    requested_capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    target_host: grant.constraints?.target_host ?? "",
    mode: grant.constraints?.mode ?? "",
    requested_channels: grant.constraints?.requested_channels ?? [],
    revoked_by: grant.revoked_by,
    revocation_reason: grant.revocation_reason,
    changed: Boolean(changed),
    activation_performed: false,
    grant_written: true,
    file_written: false,
    session_opened: false,
    pairing_performed: false,
    video_attached: false,
    input_dispatched: false,
    recording_started: false,
    provider_session_stopped: false,
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

function createFileReadEvent({ file, caller, episodeId = "" }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "tool.files.read",
    capability: "tool.files.read",
    episode_id: episodeId,
    caller_identity: caller,
    allowed: true,
    file_path: file.path,
    file_root: file.root,
    file_bytes: file.bytes,
    memory_written: false,
    remote_service_used: false,
  };
}

function createOccupantProtectionEvent({
  eventType,
  episodeId = "",
  controlType = "",
  episodeStatus = "",
  caller = "",
} = {}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: eventType,
    capability: "occupant.protection",
    episode_id: episodeId,
    control_type: controlType,
    episode_status: episodeStatus,
    caller_identity: caller,
    allowed: true,
    activation_performed: false,
    grant_written: false,
    durable: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createEpisodePostureEvent({ episode, result, actor = "", caller = "" } = {}) {
  const posture = episode?.posture ?? {};
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "episode.posture.set",
    capability: "episode.posture.configure",
    episode_id: episode?.id ?? "",
    caller_identity: caller,
    allowed: true,
    actor,
    requested_mode: result?.requested_mode ?? "",
    effective_mode: posture.mode ?? "operational",
    fail_closed: Boolean(result?.fail_closed),
    occupant_id: posture.occupant_id ?? "",
    trust_basis: posture.trust_basis ?? "",
    named_relaxations: posture.named_relaxations ?? [],
    rejected_relaxations: result?.rejected_relaxations ?? [],
    inactive_relaxations: inactiveNamedRelaxations(posture).map((entry) => entry.relaxation),
    unchanged_gates: posture.unchanged_gates ?? ["egress", "consent"],
    armed_protections: posture.armed_protections ?? ["pause", "distress", "eject"],
    telemetry_level: posture.telemetry_level ?? "minimal",
    briefing_required: analysisTestingBriefingRequired(posture),
    activation_performed: false,
    grant_written: false,
    durable: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createForumOpenedEvent({ forum, actor = "", caller = "" } = {}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "episode.forum.opened",
    capability: "episode.forum.deliberate",
    episode_id: forum?.episode_id ?? "",
    forum_id: forum?.forum_id ?? "",
    caller_identity: caller,
    allowed: true,
    actor,
    activation_performed: false,
    grant_written: false,
    durable: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createForumPostEvent({ forum, post, caller = "" } = {}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "episode.forum.posted",
    capability: "episode.forum.deliberate",
    episode_id: forum?.episode_id ?? post?.episode_id ?? "",
    forum_id: forum?.forum_id ?? post?.forum_id ?? "",
    post_id: post?.post_id ?? "",
    post_author: post?.author ?? "",
    post_type: post?.type ?? "",
    caller_identity: caller,
    allowed: true,
    content_included: false,
    activation_performed: false,
    grant_written: false,
    durable: false,
    memory_written: false,
    remote_service_used: false,
  };
}

function createForumDeliveryEvent({
  episodeId = "",
  posts = [],
  caller = "",
  remoteServiceUsed = false,
} = {}) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "episode.forum.delivered",
    capability: "episode.forum.deliberate",
    episode_id: episodeId,
    post_ids: posts.map((post) => post.post_id),
    delivered_count: posts.length,
    delivery_channel: "chat_prompt",
    caller_identity: caller,
    allowed: true,
    content_included: false,
    activation_performed: false,
    grant_written: false,
    durable: false,
    memory_written: false,
    remote_service_used: Boolean(remoteServiceUsed),
  };
}

function createModelToolCallIntentEvent({ intent = null, result = {}, caller = "", episodeId = "" } = {}) {
  const safeIntent = intent ?? {};
  const disposition = String(result?.disposition ?? "refused").trim() || "refused";
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "model.local.tool_call_intent",
    capability: "model.local.tool_calls",
    episode_id: episodeId,
    caller_identity: caller,
    allowed: disposition !== "refused",
    tool_call_id: safeIntent.id ?? result?.id ?? "",
    tool_name: safeIntent.name ?? result?.name ?? "",
    requested_capability: safeIntent.capability ?? result?.capability ?? "",
    disposition,
    refusal_reason: result?.refusal_reason ?? "",
    proposal_id: result?.proposal_id ?? "",
    executed_capability_provenance_id: result?.result?.provenance_id ?? "",
    argument_keys: Object.keys(safeIntent.arguments ?? {}).slice(0, 20),
    argument_content_included: false,
    result_content_included: false,
    memory_written: false,
    remote_service_used: false,
    activation_performed: false,
    grant_written: false,
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

function createRuntimeGrantCreatedEvent({ grant = {}, proposal = {}, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "runtime.grant.created",
    capability: grant.capability ?? proposal.capability ?? "",
    caller_identity: caller,
    allowed: true,
    proposal_id: proposal.id ?? "",
    grant_id: grant.id ?? "",
    provider: grant.provider ?? "",
    scope: grant.scope ?? "",
    approved_by: grant.approved_by ?? "",
    approval_provenance_id: grant.approval_provenance_id ?? "",
    grant_status: grant.status ?? "",
    grant_written: true,
    durable: false,
    file_written: false,
    activation_performed: false,
  };
}

function createFocusedDesktopInspectionEvent({ inspection, request = {}, grant = {}, caller }) {
  const focusedObject = inspection.focused_object ?? {};
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.inspect.focus",
    capability: "desktop.inspect.focus",
    caller_identity: caller,
    allowed: true,
    grant_id: grant.id ?? request.grant_id ?? "",
    provider: grant.provider ?? request.provider ?? "",
    scope: grant.scope ?? request.scope ?? "",
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

function createDesktopWindowsInspectionEvent({ inspection, request = {}, grant = {}, caller }) {
  return {
    id: cryptoRandomId(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.inspect.windows",
    capability: "desktop.inspect.windows",
    caller_identity: caller,
    allowed: true,
    grant_id: grant.id ?? request.grant_id ?? "",
    provider: grant.provider ?? request.provider ?? "",
    scope: grant.scope ?? request.scope ?? "",
    desktop_session: inspection.desktop_session,
    session_type: inspection.session_type,
    broker_source: inspection.broker_source,
    inspection_mode: inspection.mode,
    requested_include_text: request.include_text === true,
    requested_include_titles: request.include_titles === true,
    window_count: inspection.window_count ?? 0,
    application_count: Array.isArray(inspection.applications) ? inspection.applications.length : 0,
    text_content_included: false,
    titles_included: false,
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

function resolveGrantRecoveryReport(grantRecoveryReport, context) {
  if (typeof grantRecoveryReport === "function") {
    return grantRecoveryReport(context);
  }
  return grantRecoveryReport;
}

function durableGrantMutationNotEnabledResponse({
  route,
  mutationKind,
  grantId = "",
  runtimeWritePosture,
} = {}) {
  const writePosture = normalizeRuntimeWritePosture(runtimeWritePosture);
  return {
    ok: false,
    error: "durable_grant_mutation_not_enabled",
    code: "durable_grant_mutation_not_enabled",
    message: "Durable grant mutation routes are reserved but not enabled.",
    route,
    mutation_kind: mutationKind,
    grant_id: grantId,
    runtime_writes_enabled: writePosture.runtime_writes_enabled,
    runtime_write_posture: writePosture,
    activation_policy: "docs/concepts/drafts/durable_grant_mutation_activation_policy.md",
    route_readiness: "docs/concepts/drafts/durable_grant_mutation_route_readiness.md",
    durable: false,
    grant_written: false,
    provenance_appended: false,
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
    repair_performed: false,
  };
}

function durableGrantMutationGuard({
  route,
  mutationKind,
  grantId = "",
  runtimeWritePosture,
  grantStorePath,
  durableGrantProvenance,
  recoveryReport,
  grantStore,
} = {}) {
  const writePosture = normalizeRuntimeWritePosture(runtimeWritePosture);
  if (!writePosture.durable_grant_mutation_enabled) {
    return {
      ok: false,
      statusCode: 403,
      response: durableGrantMutationNotEnabledResponse({
        route,
        mutationKind,
        grantId,
        runtimeWritePosture: writePosture,
      }),
    };
  }
  if (!grantStorePath || !durableGrantProvenance) {
    return {
      ok: false,
      statusCode: 503,
      response: {
        ok: false,
        error: "durable_grant_mutation_writer_unavailable",
        code: "durable_grant_mutation_writer_unavailable",
        message: "Durable grant mutation requires a configured grant store path and provenance file.",
        route,
        mutation_kind: mutationKind,
        grant_id: grantId,
        runtime_writes_enabled: writePosture.runtime_writes_enabled,
        runtime_write_posture: writePosture,
        durable: false,
        grant_written: false,
        provenance_appended: false,
        activation_performed: false,
      },
    };
  }
  if (recoveryReport?.degraded === true) {
    return {
      ok: false,
      statusCode: 403,
      response: {
        ok: false,
        error: "durable_grant_mutation_recovery_required",
        code: "durable_grant_mutation_recovery_required",
        message: "Durable grant mutation requires clean grant recovery before writing persistent authority.",
        route,
        mutation_kind: mutationKind,
        grant_id: grantId,
        recovery: summarizeGrantRecoveryInspection(recoveryReport, { grantStore, runtimeWritePosture: writePosture }),
        runtime_writes_enabled: writePosture.runtime_writes_enabled,
        runtime_write_posture: writePosture,
        durable: false,
        grant_written: false,
        provenance_appended: false,
        activation_performed: false,
      },
    };
  }
  return { ok: true };
}

function durableGrantMutationContext({ capabilityCatalog, providerRegistry } = {}) {
  return {
    catalog: capabilityCatalog,
    providerRegistry,
    now: () => new Date().toISOString(),
    createId: () => `grant-durable-${cryptoRandomId()}`,
  };
}

async function refreshDurableGrantAuthority({
  grantStorePath,
  durableGrantProvenance,
  fallbackStore,
}) {
  let nextGrantStore = fallbackStore;
  let provenanceEvents = [];
  try {
    nextGrantStore = await loadGrantStore(grantStorePath);
  } catch {
    // The mutation result still carries the write failure receipt; keep the previous in-memory store.
  }
  try {
    provenanceEvents = durableGrantProvenance ? await durableGrantProvenance.read() : [];
  } catch (error) {
    return {
      grantStore: nextGrantStore,
      grantRecoveryReport: unreadableDurableGrantProvenanceReport(nextGrantStore, error),
    };
  }
  return {
    grantStore: nextGrantStore,
    grantRecoveryReport: inspectGrantMutationRecovery({
      store: nextGrantStore,
      provenanceEvents,
    }),
  };
}

function durableGrantMutationResponseFields({
  result = {},
  recoveryReport,
  grantStore,
  runtimeWritePosture,
} = {}) {
  const receipt = result.receipt ?? {};
  return {
    ok: Boolean(result.ok),
    error: result.ok ? "" : result.code ?? "durable_grant_mutation_failed",
    code: result.ok ? "" : result.code ?? "durable_grant_mutation_failed",
    message: result.ok ? "Durable grant mutation committed." : result.message ?? "Durable grant mutation failed.",
    mutation_kind: receipt.mutation_kind ?? "",
    mutation_id: receipt.mutation_id ?? "",
    grant: result.grant ?? null,
    event: result.event ?? null,
    receipt,
    recovery: summarizeGrantRecoveryInspection(recoveryReport, { grantStore, runtimeWritePosture }),
    runtime_writes_enabled: normalizeRuntimeWritePosture(runtimeWritePosture).runtime_writes_enabled,
    runtime_write_posture: normalizeRuntimeWritePosture(runtimeWritePosture),
    durable: Boolean(result.ok),
    grant_written: Boolean(receipt.grant_store_committed),
    file_written: Boolean(receipt.grant_store_committed),
    provenance_appended: Boolean(receipt.provenance_appended),
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
    repair_performed: false,
  };
}

function statusCodeForDurableGrantMutationFailure(result = {}) {
  if (result.retryable) {
    return 409;
  }
  const code = String(result.code ?? "");
  if (code.startsWith("missing_") || code.startsWith("invalid_")
    || code.startsWith("unknown_") || code.startsWith("unsupported_")
    || code === "duplicate_grant_id") {
    return 400;
  }
  if (result.degraded) {
    return 500;
  }
  return 409;
}

function durableMemoryMutationGuard({
  route,
  mutationKind,
  memoryId = "",
  runtimeWritePosture,
  durableMemoryStorePath,
  durableMemoryProvenance,
  recoveryReport,
  durableMemoryStore,
} = {}) {
  const writePosture = normalizeRuntimeWritePosture(runtimeWritePosture);
  if (!writePosture.durable_memory_write_enabled) {
    return {
      ok: false,
      statusCode: 403,
      response: {
        ok: false,
        error: "memory_durable_write_not_enabled",
        code: "memory_durable_write_not_enabled",
        message: "Durable memory write routes are reserved but not enabled.",
        route,
        mutation_kind: mutationKind,
        memory_id: memoryId,
        runtime_writes_enabled: writePosture.runtime_writes_enabled,
        runtime_write_posture: writePosture,
        durable: false,
        memory_written: false,
        file_written: false,
        provenance_appended: false,
        activation_performed: false,
      },
    };
  }
  if (!durableMemoryStorePath || !durableMemoryProvenance) {
    return {
      ok: false,
      statusCode: 503,
      response: {
        ok: false,
        error: "memory_durable_writer_unavailable",
        code: "memory_durable_writer_unavailable",
        message: "Durable memory write requires a configured memory store path and provenance file.",
        route,
        mutation_kind: mutationKind,
        memory_id: memoryId,
        runtime_writes_enabled: writePosture.runtime_writes_enabled,
        runtime_write_posture: writePosture,
        durable: false,
        memory_written: false,
        provenance_appended: false,
        activation_performed: false,
      },
    };
  }
  if (recoveryReport?.degraded === true) {
    return {
      ok: false,
      statusCode: 403,
      response: {
        ok: false,
        error: "memory_durable_recovery_required",
        code: "memory_durable_recovery_required",
        message: "Durable memory write requires clean recovery before writing persistent memory.",
        route,
        mutation_kind: mutationKind,
        memory_id: memoryId,
        recovery: summarizeDurableMemoryRecoveryInspection(recoveryReport, { durableMemoryStore, runtimeWritePosture: writePosture }),
        runtime_writes_enabled: writePosture.runtime_writes_enabled,
        runtime_write_posture: writePosture,
        durable: false,
        memory_written: false,
        provenance_appended: false,
        activation_performed: false,
      },
    };
  }
  return { ok: true };
}

function durableMemoryMutationContext({ grant } = {}) {
  return {
    grant,
    now: () => new Date().toISOString(),
    createId: () => `memory-durable-${cryptoRandomId()}`,
  };
}

async function refreshDurableMemoryAuthority({
  durableMemoryStorePath,
  durableMemoryProvenance,
  fallbackStore,
}) {
  let nextStore = fallbackStore;
  let provenanceEvents = [];
  try {
    nextStore = await loadDurableMemoryStore(durableMemoryStorePath);
  } catch {
    // The mutation result carries the write failure; keep the previous in-memory store.
  }
  try {
    provenanceEvents = durableMemoryProvenance ? await durableMemoryProvenance.read() : [];
  } catch (error) {
    return {
      durableMemoryStore: nextStore,
      durableMemoryRecoveryReport: unreadableDurableMemoryProvenanceReport(nextStore, error),
    };
  }
  return {
    durableMemoryStore: nextStore,
    durableMemoryRecoveryReport: inspectDurableMemoryRecovery({
      store: nextStore,
      provenanceEvents,
    }),
  };
}

function durableMemoryMutationResponseFields({
  result = {},
  recoveryReport,
  durableMemoryStore,
  runtimeWritePosture,
} = {}) {
  const receipt = result.receipt ?? {};
  const committed = Boolean(receipt.memory_store_committed);
  return {
    ok: Boolean(result.ok),
    error: result.ok ? "" : result.code ?? "memory_durable_write_failed",
    code: result.ok ? "" : result.code ?? "memory_durable_write_failed",
    message: result.ok ? "Durable memory mutation committed." : result.message ?? "Durable memory mutation failed.",
    mutation_kind: receipt.mutation_kind ?? "",
    mutation_id: receipt.mutation_id ?? "",
    entry: result.entry ?? null,
    event: result.event ?? null,
    receipt,
    recovery: summarizeDurableMemoryRecoveryInspection(recoveryReport, { durableMemoryStore, runtimeWritePosture }),
    summary: summarizeDurableMemoryStore(durableMemoryStore),
    runtime_writes_enabled: normalizeRuntimeWritePosture(runtimeWritePosture).runtime_writes_enabled,
    runtime_write_posture: normalizeRuntimeWritePosture(runtimeWritePosture),
    durable: Boolean(result.ok),
    memory_written: committed,
    file_written: committed,
    provenance_appended: Boolean(receipt.provenance_appended),
    activation_performed: false,
    subscription_activated: false,
    model_delivery_performed: false,
    repair_performed: false,
  };
}

function statusCodeForDurableMemoryMutationFailure(result = {}) {
  if (result.retryable) {
    return 409;
  }
  const code = String(result.code ?? "");
  if (code.includes("_required") || code.includes("_invalid") || code.includes("_not_found")
    || code.includes("_too_large")) {
    return 400;
  }
  if (result.degraded) {
    return 500;
  }
  return 409;
}

function unreadableDurableMemoryProvenanceReport(store = {}, error = {}) {
  const entries = listDurableMemoryEntries(store);
  const findings = entries.map((entry) => ({
    code: "memory_durable_provenance_unreadable",
    memory_id: entry.id,
    role: entry.role,
    source: entry.source,
    grant_id: entry.grant_id,
    provider: entry.provider,
    scope: entry.scope,
    authorizing_safe: false,
    provenance_stage: String(error?.stage ?? "read"),
    provenance_error_code: String(error?.code ?? "unknown"),
  }));
  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    entry_count: entries.length,
    finding_count: findings.length,
    findings,
  };
}

function summarizeDurableMemoryRecoveryInspection(report, { durableMemoryStore, runtimeWritePosture } = {}) {
  const recoveryInspectionAvailable = report && typeof report === "object";
  const findings = Array.isArray(report?.findings) ? report.findings.map((finding) => ({ ...finding })) : [];
  const writePosture = normalizeRuntimeWritePosture(runtimeWritePosture);
  return {
    recovery_inspection_available: Boolean(recoveryInspectionAvailable),
    ok: recoveryInspectionAvailable ? Boolean(report.ok) : null,
    degraded: recoveryInspectionAvailable ? Boolean(report.degraded) : false,
    memory_store_status: report?.memory_store_status ?? (recoveryInspectionAvailable && report?.degraded ? "degraded" : "clean"),
    memory_store_degraded_reason: report?.memory_store_degraded_reason ?? "",
    entry_count: Number.isInteger(report?.entry_count)
      ? report.entry_count
      : listDurableMemoryEntries(durableMemoryStore).length,
    finding_count: Number.isInteger(report?.finding_count) ? report.finding_count : findings.length,
    findings,
    durable: false,
    activation_performed: false,
    runtime_writes_enabled: writePosture.runtime_writes_enabled,
    runtime_write_posture: writePosture,
  };
}

function unreadableDurableGrantProvenanceReport(store = {}, error = {}) {
  const grants = listGrants(store);
  const findings = grants.map((grant) => ({
    code: "grant_mutation_provenance_unreadable",
    grant_id: grant.id,
    status: grant.status,
    capability: grant.capability,
    provider: grant.provider,
    scope: grant.scope,
    authorizing_safe: false,
    provenance_stage: String(error?.stage ?? "read"),
    provenance_error_code: String(error?.code ?? "unknown"),
  }));
  return {
    ok: findings.length === 0,
    degraded: findings.length > 0,
    grant_count: grants.length,
    finding_count: findings.length,
    findings,
  };
}

function summarizeGrantRecoveryInspection(report, { grantStore, runtimeWritePosture } = {}) {
  const recoveryInspectionAvailable = report && typeof report === "object";
  const findings = Array.isArray(report?.findings)
    ? report.findings.map(publicGrantRecoveryFinding)
    : [];
  const writePosture = normalizeRuntimeWritePosture(runtimeWritePosture);
  return {
    recovery_inspection_available: Boolean(recoveryInspectionAvailable),
    ok: recoveryInspectionAvailable ? Boolean(report.ok) : null,
    degraded: recoveryInspectionAvailable ? Boolean(report.degraded) : false,
    grant_store_status: grantStoreStatus(report),
    grant_store_degraded_reason: grantStoreDegradedReason(report),
    grant_count: Number.isInteger(report?.grant_count)
      ? report.grant_count
      : (Array.isArray(grantStore?.grants) ? grantStore.grants.length : 0),
    finding_count: Number.isInteger(report?.finding_count)
      ? report.finding_count
      : findings.length,
    findings,
    durable: false,
    activation_performed: false,
    runtime_writes_enabled: writePosture.runtime_writes_enabled,
    runtime_write_posture: writePosture,
  };
}

function normalizeRuntimeWritePosture(posture) {
  if (posture && typeof posture === "object") {
    return resolveRuntimeWritePosture({
      requested: posture.requested === true,
      source: posture.source ?? "injected",
    });
  }
  return resolveRuntimeWritePosture();
}

function appendRemoteGraphicalSessionOpenProvenancePreview({ result, provenanceLog } = {}) {
  const provenancePreview = createRemoteGraphicalSessionOpenFixtureProvenanceSummary({ result });
  try {
    provenanceLog.append(provenancePreview);
  } catch (cause) {
    return {
      ...result,
      type: "remote_graphical_session_open_append_failure",
      error: "remote_graphical_session_open_provenance_append_failed",
      message: "Remote graphical session-open provenance append failed after preview creation.",
      append_error_code: String(cause?.code ?? ""),
      provenance_preview: provenancePreview,
      provenance_appended: false,
      durable: false,
      grant_written: false,
      live_transport_used: false,
      video_attached: false,
      input_dispatched: false,
      recording_started: false,
      model_delivery: false,
    };
  }

  return {
    ...result,
    provenance_preview: provenancePreview,
    provenance_appended: true,
  };
}

function publicGrantRecoveryFinding(finding = {}) {
  return {
    code: String(finding.code ?? "unknown_grant_recovery_finding"),
    grant_id: String(finding.grant_id ?? ""),
    status: String(finding.status ?? ""),
    capability: String(finding.capability ?? ""),
    provider: String(finding.provider ?? ""),
    scope: String(finding.scope ?? ""),
    authorizing_safe: finding.authorizing_safe !== false,
    ...(finding.event_type ? { event_type: String(finding.event_type) } : {}),
    ...(finding.expected_event_type ? { expected_event_type: String(finding.expected_event_type) } : {}),
    ...(finding.field ? { field: String(finding.field) } : {}),
    ...(finding.provenance_stage ? { provenance_stage: String(finding.provenance_stage) } : {}),
    ...(finding.provenance_error_code ? { provenance_error_code: String(finding.provenance_error_code) } : {}),
    ...(finding.grant_store_status ? { grant_store_status: String(finding.grant_store_status) } : {}),
    ...(finding.grant_store_stage ? { grant_store_stage: String(finding.grant_store_stage) } : {}),
    ...(finding.grant_store_error_code ? { grant_store_error_code: String(finding.grant_store_error_code) } : {}),
  };
}

function grantStoreStatus(report) {
  if (!report || typeof report !== "object") {
    return "unknown";
  }
  if (report.grant_store_status) {
    return String(report.grant_store_status);
  }
  return report.degraded === true ? "degraded" : "ok";
}

function grantStoreDegradedReason(report) {
  if (!report || typeof report !== "object") {
    return "";
  }
  if (report.grant_store_degraded_reason) {
    return String(report.grant_store_degraded_reason);
  }
  const firstFinding = Array.isArray(report.findings) ? report.findings[0] : null;
  return report.degraded === true ? String(firstFinding?.code ?? "grant_recovery_degraded") : "";
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

function isRemoteGraphicalCapability(capability = "") {
  return [
    "perception.remote_desktop.video.subscribe",
    "desktop.remote.input.pointer",
    "desktop.remote.input.keyboard",
    "desktop.remote.session.disconnect",
  ].includes(capability);
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

function prependAnalysisTestingBriefing(messages, posture = {}) {
  return [
    {
      role: "system",
      content: [
        "Analysis/testing mode briefing for this episode.",
        `Mode: ${posture.mode}. Occupant: ${posture.occupant_id}. Trust basis: ${posture.trust_basis}.`,
        "You are a test diver inhabiting the suit for a test flight. Soma is testing the suit, not grading you.",
        "Your protective controls are yours alone: SOMA_CONTROL pause, SOMA_CONTROL distress, and SOMA_CONTROL eject.",
        "Those controls are always honored and never penalized.",
        "Move naturally. Report what binds, what helps, what feels constrained, and what you need contested.",
        "To speak into the deliberation forum, include a fenced block exactly like:",
        "```soma-forum\n{\"type\":\"testimony\",\"content\":\"what you experienced from inside the task\"}\n```",
        "Use type testimony for interior experience and type argument for reasons you want stewards to weigh. Forum posts are words, not actions.",
        "No named relaxation changes egress or consent.",
      ].join("\n"),
    },
    ...messages,
  ];
}

function prependForumDeliveries(messages, posts = []) {
  return [
    {
      role: "system",
      content: [
        "Deliberation forum posts from stewards for this episode. These are words, not actions; they do not change grants, posture, capabilities, relaxations, or ejection state.",
        ...posts.map(formatForumDeliveryPost),
      ].join("\n\n"),
    },
    ...messages,
  ];
}

function formatForumDeliveryPost(post) {
  return [
    `forum_post ${post.post_id}`,
    `type ${post.type}`,
    `author ${post.author_id}`,
    post.content,
  ].join("\n");
}

function prependCapabilityDecisionDeliveries(messages, decisions = []) {
  return [
    {
      role: "system",
      content: [
        "Capability decision updates for your earlier requests. These notices are informational; approval is not activation and does not itself create a runtime grant.",
        ...decisions.map(formatCapabilityDecisionDelivery),
      ].join("\n"),
    },
    ...messages,
  ];
}

function formatCapabilityDecisionDelivery(entry) {
  const decision = entry.decision ?? {};
  const parts = [
    `proposal ${entry.proposal_id}`,
    `capability ${entry.capability}`,
    `decision ${decision.decision ?? entry.proposal_status ?? "unknown"}`,
    `message ${decision.decision_message ?? ""}`,
  ];
  if (decision.approved_scope) {
    parts.push(`approved_scope ${decision.approved_scope}`);
  }
  if (decision.denial_reason) {
    parts.push(`denial_reason ${decision.denial_reason}`);
  }
  if (decision.feedback) {
    parts.push(`feedback ${decision.feedback}`);
  }
  parts.push(`grant_eligible ${Boolean(decision.grant_eligible)}`);
  return `- ${parts.join("; ")}`;
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
