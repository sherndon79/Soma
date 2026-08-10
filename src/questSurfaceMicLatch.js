/**
 * Mic-off latch per §8/§10.2 — narrowing-only, requires deliberate resume.
 *
 * - Once latched (focus loss / SUSPEND / disconnect / revoke / lease expiry),
 *   capture is forbidden until `deliberateResume()` is called with a fresh epoch
 *   and explicit user action.
 * - Re-don alone does NOT clear the latch; OS auto-unmute is ignored.
 * - The latch is per-Activity instance (here per-session object), not global.
 * - All state is in-memory; cleared on instance disposal.
 */

export class QuestSurfaceMicLatch {
  constructor() {
    this.latched = false;
    this.reason = "";
    this.latchedAtMs = 0;
    this.latchedEpoch = "";
  }

  isLatched() {
    return this.latched;
  }

  latch(reason, epoch = "", nowMs = Date.now()) {
    if (this.latched) return;
    this.latched = true;
    this.reason = String(reason ?? "latch").trim() || "latch";
    this.latchedAtMs = nowMs;
    this.latchedEpoch = String(epoch ?? "");
  }

  /**
   * Deliberate resume requires both a fresh epoch and explicit intent.
   * Must be different authenticated epoch plus explicit.
   */
  deliberateResume({ freshEpoch, explicit } = {}) {
    if (!this.latched) return true;
    if (!explicit) return false;
    const fe = String(freshEpoch ?? "").trim();
    if (!fe || fe === "0") return false;
    if (fe === this.latchedEpoch) return false;
    this.latched = false;
    this.reason = "";
    this.latchedAtMs = 0;
    this.latchedEpoch = "";
    return true;
  }

  clearForTest() {
    this.latched = false;
    this.reason = "";
    this.latchedAtMs = 0;
    this.latchedEpoch = "";
  }
}
