#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const TRUTHY = new Set(["1", "true", "yes"]);

export const DEFAULT_SENSORIUM_SMOKE = Object.freeze({
  capability: "perception.sensorium.status.subscribe",
  provider: "soma.provider.sensorium.jetsorano",
  topic: "sensor/jetsorano/status",
  maxSeconds: "30",
  observeSeconds: "3",
  reason: "Smoke test status/liveness subscription.",
  actor: "user",
});

export class SensoriumLiveSmokeError extends Error {
  constructor(message, code = "sensorium_live_smoke_error") {
    super(message);
    this.name = "SensoriumLiveSmokeError";
    this.code = code;
  }
}

export function parseSensoriumLiveSmokeArgs(argv = []) {
  const options = {
    ...DEFAULT_SENSORIUM_SMOKE,
    url: "",
    dryRun: false,
  };
  const seenCore = new Set();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new SensoriumLiveSmokeError(`unexpected positional argument: ${arg}`, "usage_error");
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new SensoriumLiveSmokeError(`${arg} requires a value`, "usage_error");
    }
    i += 1;
    switch (key) {
      case "capability":
        options.capability = value;
        seenCore.add(key);
        break;
      case "provider":
        options.provider = value;
        seenCore.add(key);
        break;
      case "topic":
        options.topic = value;
        seenCore.add(key);
        break;
      case "max-seconds":
        options.maxSeconds = value;
        seenCore.add(key);
        break;
      case "observe-seconds":
        options.observeSeconds = value;
        break;
      case "reason":
        options.reason = value;
        break;
      case "by":
        options.actor = value;
        break;
      case "url":
        options.url = value;
        break;
      default:
        throw new SensoriumLiveSmokeError(`unknown flag: ${arg}`, "usage_error");
    }
  }

  if (seenCore.size > 0 && seenCore.size < 4) {
    throw new SensoriumLiveSmokeError(
      "custom smoke targets require all of --capability, --provider, --topic, and --max-seconds",
      "usage_error",
    );
  }

  validateSmokeOptions(options);
  return options;
}

export function sensoriumLiveSmokeGuardErrors(env = process.env) {
  const errors = [];
  if (!isTruthy(env.SOMA_SENSORIUM_ENABLED)) {
    errors.push("SOMA_SENSORIUM_ENABLED=1 is required");
  }
  if (!isTruthy(env.SOMA_SENSORIUM_LIVE_SMOKE)) {
    errors.push("SOMA_SENSORIUM_LIVE_SMOKE=1 is required");
  }
  return errors;
}

export function buildSensoriumLiveSmokePlan(options = DEFAULT_SENSORIUM_SMOKE) {
  const normalized = normalizeSmokeOptions(options);
  const commonReviewArgs = [
    "--capability", normalized.capability,
    "--provider", normalized.provider,
    "--topic", normalized.topic,
    "--reason", normalized.reason,
    "--max-seconds", normalized.maxSeconds,
  ];
  const commonSubscribeArgs = [
    "--capability", normalized.capability,
    "--topic", normalized.topic,
    "--max-seconds", normalized.maxSeconds,
  ];

  return [
    step("inspect active Sensorium subscriptions", ["sensorium", "subscriptions", "--json"], normalized),
    step("create non-activating Sensorium proposal", [
      "sensorium", "propose",
      ...commonReviewArgs,
      "--json",
    ], normalized),
    step("approve the proposal for session scope", [
      "proposals", "approve", "<proposal-id>",
      "--scope", "session",
      "--by", normalized.actor,
      "--json",
    ], normalized),
    step("create runtime session grant from approved proposal", [
      "sensorium", "grant-create", "<proposal-id>",
      "--by", normalized.actor,
      "--json",
    ], normalized),
    step("start bounded Sensorium subscription", [
      "sensorium", "subscribe-start",
      ...commonSubscribeArgs,
      "--json",
    ], normalized),
    step("inspect active Sensorium disclosure", ["sensorium", "subscriptions", "--json"], normalized),
    step("stop bounded Sensorium subscription", [
      "sensorium", "subscribe-stop", "<subscription-id>",
      "--json",
    ], normalized),
    step("revoke runtime session grant", [
      "sensorium", "grant-revoke", "<grant-id>",
      "--by", normalized.actor,
      "--reason", "Sensorium live smoke complete.",
      "--json",
    ], normalized),
  ];
}

