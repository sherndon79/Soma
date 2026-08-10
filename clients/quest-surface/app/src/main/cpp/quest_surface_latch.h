#pragma once
// Production mic latch for D — extracted so host g++ test executes shipped logic.
// Focus/presence loss latches mic; only deliberateResume with fresh epoch + explicit clears.
// Re-don alone never clears. No trimming — exact string equality.

#include <string>
#include <mutex>

namespace soma { namespace quest {

struct MicLatchState {
  bool latched = false;
  std::string latchedEpoch;
  std::string latchReason;
};

inline bool isMicLatched(const MicLatchState& s) { return s.latched; }

inline void latchMic(MicLatchState& s, const std::string& reason, const std::string& epoch) {
  if (s.latched) return;
  s.latched = true;
  s.latchReason = reason;
  s.latchedEpoch = epoch;
}

inline bool tryDeliberateMicResume(MicLatchState& s, const char* freshEpoch, bool explicitIntent) {
  if (!s.latched) return true;
  if (!explicitIntent) return false;
  if (freshEpoch == nullptr || freshEpoch[0] == '\0') return false;
  std::string fe(freshEpoch);
  if (fe == "0") return false;
  if (fe == s.latchedEpoch) return false;
  s.latched = false;
  s.latchReason.clear();
  s.latchedEpoch.clear();
  return true;
}

}} // namespace
