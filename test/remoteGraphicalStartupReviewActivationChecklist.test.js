import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CHECKLIST_PATH = "docs/concepts/drafts/remote_graphical_live_broker_activation_checklist.md";

test("remote graphical activation checklist treats startup-review as evidence not authority", async () => {
  const checklist = await readFile(CHECKLIST_PATH, "utf8");

  for (const marker of [
    "`soma remote-graphical startup-review`",
    "JSON fixture",
    "review-only evidence",
    "They are not route authority, runtime authority, grant authority, or permission to",
    "construct a live broker",
    "[Remote Graphical Startup Review](../../runbooks/remote_graphical_startup_review.md)",
  ]) {
    assert.match(checklist, escapedPattern(marker));
  }
});

function escapedPattern(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
