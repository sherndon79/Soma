#include <cassert>
#include <string>
#include <iostream>
#include "quest_surface_latch.h"
#include "quest_surface_lifecycle.h"

using namespace soma::quest;

int main() {
  MicLatchState s;
  // same epoch should not clear
  latchMic(s, "focus_lost", "99");
  assert(isMicLatched(s));
  assert(!tryDeliberateMicResume(s, "99", true));
  assert(isMicLatched(s));
  // fresh epoch with explicit intent clears
  assert(tryDeliberateMicResume(s, "100", true));
  assert(!isMicLatched(s));
  // reconnect persistence: latch survives reconnect (simulated by not clearing on disconnect)
  latchMic(s, "suspend", "200");
  assert(isMicLatched(s));
  std::string savedEpoch = s.latchedEpoch;
  bool savedLatched = s.latched;
  assert(savedLatched);
  assert(savedEpoch == "200");
  // re-don alone (without explicit) never clears
  assert(!tryDeliberateMicResume(s, "201", false));
  assert(isMicLatched(s));
  // fresh epoch + explicit clears
  assert(tryDeliberateMicResume(s, "201", true));
  assert(!isMicLatched(s));
  // empty/0 never clears, no trimming divergence (exact match)
  latchMic(s, "revoke", "300");
  assert(!tryDeliberateMicResume(s, "", true));
  assert(!tryDeliberateMicResume(s, "0", true));
  // production does NOT trim: padded " 300 " != "300", so it is fresh and must clear
  assert(tryDeliberateMicResume(s, " 300 ", true));
  assert(!isMicLatched(s));
  // re-latch and verify fresh check again
  latchMic(s, "revoke", "400");
  assert(!tryDeliberateMicResume(s, "400", true));
  assert(isMicLatched(s));
  assert(tryDeliberateMicResume(s, "401", true));
  assert(!isMicLatched(s));

  // Production lifecycle reducer: pre-focus loss is inert; post-focus loss is resumable.
  assert(!isResumableLifecycleLoss(false));
  assert(isResumableLifecycleLoss(true));
  // A running resumed session remains frame-pumped while its content/capture is suspended, so the
  // controller A action can be observed. Android pause/stop closes this render path immediately.
  assert(shouldFramePump(true, true));
  assert(!shouldFramePump(true, false));
  assert(shouldPollLocalActions(true, true, true));
  assert(!shouldPollLocalActions(true, false, true));
  assert(!shouldPollLocalActions(true, true, false));
  // Finish requests continue pumping glue; only DESTROY/destroyRequested exits the native loop.
  assert(!shouldExitNativeLoop(false, false));
  assert(shouldExitNativeLoop(true, false));
  assert(shouldExitNativeLoop(false, true));

  std::cout << "C++ latch and lifecycle policy tests PASS (production)\n";
  return 0;
}
