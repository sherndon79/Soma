import { randomUUID } from "node:crypto";

/**
 * Mic-off latch per §8/§10.2 — narrowing-only, requires deliberate resume.
 *
 * - Once latched (focus loss / SUSPEND / disconnect / revoke / lease expiry),
 *   capture is forbidden until `deliberateResume()` is called with a fresh epoch
 *   and explicit user action.
 * - Re-don alone does NOT clear the latch; OS auto-unmute is ignored.
 * - The server shares one latch across reconnects within an armed episode; a
 *   successful explicit arm creates the next episode's latch.
 * - All state is in-memory; prior episode/session instances keep their own
 *   latched object until disposal.
 */

export class QuestSurfaceMicLatch {
  constructor({ resumeHandle = randomUUID() } = {}) {
    this.resumeHandle = String(resumeHandle ?? "").trim();
    if (!this.resumeHandle) throw new TypeError("resumeHandle is required");
    this.latched = false;
    this.reason = "";
    this.latchedAtMs = 0;
    this.latchedEpoch = "";
    this.latchedEpisodeId = "";
  }

  isLatched() {
    return this.latched;
  }

  latch(reason, epoch = "", nowMs = Date.now(), episodeId = "") {
    if (this.latched) return;
    this.latched = true;
    this.reason = String(reason ?? "latch").trim() || "latch";
    this.latchedAtMs = nowMs;
    this.latchedEpoch = String(epoch ?? "");
    this.latchedEpisodeId = String(episodeId ?? "").trim();
  }

  /**
   * Deliberate resume requires a fresh epoch, the exact episode-scoped opaque
   * handle and originally issued episode, plus explicit local intent.
   */
  deliberateResume({ freshEpoch, resumeHandle, currentEpisodeId, explicit } = {}) {
    if (!this.latched) return false;
    if (!explicit) return false;
    const fe = String(freshEpoch ?? "").trim();
    const handle = String(resumeHandle ?? "").trim();
    const currentEpisode = String(currentEpisodeId ?? "").trim();
    if (!fe || fe === "0") return false;
    if (fe === this.latchedEpoch) return false;
    if (!handle || handle !== this.resumeHandle) return false;
    if (!this.latchedEpisodeId || currentEpisode !== this.latchedEpisodeId) return false;
    this.latched = false;
    this.reason = "";
    this.latchedAtMs = 0;
    this.latchedEpoch = "";
    this.latchedEpisodeId = "";
    return true;
  }

  clearForTest() {
    this.latched = false;
    this.reason = "";
    this.latchedAtMs = 0;
    this.latchedEpoch = "";
    this.latchedEpisodeId = "";
  }
}
