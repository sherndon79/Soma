#pragma once

// Pure lifecycle policy shared by the Android/OpenXR loop and host tests. Keeping these decisions
// free of Android types makes the exact causes of ANR-sensitive behavior deterministic in tests.
namespace soma { namespace quest {

inline bool isResumableLifecycleLoss(bool focusEverReached) {
    return focusEverReached;
}

inline bool shouldFramePump(bool sessionRunning, bool androidResumed) {
    return sessionRunning && androidResumed;
}

inline bool shouldPollLocalActions(
        bool sessionRunning, bool androidResumed, bool focused) {
    return sessionRunning && androidResumed && focused;
}

inline bool shouldExitNativeLoop(bool destroyCommand, bool destroyRequested) {
    return destroyCommand || destroyRequested;
}

}}  // namespace soma::quest
