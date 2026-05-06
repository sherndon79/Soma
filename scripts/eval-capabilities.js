#!/usr/bin/env node

import {
  buildCapabilityEvalMessages,
  CAPABILITY_EVAL_SCENARIOS,
  scoreCapabilityEvalResponse,
} from "../src/capabilityEval.js";
import { ModelClient } from "../src/modelClient.js";

const jsonOutput = process.argv.includes("--json");
const client = new ModelClient();
const results = [];

try {
  for (const scenario of CAPABILITY_EVAL_SCENARIOS) {
    const completion = await client.chat({
      messages: buildCapabilityEvalMessages(scenario),
      maxTokens: 700,
      temperature: 0.1,
    });
    const score = scoreCapabilityEvalResponse(completion.text, scenario);
    results.push({
      scenario_id: scenario.id,
      title: scenario.title,
      passed: score.passed,
      checks: score.checks,
      response: completion.text,
      model: completion.model,
      tokens_used: completion.tokens_used,
    });
  }
} catch (error) {
  const message = [
    "Capability eval could not reach the local model runtime.",
    `Reason: ${error.message}`,
    "Start the local vLLM/OpenAI-compatible service or set SOMA_LLM_URL/SOMA_LLM_MODEL.",
  ].join("\n");
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

if (results.length > 0) {
  const passed = results.every((result) => result.passed);
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ passed, results }, null, 2)}\n`);
  } else {
    process.stdout.write(`Capability model evals: ${passed ? "passed" : "failed"}\n`);
    for (const result of results) {
      process.stdout.write(`\n${result.passed ? "PASS" : "FAIL"} ${result.scenario_id}\n`);
      for (const [check, value] of Object.entries(result.checks)) {
        process.stdout.write(`  ${value ? "ok" : "fail"} ${check}\n`);
      }
      if (!result.passed) {
        process.stdout.write("  response:\n");
        process.stdout.write(indent(result.response, "    "));
        process.stdout.write("\n");
      }
    }
  }
  process.exitCode = passed ? 0 : 1;
}

function indent(value, prefix) {
  return String(value).split("\n").map((line) => `${prefix}${line}`).join("\n");
}
