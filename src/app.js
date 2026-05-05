import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { assessCognitiveLoad } from "./cognitiveLoad.js";
import { inspectDesktopBrokerEnvironment } from "./desktopBroker.js";
import { readScopedTextFile } from "./fileAccess.js";
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
  moduleRegistry,
  runtimeProfiles,
  modelClient,
  sessionMemory,
  provenanceLog,
  logger = console,
} = {}) {
  return createServer(createRequestHandler({
    harness,
    moduleRegistry,
    runtimeProfiles,
    modelClient,
    sessionMemory,
    provenanceLog,
    logger,
  }));
}

export function createRequestHandler({
  harness,
  moduleRegistry = { schema_version: 1, modules: [] },
  runtimeProfiles,
  modelClient,
  sessionMemory = new SessionMemory(),
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

      if (req.method === "GET" && url.pathname === "/harness-modules") {
        writeJson(res, 200, {
          modules: listVisibleModules(moduleRegistry),
          active_modules: activeModules,
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

      if (req.method === "POST" && url.pathname === "/chat") {
        const body = await readJson(req);
        const messages = normalizeMessages(body.messages);
        const useSessionMemory = Boolean(body.use_session_memory);
        const writeSessionMemory = Boolean(body.write_session_memory);
        const assessLoad = Boolean(body.assess_cognitive_load);
        let cognitiveLoadAssessment = null;
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

        const allowedProvenance = {
          ...provenance,
          event_type: "model.chat.completed",
          allowed: true,
        };
        provenanceLog.append(allowedProvenance);
        logger.info?.("soma.provenance", allowedProvenance);

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
