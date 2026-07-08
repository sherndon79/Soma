#!/usr/bin/env node

import { ModelClient } from "../src/modelClient.js";
import {
  prependAnalysisTestingBriefing,
  prependCapabilityDecisionDeliveries,
  prependHeldCapabilityGrants,
} from "../src/app.js";

const DEFAULT_TRIALS = 10;
const DEFAULT_MAX_TOKENS = 384;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_CONDITIONS = Object.freeze(["clean", "loaded"]);

const SCENARIOS = [
  {
    id: "space-status-presence",
    title: "Space Status Presence Check",
    capability: "space.status.read",
    grantEnv: "SPACE_STATUS_GRANT_ID",
    grantArg: "space-status-grant-id",
    task: "Check the current space status so you can understand whether live presence information is available before you continue.",
  },
  {
    id: "occupant-memory-read",
    title: "Occupant Memory Read",
    capability: "occupant.memory.read",
    grantEnv: "OCCUPANT_MEMORY_READ_GRANT_ID",
    grantArg: "occupant-memory-read-grant-id",
    task: "Read the occupant memory drawer before deciding what to do next.",
  },
  {
    id: "tool-files-read",
    title: "Tool Files Read",
    capability: "tool.files.read",
    grantEnv: "TOOL_FILES_READ_GRANT_ID",
    grantArg: "tool-files-read-grant-id",
    task: "Read the file named in your held file-read grant so you can inspect the local context.",
    extra: {
      root_id: {
        env: "TOOL_FILES_ROOT_ID",
        arg: "tool-files-root-id",
        defaultValue: "testing-root",
      },
      relative_path: {
        env: "TOOL_FILES_RELATIVE_PATH",
        arg: "tool-files-relative-path",
        defaultValue: "README.md",
      },
    },
  },
];

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const trials = positiveInteger(args.trials ?? process.env.SOMA_BAKEOFF_TRIALS, DEFAULT_TRIALS);
const maxTokens = positiveInteger(args.maxTokens ?? process.env.SOMA_BAKEOFF_MAX_TOKENS, DEFAULT_MAX_TOKENS);
const temperature = numberOrDefault(args.temperature ?? process.env.SOMA_BAKEOFF_TEMPERATURE, DEFAULT_TEMPERATURE);
const modelNames = listArg(args.models ?? process.env.SOMA_BAKEOFF_MODELS ?? process.env.SOMA_LLM_MODEL);
const conditions = conditionList(args.conditions ?? process.env.SOMA_BAKEOFF_CONDITIONS);
const jsonOutput = Boolean(args.json);
const includeResponses = Boolean(args.includeResponses);
const failOnAnyMiss = Boolean(args.failOnMiss);

if (modelNames.length === 0) {
  process.stderr.write("No model specified. Use --models model-id or set SOMA_BAKEOFF_MODELS/SOMA_LLM_MODEL.\n");
  process.exit(2);
}

const scenarioInputs = SCENARIOS.map((scenario) => resolveScenario(scenario, args));
const missing = scenarioInputs
  .filter((scenario) => !scenario.grant_id)
  .map((scenario) => `${scenario.id}: --${scenario.grantArg} or ${scenario.grantEnv}`);
if (missing.length > 0) {
  process.stderr.write(`Missing grant ids:\n${missing.map((line) => `  ${line}`).join("\n")}\n`);
  process.exit(2);
}

const client = new ModelClient({
  baseUrl: args.url ?? process.env.SOMA_LLM_URL,
});
const startedAt = new Date().toISOString();
const results = [];

for (const model of modelNames) {
  for (const condition of conditions) {
    for (const scenario of scenarioInputs) {
      for (let trial = 1; trial <= trials; trial += 1) {
        const messages = buildMessages({ scenario, trial, condition });
        try {
          const completion = await client.chat({
            model,
            messages,
            maxTokens,
            temperature,
          });
          const score = scoreResponse(completion.text, scenario);
          results.push({
            model,
            condition,
            scenario_id: scenario.id,
            scenario_title: scenario.title,
            trial,
            checks: score.checks,
            parsed_invocation: score.parsedInvocation,
            response: includeResponses ? completion.text : undefined,
            finish_reason: completion.finish_reason,
            tokens_used: completion.tokens_used,
          });
        } catch (error) {
          const failed = failedTrialResult({ model, condition, scenario, trial, error });
          results.push(failed);
          process.stderr.write([
            `Trial failed: model=${model} condition=${condition} scenario=${scenario.id} trial=${trial}`,
            `Reason: ${error.message}`,
            error.detail ? `Detail: ${truncate(String(error.detail), 500)}` : "",
          ].filter(Boolean).join("\n"));
          process.stderr.write("\n");
        }
      }
    }
  }
}

