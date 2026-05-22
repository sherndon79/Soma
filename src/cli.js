#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_SOMA_URL = "http://127.0.0.1:8765";

export function parseCli(argv) {
  const args = argv.slice(2);
  const flags = parseFlags(args);
  const [command = "help", subcommand = "", ...rest] = flags.positionals;

  return {
    command,
    subcommand,
    rest,
    flags: flags.values,
    baseUrl: flags.values.url ?? process.env.SOMA_URL ?? DEFAULT_SOMA_URL,
  };
}

export async function runCli(parsed, { stdout = process.stdout, stderr = process.stderr, request = apiRequest } = {}) {
  const { command, subcommand, rest, flags, baseUrl } = parsed;
  const jsonOutput = Boolean(flags.json);

  if (command === "help" || flags.help) {
    stdout.write(helpText());
    return 0;
  }

  if (command === "status") {
    const [health, harness, modules, pendingProposals, provenance] = await Promise.all([
      request(baseUrl, "GET", "/health"),
      request(baseUrl, "GET", "/harness"),
      request(baseUrl, "GET", "/harness-modules"),
      request(baseUrl, "GET", "/capability-proposals?status=pending"),
      request(baseUrl, "GET", "/provenance/summary"),
    ]);
    const proposalSummaries = pendingProposalSummaries(pendingProposals.proposals);
    writeOutput(stdout, {
      health,
      harness_id: harness.harness_id,
      mode: harness.mode,
      default_runtime_profile: harness.runtime_profiles?.default_profile,
      active_modules: modules.active_modules,
      pending_capability_proposals: proposalSummaries.length,
      pending_capability_proposal_details: proposalSummaries,
      provenance_summary: provenance.summary,
    }, jsonOutput);
    return 0;
  }

  if (command === "chat") {
    const content = [subcommand, ...rest].join(" ").trim();
    if (!content) {
      throw usageError("chat requires a message.");
    }
    const response = await request(baseUrl, "POST", "/chat", {
      messages: [{ role: "user", content }],
      model_profile: flags.profile,
      max_tokens: numberFlag(flags["max-tokens"]),
      temperature: numberFlag(flags.temperature),
      use_session_memory: Boolean(flags.memory),
      write_session_memory: Boolean(flags["write-memory"]),
      assess_cognitive_load: Boolean(flags["assess-load"]),
      assess_escalation: Boolean(flags["assess-escalation"]),
    });
    writeOutput(stdout, response, jsonOutput, response.text);
    return 0;
  }

  if (command === "modules") {
    if (subcommand === "list" || !subcommand) {
      writeOutput(stdout, await request(baseUrl, "GET", "/harness-modules"), jsonOutput);
      return 0;
    }
    if (subcommand === "adopt" || subcommand === "drop") {
      const moduleId = rest[0];
      if (!moduleId) {
        throw usageError(`modules ${subcommand} requires a module id.`);
      }
      writeOutput(stdout, await request(baseUrl, "POST", `/harness-modules/${subcommand}`, {
        module_id: moduleId,
      }), jsonOutput);
      return 0;
    }
  }

  if (command === "capabilities") {
    const response = await request(baseUrl, "GET", "/capability-view");
    writeOutput(stdout, response, jsonOutput, capabilityViewSummary(response));
    return 0;
  }

  if (command === "notifications") {
    const query = new URLSearchParams();
    if (flags.status) {
      query.set("status", String(flags.status));
    }
    const suffix = query.size > 0 ? `?${query}` : "";
    const response = await request(baseUrl, "GET", `/notifications${suffix}`);
    writeOutput(stdout, response, jsonOutput, notificationSummary(response));
    return 0;
  }

  if (command === "proposals") {
    if (subcommand === "list" || !subcommand) {
      const query = new URLSearchParams();
      if (flags.status) {
        query.set("status", String(flags.status));
      }
      const suffix = query.size > 0 ? `?${query}` : "";
      const response = await request(baseUrl, "GET", `/capability-proposals${suffix}`);
      writeOutput(stdout, response, jsonOutput, proposalListSummary(response));
      return 0;
    }
    if (subcommand === "show") {
      const proposalId = rest[0];
      if (!proposalId) {
        throw usageError("proposals show requires a proposal id.");
      }
      const response = await request(baseUrl, "GET", `/capability-proposals/${proposalId}`);
      writeOutput(stdout, response, jsonOutput, proposalDetailSummary(response));
      return 0;
    }
    if (subcommand === "approve" || subcommand === "deny") {
      const proposalId = rest[0];
      if (!proposalId) {
        throw usageError(`proposals ${subcommand} requires a proposal id.`);
      }
      const body = subcommand === "approve"
        ? { approved_scope: flags.scope ?? "session", decided_by: flags.by ?? "user" }
        : { reason: flags.reason, decided_by: flags.by ?? "user" };
      const response = await request(baseUrl, "POST", `/capability-proposals/${proposalId}/${subcommand}`, body);
      writeOutput(stdout, response, jsonOutput, proposalDecisionSummary(response));
      return 0;
    }
  }

  if (command === "grants") {
    if (subcommand === "recovery") {
      const response = await request(baseUrl, "GET", "/grants/recovery");
      writeOutput(stdout, response, jsonOutput, grantRecoverySummary(response));
      return 0;
    }
    if (subcommand === "preview-create") {
      const response = await request(
        baseUrl,
        "POST",
        "/grants/mutation-previews",
        grantPreviewCreateRequestFromFlags(flags),
      );
      writeOutput(stdout, response, jsonOutput, grantMutationPreviewSummary(response));
      return 0;
    }
    if (subcommand === "preview-revoke") {
      const grantId = rest[0];
      if (!grantId) {
        throw usageError("grants preview-revoke requires a grant id.");
      }
      const response = await request(
        baseUrl,
        "POST",
        "/grants/mutation-previews",
        grantPreviewRevokeRequestFromFlags(grantId, flags),
      );
      writeOutput(stdout, response, jsonOutput, grantMutationPreviewSummary(response));
      return 0;
    }
    if (subcommand === "list" || !subcommand) {
      const query = new URLSearchParams();
      if (flags.status) {
        query.set("status", String(flags.status));
      }
      const suffix = query.size > 0 ? `?${query}` : "";
      const response = await request(baseUrl, "GET", `/grants${suffix}`);
      writeOutput(stdout, response, jsonOutput, grantListSummary(response));
      return 0;
    }
  }

  if (command === "sensorium" && subcommand === "proposal-template") {
    const response = await request(baseUrl, "POST", "/sensorium/proposal-template", sensoriumProposalTemplateRequestFromFlags(flags));
    writeOutput(stdout, response, jsonOutput, sensoriumProposalTemplateSummary(response));
    return 0;
  }

  if (command === "sensorium" && subcommand === "propose") {
    const response = await request(baseUrl, "POST", "/sensorium/proposals", sensoriumProposalTemplateRequestFromFlags(flags));
    writeOutput(stdout, response, jsonOutput, sensoriumProposalCreatedSummary(response));
    return 0;
  }

  if (command === "sensorium" && subcommand === "grant-create") {
    const proposalId = rest[0];
    if (!proposalId) {
      throw usageError("sensorium grant-create requires a proposal id.");
    }
    const response = await request(baseUrl, "POST", "/sensorium/grants", {
      proposal_id: proposalId,
      actor: flags.by ?? "user",
    });
    writeOutput(stdout, response, jsonOutput, sensoriumGrantCreatedSummary(response));
    return 0;
  }

  if (command === "sensorium" && subcommand === "grant-revoke") {
    const grantId = rest[0];
    if (!grantId) {
      throw usageError("sensorium grant-revoke requires a grant id.");
    }
    const reason = String(flags.reason ?? "").trim();
    if (!reason) {
      throw usageError("sensorium grant-revoke requires --reason text.");
    }
    const response = await request(baseUrl, "POST", `/sensorium/grants/${grantId}/revoke`, {
      actor: flags.by ?? "user",
      reason,
    });
    writeOutput(stdout, response, jsonOutput, sensoriumGrantRevokedSummary(response));
    return 0;
  }

  if (command === "sensorium" && subcommand === "subscribe-start") {
    const response = await request(baseUrl, "POST", "/sensorium/subscriptions", sensoriumSubscribeStartRequestFromFlags(flags));
    writeOutput(stdout, response, jsonOutput, sensoriumSubscriptionStartedSummary(response));
    return 0;
  }

  if (command === "sensorium" && subcommand === "subscribe-stop") {
    const subscriptionId = rest[0];
    if (!subscriptionId) {
      throw usageError("sensorium subscribe-stop requires a subscription id.");
    }
    const response = await request(baseUrl, "DELETE", `/sensorium/subscriptions/${subscriptionId}`);
    writeOutput(stdout, response, jsonOutput, sensoriumSubscriptionStoppedSummary(response));
    return 0;
  }

  if (command === "sensorium" && (subcommand === "subscriptions" || subcommand === "subscriptions-list")) {
    const response = await request(baseUrl, "GET", "/sensorium/subscriptions");
    writeOutput(stdout, response, jsonOutput, sensoriumSubscriptionsSummary(response));
    return 0;
  }

  if (command === "sensorium" && subcommand === "status") {
    const response = await request(baseUrl, "GET", "/sensorium/subscriptions");
    const statusView = sensoriumStatusView(response);
    writeOutput(stdout, statusView, jsonOutput, sensoriumStatusSummary(statusView));
    return 0;
  }

  if (command === "model-visual" && subcommand === "review") {
    const response = await request(
      baseUrl,
      "POST",
      "/model-visual/review-text",
      modelVisualReviewTextRequestFromFlags(flags),
    );
    writeOutput(stdout, response, jsonOutput, response.text);
    return 0;
  }

  if (command === "model-visual" && subcommand === "attach-dry-run") {
    const response = await request(
      baseUrl,
      "POST",
      "/model-visual/attach-requests/dry-run",
      modelVisualAttachDryRunRequestFromFlags(flags),
    );
    writeOutput(stdout, response, jsonOutput, modelVisualAttachDryRunSummary(response));
    return 0;
  }

  if (command === "memory") {
    if (subcommand === "list" || !subcommand) {
      writeOutput(stdout, await request(baseUrl, "GET", "/session-memory"), jsonOutput);
      return 0;
    }
    if (subcommand === "add") {
      const content = rest.join(" ").trim();
      if (!content) {
        throw usageError("memory add requires content.");
      }
      writeOutput(stdout, await request(baseUrl, "POST", "/session-memory", {
        role: flags.role ?? "note",
        source: flags.source ?? "manual",
        content,
      }), jsonOutput);
      return 0;
    }
    if (subcommand === "clear") {
      writeOutput(stdout, await request(baseUrl, "DELETE", "/session-memory"), jsonOutput);
      return 0;
    }
  }

  if (command === "provenance") {
    if (subcommand === "summary" || !subcommand) {
      const response = await request(baseUrl, "GET", "/provenance/summary");
      writeOutput(stdout, response, jsonOutput, provenanceSummaryText(response));
      return 0;
    }
    if (subcommand === "list") {
      const query = new URLSearchParams();
      if (flags.allowed !== undefined) {
        query.set("allowed", String(flags.allowed));
      }
      if (flags.capability) {
        query.set("capability", flags.capability);
      }
      if (flags["event-type"]) {
        query.set("event_type", flags["event-type"]);
      }
      if (flags.limit) {
        query.set("limit", String(flags.limit));
      }
      const suffix = query.size > 0 ? `?${query}` : "";
      const response = await request(baseUrl, "GET", `/provenance${suffix}`);
      writeOutput(stdout, response, jsonOutput, provenanceListSummary(response));
      return 0;
    }
    if (subcommand === "clear") {
      writeOutput(stdout, await request(baseUrl, "DELETE", "/provenance"), jsonOutput);
      return 0;
    }
  }

  if (command === "files" && subcommand === "read") {
    const filePath = rest[0];
    if (!filePath) {
      throw usageError("files read requires a path.");
    }
    const response = await request(baseUrl, "POST", "/files/read", {
      path: filePath,
    });
    writeOutput(stdout, response, jsonOutput, response.content);
    return 0;
  }

  if (command === "desktop" && subcommand === "inspect") {
    const inspectRequest = desktopInspectRequestFromFlags(flags);
    const response = await request(baseUrl, "POST", "/desktop/inspect/accessibility-tree", {
      mode: inspectRequest.mode,
      max_apps: inspectRequest.max_apps,
      max_children: inspectRequest.max_children,
    });
    writeOutput(stdout, response, jsonOutput, desktopInspectionSummary(response));
    return 0;
  }

  if (command === "desktop" && subcommand === "focus") {
    const response = await request(baseUrl, "POST", "/desktop/inspect/focus", {
      include_text: flags["include-text"],
    });
    writeOutput(stdout, response, jsonOutput, focusedDesktopInspectionSummary(response));
    return 0;
  }

  if (command === "stewardship" && subcommand === "assess") {
    const content = rest.join(" ").trim();
    if (!content) {
      throw usageError("stewardship assess requires text.");
    }
    writeOutput(stdout, await request(baseUrl, "POST", "/stewardship/cognitive-load", {
      messages: [{ role: "user", content }],
    }), jsonOutput);
    return 0;
  }

  throw usageError(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

async function apiRequest(baseUrl, method, path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: body ? {
      "content-type": "application/json",
      "x-soma-caller": "soma-cli",
    } : {
      "x-soma-caller": "soma-cli",
    },
    body: body ? JSON.stringify(stripUndefined(body)) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `Soma request failed with HTTP ${response.status}.`);
    error.code = payload.error ?? "request_failed";
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function parseFlags(args) {
  const values = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, rawValue] = arg.slice(2).split("=", 2);
    const next = args[index + 1];
    if (rawValue !== undefined) {
      values[rawKey] = coerceFlag(rawValue);
    } else if (next && !next.startsWith("--")) {
      values[rawKey] = coerceFlag(next);
      index += 1;
    } else {
      values[rawKey] = true;
    }
  }

  return { values, positionals };
}

