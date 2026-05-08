import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { buildCapabilityView } from "./capabilityCatalog.js";
import { assessCognitiveLoad } from "./cognitiveLoad.js";
import { CapabilityProposalStore, summarizeNotifications } from "./capabilityProposals.js";
import { inspectDesktopBrokerEnvironment, inspectFocusedDesktopObject } from "./desktopBroker.js";
import { assessEscalationTriggers } from "./escalationTriggers.js";
import { readScopedTextFile } from "./fileAccess.js";
import { listGrants, summarizeGrants } from "./grants.js";
import { requireCapability } from "./harness.js";
import {
  adoptSelfApplyModule,
  applyActiveModules,
  dropModule,
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
        const inspection = await inspectDesktopBrokerEnvironment({
          mode: body.mode,
          maxApps: body.max_apps,
          maxChildren: body.max_children,
        });
        const event = provenanceLog.append(createDesktopInspectionEvent({
          inspection,
          request: body,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
        writeJson(res, 200, {
          inspection,
          provenance_id: event.id,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/desktop/inspect/focus") {
        requireCapability(effectiveHarness, "desktop.inspect.focus");
        const body = await readJson(req);
        if (body.include_text === true) {
          const error = new Error("Focused desktop inspection does not include text content.");
          error.statusCode = 403;
          error.code = "focused_desktop_text_not_allowed";
          throw error;
        }
        const inspection = await inspectFocusedDesktopObject();
        const event = provenanceLog.append(createFocusedDesktopInspectionEvent({
          inspection,
          request: body,
          caller: req.headers["x-soma-caller"] ?? "",
        }));
        logger.info?.("soma.provenance", event);
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

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