export async function runSensoriumLiveSmoke({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  runner = runCliCommand,
} = {}) {
  const options = parseSensoriumLiveSmokeArgs(argv);
  const guardErrors = sensoriumLiveSmokeGuardErrors(env);
  if (guardErrors.length > 0) {
    throw new SensoriumLiveSmokeError(
      `Sensorium live smoke refused: ${guardErrors.join("; ")}`,
      "guard_refused",
    );
  }

  const plan = buildSensoriumLiveSmokePlan(options);
  stdout.write("Sensorium live smoke plan:\n");
  for (const planStep of plan) {
    stdout.write(`- ${planStep.label}\n`);
    stdout.write(`  $ ${formatCliCommand(planStep.args)}\n`);
  }
  stdout.write("\n");
  stdout.write("This workflow uses runtime grants only and does not record, decode, or preprocess payloads.\n");
  stdout.write(`Observation wait: ${options.observeSeconds} second(s).\n`);

  if (options.dryRun) {
    stdout.write("Dry run requested; no commands executed.\n");
    return { dry_run: true, plan };
  }

  let proposalId = "";
  let grantId = "";
  let subscriptionId = "";

  try {
    await runStep(runner, "inspect active Sensorium subscriptions", ["sensorium", "subscriptions", "--json"], options);

    const proposalResponse = await runStep(runner, "create non-activating Sensorium proposal", [
      "sensorium", "propose",
      "--capability", options.capability,
      "--provider", options.provider,
      "--topic", options.topic,
      "--reason", options.reason,
      "--max-seconds", options.maxSeconds,
      "--json",
    ], options);
    proposalId = requireString(proposalResponse?.proposal?.id, "proposal id");

    await runStep(runner, "approve the proposal for session scope", [
      "proposals", "approve", proposalId,
      "--scope", "session",
      "--by", options.actor,
      "--json",
    ], options);

    const grantResponse = await runStep(runner, "create runtime session grant", [
      "sensorium", "grant-create", proposalId,
      "--by", options.actor,
      "--json",
    ], options);
    grantId = requireString(grantResponse?.grant?.id, "grant id");

    const subscriptionResponse = await runStep(runner, "start bounded Sensorium subscription", [
      "sensorium", "subscribe-start",
      "--capability", options.capability,
      "--topic", options.topic,
      "--max-seconds", options.maxSeconds,
      "--json",
    ], options);
    subscriptionId = requireString(subscriptionResponse?.subscription_id, "subscription id");

    stdout.write(`Waiting ${options.observeSeconds} second(s) for metadata-only sample counters.\n`);
    await sleepSeconds(Number(options.observeSeconds));

    const activeDisclosure = await runStep(
      runner,
      "inspect active Sensorium disclosure",
      ["sensorium", "subscriptions", "--json"],
      options,
    );
    const disclosureFrames = findFramesConsumedSoFar(activeDisclosure, subscriptionId);
    const stopResponse = await runStep(runner, "stop bounded Sensorium subscription", [
      "sensorium", "subscribe-stop", subscriptionId,
      "--json",
    ], options);
    subscriptionId = "";
    const framesConsumed = Number(stopResponse?.end_summary?.frames_consumed ?? disclosureFrames ?? 0);
    stdout.write(`Observed sample count: ${framesConsumed}\n`);
    if (!Number.isFinite(framesConsumed) || framesConsumed < 1) {
      throw new SensoriumLiveSmokeError(
        "Sensorium live smoke completed the control path but observed zero samples from the publisher",
        "no_samples_observed",
      );
    }

    await runStep(runner, "revoke runtime session grant", [
      "sensorium", "grant-revoke", grantId,
      "--by", options.actor,
      "--reason", "Sensorium live smoke complete.",
      "--json",
    ], options);
    grantId = "";

    stdout.write("Sensorium live smoke completed.\n");
    return { dry_run: false, completed: true };
  } catch (error) {
    await cleanupAfterFailure({ runner, options, subscriptionId, grantId, stderr });
    throw error;
  }
}

