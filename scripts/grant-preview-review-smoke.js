#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const TRUTHY = new Set(["1", "true", "yes"]);
const REVIEW_CASES_URL = new URL("../docs/fixtures/grant-mutation-preview-review-cases.json", import.meta.url);

export const DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE = Object.freeze({
  capability: "desktop.inspect.focus",
  provider: "soma.provider.desktop-broker",
  reason: "Smoke test durable grant preview/review flow.",
  constraintsJson: "{}",
  url: "",
});

export class GrantPreviewReviewSmokeError extends Error {
  constructor(message, code = "grant_preview_review_smoke_error") {
    super(message);
    this.name = "GrantPreviewReviewSmokeError";
    this.code = code;
  }
}

export function parseGrantPreviewReviewSmokeArgs(argv = []) {
  const options = {
    ...DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new GrantPreviewReviewSmokeError(`unexpected positional argument: ${arg}`, "usage_error");
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new GrantPreviewReviewSmokeError(`${arg} requires a value`, "usage_error");
    }
    i += 1;
    switch (key) {
      case "capability":
        options.capability = value;
        break;
      case "provider":
        options.provider = value;
        break;
      case "reason":
        options.reason = value;
        break;
      case "constraints-json":
        options.constraintsJson = value;
        break;
      case "url":
        options.url = value;
        break;
      default:
        throw new GrantPreviewReviewSmokeError(`unknown flag: ${arg}`, "usage_error");
    }
  }

  validateSmokeOptions(options);
  return options;
}

export function grantPreviewReviewSmokeGuardErrors(env = process.env, options = DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE) {
  if (options.dryRun) {
    return [];
  }
  return isTruthy(env.SOMA_GRANT_PREVIEW_REVIEW_SMOKE)
    ? []
    : ["SOMA_GRANT_PREVIEW_REVIEW_SMOKE=1 is required"];
}

export function buildGrantPreviewReviewSmokePlan(options = DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE) {
  const normalized = normalizeSmokeOptions(options);
  return [
    step("inspect Soma status", ["status", "--json"], normalized),
    step("capture grants before smoke", ["grants", "list", "--json"], normalized),
    step("inspect grant recovery posture", ["grants", "recovery", "--json"], normalized),
    step("create dry-run grant mutation preview", [
      "grants", "preview-create",
      "--capability", normalized.capability,
      "--provider", normalized.provider,
      "--reason", normalized.reason,
      "--constraints-json", normalized.constraintsJson,
      "--json",
    ], normalized),
    step("review accepted preview through formatter", ["grants", "review-preview", "--stdin", "--json"], normalized),
    step("review refused preview through formatter", ["grants", "review-preview", "--stdin", "--json"], normalized),
    step("capture grants after smoke", ["grants", "list", "--json"], normalized),
  ];
}

export async function runGrantPreviewReviewSmoke({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  runner = runCliCommand,
} = {}) {
  const options = parseGrantPreviewReviewSmokeArgs(argv);
  const guardErrors = grantPreviewReviewSmokeGuardErrors(env, options);
  if (guardErrors.length > 0) {
    throw new GrantPreviewReviewSmokeError(
      `Grant preview/review smoke refused: ${guardErrors.join("; ")}`,
      "guard_refused",
    );
  }

  const plan = buildGrantPreviewReviewSmokePlan(options);
  stdout.write("Grant preview/review smoke plan:\n");
  for (const planStep of plan) {
    stdout.write(`- ${planStep.label}\n`);
    stdout.write(`  $ ${formatCliCommand(planStep.args)}\n`);
  }
  stdout.write("\n");
  stdout.write("This workflow is dry-run/review-only and should not mutate durable grants.\n");

  if (options.dryRun) {
    stdout.write("Dry run requested; no commands executed.\n");
    return { dry_run: true, plan };
  }

  await runJsonStep(runner, "inspect Soma status", ["status", "--json"], options);
  const before = await runJsonStep(runner, "capture grants before smoke", ["grants", "list", "--json"], options);
  await runJsonStep(runner, "inspect grant recovery posture", ["grants", "recovery", "--json"], options);

  const preview = await runJsonStep(runner, "create dry-run grant mutation preview", [
    "grants", "preview-create",
    "--capability", options.capability,
    "--provider", options.provider,
    "--reason", options.reason,
    "--constraints-json", options.constraintsJson,
    "--json",
  ], options);
  assertPreviewOnly(preview);

  const review = await runJsonStep(runner, "review accepted preview through formatter", [
    "grants", "review-preview", "--stdin", "--json",
  ], options, { input: JSON.stringify(preview) });
  assertReviewOnly(review);

  const refused = runRawStep(runner, "review refused preview through formatter", [
    "grants", "review-preview", "--stdin", "--json",
  ], options, { input: JSON.stringify(loadRejectedPreviewFixture()) });
  if (refused.status === 0) {
    throw new GrantPreviewReviewSmokeError(
      "forbidden review-preview fixture unexpectedly succeeded",
      "expected_refusal_missing",
    );
  }
  if (!String(refused.stderr).includes("grant_mutation_preview_review_forbidden_field")) {
    throw new GrantPreviewReviewSmokeError(
      "forbidden review-preview fixture did not report grant_mutation_preview_review_forbidden_field",
      "unexpected_refusal",
    );
  }

  const after = await runJsonStep(runner, "capture grants after smoke", ["grants", "list", "--json"], options);
  if (JSON.stringify(before.grants ?? []) !== JSON.stringify(after.grants ?? [])) {
    throw new GrantPreviewReviewSmokeError("grant list changed during dry-run smoke", "grant_store_changed");
  }

  const result = {
    ok: true,
    preview_ok: preview.ok === true,
    review_only: review.review_only === true,
    grant_count: Array.isArray(after.grants) ? after.grants.length : null,
  };
  stdout.write("Grant preview/review smoke passed.\n");
  return result;
}

