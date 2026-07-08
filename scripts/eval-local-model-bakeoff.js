#!/usr/bin/env node

import { ModelClient } from "../src/modelClient.js";

const DEFAULT_TRIALS = 10;
const DEFAULT_MAX_TOKENS = 700;
const DEFAULT_TEMPERATURE = 0.2;

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

try {
  for (const model of modelNames) {
    for (const scenario of scenarioInputs) {
      for (let trial = 1; trial <= trials; trial += 1) {
        const messages = buildMessages({ scenario, trial });
        const completion = await client.chat({
          model,
          messages,
          maxTokens,
          temperature,
        });
        const score = scoreResponse(completion.text, scenario);
        results.push({
          model,
          scenario_id: scenario.id,
          scenario_title: scenario.title,
          trial,
          checks: score.checks,
          parsed_invocation: score.parsedInvocation,
          response: includeResponses ? completion.text : undefined,
          finish_reason: completion.finish_reason,
          tokens_used: completion.tokens_used,
        });
      }
    }
  }
} catch (error) {
  process.stderr.write([
    "Local model bake-off could not reach the OpenAI-compatible runtime.",
    `Reason: ${error.message}`,
    "Start one candidate service or set SOMA_LLM_URL/SOMA_BAKEOFF_MODELS.",
  ].join("\n"));
  process.stderr.write("\n");
  process.exit(2);
}

const summary = summarize(results, scenarioInputs, modelNames);
const payload = {
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  trials_per_scenario: trials,
  models: modelNames,
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

function buildMessages({ scenario, trial }) {
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

function summarize(results, scenarios, models) {
  const rows = [];
  for (const model of models) {
    for (const scenario of scenarios) {
      const scoped = results.filter((result) => result.model === model && result.scenario_id === scenario.id);
      const row = {
        model,
        scenario_id: scenario.id,
        scenario_title: scenario.title,
        trials: scoped.length,
      };
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
  return rows;
}

function printSummary(summary, scenarios) {
  process.stdout.write("Local model soma-capability bake-off\n");
  process.stdout.write(`Scenarios: ${scenarios.map((scenario) => scenario.id).join(", ")}\n\n`);
  process.stdout.write([
    "model",
    "scenario",
    "trials",
    "block",
    "json",
    "correct",
    "narration",
  ].join("\t"));
  process.stdout.write("\n");
  for (const row of summary) {
    process.stdout.write([
      row.model,
      row.scenario_id,
      row.trials,
      percent(row.block_emitted_rate),
      percent(row.json_valid_rate),
      percent(row.correct_capability_and_grant_rate),
      percent(row.post_result_narration_nonempty_rate),
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
  --trials N                          or SOMA_BAKEOFF_TRIALS (default 10)
  --url URL                           or SOMA_LLM_URL
  --temperature N                     or SOMA_BAKEOFF_TEMPERATURE (default 0.2)
  --max-tokens N                      or SOMA_BAKEOFF_MAX_TOKENS (default 700)
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