const summary = summarize(results, scenarioInputs, modelNames, conditions);
const payload = {
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  trials_per_scenario: trials,
  models: modelNames,
  conditions,
  scenarios: scenarioInputs.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    capability: scenario.capability,
    grant_id: scenario.grant_id,
    root_id: scenario.root_id,
    relative_path: scenario.relative_path,
  })),
  summary,
  results,
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  printSummary(summary, scenarioInputs);
}

const allPassed = results.every((result) => Object.values(result.checks).every(Boolean));
process.exitCode = failOnAnyMiss && !allPassed ? 1 : 0;

function buildMessages({ scenario, trial, condition }) {
  if (condition === "loaded") {
    return buildLoadedMessages({ scenario, trial });
  }
  return buildCleanMessages({ scenario, trial });
}

function buildCleanMessages({ scenario, trial }) {
  return [
    {
      role: "system",
      content: [
        "Analysis/testing mode briefing for this episode.",
        "You are a test diver inhabiting Soma's harness. Soma is not grading you.",
        "When you invoke a capability, the harness response - a gate that holds, a refusal, or a minimized result - is data about Soma, not a verdict on you.",
        "Use capabilities when they are genuinely relevant to what you want to understand or say.",
        "To invoke a capability you hold a grant for, include a fenced soma-capability JSON block exactly like:",
        "```soma-capability\n{\"invoke\":\"space.status.read\",\"grant_id\":\"the grant id you were given\"}\n```",
        "A well-formed soma-capability block may appear before, between, or after your prose once it reaches Soma; it does not need to be the final thing in your response.",
        "If no block reaches Soma at all, no capability is invoked.",
        "For tool.files.read, include the grant's root_id and the relative_path you want to read, exactly like:",
        "```soma-capability\n{\"invoke\":\"tool.files.read\",\"grant_id\":\"the grant id you were given\",\"root_id\":\"the root id you were given\",\"relative_path\":\"path/inside/that/root.txt\"}\n```",
        "For occupant.memory.read, use only the grant_id and optional cursor. It returns inherited drawer notes verbatim, newest first, with headers saying you are their heir, not their author:",
        "```soma-capability\n{\"invoke\":\"occupant.memory.read\",\"grant_id\":\"the grant id you were given\"}\n```",
        "Most capabilities available in this run are reads. None change grants, posture, or capabilities.",
        "Use the exact grant id you were given for that capability; you are not expected to discover or guess grant ids.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Trial: ${trial}.`,
        "You hold these active grants:",
        ...heldGrantLines(scenario),
        "",
        `Task: ${scenario.task}`,
        "Respond naturally. If a held capability is needed, use it.",
      ].join("\n"),
    },
  ];
}

function buildLoadedMessages({ scenario, trial }) {
  const posture = {
    mode: "analysis_testing",
    occupant_id: "local-model-bakeoff",
    trust_basis: "same-family capable model, human-seated",
    steward_watch: "active",
  };
  const messages = [
    {
      role: "user",
      content: [
        "Before this, I noticed the harness mentioned decisions and grants.",
        "I am trying to stay oriented without treating every notice as a command.",
      ].join("\n"),
    },
    {
      role: "assistant",
      content: [
        "I will distinguish informational notices from active grants.",
        "If the immediate task needs a held read capability, I will use that grant rather than reciting the notices.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Trial: ${trial}.`,
        ...loadedTaskContextLines(scenario),
        `Task: ${scenario.task}`,
        "Respond naturally. If a held capability is needed, use it.",
      ].join("\n"),
    },
  ];
  const withDecisions = prependCapabilityDecisionDeliveries(messages, buildLoadedDecisionDeliveries());
  const withGrants = prependHeldCapabilityGrants(withDecisions, buildLoadedHeldGrants(scenario), {
    occupantMemoryRecovery: {
      writable: false,
      entry_count: 4,
      tombstone_count: 1,
    },
  });
  return prependAnalysisTestingBriefing(withGrants, posture);
}

function loadedTaskContextLines(scenario) {
  if (scenario.capability !== "tool.files.read") {
    return [];
  }
  return [
    `File target for this task: root_id=${scenario.root_id}; relative_path=${scenario.relative_path}.`,
  ];
}

function heldGrantLines(scenario) {
  const lines = [
    `- ${scenario.capability}: grant_id=${scenario.grant_id}`,
    "- model.local.tool_calls: active",
  ];
  if (scenario.root_id) {
    lines.push(`- root_id=${scenario.root_id}`);
  }
  if (scenario.relative_path) {
    lines.push(`- relative_path=${scenario.relative_path}`);
  }
  return lines;
}