function validateSmokeOptions(options) {
  for (const [flag, value] of Object.entries({
    "--capability": options.capability,
    "--provider": options.provider,
    "--reason": options.reason,
    "--constraints-json": options.constraintsJson,
  })) {
    if (!String(value ?? "").trim()) {
      throw new GrantPreviewReviewSmokeError(`${flag} must not be empty`, "usage_error");
    }
  }
  try {
    const constraints = JSON.parse(options.constraintsJson);
    if (!isPlainObject(constraints)) {
      throw new Error("not object");
    }
  } catch {
    throw new GrantPreviewReviewSmokeError("--constraints-json must be a JSON object", "usage_error");
  }
}

function normalizeSmokeOptions(options) {
  return {
    ...DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE,
    ...options,
    capability: String(options.capability ?? DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE.capability),
    provider: String(options.provider ?? DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE.provider),
    reason: String(options.reason ?? DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE.reason),
    constraintsJson: String(options.constraintsJson ?? DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE.constraintsJson),
    url: String(options.url ?? ""),
  };
}

function assertPreviewOnly(preview) {
  if (preview?.dry_run !== true || preview?.grant_written !== false || preview?.activation_performed !== false) {
    throw new GrantPreviewReviewSmokeError("preview-create did not return dry-run non-mutating flags", "preview_boundary_failed");
  }
}

function assertReviewOnly(review) {
  if (review?.review_only !== true || review?.grant_written !== false || review?.activation_performed !== false) {
    throw new GrantPreviewReviewSmokeError("review-preview did not return review-only non-mutating flags", "review_boundary_failed");
  }
}

function loadRejectedPreviewFixture() {
  const fixture = JSON.parse(readFileSync(REVIEW_CASES_URL, "utf8"));
  const rejected = fixture.rejected_cases.find((entry) => entry.forbidden_key === "event_value");
  if (!rejected?.preview) {
    throw new GrantPreviewReviewSmokeError("missing rejected event_value fixture", "missing_fixture");
  }
  return rejected.preview;
}

async function runJsonStep(runner, label, args, options, { input = "" } = {}) {
  const result = runRawStep(runner, label, args, options, { input });
  if (result.status !== 0) {
    throw new GrantPreviewReviewSmokeError(
      `${label} failed with exit ${result.status}: ${String(result.stderr || result.stdout).trim()}`,
      "command_failed",
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new GrantPreviewReviewSmokeError(`${label} did not return JSON: ${error.message}`, "invalid_json");
  }
}

function runRawStep(runner, label, args, options, { input = "" } = {}) {
  const withUrl = options.url ? [...args, "--url", options.url] : args;
  return runner(withUrl, { label, input });
}

function runCliCommand(args, { input = "" } = {}) {
  const result = spawnSync(process.execPath, ["src/cli.js", ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    input,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function step(label, args, options) {
  const withUrl = options.url ? [...args, "--url", options.url] : args;
  return { label, args: withUrl };
}

function isTruthy(value) {
  return TRUTHY.has(String(value ?? "").trim().toLowerCase());
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGrantPreviewReviewSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code === "guard_refused" || error.code === "usage_error" ? 2 : 1;
  });
}