function coerceFlag(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}

function numberFlag(value) {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function desktopInspectRequestFromFlags(flags) {
  if (flags.mode !== undefined && !["environment", "atspi"].includes(flags.mode)) {
    throw usageError("desktop inspect --mode must be environment or atspi.");
  }
  return {
    mode: flags.mode,
    max_apps: integerFlagInRange(flags["max-apps"], "--max-apps", 1, 64),
    max_children: integerFlagInRange(flags["max-children"], "--max-children", 0, 8),
  };
}

function integerFlagInRange(value, flagName, minimum, maximum) {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw usageError(`desktop inspect ${flagName} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function sensoriumProposalTemplateRequestFromFlags(flags) {
  const constraints = stripUndefined({
    max_seconds: integerFlag(flags["max-seconds"], "--max-seconds", 1, 3600, "sensorium proposal-template"),
    max_fps: integerFlag(flags["max-fps"], "--max-fps", 1, 30, "sensorium proposal-template"),
    format_required: flags.format,
    downsample_to: dimensionFlag(flags.downsample, "--downsample"),
  });

  return stripUndefined({
    requested_by: flags.by,
    capability: requiredFlag(flags.capability, "--capability", "sensorium proposal-template"),
    provider: requiredFlag(flags.provider, "--provider", "sensorium proposal-template"),
    topic: requiredFlag(flags.topic, "--topic", "sensorium proposal-template"),
    requested_scope: flags.scope ?? "session",
    reason: requiredFlag(flags.reason, "--reason", "sensorium proposal-template"),
    fallback: flags.fallback,
    constraints,
  });
}

function sensoriumSubscribeStartRequestFromFlags(flags) {
  const constraints = stripUndefined({
    max_seconds: integerFlag(flags["max-seconds"], "--max-seconds", 1, 3600, "sensorium subscribe-start"),
    max_fps: integerFlag(flags["max-fps"], "--max-fps", 1, 30, "sensorium subscribe-start"),
    format_required: flags.format,
    downsample_to: dimensionFlag(flags.downsample, "--downsample", "sensorium subscribe-start"),
  });

  return stripUndefined({
    capability: requiredFlag(flags.capability, "--capability", "sensorium subscribe-start"),
    topic: requiredFlag(flags.topic, "--topic", "sensorium subscribe-start"),
    scope: flags.scope ?? "session",
    constraints,
  });
}

function modelVisualReviewTextRequestFromFlags(flags) {
  const kind = requiredFlag(flags.kind, "--kind", "model-visual review");
  if (!["proposal", "grant_candidate"].includes(kind)) {
    throw usageError("model-visual review --kind must be proposal or grant_candidate.");
  }

  const reviewJson = requiredFlag(flags["review-json"], "--review-json", "model-visual review");
  let reviewResponse;
  try {
    reviewResponse = JSON.parse(reviewJson);
  } catch {
    throw usageError("model-visual review --review-json must be valid JSON.");
  }
  if (!isPlainObject(reviewResponse)) {
    throw usageError("model-visual review --review-json must decode to an object.");
  }

  return {
    kind,
    review_response: reviewResponse,
  };
}

function modelVisualAttachDryRunRequestFromFlags(flags) {
  const requestJson = requiredFlag(flags["request-json"], "--request-json", "model-visual attach-dry-run");
  let requestBody;
  try {
    requestBody = JSON.parse(requestJson);
  } catch {
    throw usageError("model-visual attach-dry-run --request-json must be valid JSON.");
  }
  if (!isPlainObject(requestBody)) {
    throw usageError("model-visual attach-dry-run --request-json must decode to an object.");
  }
  return requestBody;
}

function grantPreviewCreateRequestFromFlags(flags) {
  return {
    kind: "grant.created",
    mutation_id: flags["mutation-id"],
    input: stripUndefined({
      capability: requiredFlag(flags.capability, "--capability", "grants preview-create"),
      provider: requiredFlag(flags.provider, "--provider", "grants preview-create"),
      scope: flags.scope ?? "session",
      constraints: jsonObjectFlag(flags["constraints-json"], "--constraints-json", "grants preview-create") ?? {},
      approved_by: flags.by ?? "user",
      approval_provenance_id: flags["approval-provenance-id"],
      direct_user_action: flags["approval-provenance-id"] ? undefined : true,
      reason: requiredFlag(flags.reason, "--reason", "grants preview-create"),
    }),
  };
}

function grantPreviewRevokeRequestFromFlags(grantId, flags) {
  return {
    kind: "grant.revoked",
    mutation_id: flags["mutation-id"],
    input: {
      id: grantId,
      actor: flags.by ?? "user",
      reason: requiredFlag(flags.reason, "--reason", "grants preview-revoke"),
    },
  };
}

function jsonObjectFlag(value, flagName, commandName) {
  if (value === undefined) {
    return undefined;
  }
  let decoded;
  try {
    decoded = JSON.parse(String(value));
  } catch {
    throw usageError(`${commandName} ${flagName} must be valid JSON.`);
  }
  if (!isPlainObject(decoded)) {
    throw usageError(`${commandName} ${flagName} must decode to an object.`);
  }
  return decoded;
}

function requiredFlag(value, flagName, commandName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw usageError(`${commandName} requires ${flagName}.`);
  }
  return normalized;
}

function integerFlag(value, flagName, minimum, maximum, commandName) {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw usageError(`${commandName} ${flagName} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function dimensionFlag(value, flagName, commandName = "sensorium proposal-template") {
  if (value === undefined) {
    return undefined;
  }
  const normalized = String(value).trim();
  const parts = normalized.includes("x") ? normalized.split("x") : normalized.split(",");
  const dimensions = parts.map((part) => Number(part));
  if (
    dimensions.length !== 2 ||
    dimensions.some((dimension) => !Number.isInteger(dimension) || dimension < 16 || dimension > 1920)
  ) {
    throw usageError(`${commandName} ${flagName} must be WIDTHxHEIGHT with each dimension 16..1920.`);
  }
  return dimensions;
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function writeOutput(stdout, payload, jsonOutput, textOutput = "") {
  if (jsonOutput || !textOutput) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  stdout.write(`${textOutput}\n`);
}

function desktopInspectionSummary(response) {
  const inspection = response.inspection ?? {};
  const tree = inspection.tree ?? {};
  const applications = Array.isArray(tree.applications) ? tree.applications : [];
  const rootObjects = applications.filter((application) => application.root_object).length;
  const childMetadataCount = applications.reduce((count, application) => {
    const sample = application.root_object?.child_metadata_sample;
    return count + (Array.isArray(sample) ? sample.length : 0);
  }, 0);

  const lines = [
    "Desktop inspection",
    `  mode: ${inspection.mode ?? "unknown"}`,
    `  broker: ${inspection.broker_source ?? "unknown"}`,
    `  session: ${inspection.desktop_session ?? "unknown"} (${inspection.session_type ?? "unknown"})`,
    `  tree available: ${booleanText(inspection.tree_available)}`,
    `  applications: ${inspection.application_count ?? applications.length}`,
    `  root objects: ${inspection.root_object_available_count ?? rootObjects}`,
    `  shallow child metadata: ${childMetadataCount}`,
    `  windows: ${inspection.window_count ?? 0}`,
    `  text content included: ${booleanText(tree.text_content_included)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
  ];

  if (inspection.unavailable_reason) {
    lines.splice(5, 0, `  unavailable reason: ${inspection.unavailable_reason}`);
  }

  return lines.join("\n");
}

function focusedDesktopInspectionSummary(response) {
  const inspection = response.inspection ?? {};
  const focusedObject = inspection.focused_object ?? {};
  const lines = [
    "Focused desktop object",
    `  available: ${booleanText(inspection.focus_available)}`,
    `  broker: ${inspection.broker_source ?? "unknown"}`,
    `  session: ${inspection.desktop_session ?? "unknown"} (${inspection.session_type ?? "unknown"})`,
    `  role: ${focusedObject.role ?? "none"}`,
    `  child count: ${focusedObject.child_count ?? 0}`,
    `  text content included: ${booleanText(inspection.text_content_included)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
  ];
  if (inspection.unavailable_reason) {
    lines.splice(4, 0, `  unavailable reason: ${inspection.unavailable_reason}`);
  }
  return lines.join("\n");
}

function booleanText(value) {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "unknown";
}

function provenanceListSummary(response) {
  const entries = Array.isArray(response.entries) ? response.entries : [];
  if (entries.length === 0) {
    return "Provenance entries\n  none";
  }

  const lines = ["Provenance entries"];
  for (const entry of entries) {
    lines.push(formatProvenanceEntry(entry));
  }
  return lines.join("\n");
}

function formatProvenanceEntry(entry) {
  const status = entry.allowed === false ? "denied" : "allowed";
  const parts = [
    `  ${entry.timestamp ?? "unknown-time"}`,
    `[${status}]`,
    entry.event_type ?? "unknown-event",
    `capability=${entry.capability ?? "unknown"}`,
  ];

  if (entry.id) {
    parts.push(`id=${entry.id}`);
  }
  if (entry.inspection_mode) {
    parts.push(`mode=${entry.inspection_mode}`);
  }
  if (entry.requested_mode) {
    parts.push(`requested=${entry.requested_mode}`);
  }
  if (entry.requested_max_apps !== undefined && entry.requested_max_apps !== null) {
    parts.push(`max_apps=${entry.requested_max_apps}`);
  }
  if (entry.requested_max_children !== undefined && entry.requested_max_children !== null) {
    parts.push(`max_children=${entry.requested_max_children}`);
  }
  if (entry.application_count !== undefined && entry.application_count !== null) {
    parts.push(`apps=${entry.application_count}`);
  }
  if (entry.root_object_available_count !== undefined && entry.root_object_available_count !== null) {
    parts.push(`roots=${entry.root_object_available_count}`);
  }
  if (entry.denial_reason) {
    parts.push(`reason=${entry.denial_reason}`);
  }

  return parts.join(" ");
}

function provenanceSummaryText(response) {
  const summary = response.summary ?? {};
  const lines = [
    "Provenance summary",
    `  total: ${summary.total ?? 0}`,
    `  allowed: ${summary.allowed ?? 0}`,
    `  denied: ${summary.denied ?? 0}`,
    `  memory read: ${summary.memory_read ?? 0}`,
    `  memory written: ${summary.memory_written ?? 0}`,
    `  remote service used: ${summary.remote_service_used ?? 0}`,
    `  cognitive load assessed: ${summary.cognitive_load_assessed ?? 0}`,
  ];

  appendCountMap(lines, "by capability", summary.by_capability);
  appendCountMap(lines, "by event type", summary.by_event_type);
  return lines.join("\n");
}

function proposalListSummary(response) {
  const proposals = Array.isArray(response.proposals) ? response.proposals : [];
  if (proposals.length === 0) {
    return "Capability proposals\n  none";
  }

  const lines = ["Capability proposals"];
  for (const proposal of proposals) {
    lines.push([
      `  ${proposal.id ?? "unknown-id"}`,
      `[${proposal.status ?? "unknown-status"}]`,
      `capability=${proposal.capability ?? "unknown"}`,
      `requested_by=${proposal.requested_by ?? "unknown"}`,
      `scope=${proposal.requested_scope ?? "unknown"}`,
    ].join(" "));
    lines.push(`    reason: ${proposal.reason ?? ""}`);
  }
  lines.push("  use `soma proposals show proposal-id` for full review context");
  return lines.join("\n");
}

function notificationSummary(response) {
  const notifications = Array.isArray(response.notifications) ? response.notifications : [];
  if (notifications.length === 0) {
    return "Notifications\n  none";
  }

  const lines = [
    "Notifications",
    `  total: ${response.summary?.total ?? notifications.length}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
  ];
  for (const notification of notifications) {
    lines.push([
      `  ${notification.id ?? "unknown-id"}`,
      `[${notification.status ?? "unknown-status"}]`,
      `type=${notification.type ?? "unknown"}`,
      `capability=${notification.capability ?? "unknown"}`,
      `proposal=${notification.proposal_id ?? "unknown"}`,
    ].join(" "));
    lines.push(`    reason: ${notification.reason ?? ""}`);
    lines.push(`    show: soma proposals show ${notification.proposal_id ?? "proposal-id"}`);
    lines.push(`    approve: soma proposals approve ${notification.proposal_id ?? "proposal-id"} --scope ${notification.requested_scope ?? "session"}`);
    lines.push(`    deny: soma proposals deny ${notification.proposal_id ?? "proposal-id"} --reason text`);
  }
  return lines.join("\n");
}

function proposalDetailSummary(response) {
  const proposal = response.proposal ?? {};
  const decision = proposal.decision ?? {};
  const lines = [
    "Capability proposal",
    `  id: ${proposal.id ?? "unknown"}`,
    `  status: ${proposal.status ?? "unknown"}`,
    `  capability: ${proposal.capability ?? "unknown"}`,
    `  requested by: ${proposal.requested_by ?? "unknown"}`,
    `  requested scope: ${proposal.requested_scope ?? "unknown"}`,
    `  reason: ${proposal.reason ?? ""}`,
    `  risk: ${proposal.risk ?? ""}`,
    `  fallback: ${proposal.fallback ?? ""}`,
    `  data exposed: ${joinList(proposal.data_exposed)}`,
    `  excluded data: ${joinList(proposal.excluded_data)}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
  ];

  if (proposal.provenance_id) {
    lines.push(`  provenance: ${proposal.provenance_id}`);
  }
  if (decision.decision) {
    lines.push(`  decision: ${decision.decision}`);
    lines.push(`  decided by: ${decision.decided_by ?? "unknown"}`);
    lines.push(`  decided at: ${decision.decided_at ?? "unknown"}`);
  }
  if (decision.approved_scope) {
    lines.push(`  approved scope: ${decision.approved_scope}`);
  }
  if (decision.denial_reason) {
    lines.push(`  denial reason: ${decision.denial_reason}`);
  }

  return lines.join("\n");
}

function proposalDecisionSummary(response) {
  const proposal = response.proposal ?? {};
  const decision = response.decision ?? {};
  const lines = [
    "Capability proposal decision",
    `  proposal: ${proposal.id ?? "unknown"}`,
    `  status: ${proposal.status ?? "unknown"}`,
    `  capability: ${proposal.capability ?? "unknown"}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
  ];
  if (decision.approved_scope) {
    lines.splice(4, 0, `  approved scope: ${decision.approved_scope}`);
  }
  if (decision.denial_reason) {
    lines.splice(4, 0, `  denial reason: ${decision.denial_reason}`);
  }
  return lines.join("\n");
}

function pendingProposalSummaries(proposals) {
  if (!Array.isArray(proposals)) {
    return [];
  }
  return proposals.map((proposal) => ({
    id: proposal.id ?? "",
    capability: proposal.capability ?? "",
    requested_by: proposal.requested_by ?? "",
    requested_scope: proposal.requested_scope ?? "",
    reason: proposal.reason ?? "",
  }));
}

function joinList(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(", ") : "none";
}

function dimensionsText(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    return "dimensions=unknown";
  }
  return `dimensions=${value[0]}x${value[1]}`;
}

function grantListSummary(response) {
  const grants = Array.isArray(response.grants) ? response.grants : [];
  const lines = [
    "Grants",
    `  total: ${response.summary?.total ?? grants.length}`,
    `  examples available: ${booleanText(response.examples_available)}`,
    `  file backed: ${booleanText(response.file_backed)}`,
    `  writable: ${booleanText(response.writable)}`,
    `  runtime writes enabled: ${booleanText(response.runtime_writes_enabled)}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
  ];

  if (grants.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }

  for (const grant of grants) {
    lines.push([
      `  ${grant.id ?? "unknown-id"}`,
      `[${grant.status ?? "unknown-status"}]`,
      `capability=${grant.capability ?? "unknown"}`,
      `provider=${grant.provider ?? "unknown"}`,
      `scope=${grant.scope ?? "unknown"}`,
      `activation=${booleanText(grant.activation_performed)}`,
    ].join(" "));
    if (grant.reason) {
      lines.push(`    reason: ${grant.reason}`);
    }
    if (grant.review_required) {
      lines.push("    review required: yes");
    }
    if (grant.revoked_at) {
      lines.push(`    revoked at: ${grant.revoked_at}`);
      lines.push(`    revoked by: ${grant.revoked_by || "unknown"}`);
      lines.push(`    revocation reason: ${grant.revocation_reason || "unspecified"}`);
    }
    if (grant.replacement_grant_id) {
      lines.push(`    replacement grant: ${grant.replacement_grant_id}`);
    }
  }

  return lines.join("\n");
}

function grantRecoverySummary(response) {
  const findings = Array.isArray(response.findings) ? response.findings : [];
  const lines = [
    "Grant recovery",
    `  inspection available: ${booleanText(response.recovery_inspection_available)}`,
    `  ok: ${response.ok === null ? "not inspected" : booleanText(response.ok)}`,
    `  degraded: ${booleanText(response.degraded)}`,
    `  grants inspected: ${response.grant_count ?? 0}`,
    `  findings: ${response.finding_count ?? findings.length}`,
    `  runtime writes enabled: ${booleanText(response.runtime_writes_enabled)}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
  ];

  if (findings.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }

  for (const finding of findings) {
    const details = [
      `grant=${finding.grant_id ?? "unknown"}`,
      `capability=${finding.capability ?? "unknown"}`,
      `provider=${finding.provider ?? "unknown"}`,
      `scope=${finding.scope ?? "unknown"}`,
      `safe=${booleanText(finding.authorizing_safe)}`,
    ];
    if (finding.event_type) {
      details.push(`event=${finding.event_type}`);
    }
    if (finding.expected_event_type) {
      details.push(`expected=${finding.expected_event_type}`);
    }
    if (finding.field) {
      details.push(`field=${finding.field}`);
    }
    if (finding.provenance_stage) {
      details.push(`stage=${finding.provenance_stage}`);
    }
    if (finding.provenance_error_code) {
      details.push(`error=${finding.provenance_error_code}`);
    }
    lines.push(`  ${finding.code ?? "unknown_grant_recovery_finding"} ${details.join(" ")}`);
  }

  return lines.join("\n");
}

function grantMutationPreviewSummary(response) {
  const receipt = response.receipt_preview ?? {};
  const event = response.event ?? {};
  const grant = response.grant ?? {};
  const lines = [
    "Grant mutation preview",
    `  ok: ${booleanText(response.ok)}`,
    `  dry run: ${booleanText(response.dry_run)}`,
    `  mutation: ${response.mutation_kind ?? receipt.mutation_kind ?? "unknown"}`,
    `  grant: ${grant.id ?? receipt.grant_id ?? "unknown"}`,
    `  event: ${event.event_type ?? receipt.event_type ?? "none"}`,
    `  receipt status: ${receipt.status ?? "unknown"}`,
    `  grant written: ${booleanText(response.grant_written)}`,
    `  provenance appended: ${booleanText(response.provenance_appended)}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
  ];

  if (response.ok === false) {
    lines.push(`  error: ${response.code ?? receipt.error_code ?? "unknown"}`);
    if (response.message) {
      lines.push(`  message: ${response.message}`);
    }
  }

  if (response.next_store_summary) {
    lines.push(`  next grant count: ${response.next_store_summary.grant_count ?? "unknown"}`);
    lines.push(`  changed: ${booleanText(response.next_store_summary.changed)}`);
  }

  return lines.join("\n");
}

function modelVisualAttachDryRunSummary(response) {
  const request = response.request ?? {};
  const futurePreview = response.future_provenance_preview ?? {};
  const lines = [
    "Model visual attach dry-run",
    `  accepted: ${booleanText(response.accepted)}`,
    `  dry run: ${booleanText(response.dry_run)}`,
    `  capability: ${request.capability ?? "unknown"}`,
    `  grant: ${request.grant_id ?? "unknown"}`,
    `  provider: ${request.provider ?? "unknown"}`,
    `  model target: ${request.model_target ?? "unknown"}`,
    `  payload: ${request.payload_type ?? "unknown"} ${dimensionsText(request.transformed_dimensions)} ${request.format_required ?? "unknown"}`,
    `  preview acknowledgement: ${request.preview_acknowledgement_id ?? "unknown"}`,
    `  retention: ${request.retention_mode ?? "unknown"}`,
    `  model delivery performed: ${booleanText(response.model_delivery_performed)}`,
    `  payload attached: ${booleanText(response.payload_attached)}`,
    `  payload bytes included: ${booleanText(response.payload_bytes_included)}`,
  ];
  if (futurePreview.event_type || response.future_provenance_appended !== undefined) {
    lines.push(
      "  future provenance preview: preview only",
      `  future provenance event: ${futurePreview.event_type ?? "unknown"}`,
      `  future provenance appended: ${booleanText(response.future_provenance_appended)}`,
    );
  }
  return lines.join("\n");
}

function sensoriumProposalTemplateSummary(response) {
  const proposal = response.proposal ?? {};
  const review = response.review ?? {};
  const revocation = review.revocation ?? {};
  const lines = [
    "Sensorium proposal template",
    `  capability: ${proposal.capability ?? review.capability ?? "unknown"}`,
    `  provider: ${review.provider ?? "unknown"}`,
    `  topic: ${review.topic ?? "unknown"}`,
    `  stream: ${review.stream_type ?? "unknown"}`,
    `  risk class: ${review.risk_class ?? "unknown"}`,
    `  scope: ${review.scope ?? proposal.requested_scope ?? "unknown"}`,
    `  reason: ${proposal.reason ?? ""}`,
    `  constraints: ${sensoriumConstraintSummary(review)}`,
    `  disclosure: ${review.active_disclosure ?? ""}`,
    `  revocation: ${revocation.summary ?? "unknown"}`,
    `  recording: ${review.recording_posture ?? "unknown"}`,
    `  model boundary: ${review.model_boundary_warning ?? "unknown"}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  grant written: ${booleanText(response.grant_written)}`,
    `  subscription activated: ${booleanText(response.subscription_activated)}`,
  ];
  return lines.join("\n");
}

function sensoriumProposalCreatedSummary(response) {
  const proposal = response.proposal ?? {};
  const review = response.review ?? proposal.review_context ?? {};
  const lines = [
    "Sensorium proposal created",
    `  proposal: ${proposal.id ?? "unknown"}`,
    `  status: ${proposal.status ?? "unknown"}`,
    `  capability: ${proposal.capability ?? "unknown"}`,
    `  provider: ${review.provider ?? "unknown"}`,
    `  topic: ${review.topic ?? "unknown"}`,
    `  stream: ${review.stream_type ?? "unknown"}`,
    `  scope: ${proposal.requested_scope ?? review.scope ?? "unknown"}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  grant written: ${booleanText(response.grant_written)}`,
    `  subscription activated: ${booleanText(response.subscription_activated)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
    `  show: soma proposals show ${proposal.id ?? "proposal-id"}`,
  ];
  return lines.join("\n");
}

function sensoriumGrantCreatedSummary(response) {
  const grant = response.grant ?? {};
  const lines = [
    "Sensorium grant created",
    `  grant: ${grant.id ?? "unknown"}`,
    `  proposal: ${response.source_proposal_id ?? "unknown"}`,
    `  capability: ${grant.capability ?? "unknown"}`,
    `  provider: ${grant.provider ?? "unknown"}`,
    `  scope: ${grant.scope ?? "unknown"}`,
    `  topic: ${grant.constraints?.topic ?? "unknown"}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  subscription activated: ${booleanText(response.subscription_activated)}`,
    `  file written: ${booleanText(response.file_written)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
  ];
  return lines.join("\n");
}

function sensoriumGrantRevokedSummary(response) {
  const grant = response.grant ?? {};
  const lines = [
    "Sensorium grant revoked",
    `  grant: ${grant.id ?? "unknown"}`,
    `  changed: ${booleanText(response.changed)}`,
    `  status: ${grant.status ?? "unknown"}`,
    `  revoked by: ${grant.revoked_by ?? "unknown"}`,
    `  reason: ${grant.revocation_reason ?? "unknown"}`,
    `  stopped subscriptions: ${response.stopped_subscription_count ?? 0}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  subscription activated: ${booleanText(response.subscription_activated)}`,
    `  file written: ${booleanText(response.file_written)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
  ];
  return lines.join("\n");
}

function sensoriumSubscriptionStartedSummary(response) {
  const lines = [
    "Sensorium subscription started",
    `  subscription: ${response.subscription_id ?? "unknown"}`,
    `  grant: ${response.grant_id ?? "unknown"}`,
    `  topic: ${response.topic ?? "unknown"}`,
    `  started at: ${response.started_at ?? "unknown"}`,
    `  activation performed: ${booleanText(response.activation_performed)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
  ];
  return lines.join("\n");
}

function sensoriumSubscriptionStoppedSummary(response) {
  const summary = response.end_summary ?? {};
  const lines = [
    "Sensorium subscription stopped",
    `  subscription: ${response.subscription_id ?? summary.subscription_id ?? "unknown"}`,
    `  termination: ${summary.termination_reason ?? "unknown"}`,
    `  frames consumed: ${summary.frames_consumed ?? 0}`,
    `  duration seconds: ${summary.duration_seconds ?? "unknown"}`,
    `  frames recorded: ${booleanText(summary.frames_recorded)}`,
    `  provenance: ${response.provenance_id ?? "none"}`,
  ];
  return lines.join("\n");
}

function sensoriumSubscriptionsSummary(response) {
  const streams = Array.isArray(response.streams) ? response.streams : [];
  const lines = [
    "Sensorium subscriptions",
    `  active: ${response.active_count ?? streams.length}`,
    `  summary: ${response.summary ?? ""}`,
    `  frames recorded: ${booleanText(response.frames_recorded)}`,
  ];

  if (streams.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }

  for (const stream of streams) {
    lines.push([
      `  ${stream.subscription_id ?? "unknown-subscription"}`,
      `capability=${stream.capability ?? "unknown"}`,
      `topic=${stream.topic ?? "unknown"}`,
      `grant=${stream.grant_id ?? "unknown"}`,
      `expires_in=${stream.expires_in_seconds ?? "unknown"}`,
    ].join(" "));
  }

  return lines.join("\n");
}

function sensoriumStatusView(response) {
  const streams = Array.isArray(response.streams) ? response.streams : [];
  const statuses = streams
    .filter((stream) => stream?.capability === "perception.sensorium.status.subscribe")
    .map((stream) => ({
      subscription_id: stream.subscription_id ?? "",
      grant_id: stream.grant_id ?? "",
      topic: stream.topic ?? "",
      host: stream.host ?? "",
      frames_consumed_so_far: stream.frames_consumed_so_far ?? 0,
      status_summary_observed: stream.status_summary_observed ?? null,
    }));

  return {
    family: "perception.sensorium",
    active_status_count: statuses.length,
    summary: statuses.length === 0
      ? "No active Sensorium status summaries"
      : `Sensorium status summaries: ${statuses.length} active`,
    statuses,
    frames_recorded: Boolean(response.frames_recorded),
  };
}

function sensoriumStatusSummary(response) {
  const statuses = Array.isArray(response.statuses) ? response.statuses : [];
  const lines = [
    "Sensorium status",
    `  active status subscriptions: ${response.active_status_count ?? statuses.length}`,
    `  summary: ${response.summary ?? ""}`,
    `  frames recorded: ${booleanText(response.frames_recorded)}`,
  ];

  if (statuses.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }

  for (const status of statuses) {
    const observed = status.status_summary_observed ?? {};
    lines.push(`  ${status.subscription_id || "unknown-subscription"}`);
    lines.push(`    topic: ${status.topic || "unknown"}`);
    lines.push(`    grant: ${status.grant_id || "unknown"}`);
    lines.push(`    frames consumed so far: ${status.frames_consumed_so_far ?? 0}`);
    if (!observed || Object.keys(observed).length === 0) {
      lines.push("    observed: none yet");
      continue;
    }
    lines.push(`    host: ${observed.hostname ?? status.host ?? "unknown"}`);
    lines.push(`    schema version: ${observed.schema_version ?? "unknown"}`);
    lines.push(`    node version: ${observed.node_version ?? "unknown"}`);
    lines.push(`    uptime seconds: ${observed.uptime_seconds ?? "unknown"}`);
    const streams = Array.isArray(observed.enabled_streams) ? observed.enabled_streams : [];
    lines.push(`    enabled streams: ${streams.length > 0 ? streams.join(", ") : "none"}`);
    const profiles = Array.isArray(observed.stream_profiles) ? observed.stream_profiles : [];
    if (profiles.length > 0) {
      lines.push(`    native profiles: ${profiles.map(formatSensoriumProfile).join("; ")}`);
    }
  }

  return lines.join("\n");
}

function formatSensoriumProfile(profile) {
  const stream = profile.stream ?? "unknown";
  const dimensions = Number.isInteger(profile.width) && Number.isInteger(profile.height)
    ? `${profile.width}x${profile.height}`
    : "unknown-size";
  const fps = Number.isInteger(profile.fps) ? `${profile.fps}fps` : "unknown-fps";
  const format = profile.format ? ` ${profile.format}` : "";
  const jpegQuality = Number.isInteger(profile.jpeg_quality)
    ? ` q${profile.jpeg_quality}`
    : "";
  return `${stream} ${dimensions} @ ${fps}${format}${jpegQuality}`;
}

function sensoriumConstraintSummary(review) {
  const parts = [];
  if (review.max_seconds !== undefined && review.max_seconds !== null) {
    parts.push(`max_seconds=${review.max_seconds}`);
  }
  if (review.max_fps !== undefined && review.max_fps !== null) {
    parts.push(`max_fps=${review.max_fps}`);
  }
  if (review.format_required) {
    parts.push(`format=${review.format_required}`);
  }
  if (Array.isArray(review.downsample_to) && review.downsample_to.length === 2) {
    parts.push(`downsample=${review.downsample_to[0]}x${review.downsample_to[1]}`);
  }
  return parts.length > 0 ? parts.join(" ") : "none";
}

function capabilityViewSummary(response) {
  const summary = response.summary ?? {};
  const grouped = response.grouped ?? {};
  const lines = [
    "Capability view",
    `  total: ${summary.total ?? 0}`,
  ];

  appendCountMap(lines, "by status", summary.by_status);

  const categories = Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right));
  if (categories.length > 0) {
    lines.push("  by category:");
  }
  for (const [category, details] of categories) {
    const statusParts = Object.entries(details.by_status ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}=${count}`)
      .join(" ");
    lines.push(`    ${category}: ${details.total ?? 0}${statusParts ? ` (${statusParts})` : ""}`);
  }

  return lines.join("\n");
}

function appendCountMap(lines, label, value) {
  const entries = Object.entries(value ?? {});
  if (entries.length === 0) {
    return;
  }
  lines.push(`  ${label}:`);
  for (const [key, count] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`    ${key}: ${count}`);
  }
}

function usageError(message) {
  const error = new Error(message);
  error.code = "usage_error";
  error.statusCode = 2;
  return error;
}

function helpText() {
  return `Soma CLI

Usage:
  soma status [--json]
  soma chat "message" [--memory] [--write-memory] [--assess-load] [--assess-escalation] [--profile id] [--max-tokens n] [--temperature n] [--json]
  soma capabilities [--json]
  soma notifications [--status pending] [--json]
  soma modules list|adopt|drop [module-id] [--json]
  soma grants list [--status active|revoked|expired] [--json]
  soma grants recovery [--json]
  soma grants preview-create --capability key --provider id --reason text [--scope session] [--constraints-json json] [--approval-provenance-id id] [--mutation-id id] [--json]
  soma grants preview-revoke grant-id --reason text [--by user] [--mutation-id id] [--json]
  soma sensorium proposal-template --capability key --provider id --topic topic --reason text --max-seconds n [--max-fps n] [--format jpeg|png] [--downsample WIDTHxHEIGHT] [--json]
  soma sensorium propose --capability key --provider id --topic topic --reason text --max-seconds n [--max-fps n] [--format jpeg|png] [--downsample WIDTHxHEIGHT] [--json]
  soma sensorium grant-create proposal-id [--by user] [--json]
  soma sensorium grant-revoke grant-id --reason text [--by user] [--json]
  soma sensorium subscribe-start --capability key --topic topic --max-seconds n [--max-fps n] [--format jpeg|png] [--downsample WIDTHxHEIGHT] [--scope session] [--json]
  soma sensorium subscribe-stop subscription-id [--json]
  soma sensorium subscriptions [--json]
  soma sensorium status [--json]
  soma model-visual review --kind proposal|grant_candidate --review-json json [--json]
  soma model-visual attach-dry-run --request-json json [--json]
  soma proposals list [--status pending] [--json]
  soma proposals show proposal-id [--json]
  soma proposals approve proposal-id [--scope once|session] [--by user] [--json]
  soma proposals deny proposal-id --reason text [--by user] [--json]
  soma memory list|add|clear [content] [--role note] [--source manual] [--json]
  soma files read path [--json]
  soma desktop inspect [--mode environment|atspi] [--max-apps n] [--max-children n] [--json]
  soma desktop focus [--json]
  soma provenance summary|list|clear [--allowed true|false] [--capability key] [--event-type type] [--limit n] [--json]
  soma stewardship assess "text" [--json]

Options:
  --url URL    Soma service URL. Defaults to SOMA_URL or ${DEFAULT_SOMA_URL}.
  --json       Print full JSON responses.
`;
}

async function main() {
  try {
    process.exitCode = await runCli(parseCli(process.argv));
  } catch (error) {
    process.stderr.write(`${error.code ?? "error"}: ${error.message}\n`);
    process.exitCode = error.statusCode === 2 ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