function normalizeSmokeOptions(options) {
  return {
    ...DEFAULT_SENSORIUM_SMOKE,
    ...options,
    maxSeconds: String(options.maxSeconds ?? DEFAULT_SENSORIUM_SMOKE.maxSeconds),
    url: String(options.url ?? ""),
  };
}

function validateSmokeOptions(options) {
  const maxSeconds = Number(options.maxSeconds);
  if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > 3600) {
    throw new SensoriumLiveSmokeError("--max-seconds must be an integer from 1 to 3600", "usage_error");
  }
  const observeSeconds = Number(options.observeSeconds);
  if (!Number.isInteger(observeSeconds) || observeSeconds < 1 || observeSeconds > 60) {
    throw new SensoriumLiveSmokeError("--observe-seconds must be an integer from 1 to 60", "usage_error");
  }
  for (const [name, value] of Object.entries({
    capability: options.capability,
    provider: options.provider,
    topic: options.topic,
    reason: options.reason,
    by: options.actor,
  })) {
    if (!String(value ?? "").trim()) {
      throw new SensoriumLiveSmokeError(`--${name} must not be empty`, "usage_error");
    }
  }
}

function step(label, args, options) {
  const withUrl = options.url ? [...args, "--url", options.url] : args;
  return { label, args: withUrl };
}

function isTruthy(value) {
  return TRUTHY.has(String(value ?? "").trim().toLowerCase());
}

async function runStep(runner, label, args, options) {
  const withUrl = options.url ? [...args, "--url", options.url] : args;
  return runner(withUrl, { label });
}

async function cleanupAfterFailure({ runner, options, subscriptionId, grantId, stderr }) {
  if (subscriptionId) {
    try {
      await runStep(runner, "cleanup stop subscription", [
        "sensorium", "subscribe-stop", subscriptionId, "--json",
      ], options);
    } catch (error) {
      stderr.write(`Cleanup could not stop subscription ${subscriptionId}: ${error.message}\n`);
    }
  }
  if (grantId) {
    try {
      await runStep(runner, "cleanup revoke grant", [
        "sensorium", "grant-revoke", grantId,
        "--by", options.actor,
        "--reason", "Sensorium live smoke cleanup after failure.",
        "--json",
      ], options);
    } catch (error) {
      stderr.write(`Cleanup could not revoke grant ${grantId}: ${error.message}\n`);
    }
  }
}

function runCliCommand(args, { label } = {}) {
  const result = spawnSync(process.execPath, ["src/cli.js", ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new SensoriumLiveSmokeError(
      `${label ?? "CLI command"} failed with exit ${result.status}: ${String(result.stderr || result.stdout).trim()}`,
      "command_failed",
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new SensoriumLiveSmokeError(
      `${label ?? "CLI command"} did not return JSON: ${error.message}`,
      "invalid_json",
    );
  }
}

function sleepSeconds(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

function findFramesConsumedSoFar(disclosure, subscriptionId) {
  const stream = Array.isArray(disclosure?.streams)
    ? disclosure.streams.find((entry) => entry?.subscription_id === subscriptionId)
    : null;
  const value = stream?.frames_consumed_so_far;
  return typeof value === "number" ? value : null;
}

function requireString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new SensoriumLiveSmokeError(`missing ${label} in CLI response`, "missing_response_field");
  }
  return normalized;
}

export function formatCliCommand(args) {
  return ["npm", "run", "cli", "--", ...args].map(shellToken).join(" ");
}

function shellToken(value) {
  const token = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(token)) {
    return token;
  }
  return `'${token.replaceAll("'", "'\\''")}'`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSensoriumLiveSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code === "guard_refused" || error.code === "usage_error" ? 2 : 1;
  });
}
