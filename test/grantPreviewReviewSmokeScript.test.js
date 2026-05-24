import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE,
  buildGrantPreviewReviewSmokePlan,
  grantPreviewReviewSmokeGuardErrors,
  parseGrantPreviewReviewSmokeArgs,
  runGrantPreviewReviewSmoke,
} from "../scripts/grant-preview-review-smoke.js";

test("grant preview/review smoke refuses live execution without explicit guard", () => {
  assert.deepEqual(grantPreviewReviewSmokeGuardErrors({}, DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE), [
    "SOMA_GRANT_PREVIEW_REVIEW_SMOKE=1 is required",
  ]);
  assert.deepEqual(grantPreviewReviewSmokeGuardErrors({ SOMA_GRANT_PREVIEW_REVIEW_SMOKE: "yes" }), []);

  const dryRun = parseGrantPreviewReviewSmokeArgs(["--dry-run"]);
  assert.deepEqual(grantPreviewReviewSmokeGuardErrors({}, dryRun), []);
});

test("grant preview/review smoke plan covers status recovery preview review and post-check", () => {
  const options = parseGrantPreviewReviewSmokeArgs(["--url", "http://127.0.0.1:8765"]);
  const plan = buildGrantPreviewReviewSmokePlan(options);
  const labels = plan.map((entry) => entry.label);

  assert.deepEqual(labels, [
    "inspect Soma status",
    "capture grants before smoke",
    "inspect grant recovery posture",
    "create dry-run grant mutation preview",
    "review accepted preview through formatter",
    "review refused preview through formatter",
    "capture grants after smoke",
  ]);
  assert.deepEqual(plan[0].args, ["status", "--json", "--url", "http://127.0.0.1:8765"]);
  assert.ok(plan[3].args.includes("preview-create"));
  assert.ok(plan[3].args.includes(DEFAULT_GRANT_PREVIEW_REVIEW_SMOKE.capability));
  assert.ok(plan[4].args.includes("review-preview"));
  assert.ok(plan[4].args.includes("--stdin"));
});

test("grant preview/review smoke validates constraints JSON", () => {
  assert.throws(
    () => parseGrantPreviewReviewSmokeArgs(["--constraints-json", "[]"]),
    /--constraints-json must be a JSON object/,
  );
});

test("grant preview/review smoke dry-run prints plan without runner calls", async () => {
  const writes = [];
  const result = await runGrantPreviewReviewSmoke({
    argv: ["--dry-run"],
    env: {},
    stdout: { write: (value) => writes.push(value) },
    runner: () => {
      throw new Error("runner should not be called");
    },
  });

  assert.equal(result.dry_run, true);
  assert.match(writes.join(""), /Grant preview\/review smoke plan/);
  assert.match(writes.join(""), /Dry run requested; no commands executed/);
});

test("grant preview/review smoke executes dry-run and review commands without mutating grants", async () => {
  const calls = [];
  const result = await runGrantPreviewReviewSmoke({
    argv: [],
    env: { SOMA_GRANT_PREVIEW_REVIEW_SMOKE: "1" },
    stdout: { write() {} },
    runner: (args, { label, input }) => {
      calls.push({ label, args, input });
      if (label === "inspect Soma status") {
        return ok({ health: { status: "ok" } });
      }
      if (label === "capture grants before smoke" || label === "capture grants after smoke") {
        return ok({ grants: [], summary: { total: 0 } });
      }
      if (label === "inspect grant recovery posture") {
        return ok({ ok: null, degraded: false, grant_count: 0, finding_count: 0 });
      }
      if (label === "create dry-run grant mutation preview") {
        return ok({
          ok: true,
          dry_run: true,
          mutation_kind: "grant.created",
          grant_written: false,
          provenance_appended: false,
          activation_performed: false,
        });
      }
      if (label === "review accepted preview through formatter") {
        assert.match(input, /grant\.created/);
        return ok({
          text: "Grant mutation preview",
          review_only: true,
          dry_run: true,
          durable: false,
          grant_written: false,
          provenance_appended: false,
          activation_performed: false,
        });
      }
      if (label === "review refused preview through formatter") {
        assert.match(input, /event_value/);
        return {
          status: 1,
          stdout: "",
          stderr: "grant_mutation_preview_review_forbidden_field: rejected",
        };
      }
      throw new Error(`unexpected step: ${label}`);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.preview_ok, true);
  assert.equal(result.review_only, true);
  assert.deepEqual(calls.map((entry) => entry.label), [
    "inspect Soma status",
    "capture grants before smoke",
    "inspect grant recovery posture",
    "create dry-run grant mutation preview",
    "review accepted preview through formatter",
    "review refused preview through formatter",
    "capture grants after smoke",
  ]);
});

function ok(payload) {
  return {
    status: 0,
    stdout: JSON.stringify(payload),
    stderr: "",
  };
}