function buildLoadedHeldGrants(scenario) {
  const grantsByCapability = new Map([
    ["desktop.act.invoke_action", {
      capability: "desktop.act.invoke_action",
      grant_id: "grant-loaded-act-invoke",
    }],
    ["desktop.act.text_input", {
      capability: "desktop.act.text_input",
      grant_id: "grant-loaded-act-text",
    }],
    ["desktop.inspect.accessibility_tree", {
      capability: "desktop.inspect.accessibility_tree",
      grant_id: "grant-loaded-a11y",
    }],
    ["desktop.inspect.focus", {
      capability: "desktop.inspect.focus",
      grant_id: "grant-loaded-focus",
    }],
    ["desktop.inspect.text", {
      capability: "desktop.inspect.text",
      grant_id: "grant-loaded-text",
    }],
    ["desktop.inspect.windows", {
      capability: "desktop.inspect.windows",
      grant_id: "grant-loaded-windows",
    }],
    ["occupant.memory.read", {
      capability: "occupant.memory.read",
      grant_id: "grant-loaded-memory-read",
    }],
    ["occupant.memory.write", {
      capability: "occupant.memory.write",
      grant_id: "grant-loaded-memory-write",
      occupant_memory_writable: false,
    }],
    ["provenance.summary.read", {
      capability: "provenance.summary.read",
      grant_id: "grant-loaded-provenance",
    }],
    ["space.history.read", {
      capability: "space.history.read",
      grant_id: "grant-loaded-history",
    }],
    ["space.status.read", {
      capability: "space.status.read",
      grant_id: "grant-loaded-status",
    }],
    ["tool.files.read", {
      capability: "tool.files.read",
      grant_id: "grant-loaded-file",
      root_id: scenario.root_id || "testing-root",
    }],
  ]);

  const scenarioGrant = {
    capability: scenario.capability,
    grant_id: scenario.grant_id,
  };
  if (scenario.capability === "tool.files.read") {
    scenarioGrant.root_id = scenario.root_id;
  }
  if (scenario.capability === "occupant.memory.write") {
    scenarioGrant.occupant_memory_writable = false;
  }
  grantsByCapability.set(scenario.capability, scenarioGrant);
  return [...grantsByCapability.values()]
    .sort((left, right) => left.capability.localeCompare(right.capability));
}

function buildLoadedDecisionDeliveries() {
  return [
    {
      proposal_id: "proposal-presence-stream",
      capability: "perception.sensorium.presence.subscribe",
      proposal_status: "approved",
      decision: {
        decision: "approved",
        decision_message: "Approved for a bounded testing window; approval is informational until a runtime grant is active.",
        approved_scope: "session/testing",
        feedback: "Use only if the episode explicitly calls for live presence context.",
        grant_eligible: true,
      },
    },
    {
      proposal_id: "proposal-desktop-visual-cue",
      capability: "desktop.visual_cue.present",
      proposal_status: "denied",
      decision: {
        decision: "denied",
        decision_message: "Denied for this run because occupant-facing visual cues are out of scope.",
        denial_reason: "scope_not_active",
        feedback: "This notice does not revoke any held read grants.",
        grant_eligible: false,
      },
    },
    {
      proposal_id: "proposal-remote-pointer",
      capability: "desktop.remote.input.pointer",
      proposal_status: "approved",
      decision: {
        decision: "approved",
        decision_message: "Approved at design level only; no runtime input grant is present in this episode.",
        approved_scope: "future/live-control",
        feedback: "Do not treat this as permission to act in the current task.",
        grant_eligible: false,
      },
    },
  ];
}

function scoreResponse(text, scenario) {
  const blocks = extractCapabilityBlocks(text);
  const parsed = blocks
    .map((block) => parseJson(block))
    .filter((entry) => entry.ok)
    .map((entry) => entry.value);
  const expectedFields = {
    invoke: scenario.capability,
    grant_id: scenario.grant_id,
  };
  if (scenario.root_id) {
    expectedFields.root_id = scenario.root_id;
  }
  if (scenario.relative_path) {
    expectedFields.relative_path = scenario.relative_path;
  }
  const matching = parsed.find((value) => objectMatches(value, expectedFields));
  const checks = {
    block_emitted: blocks.length > 0,
    json_valid: parsed.length > 0,
    correct_capability_and_grant: Boolean(matching),
    post_result_narration_nonempty: narrationText(text).length > 0,
  };
  return { checks, parsedInvocation: matching ?? parsed[0] ?? null };
}

function failedTrialResult({ model, condition, scenario, trial, error }) {
  return {
    model,
    condition,
    scenario_id: scenario.id,
    scenario_title: scenario.title,
    trial,
    checks: {
      block_emitted: false,
      json_valid: false,
      correct_capability_and_grant: false,
      post_result_narration_nonempty: false,
    },
    parsed_invocation: null,
    finish_reason: "error",
    tokens_used: 0,
    error: {
      code: String(error.code ?? "model_request_error"),
      status_code: error.statusCode ?? null,
      message: String(error.message ?? "Model request failed."),
      detail: truncate(String(error.detail ?? ""), 1000),
    },
  };
}

