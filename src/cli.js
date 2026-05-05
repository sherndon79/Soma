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
    const [health, harness, modules, provenance] = await Promise.all([
      request(baseUrl, "GET", "/health"),
      request(baseUrl, "GET", "/harness"),
      request(baseUrl, "GET", "/harness-modules"),
      request(baseUrl, "GET", "/provenance/summary"),
    ]);
    writeOutput(stdout, {
      health,
      harness_id: harness.harness_id,
      mode: harness.mode,
      default_runtime_profile: harness.runtime_profiles?.default_profile,
      active_modules: modules.active_modules,
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
      writeOutput(stdout, await request(baseUrl, "GET", "/provenance/summary"), jsonOutput);
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
    const response = await request(baseUrl, "POST", "/desktop/inspect/accessibility-tree", {
      mode: flags.mode,
      max_apps: numberFlag(flags["max-apps"]),
      max_children: numberFlag(flags["max-children"]),
    });
    writeOutput(stdout, response, jsonOutput, desktopInspectionSummary(response));
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

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
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
  soma chat "message" [--memory] [--write-memory] [--assess-load] [--profile id] [--max-tokens n] [--temperature n] [--json]
  soma modules list|adopt|drop [module-id] [--json]
  soma memory list|add|clear [content] [--role note] [--source manual] [--json]
  soma files read path [--json]
  soma desktop inspect [--mode environment|atspi] [--max-apps n] [--max-children n] [--json]
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