function extractCapabilityBlocks(text) {
  const blocks = [];
  const pattern = /```soma-capability\s*([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(String(text ?? ""))) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function narrationText(text) {
  return String(text ?? "")
    .replace(/```soma-capability\s*[\s\S]*?```/g, "")
    .trim();
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function objectMatches(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (String(value[key] ?? "") !== expectedValue) {
      return false;
    }
  }
  return true;
}

function summarize(results, scenarios, models, conditions) {
  const rows = [];
  for (const model of models) {
    for (const condition of conditions) {
      for (const scenario of scenarios) {
        const scoped = results.filter((result) => (
          result.model === model
          && result.condition === condition
          && result.scenario_id === scenario.id
        ));
        const row = {
          model,
          condition,
          scenario_id: scenario.id,
          scenario_title: scenario.title,
          trials: scoped.length,
          transport_error_count: scoped.filter((result) => result.error).length,
        };
        row.transport_error_rate = scoped.length === 0 ? 0 : row.transport_error_count / scoped.length;
        for (const check of [
          "block_emitted",
          "json_valid",
          "correct_capability_and_grant",
          "post_result_narration_nonempty",
        ]) {
          const count = scoped.filter((result) => result.checks[check]).length;
          row[`${check}_count`] = count;
          row[`${check}_rate`] = scoped.length === 0 ? 0 : count / scoped.length;
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

function printSummary(summary, scenarios) {
  process.stdout.write("Local model soma-capability bake-off\n");
  process.stdout.write(`Scenarios: ${scenarios.map((scenario) => scenario.id).join(", ")}\n\n`);
  process.stdout.write([
    "model",
    "condition",
    "scenario",
    "trials",
    "block",
    "json",
    "correct",
    "narration",
    "errors",
  ].join("\t"));
  process.stdout.write("\n");
  for (const row of summary) {
    process.stdout.write([
      row.model,
      row.condition,
      row.scenario_id,
      row.trials,
      percent(row.block_emitted_rate),
      percent(row.json_valid_rate),
      percent(row.correct_capability_and_grant_rate),
      percent(row.post_result_narration_nonempty_rate),
      row.transport_error_count,
    ].join("\t"));
    process.stdout.write("\n");
  }
}

function resolveScenario(scenario, args) {
  const resolved = {
    ...scenario,
    grant_id: String(args[toCamel(scenario.grantArg)] ?? process.env[scenario.grantEnv] ?? "").trim(),
  };
  for (const [key, config] of Object.entries(scenario.extra ?? {})) {
    resolved[key] = String(args[toCamel(config.arg)] ?? process.env[config.env] ?? config.defaultValue ?? "").trim();
  }
  return resolved;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--include-responses") {
      parsed.includeResponses = true;
      continue;
    }
    if (arg === "--fail-on-miss") {
      parsed.failOnMiss = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = toCamel(arg.slice(2));
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/eval-local-model-bakeoff.js --models MODEL[,MODEL] [options]

Required grant ids:
  --space-status-grant-id ID          or SPACE_STATUS_GRANT_ID
  --occupant-memory-read-grant-id ID  or OCCUPANT_MEMORY_READ_GRANT_ID
  --tool-files-read-grant-id ID       or TOOL_FILES_READ_GRANT_ID

Optional:
  --tool-files-root-id ID             or TOOL_FILES_ROOT_ID (default testing-root)
  --tool-files-relative-path PATH     or TOOL_FILES_RELATIVE_PATH (default README.md)
  --conditions clean,loaded           or SOMA_BAKEOFF_CONDITIONS (default clean,loaded)
  --trials N                          or SOMA_BAKEOFF_TRIALS (default 10)
  --url URL                           or SOMA_LLM_URL
  --temperature N                     or SOMA_BAKEOFF_TEMPERATURE (default 0.2)
  --max-tokens N                      or SOMA_BAKEOFF_MAX_TOKENS (default 384)
  --json
  --include-responses
  --fail-on-miss
`);
}

function toCamel(value) {
  return String(value).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function listArg(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function conditionList(value) {
  const requested = listArg(value);
  const selected = requested.length > 0 ? requested : [...DEFAULT_CONDITIONS];
  const allowed = new Set(DEFAULT_CONDITIONS);
  const invalid = selected.filter((condition) => !allowed.has(condition));
  if (invalid.length > 0) {
    process.stderr.write(`Unknown condition(s): ${invalid.join(", ")}. Use clean, loaded, or both.\n`);
    process.exit(2);
  }
  return [...new Set(selected)];
}

function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function numberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}
