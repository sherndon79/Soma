// Soma Quest v1a client: one leased, snapshot-only view-space panel over passthrough.
//
// The runtime composites passthrough; this process receives no camera pixels. It never calls
// xrLocateViews, never emits head pose, and never enables input/audio/perception extensions.

#include <android/log.h>
#include <android_native_app_glue.h>
#include <jni.h>

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>

#define XR_USE_PLATFORM_ANDROID
#define XR_USE_GRAPHICS_API_OPENGL_ES
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <algorithm>
#include <array>
#include <cinttypes>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <mutex>
#include <string>
#include <vector>

#include "font5x7.h"
#include "quest_surface_latch.h"
#include "quest_surface_lifecycle.h"

#define TAG "SOMA_QUEST_SURFACE"

namespace {

constexpr int32_t kTextureSize = 1024;
constexpr uint64_t kMsInNs = 1000000ull;

struct Snapshot {
    std::string epoch;
    std::string lease;
    std::string revision;
    std::string hash;
    std::string surface;
    std::string text;
    XrPosef pose{{0, 0, 0, 1}, {0, 0, -1.5f}};
    XrExtent2Df bounds{0.9f, 0.5f};
    int64_t deadline_ms = 0;
    bool ready = false;
    bool acked = false;
};

struct AppState {
    android_app* app = nullptr;
    XrInstance instance = XR_NULL_HANDLE;
    XrSystemId system = XR_NULL_SYSTEM_ID;
    XrSession session = XR_NULL_HANDLE;
    XrSessionState session_state = XR_SESSION_STATE_UNKNOWN;
    XrSpace view_space = XR_NULL_HANDLE;
    XrSwapchain swapchain = XR_NULL_HANDLE;
    std::vector<XrSwapchainImageOpenGLESKHR> images;
    // PTT/VAD input (client-local, no protocol). Default PTT.
    XrActionSet pttActionSet = XR_NULL_HANDLE;
    XrAction pttHoldAction = XR_NULL_HANDLE;
    XrAction modeToggleAction = XR_NULL_HANDLE;
    XrPath rightHandPath = XR_NULL_PATH;
    bool pttHeld = false;
    bool prevPttHeld = false;
    bool prevTogglePressed = false;
    int captureMode = 0; // 0 PTT, 1 VAD
    std::string captureState = "idle";

    EGLDisplay display = EGL_NO_DISPLAY;
    EGLConfig config = nullptr;
    EGLContext context = EGL_NO_CONTEXT;
    EGLSurface surface = EGL_NO_SURFACE;

    XrPassthroughFB passthrough = XR_NULL_HANDLE;
    XrPassthroughLayerFB passthrough_layer = XR_NULL_HANDLE;
    bool passthrough_running = false;
    bool presence_supported = false;

    std::vector<uint8_t> pixels;
    std::mutex mutex;
    Snapshot snapshot;
    std::string shell_state = "WAITING FOR FOCUS AND PRESENCE";
    std::string shell_code = "LOCAL STOP: EXIT APP";
    bool content_dirty = true;
    bool session_running = false;
    bool exiting = false;
    bool focus_ever_reached = false;
    bool presence_known = false;
    bool user_present = false;
    bool transport_started = false;
    bool suspended_latched = false;
    bool suspend_notified = false;
    bool suspended_resumable = false;
    bool resuming = false;
    bool pendingResumeAToken = false;
    bool triggerReleaseRequired = false;
    bool aReleaseRequired = false;
    bool pendingLocalStop = false;
    bool pendingPause = false;
    bool androidResumed = true;
    bool finishRequested = false;
    uint64_t activityGeneration = 0;
    uint64_t controlGeneration = 0;
    uint64_t pendingStartSequence = 0;
    uint64_t pendingResumeSequence = 0;
    soma::quest::MicLatchState micLatch;
    uint64_t frames = 0;
};

AppState g;

// v2.1: cached JNI class/methodIDs for bounded nonblocking enqueue (no Get* inline per call)
static jclass g_activityClass = nullptr;
static jmethodID g_midActivityGeneration = nullptr;
static jmethodID g_midEnqueueStart = nullptr;
static jmethodID g_midEnqueueSuspend = nullptr;
static jmethodID g_midEnqueueStop = nullptr;
static jmethodID g_midEnqueueResume = nullptr;
static jmethodID g_midEnqueuePtt = nullptr;
static jmethodID g_midEnqueueToggle = nullptr;
static jmethodID g_midEnqueueAck = nullptr;

PFN_xrCreatePassthroughFB xrCreatePassthroughFB_ = nullptr;
PFN_xrDestroyPassthroughFB xrDestroyPassthroughFB_ = nullptr;
PFN_xrPassthroughStartFB xrPassthroughStartFB_ = nullptr;
PFN_xrCreatePassthroughLayerFB xrCreatePassthroughLayerFB_ = nullptr;
PFN_xrDestroyPassthroughLayerFB xrDestroyPassthroughLayerFB_ = nullptr;

uint64_t boottime_ns() {
    timespec time{};
    clock_gettime(CLOCK_BOOTTIME, &time);
    return static_cast<uint64_t>(time.tv_sec) * 1000000000ull
            + static_cast<uint64_t>(time.tv_nsec);
}

const char* state_name(XrSessionState state) {
    switch (state) {
        case XR_SESSION_STATE_IDLE: return "IDLE";
        case XR_SESSION_STATE_READY: return "READY";
        case XR_SESSION_STATE_SYNCHRONIZED: return "SYNCHRONIZED";
        case XR_SESSION_STATE_VISIBLE: return "VISIBLE";
        case XR_SESSION_STATE_FOCUSED: return "FOCUSED";
        case XR_SESSION_STATE_STOPPING: return "STOPPING";
        case XR_SESSION_STATE_EXITING: return "EXITING";
        case XR_SESSION_STATE_LOSS_PENDING: return "LOSS_PENDING";
        default: return "UNKNOWN";
    }
}

void log_state(const char* event, const char* code = "") {
    __android_log_print(
            ANDROID_LOG_INFO,
            TAG,
            "event=%s code=%s xr_state=%s frames=%" PRIu64,
            event,
            code,
            state_name(g.session_state),
            g.frames);
}

bool get_proc(const char* name, PFN_xrVoidFunction* function) {
    XrResult result = xrGetInstanceProcAddr(g.instance, name, function);
    if (XR_FAILED(result) || *function == nullptr) {
        log_state("openxr_proc_missing", name);
        return false;
    }
    return true;
}

JNIEnv* attach_java(bool* attached) {
    *attached = false;
    if (g.app == nullptr || g.app->activity == nullptr) return nullptr;
    JNIEnv* env = nullptr;
    jint result = g.app->activity->vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    if (result == JNI_EDETACHED) {
        if (g.app->activity->vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return nullptr;
        *attached = true;
    } else if (result != JNI_OK) {
        return nullptr;
    }
    return env;
}

void detach_java(bool attached) {
    if (attached && g.app != nullptr) g.app->activity->vm->DetachCurrentThread();
}

uint64_t next_control_sequence() {
    std::lock_guard<std::mutex> lock(g.mutex);
    return ++g.controlGeneration;
}

int64_t call_java_activity_generation() {
    if (g_midActivityGeneration == nullptr) return 0;
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return 0;
    jlong generation = env->CallLongMethod(
            g.app->activity->clazz, g_midActivityGeneration);
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        generation = 0;
    }
    detach_java(attached);
    return generation;
}

bool call_java_enqueue_start(uint64_t sequence) {
    if (g_midEnqueueStart == nullptr) return false;
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return false;
    jboolean admitted = env->CallBooleanMethod(
            g.app->activity->clazz, g_midEnqueueStart, static_cast<jlong>(sequence));
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        admitted = JNI_FALSE;
    }
    detach_java(attached);
    return admitted == JNI_TRUE;
}

void call_java_enqueue_suspend_resumable(uint64_t sequence, const char* reason) {
    if (g_midEnqueueSuspend == nullptr) return;
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    jstring value = env->NewStringUTF(reason == nullptr ? "local_suspend" : reason);
    if (value != nullptr) {
        env->CallVoidMethod(
                g.app->activity->clazz,
                g_midEnqueueSuspend,
                static_cast<jlong>(sequence),
                value);
        if (env->ExceptionCheck()) env->ExceptionClear();
        env->DeleteLocalRef(value);
    }
    detach_java(attached);
}

void call_java_enqueue_stop_permanent(uint64_t sequence, const char* reason) {
    if (g_midEnqueueStop == nullptr) return;
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    jstring value = env->NewStringUTF(reason == nullptr ? "local_stop" : reason);
    if (value != nullptr) {
        env->CallVoidMethod(
                g.app->activity->clazz,
                g_midEnqueueStop,
                static_cast<jlong>(sequence),
                value);
        if (env->ExceptionCheck()) env->ExceptionClear();
        env->DeleteLocalRef(value);
    }
    detach_java(attached);
}

bool call_java_enqueue_resume(uint64_t sequence) {
    if (g_midEnqueueResume == nullptr) return false;
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return false;
    jboolean admitted = env->CallBooleanMethod(
            g.app->activity->clazz, g_midEnqueueResume, static_cast<jlong>(sequence));
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        admitted = JNI_FALSE;
    }
    detach_java(attached);
    return admitted == JNI_TRUE;
}

void call_java_enqueue_ack(uint64_t sequence, const Snapshot& snapshot) {
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    jstring epoch = env->NewStringUTF(snapshot.epoch.c_str());
    jstring lease = env->NewStringUTF(snapshot.lease.c_str());
    jstring revision = env->NewStringUTF(snapshot.revision.c_str());
    jstring hash = env->NewStringUTF(snapshot.hash.c_str());
    jstring surface = env->NewStringUTF(snapshot.surface.c_str());
    if (epoch == nullptr || lease == nullptr || revision == nullptr || hash == nullptr || surface == nullptr) {
        if (epoch) env->DeleteLocalRef(epoch);
        if (lease) env->DeleteLocalRef(lease);
        if (revision) env->DeleteLocalRef(revision);
        if (hash) env->DeleteLocalRef(hash);
        if (surface) env->DeleteLocalRef(surface);
        detach_java(attached);
        return;
    }
    if (g_midEnqueueAck != nullptr) {
        env->CallVoidMethod(
                g.app->activity->clazz,
                g_midEnqueueAck,
                static_cast<jlong>(sequence),
                epoch,
                lease,
                revision,
                hash,
                surface,
                snapshot.bounds.width,
                snapshot.bounds.height);
    }
    if (env->ExceptionCheck()) env->ExceptionClear();
    if (epoch != nullptr) env->DeleteLocalRef(epoch);
    if (lease != nullptr) env->DeleteLocalRef(lease);
    if (revision != nullptr) env->DeleteLocalRef(revision);
    if (hash != nullptr) env->DeleteLocalRef(hash);
    if (surface != nullptr) env->DeleteLocalRef(surface);
    detach_java(attached);
}

void latch_suspend(const char* reason) {
    std::string epoch_copy;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        epoch_copy = g.snapshot.epoch;
    }
    bool notify = false;
    bool upgrade_to_terminal = false;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        if (!g.suspended_latched) {
            g.suspended_latched = true;
            g.suspended_resumable = false;
            g.resuming = false;
            g.pendingResumeAToken = false;
            g.pendingStartSequence = 0;
            g.pendingResumeSequence = 0;
            g.snapshot = Snapshot{};
            g.shell_state = "SUSPENDED";
            g.shell_code = "EXIT AND RELAUNCH TO RESUME";
            g.content_dirty = true;
        } else if (g.suspended_resumable) {
            // resumable -> terminal upgrade (e.g., STOPPING after presence loss)
            g.suspended_resumable = false;
            g.resuming = false;
            g.pendingResumeAToken = false;
            g.pendingStartSequence = 0;
            g.pendingResumeSequence = 0;
            g.shell_state = "SUSPENDED";
            g.shell_code = "EXIT AND RELAUNCH TO RESUME";
            g.content_dirty = true;
            upgrade_to_terminal = true;
        }
        soma::quest::latchMic(g.micLatch, reason ? reason : "suspend", epoch_copy);
        if (!g.suspend_notified) {
            g.suspend_notified = true;
            notify = true;
        } else if (upgrade_to_terminal) {
            // already notified as resumable, now need terminal notification
            notify = true;
        }
    }
    if (notify) call_java_enqueue_stop_permanent(next_control_sequence(), reason);
}

void latch_suspend_resumable(const char* reason) {
    std::string epoch_copy;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        epoch_copy = g.snapshot.epoch;
    }
    bool notify = false;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        if (!g.suspended_latched) {
            g.suspended_latched = true;
            g.suspended_resumable = true;
            // Do not retain server snapshot while suspended
            g.snapshot = Snapshot{};
        } else if (!g.suspended_resumable) {
            // already terminally suspended — do not downgrade to resumable
            return;
        }
        // A repeated loss while an explicit resume is queued/in flight must supersede it too.
        g.resuming = false;
        g.pendingResumeAToken = false;
        g.pendingResumeSequence = 0;
        g.triggerReleaseRequired = false;
        g.aReleaseRequired = true;
        g.shell_state = "SUSPENDED";
        g.shell_code = "PRESS A TO RESUME";
        g.content_dirty = true;
        soma::quest::latchMic(g.micLatch, reason ? reason : "suspend", epoch_copy);
        g.suspend_notified = true;
        notify = true;
    }
    if (notify) call_java_enqueue_suspend_resumable(next_control_sequence(), reason);
}

void latch_suspend_terminal(const char* reason) {
    latch_suspend(reason);
}

int glyph_index(char value) {
    if (value >= 'a' && value <= 'z') value = static_cast<char>(value - 'a' + 'A');
    for (int index = 0; kFontOrder[index] != '\0'; index++) {
        if (kFontOrder[index] == value) return index;
    }
    return 0;
}

void put_pixel(int x, int y, uint8_t red, uint8_t green, uint8_t blue, uint8_t alpha) {
    if (x < 0 || y < 0 || x >= kTextureSize || y >= kTextureSize) return;
    const int flipped_y = kTextureSize - 1 - y;
    uint8_t* pixel = &g.pixels[(static_cast<size_t>(flipped_y) * kTextureSize + x) * 4];
    pixel[0] = red;
    pixel[1] = green;
    pixel[2] = blue;
    pixel[3] = alpha;
}

int draw_text(const std::string& text, int x, int y, int scale) {
    int cursor = x;
    for (char value : text) {
        const unsigned char* glyph = kFont[glyph_index(value)];
        for (int row = 0; row < 7; row++) {
            for (int col = 0; col < 5; col++) {
                if ((glyph[row] & (1 << (4 - col))) == 0) continue;
                for (int sy = 0; sy < scale; sy++) {
                    for (int sx = 0; sx < scale; sx++) {
                        put_pixel(
                                cursor + col * scale + sx,
                                y + row * scale + sy,
                                244,
                                247,
                                255,
                                255);
                    }
                }
            }
        }
        cursor += 6 * scale;
    }
    return cursor;
}

void draw_wrapped(const std::string& text, int x, int y, int scale, size_t columns, size_t rows) {
    std::string line;
    size_t line_count = 0;
    auto flush = [&]() {
        if (line_count >= rows) return;
        draw_text(line, x, y + static_cast<int>(line_count) * (9 * scale), scale);
        line.clear();
        line_count++;
    };
    for (unsigned char value : text) {
        if (line_count >= rows) break;
        if (value == '\n') {
            flush();
            continue;
        }
        line.push_back(value >= 0x20 && value <= 0x7e ? static_cast<char>(value) : ' ');
        if (line.size() == columns) flush();
    }
    if (!line.empty() && line_count < rows) flush();
}

void build_panel_locked() {
    g.pixels.assign(static_cast<size_t>(kTextureSize) * kTextureSize * 4, 0);
    for (int y = 0; y < kTextureSize; y++) {
        for (int x = 0; x < kTextureSize; x++) {
            uint8_t* pixel = &g.pixels[(static_cast<size_t>(y) * kTextureSize + x) * 4];
            pixel[0] = 8;
            pixel[1] = 12;
            pixel[2] = 20;
            pixel[3] = 210;
        }
    }
    draw_text("SOMA QUEST SURFACE", 48, 48, 5);
    if (g.snapshot.ready) {
        draw_wrapped(g.snapshot.text, 48, 160, 4, 34, 20);
    } else {
        draw_wrapped(g.shell_state, 48, 190, 5, 28, 5);
        draw_wrapped(g.shell_code, 48, 430, 3, 45, 5);
    }
    // Client-local status line, separate from server-authored snapshot.text
    {
        std::string mode = g.captureMode == 0 ? "[PTT]" : "[VAD]";
        std::string line = mode + " " + g.captureState;
        if (g.pttHeld && g.captureMode == 0) line += " (hold)";
        draw_text(line, 48, 950, 3);
    }
    g.content_dirty = false;
}

bool egl_init() {
    g.display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    EGLint major = 0;
    EGLint minor = 0;
    if (g.display == EGL_NO_DISPLAY || !eglInitialize(g.display, &major, &minor)) return false;
    std::array<EGLConfig, 1024> configs{};
    EGLint count = 0;
    if (!eglGetConfigs(g.display, configs.data(), configs.size(), &count) || count <= 0) return false;
    const EGLint wanted[] = {
            EGL_RED_SIZE, 8,
            EGL_GREEN_SIZE, 8,
            EGL_BLUE_SIZE, 8,
            EGL_ALPHA_SIZE, 8,
            EGL_DEPTH_SIZE, 0,
            EGL_STENCIL_SIZE, 0,
            EGL_SAMPLES, 0,
            EGL_NONE};
    for (EGLint index = 0; index < count && g.config == nullptr; index++) {
        EGLint value = 0;
        eglGetConfigAttrib(g.display, configs[index], EGL_RENDERABLE_TYPE, &value);
        if ((value & EGL_OPENGL_ES3_BIT_KHR) == 0) continue;
        eglGetConfigAttrib(g.display, configs[index], EGL_SURFACE_TYPE, &value);
        if ((value & (EGL_WINDOW_BIT | EGL_PBUFFER_BIT))
                != (EGL_WINDOW_BIT | EGL_PBUFFER_BIT)) continue;
        int wanted_index = 0;
        for (; wanted[wanted_index] != EGL_NONE; wanted_index += 2) {
            eglGetConfigAttrib(g.display, configs[index], wanted[wanted_index], &value);
            if (value != wanted[wanted_index + 1]) break;
        }
        if (wanted[wanted_index] == EGL_NONE) g.config = configs[index];
    }
    if (g.config == nullptr) return false;
    const EGLint context_attributes[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    const EGLint surface_attributes[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
    g.context = eglCreateContext(g.display, g.config, EGL_NO_CONTEXT, context_attributes);
    g.surface = eglCreatePbufferSurface(g.display, g.config, surface_attributes);
    return g.context != EGL_NO_CONTEXT
            && g.surface != EGL_NO_SURFACE
            && eglMakeCurrent(g.display, g.surface, g.surface, g.context) == EGL_TRUE;
}

bool passthrough_init() {
    if (!get_proc(
                "xrCreatePassthroughFB",
                reinterpret_cast<PFN_xrVoidFunction*>(&xrCreatePassthroughFB_))
            || !get_proc(
                    "xrDestroyPassthroughFB",
                    reinterpret_cast<PFN_xrVoidFunction*>(&xrDestroyPassthroughFB_))
            || !get_proc(
                    "xrPassthroughStartFB",
                    reinterpret_cast<PFN_xrVoidFunction*>(&xrPassthroughStartFB_))
            || !get_proc(
                    "xrCreatePassthroughLayerFB",
                    reinterpret_cast<PFN_xrVoidFunction*>(&xrCreatePassthroughLayerFB_))
            || !get_proc(
                    "xrDestroyPassthroughLayerFB",
                    reinterpret_cast<PFN_xrVoidFunction*>(&xrDestroyPassthroughLayerFB_))) {
        return false;
    }
    XrPassthroughCreateInfoFB passthrough_info{XR_TYPE_PASSTHROUGH_CREATE_INFO_FB};
    XrResult result = xrCreatePassthroughFB_(g.session, &passthrough_info, &g.passthrough);
    if (XR_FAILED(result)) return false;
    result = xrPassthroughStartFB_(g.passthrough);
    if (XR_FAILED(result)) return false;
    XrPassthroughLayerCreateInfoFB layer_info{XR_TYPE_PASSTHROUGH_LAYER_CREATE_INFO_FB};
    layer_info.passthrough = g.passthrough;
    layer_info.purpose = XR_PASSTHROUGH_LAYER_PURPOSE_RECONSTRUCTION_FB;
    layer_info.flags = XR_PASSTHROUGH_IS_RUNNING_AT_CREATION_BIT_FB;
    result = xrCreatePassthroughLayerFB_(g.session, &layer_info, &g.passthrough_layer);
    g.passthrough_running = XR_SUCCEEDED(result);
    return g.passthrough_running;
}

void call_java_enqueue_ptt_held(bool held) {
    if (g_midEnqueuePtt == nullptr) return;
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    env->CallVoidMethod(
            g.app->activity->clazz, g_midEnqueuePtt, held ? JNI_TRUE : JNI_FALSE);
    if (env->ExceptionCheck()) env->ExceptionClear();
    detach_java(attached);
}

bool call_java_enqueue_toggle_mode(uint64_t sequence) {
    if (g_midEnqueueToggle == nullptr) return false;
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return false;
    jboolean admitted = env->CallBooleanMethod(
            g.app->activity->clazz, g_midEnqueueToggle, static_cast<jlong>(sequence));
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        admitted = JNI_FALSE;
    }
    detach_java(attached);
    return admitted == JNI_TRUE;
}

bool create_ptt_actions() {
    // Client-local PTT/VAD input. No protocol change, bounded by Gate. Transactional: any failure cleans up.
    auto fail = []() {
        if (g.pttActionSet != XR_NULL_HANDLE) xrDestroyActionSet(g.pttActionSet);
        g.pttActionSet = XR_NULL_HANDLE;
        g.pttHoldAction = XR_NULL_HANDLE;
        g.modeToggleAction = XR_NULL_HANDLE;
        g.rightHandPath = XR_NULL_PATH;
        log_state("ptt_input_degraded", "action_setup_failed");
        return false;
    };
    XrActionSetCreateInfo set_info{XR_TYPE_ACTION_SET_CREATE_INFO};
    strcpy(set_info.actionSetName, "soma_ptt");
    strcpy(set_info.localizedActionSetName, "Soma PTT");
    set_info.priority = 0;
    if (XR_FAILED(xrCreateActionSet(g.instance, &set_info, &g.pttActionSet))) return fail();
    XrActionCreateInfo hold_info{XR_TYPE_ACTION_CREATE_INFO};
    hold_info.actionType = XR_ACTION_TYPE_FLOAT_INPUT;
    strcpy(hold_info.actionName, "ptt_hold");
    strcpy(hold_info.localizedActionName, "PTT Hold");
    hold_info.countSubactionPaths = 0;
    if (XR_FAILED(xrCreateAction(g.pttActionSet, &hold_info, &g.pttHoldAction))) return fail();
    XrActionCreateInfo toggle_info{XR_TYPE_ACTION_CREATE_INFO};
    toggle_info.actionType = XR_ACTION_TYPE_BOOLEAN_INPUT;
    strcpy(toggle_info.actionName, "mode_toggle");
    strcpy(toggle_info.localizedActionName, "Mode Toggle");
    if (XR_FAILED(xrCreateAction(g.pttActionSet, &toggle_info, &g.modeToggleAction))) return fail();
    if (XR_FAILED(xrStringToPath(g.instance, "/user/hand/right", &g.rightHandPath))) return fail();
    XrPath trigger_path = XR_NULL_PATH, a_click_path = XR_NULL_PATH;
    if (XR_FAILED(xrStringToPath(g.instance, "/user/hand/right/input/trigger/value", &trigger_path))) return fail();
    if (XR_FAILED(xrStringToPath(g.instance, "/user/hand/right/input/a/click", &a_click_path))) return fail();
    XrPath profile_path = XR_NULL_PATH;
    if (XR_FAILED(xrStringToPath(g.instance, "/interaction_profiles/oculus/touch_controller", &profile_path))) return fail();
    XrActionSuggestedBinding bindings[2] = {};
    bindings[0].action = g.pttHoldAction;
    bindings[0].binding = trigger_path;
    bindings[1].action = g.modeToggleAction;
    bindings[1].binding = a_click_path;
    XrInteractionProfileSuggestedBinding suggested{XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING};
    suggested.interactionProfile = profile_path;
    suggested.countSuggestedBindings = 2;
    suggested.suggestedBindings = bindings;
    if (XR_FAILED(xrSuggestInteractionProfileBindings(g.instance, &suggested))) return fail();
    XrSessionActionSetsAttachInfo attach{XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO};
    attach.countActionSets = 1;
    attach.actionSets = &g.pttActionSet;
    if (XR_FAILED(xrAttachSessionActionSets(g.session, &attach))) return fail();
    return true;
}

void poll_ptt_actions() {
    if (g.pttActionSet == XR_NULL_HANDLE || g.session == XR_NULL_HANDLE) return;
    XrActiveActionSet active{};
    active.actionSet = g.pttActionSet;
    active.subactionPath = XR_NULL_PATH;
    XrActionsSyncInfo sync{XR_TYPE_ACTIONS_SYNC_INFO};
    sync.countActiveActionSets = 1;
    sync.activeActionSets = &active;
    if (XR_FAILED(xrSyncActions(g.session, &sync))) {
        if (g.pttHeld) {
            g.pttHeld = false;
            call_java_enqueue_ptt_held(false);
        }
        return;
    }
    // Always poll both actions for state, but gate handling on suspend/resume
    XrActionStateFloat hold_state{XR_TYPE_ACTION_STATE_FLOAT};
    XrActionStateGetInfo get_hold{XR_TYPE_ACTION_STATE_GET_INFO};
    get_hold.action = g.pttHoldAction;
    XrResult hr = xrGetActionStateFloat(g.session, &get_hold, &hold_state);
    bool hold_active = XR_SUCCEEDED(hr) && hold_state.isActive == XR_TRUE;
    bool hold_held = false;
    if (hold_active) {
        if (g.pttHeld) hold_held = hold_state.currentState > 0.4f;
        else hold_held = hold_state.currentState > 0.6f;
    } else {
        // inactive while held must fail closed
        if (g.pttHeld) {
            g.pttHeld = false;
            call_java_enqueue_ptt_held(false);
        }
    }
    XrActionStateBoolean toggle_state{XR_TYPE_ACTION_STATE_BOOLEAN};
    XrActionStateGetInfo get_toggle{XR_TYPE_ACTION_STATE_GET_INFO};
    get_toggle.action = g.modeToggleAction;
    XrResult tr = xrGetActionStateBoolean(g.session, &get_toggle, &toggle_state);
    bool toggle_active = XR_SUCCEEDED(tr) && toggle_state.isActive == XR_TRUE;
    bool toggle_pressed = toggle_active && toggle_state.currentState == XR_TRUE && toggle_state.changedSinceLastSync == XR_TRUE;

    // Suspended handling: ignore trigger/PTT, consume only new A rising edge after return
    bool is_suspended = false;
    bool is_resuming = false;
    bool can_attempt_resume = false;
    bool a_release_needed = false;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        is_suspended = g.suspended_latched && g.suspended_resumable;
        is_resuming = g.resuming;
        a_release_needed = g.aReleaseRequired;
        can_attempt_resume = is_suspended && !is_resuming
                && g.session_state == XR_SESSION_STATE_FOCUSED
                && g.presence_known && g.user_present;
    }
    if (is_suspended) {
        // While suspended, ignore trigger entirely
        if (g.pttHeld) {
            g.pttHeld = false;
            call_java_enqueue_ptt_held(false);
        }
        // Held-across-A protection: require observed A release before accepting any rising edge
        if (a_release_needed) {
            bool a_currently_pressed = toggle_active && toggle_state.currentState == XR_TRUE;
            if (a_currently_pressed) {
                return; // still held across suspend, wait for release
            } else {
                std::lock_guard<std::mutex> lock(g.mutex);
                g.aReleaseRequired = false;
            }
        }
        if (can_attempt_resume && toggle_pressed) {
            // Install one-shot token+resuming UNDER LOCK before enqueue to avoid race
            uint64_t sequence = 0;
            {
                std::lock_guard<std::mutex> lock(g.mutex);
                sequence = ++g.controlGeneration;
                g.pendingResumeSequence = sequence;
                g.pendingResumeAToken = true;
                g.resuming = true;
                g.shell_state = "RESUMING...";
                g.shell_code = "PLEASE WAIT";
                g.content_dirty = true;
            }
            if (!call_java_enqueue_resume(sequence)) {
                std::lock_guard<std::mutex> lock(g.mutex);
                if (g.pendingResumeSequence == sequence) {
                    g.pendingResumeSequence = 0;
                    g.pendingResumeAToken = false;
                    g.resuming = false;
                    g.aReleaseRequired = true;
                    g.shell_state = "SUSPENDED";
                    g.shell_code = "PRESS A TO RESUME";
                    g.content_dirty = true;
                }
            }
            // Do not call toggle_mode for this A press (suppressed)
            return;
        }
        // While suspended (including resuming), never toggle mode
        return;
    }

    // Not suspended: normal PTT/VAD handling, but respect triggerReleaseRequired after resume
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        if (g.triggerReleaseRequired) {
            // Require observed trigger release (<0.4) before PTT becomes eligible
            bool released = !hold_active || hold_state.currentState < 0.4f;
            if (released) {
                g.triggerReleaseRequired = false;
            } else {
                // Still held from before resume — suppress held
                if (hold_held) hold_held = false;
            }
        }
    }
    if (hold_held != g.pttHeld) {
        g.pttHeld = hold_held;
        call_java_enqueue_ptt_held(hold_held);
    } else if (!hold_active && g.pttHeld) {
        g.pttHeld = false;
        call_java_enqueue_ptt_held(false);
    }
    if (toggle_pressed) {
        call_java_enqueue_toggle_mode(next_control_sequence());
    }
}

bool xr_init(android_app* app) {
    g.app = app;
    PFN_xrInitializeLoaderKHR initialize_loader = nullptr;
    xrGetInstanceProcAddr(
            XR_NULL_HANDLE,
            "xrInitializeLoaderKHR",
            reinterpret_cast<PFN_xrVoidFunction*>(&initialize_loader));
    if (initialize_loader == nullptr) return false;
    XrLoaderInitInfoAndroidKHR loader_info{XR_TYPE_LOADER_INIT_INFO_ANDROID_KHR};
    loader_info.applicationVM = app->activity->vm;
    loader_info.applicationContext = app->activity->clazz;
    XrResult result = initialize_loader(
            reinterpret_cast<const XrLoaderInitInfoBaseHeaderKHR*>(&loader_info));
    if (XR_FAILED(result)) return false;

    uint32_t extension_count = 0;
    result = xrEnumerateInstanceExtensionProperties(nullptr, 0, &extension_count, nullptr);
    if (XR_FAILED(result)) return false;
    std::vector<XrExtensionProperties> extensions(
            extension_count, {XR_TYPE_EXTENSION_PROPERTIES});
    result = xrEnumerateInstanceExtensionProperties(
            nullptr, extension_count, &extension_count, extensions.data());
    if (XR_FAILED(result)) return false;
    bool have_android = false;
    bool have_gles = false;
    bool have_passthrough = false;
    bool have_presence = false;
    for (const auto& extension : extensions) {
        have_android |= strcmp(
                extension.extensionName, XR_KHR_ANDROID_CREATE_INSTANCE_EXTENSION_NAME) == 0;
        have_gles |= strcmp(
                extension.extensionName, XR_KHR_OPENGL_ES_ENABLE_EXTENSION_NAME) == 0;
        have_passthrough |= strcmp(
                extension.extensionName, XR_FB_PASSTHROUGH_EXTENSION_NAME) == 0;
        have_presence |= strcmp(
                extension.extensionName, XR_EXT_USER_PRESENCE_EXTENSION_NAME) == 0;
    }
    if (!have_android || !have_gles || !have_passthrough || !have_presence) return false;

    const char* enabled_extensions[] = {
            XR_KHR_ANDROID_CREATE_INSTANCE_EXTENSION_NAME,
            XR_KHR_OPENGL_ES_ENABLE_EXTENSION_NAME,
            XR_FB_PASSTHROUGH_EXTENSION_NAME,
            XR_EXT_USER_PRESENCE_EXTENSION_NAME};
    XrInstanceCreateInfoAndroidKHR android_info{XR_TYPE_INSTANCE_CREATE_INFO_ANDROID_KHR};
    android_info.applicationVM = app->activity->vm;
    android_info.applicationActivity = app->activity->clazz;
    XrInstanceCreateInfo instance_info{XR_TYPE_INSTANCE_CREATE_INFO};
    instance_info.next = &android_info;
    instance_info.enabledExtensionCount = std::size(enabled_extensions);
    instance_info.enabledExtensionNames = enabled_extensions;
    strcpy(instance_info.applicationInfo.applicationName, "soma-quest-surface-v1a");
    instance_info.applicationInfo.apiVersion = XR_CURRENT_API_VERSION;
    result = xrCreateInstance(&instance_info, &g.instance);
    if (XR_FAILED(result)) return false;

    XrSystemGetInfo system_info{XR_TYPE_SYSTEM_GET_INFO};
    system_info.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
    result = xrGetSystem(g.instance, &system_info, &g.system);
    if (XR_FAILED(result)) return false;

    XrSystemUserPresencePropertiesEXT presence{XR_TYPE_SYSTEM_USER_PRESENCE_PROPERTIES_EXT};
    XrSystemPassthroughProperties2FB passthrough{XR_TYPE_SYSTEM_PASSTHROUGH_PROPERTIES2_FB};
    passthrough.next = &presence;
    XrSystemProperties properties{XR_TYPE_SYSTEM_PROPERTIES};
    properties.next = &passthrough;
    result = xrGetSystemProperties(g.instance, g.system, &properties);
    if (XR_FAILED(result)) return false;
    g.presence_supported = presence.supportsUserPresence == XR_TRUE;
    bool passthrough_supported =
            (passthrough.capabilities & XR_PASSTHROUGH_CAPABILITY_BIT_FB) != 0;
    if (!g.presence_supported || !passthrough_supported) return false;

    PFN_xrGetOpenGLESGraphicsRequirementsKHR get_requirements = nullptr;
    result = xrGetInstanceProcAddr(
            g.instance,
            "xrGetOpenGLESGraphicsRequirementsKHR",
            reinterpret_cast<PFN_xrVoidFunction*>(&get_requirements));
    XrGraphicsRequirementsOpenGLESKHR requirements{
            XR_TYPE_GRAPHICS_REQUIREMENTS_OPENGL_ES_KHR};
    if (XR_FAILED(result)
            || get_requirements == nullptr
            || XR_FAILED(get_requirements(g.instance, g.system, &requirements))) return false;
    if (!egl_init()) return false;

    XrGraphicsBindingOpenGLESAndroidKHR binding{
            XR_TYPE_GRAPHICS_BINDING_OPENGL_ES_ANDROID_KHR};
    binding.display = g.display;
    binding.config = g.config;
    binding.context = g.context;
    XrSessionCreateInfo session_info{XR_TYPE_SESSION_CREATE_INFO};
    session_info.next = &binding;
    session_info.systemId = g.system;
    result = xrCreateSession(g.instance, &session_info, &g.session);
    if (XR_FAILED(result)) return false;

    XrReferenceSpaceCreateInfo space_info{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
    space_info.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_VIEW;
    space_info.poseInReferenceSpace.orientation.w = 1.0f;
    result = xrCreateReferenceSpace(g.session, &space_info, &g.view_space);
    if (XR_FAILED(result)) return false;
    // Best-effort PTT actions; Codex reviews lifecycle. Failure does not abort init (degraded input).
    create_ptt_actions();

    uint32_t format_count = 0;
    result = xrEnumerateSwapchainFormats(g.session, 0, &format_count, nullptr);
    if (XR_FAILED(result) || format_count == 0) return false;
    std::vector<int64_t> formats(format_count, 0);
    result = xrEnumerateSwapchainFormats(
            g.session, format_count, &format_count, formats.data());
    if (XR_FAILED(result)) return false;
    int64_t color_format = 0;
    for (int64_t format : formats) {
        if (format == GL_RGBA8) {
            color_format = format;
            break;
        }
    }
    if (color_format == 0) return false;
    XrSwapchainCreateInfo swapchain_info{XR_TYPE_SWAPCHAIN_CREATE_INFO};
    swapchain_info.usageFlags =
            XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
    swapchain_info.format = color_format;
    swapchain_info.sampleCount = 1;
    swapchain_info.width = kTextureSize;
    swapchain_info.height = kTextureSize;
    swapchain_info.faceCount = 1;
    swapchain_info.arraySize = 1;
    swapchain_info.mipCount = 1;
    result = xrCreateSwapchain(g.session, &swapchain_info, &g.swapchain);
    if (XR_FAILED(result)) return false;
    uint32_t image_count = 0;
    result = xrEnumerateSwapchainImages(g.swapchain, 0, &image_count, nullptr);
    if (XR_FAILED(result) || image_count == 0) return false;
    g.images.assign(image_count, {XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR});
    result = xrEnumerateSwapchainImages(
            g.swapchain,
            image_count,
            &image_count,
            reinterpret_cast<XrSwapchainImageBaseHeader*>(g.images.data()));
    if (XR_FAILED(result)) return false;
    return passthrough_init();
}

void poll_xr() {
    // Cap per-iteration work so ALooper is not starved; 8 events per call matches spec
    int poll_budget = 8;
    for (int budget = 0; budget < poll_budget; ++budget) {
        XrEventDataBuffer event{XR_TYPE_EVENT_DATA_BUFFER};
        XrResult result = xrPollEvent(g.instance, &event);
        if (result == XR_EVENT_UNAVAILABLE) break;
        if (XR_FAILED(result)) {
            latch_suspend_terminal("xr_poll_failed");
            if (!g.finishRequested && g.app != nullptr) {
                g.finishRequested = true;
                ANativeActivity_finish(g.app->activity);
            }
            break;
        }
        if (event.type == XR_TYPE_EVENT_DATA_USER_PRESENCE_CHANGED_EXT) {
            const auto* presence =
                    reinterpret_cast<const XrEventDataUserPresenceChangedEXT*>(&event);
            if (presence->session != g.session) continue;
            {
                std::lock_guard<std::mutex> lock(g.mutex);
                g.presence_known = true;
                g.user_present = presence->isUserPresent == XR_TRUE;
            }
            log_state("user_presence", g.user_present ? "present" : "absent");
            bool should_suspend = false;
            {
                std::lock_guard<std::mutex> lock(g.mutex);
                should_suspend = !g.user_present;
                if (should_suspend && g.resuming) {
                    g.resuming = false;
                    g.pendingResumeAToken = false;
                    g.aReleaseRequired = true;
                    g.shell_state = "SUSPENDED";
                    g.shell_code = "PRESS A TO RESUME";
                    g.content_dirty = true;
                }
            }
            if (should_suspend) latch_suspend_resumable("user_presence_lost");
            continue;
        }
        if (event.type != XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED) continue;
        const auto* changed =
                reinterpret_cast<const XrEventDataSessionStateChanged*>(&event);
        XrSessionState previous;
        {
            std::lock_guard<std::mutex> lock(g.mutex);
            previous = g.session_state;
            g.session_state = changed->state;
        }
        log_state("session_state", state_name(previous));
        if (previous == XR_SESSION_STATE_FOCUSED
                && changed->state != XR_SESSION_STATE_FOCUSED) {
            if (changed->state != XR_SESSION_STATE_STOPPING
                    && changed->state != XR_SESSION_STATE_EXITING
                    && changed->state != XR_SESSION_STATE_LOSS_PENDING) {
                {
                    std::lock_guard<std::mutex> lock(g.mutex);
                    if (g.resuming) {
                        g.resuming = false;
                        g.pendingResumeAToken = false;
                        g.aReleaseRequired = true;
                        g.shell_state = "SUSPENDED";
                        g.shell_code = "PRESS A TO RESUME";
                        g.content_dirty = true;
                    }
                }
                latch_suspend_resumable("openxr_focus_lost");
            }
        }
        if (changed->state == XR_SESSION_STATE_READY && !g.session_running) {
            XrSessionBeginInfo begin_info{XR_TYPE_SESSION_BEGIN_INFO};
            begin_info.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
            result = xrBeginSession(g.session, &begin_info);
            g.session_running = XR_SUCCEEDED(result);
            if (!g.session_running) {
                latch_suspend_terminal("xr_begin_failed");
                if (!g.finishRequested && g.app != nullptr) {
                    g.finishRequested = true;
                    ANativeActivity_finish(g.app->activity);
                }
            }
        } else if (changed->state == XR_SESSION_STATE_FOCUSED) {
            g.focus_ever_reached = true;
        } else if (changed->state == XR_SESSION_STATE_STOPPING) {
            // Lifetime fix: STOPPING ends XrSession but never android_main. Resumable so explicit A can recover
            // even when STOPPING arrives before presence event. Pre-first-focus remains inert.
            if (soma::quest::isResumableLifecycleLoss(g.focus_ever_reached)) {
                latch_suspend_resumable("openxr_stopping");
            } else {
                // Pre-first-focus boot STOP is inert - no latch/notify, just end session if running
                log_state("stopping_pre_focus_inert");
            }
            if (g.session_running) xrEndSession(g.session);
            g.session_running = false;
        } else if (changed->state == XR_SESSION_STATE_EXITING
                || changed->state == XR_SESSION_STATE_LOSS_PENDING) {
            latch_suspend_terminal(state_name(changed->state));
            // EXITING/LOSS_PENDING request finish once but keep pumping ALooper until DESTROY
            if (!g.finishRequested && g.app != nullptr && g.app->activity != nullptr) {
                g.finishRequested = true;
                ANativeActivity_finish(g.app->activity);
            }
        }
    }

    uint64_t start_sequence = 0;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        bool should_start = (g.session_state == XR_SESSION_STATE_FOCUSED
                && g.presence_known && g.user_present
                && !g.transport_started && !g.suspended_latched);
        if (should_start) {
            start_sequence = ++g.controlGeneration;
            g.pendingStartSequence = start_sequence;
            // Reserve the single in-flight start before Java can report its async result.
            g.transport_started = true;
        }
    }
    if (start_sequence != 0 && !call_java_enqueue_start(start_sequence)) {
        std::lock_guard<std::mutex> lock(g.mutex);
        if (g.pendingStartSequence == start_sequence) {
            g.pendingStartSequence = 0;
            g.transport_started = false;
        }
    }
}

bool render_frame() {
    bool should_poll = false;
    bool should_frame = false;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        should_frame = soma::quest::shouldFramePump(
                g.session_running, g.androidResumed);
        should_poll = soma::quest::shouldPollLocalActions(
                g.session_running,
                g.androidResumed,
                g.session_state == XR_SESSION_STATE_FOCUSED);
    }
    if (!should_frame || g.exiting) return true;
    XrFrameWaitInfo wait_info{XR_TYPE_FRAME_WAIT_INFO};
    XrFrameState frame_state{XR_TYPE_FRAME_STATE};
    XrResult result = xrWaitFrame(g.session, &wait_info, &frame_state);
    if (XR_FAILED(result)) return false;
    if (should_poll) poll_ptt_actions();
    XrFrameBeginInfo begin_info{XR_TYPE_FRAME_BEGIN_INFO};
    result = xrBeginFrame(g.session, &begin_info);
    if (XR_FAILED(result)) return false;

    XrCompositionLayerPassthroughFB passthrough_layer{
            XR_TYPE_COMPOSITION_LAYER_PASSTHROUGH_FB};
    passthrough_layer.layerHandle = g.passthrough_layer;
    passthrough_layer.flags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;

    XrCompositionLayerQuad quad{XR_TYPE_COMPOSITION_LAYER_QUAD};
    Snapshot frame_snapshot;
    bool have_quad = false;
    bool should_ack = false;
    bool eligible = false;
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        eligible = (g.session_state == XR_SESSION_STATE_FOCUSED
                && g.presence_known && g.user_present);
    }

    if (frame_state.shouldRender == XR_TRUE && eligible) {
        std::lock_guard<std::mutex> lock(g.mutex);
        const int64_t now_ms = static_cast<int64_t>(boottime_ns() / kMsInNs);
        if (g.snapshot.ready && now_ms >= g.snapshot.deadline_ms) {
            g.snapshot = Snapshot{};
            g.shell_state = "OFFLINE";
            g.shell_code = "SNAPSHOT EXPIRED";
            g.content_dirty = true;
        }
        if (g.content_dirty) build_panel_locked();

        uint32_t image_index = 0;
        XrSwapchainImageAcquireInfo acquire_info{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
        result = xrAcquireSwapchainImage(g.swapchain, &acquire_info, &image_index);
        if (XR_FAILED(result)) return false;
        XrSwapchainImageWaitInfo image_wait{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
        image_wait.timeout = XR_INFINITE_DURATION;
        result = xrWaitSwapchainImage(g.swapchain, &image_wait);
        if (XR_FAILED(result)) {
            // Never release an image that did not reach WAITED.
            return false;
        }
        glBindTexture(GL_TEXTURE_2D, g.images[image_index].image);
        glTexSubImage2D(
                GL_TEXTURE_2D,
                0,
                0,
                0,
                kTextureSize,
                kTextureSize,
                GL_RGBA,
                GL_UNSIGNED_BYTE,
                g.pixels.data());
        glBindTexture(GL_TEXTURE_2D, 0);
        XrSwapchainImageReleaseInfo release_info{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
        result = xrReleaseSwapchainImage(g.swapchain, &release_info);
        if (XR_FAILED(result)) return false;

        frame_snapshot = g.snapshot;
        quad.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
        quad.space = g.view_space;
        quad.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
        quad.subImage.swapchain = g.swapchain;
        quad.subImage.imageRect = {{0, 0}, {kTextureSize, kTextureSize}};
        quad.subImage.imageArrayIndex = 0;
        if (frame_snapshot.ready) {
            quad.pose = frame_snapshot.pose;
            quad.size = frame_snapshot.bounds;
            should_ack = !g.snapshot.acked;
        } else {
            quad.pose.orientation.w = 1.0f;
            quad.pose.position = {0.0f, 0.0f, -1.5f};
            quad.size = {0.9f, 0.5f};
        }
        have_quad = true;
    }

    const XrCompositionLayerBaseHeader* layers[] = {
            reinterpret_cast<const XrCompositionLayerBaseHeader*>(&passthrough_layer),
            reinterpret_cast<const XrCompositionLayerBaseHeader*>(&quad)};
    XrFrameEndInfo end_info{XR_TYPE_FRAME_END_INFO};
    end_info.displayTime = frame_state.predictedDisplayTime;
    end_info.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
    end_info.layerCount = have_quad ? 2u : 1u;
    end_info.layers = layers;
    result = xrEndFrame(g.session, &end_info);
    if (XR_FAILED(result)) return false;
    g.frames++;

    if (should_ack) {
        {
            std::lock_guard<std::mutex> lock(g.mutex);
            if (g.snapshot.ready
                    && g.snapshot.revision == frame_snapshot.revision
                    && g.snapshot.hash == frame_snapshot.hash) {
                g.snapshot.acked = true;
            } else {
                should_ack = false;
            }
        }
        if (should_ack) call_java_enqueue_ack(next_control_sequence(), frame_snapshot);
    }
    return true;
}

void teardown() {
    if (g.pttActionSet != XR_NULL_HANDLE) xrDestroyActionSet(g.pttActionSet);
    g.pttActionSet = XR_NULL_HANDLE;
    g.pttHoldAction = XR_NULL_HANDLE;
    g.modeToggleAction = XR_NULL_HANDLE;
    if (g.passthrough_layer != XR_NULL_HANDLE && xrDestroyPassthroughLayerFB_ != nullptr) {
        xrDestroyPassthroughLayerFB_(g.passthrough_layer);
    }
    if (g.passthrough != XR_NULL_HANDLE && xrDestroyPassthroughFB_ != nullptr) {
        xrDestroyPassthroughFB_(g.passthrough);
    }
    if (g.session_running && g.session != XR_NULL_HANDLE) {
        if (g.session_state == XR_SESSION_STATE_STOPPING) xrEndSession(g.session);
        g.session_running = false;
    }
    if (g.swapchain != XR_NULL_HANDLE) xrDestroySwapchain(g.swapchain);
    if (g.view_space != XR_NULL_HANDLE) xrDestroySpace(g.view_space);
    if (g.session != XR_NULL_HANDLE) xrDestroySession(g.session);
    if (g.instance != XR_NULL_HANDLE) xrDestroyInstance(g.instance);
    if (g.display != EGL_NO_DISPLAY) {
        eglMakeCurrent(g.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (g.surface != EGL_NO_SURFACE) eglDestroySurface(g.display, g.surface);
        if (g.context != EGL_NO_CONTEXT) eglDestroyContext(g.display, g.context);
        eglTerminate(g.display);
    }
    log_state("teardown_complete");
}

std::string from_jstring(JNIEnv* env, jstring value) {
    if (value == nullptr) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeOnTransportState(
        JNIEnv* env, jclass, jlong activity_generation, jstring state, jstring code, jint) {
    std::string next_state = from_jstring(env, state);
    std::string next_code = from_jstring(env, code);
    std::lock_guard<std::mutex> lock(g.mutex);
    if (static_cast<uint64_t>(activity_generation) != g.activityGeneration) return;
    if (g.suspended_latched) {
        if (g.suspended_resumable) {
            if (next_state == "suspended") {
                g.resuming = false;
                g.pendingResumeAToken = false;
                g.aReleaseRequired = true;
                g.shell_state = "SUSPENDED";
                g.shell_code = "PRESS A TO RESUME";
                g.content_dirty = true;
            } else if (next_state == "resuming") {
                g.shell_state = "RESUMING...";
                g.shell_code = "PLEASE WAIT";
                g.content_dirty = true;
            } else if (next_state == "terminal" || next_state == "offline") {
                // Java NEW/CONNECTING failure after resumable suspend became terminal — upgrade shell
                g.suspended_resumable = false;
                g.resuming = false;
                g.pendingResumeAToken = false;
                g.aReleaseRequired = false;
                g.triggerReleaseRequired = false;
                g.shell_state = "SUSPENDED";
                g.shell_code = "EXIT AND RELAUNCH TO RESUME";
                g.content_dirty = true;
            }
        }
        return;
    }
    // Every state transition precedes or replaces capability content. Never retain a panel
    // from the prior connection while negotiation, reconnect, or teardown is in progress.
    g.snapshot = Snapshot{};
    g.shell_state = next_state.empty() ? "OFFLINE" : next_state;
    g.shell_code = next_code;
    g.content_dirty = true;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeCompleteDeliberateResume(
        JNIEnv* env, jclass, jlong activity_generation, jstring fresh_epoch) {
    std::string epoch = from_jstring(env, fresh_epoch);
    std::lock_guard<std::mutex> lock(g.mutex);
    if (static_cast<uint64_t>(activity_generation) != g.activityGeneration) return JNI_FALSE;
    if (!g.suspended_latched || !g.suspended_resumable || !g.resuming || !g.pendingResumeAToken) {
        return JNI_FALSE;
    }
    bool focus_presence_ok = (g.session_state == XR_SESSION_STATE_FOCUSED && g.presence_known && g.user_present);
    if (!focus_presence_ok) {
        g.resuming = false;
        g.pendingResumeAToken = false;
        g.shell_state = "SUSPENDED";
        g.shell_code = "PRESS A TO RESUME";
        g.content_dirty = true;
        return JNI_FALSE;
    }
    if (epoch.empty() || epoch == "0" || epoch == g.micLatch.latchedEpoch) {
        g.resuming = false;
        g.pendingResumeAToken = false;
        g.shell_state = "SUSPENDED";
        g.shell_code = "PRESS A TO RESUME";
        g.content_dirty = true;
        return JNI_FALSE;
    }
    if (!soma::quest::tryDeliberateMicResume(g.micLatch, epoch.c_str(), true)) {
        g.resuming = false;
        g.pendingResumeAToken = false;
        g.shell_state = "SUSPENDED";
        g.shell_code = "PRESS A TO RESUME";
        g.content_dirty = true;
        return JNI_FALSE;
    }
    g.suspended_latched = false;
    g.suspended_resumable = false;
    g.suspend_notified = false;
    g.resuming = false;
    g.pendingResumeAToken = false;
    g.pendingResumeSequence = 0;
    g.triggerReleaseRequired = true;
    g.shell_state = "RESUMING...";
    g.shell_code = "AWAITING FRESH PANEL";
    g.content_dirty = true;
    return JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeOnPanelSnapshot(
        JNIEnv* env,
        jclass,
        jlong activity_generation,
        jstring session_epoch,
        jstring lease_id,
        jstring revision,
        jstring document_hash,
        jstring surface_id,
        jstring text,
        jfloat x,
        jfloat y,
        jfloat z,
        jfloat qx,
        jfloat qy,
        jfloat qz,
        jfloat qw,
        jfloat width,
        jfloat height,
        jlong deadline_ms) {
    Snapshot snapshot;
    snapshot.epoch = from_jstring(env, session_epoch);
    snapshot.lease = from_jstring(env, lease_id);
    snapshot.revision = from_jstring(env, revision);
    snapshot.hash = from_jstring(env, document_hash);
    snapshot.surface = from_jstring(env, surface_id);
    snapshot.text = from_jstring(env, text);
    snapshot.pose = {{qx, qy, qz, qw}, {x, y, z}};
    snapshot.bounds = {
            std::clamp(width, 0.35f, 2.0f),
            std::clamp(height, 0.20f, 1.2f)};
    snapshot.deadline_ms = deadline_ms;
    snapshot.ready = true;
    std::lock_guard<std::mutex> lock(g.mutex);
    if (static_cast<uint64_t>(activity_generation) != g.activityGeneration) return;
    if (g.suspended_latched) return;
    g.snapshot = std::move(snapshot);
    g.content_dirty = true;
}

extern "C" JNIEXPORT void JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeOnCaptureStatus(
        JNIEnv* env, jclass, jlong activity_generation, jint mode, jstring state) {
    std::string next = from_jstring(env, state);
    if (next.empty()) next = "idle";
    std::lock_guard<std::mutex> lock(g.mutex);
    if (static_cast<uint64_t>(activity_generation) != g.activityGeneration) return;
    if (g.captureMode == static_cast<int>(mode) && g.captureState == next) return;
    g.captureMode = static_cast<int>(mode);
    g.captureState = next;
    g.content_dirty = true;
}

extern "C" JNIEXPORT void JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeOnControlResult(
        JNIEnv*, jclass, jlong activity_generation, jlong sequence, jint kind, jboolean accepted) {
    std::lock_guard<std::mutex> lock(g.mutex);
    if (static_cast<uint64_t>(activity_generation) != g.activityGeneration) return;
    const uint64_t result_sequence = static_cast<uint64_t>(sequence);
    if (kind == 1 && g.pendingStartSequence == result_sequence) {
        g.pendingStartSequence = 0;
        if (accepted != JNI_TRUE) g.transport_started = false;
        return;
    }
    if (kind == 2 && g.pendingResumeSequence == result_sequence) {
        g.pendingResumeSequence = 0;
        if (accepted == JNI_TRUE) return;
        g.resuming = false;
        g.pendingResumeAToken = false;
        g.aReleaseRequired = true;
        g.shell_state = "SUSPENDED";
        g.shell_code = "PRESS A TO RESUME";
        g.content_dirty = true;
    }
}

extern "C" jint JNI_OnLoad(JavaVM* vm, void*) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
    jclass local = env->FindClass("org/soma/questsurface/QuestSurfaceActivity");
    if (local == nullptr) return JNI_VERSION_1_6;
    g_activityClass = reinterpret_cast<jclass>(env->NewGlobalRef(local));
    env->DeleteLocalRef(local);
    if (g_activityClass == nullptr) return JNI_VERSION_1_6;
    g_midActivityGeneration = env->GetMethodID(
            g_activityClass, "activityGenerationFromNative", "()J");
    g_midEnqueueStart = env->GetMethodID(
            g_activityClass, "enqueueStartTransport", "(J)Z");
    g_midEnqueueSuspend = env->GetMethodID(
            g_activityClass, "enqueueSuspendResumable", "(JLjava/lang/String;)V");
    g_midEnqueueStop = env->GetMethodID(
            g_activityClass, "enqueueStopPermanently", "(JLjava/lang/String;)V");
    g_midEnqueueResume = env->GetMethodID(
            g_activityClass, "enqueueResumeTransport", "(J)Z");
    g_midEnqueuePtt = env->GetMethodID(
            g_activityClass, "setPttHeldFromNative", "(Z)V");
    g_midEnqueueToggle = env->GetMethodID(
            g_activityClass, "enqueueToggleMode", "(J)Z");
    g_midEnqueueAck = env->GetMethodID(
            g_activityClass,
            "enqueueBoundsAck",
            "(JLjava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;"
            "Ljava/lang/String;FF)V");
    if (env->ExceptionCheck()) env->ExceptionClear();
    if (g_midActivityGeneration == nullptr
            || g_midEnqueueStart == nullptr
            || g_midEnqueueSuspend == nullptr
            || g_midEnqueueStop == nullptr
            || g_midEnqueueResume == nullptr
            || g_midEnqueuePtt == nullptr
            || g_midEnqueueToggle == nullptr
            || g_midEnqueueAck == nullptr) {
        return JNI_ERR;
    }
    return JNI_VERSION_1_6;
}

extern "C" void android_main(android_app* app) {
    // Reset per-run state for same-process Activity recreation (AppState is static) — manual due to mutex non-assignable
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        g.session_state = XR_SESSION_STATE_UNKNOWN;
        g.view_space = XR_NULL_HANDLE;
        g.swapchain = XR_NULL_HANDLE;
        g.images.clear();
        g.pttActionSet = XR_NULL_HANDLE;
        g.pttHoldAction = XR_NULL_HANDLE;
        g.modeToggleAction = XR_NULL_HANDLE;
        g.rightHandPath = XR_NULL_PATH;
        g.pttHeld = false;
        g.prevPttHeld = false;
        g.prevTogglePressed = false;
        g.captureMode = 0;
        g.captureState = "idle";
        g.display = EGL_NO_DISPLAY;
        g.config = nullptr;
        g.context = EGL_NO_CONTEXT;
        g.surface = EGL_NO_SURFACE;
        g.passthrough = XR_NULL_HANDLE;
        g.passthrough_layer = XR_NULL_HANDLE;
        g.passthrough_running = false;
        g.presence_supported = false;
        g.pixels.clear();
        g.snapshot = Snapshot{};
        g.shell_state = "WAITING FOR FOCUS AND PRESENCE";
        g.shell_code = "LOCAL STOP: EXIT APP";
        g.content_dirty = true;
        g.session_running = false;
        g.exiting = false;
        g.focus_ever_reached = false;
        g.presence_known = false;
        g.user_present = false;
        g.transport_started = false;
        g.suspended_latched = false;
        g.suspend_notified = false;
        g.suspended_resumable = false;
        g.resuming = false;
        g.pendingResumeAToken = false;
        g.triggerReleaseRequired = false;
        g.aReleaseRequired = false;
        g.pendingLocalStop = false;
        g.pendingPause = false;
        g.androidResumed = true;
        g.finishRequested = false;
        g.activityGeneration = 0;
        g.controlGeneration = 0;
        g.pendingStartSequence = 0;
        g.pendingResumeSequence = 0;
        g.micLatch = soma::quest::MicLatchState{};
        g.frames = 0;
        g.app = app;
        g.instance = XR_NULL_HANDLE;
        g.system = XR_NULL_SYSTEM_ID;
        g.session = XR_NULL_HANDLE;
    }
    app->onAppCmd = [](android_app* /*app*/, int32_t command) {
        if (command == APP_CMD_RESUME) {
            std::lock_guard<std::mutex> lock(g.mutex);
            g.androidResumed = true;
        }
        if (command == APP_CMD_PAUSE) {
            std::lock_guard<std::mutex> lock(g.mutex);
            g.androidResumed = false;
            g.pendingPause = true;
        }
        if (command == APP_CMD_STOP) {
            std::lock_guard<std::mutex> lock(g.mutex);
            g.androidResumed = false;
            g.pendingLocalStop = true;
        }
        if (command == APP_CMD_DESTROY) g.exiting = true;
    };
    const int64_t activity_generation = call_java_activity_generation();
    {
        std::lock_guard<std::mutex> lock(g.mutex);
        if (activity_generation > 0) {
            g.activityGeneration = static_cast<uint64_t>(activity_generation);
        }
    }
    log_state("startup", "perceives_nothing");
    if (activity_generation <= 0 || !xr_init(app)) {
        log_state("startup_failed");
        latch_suspend_terminal("xr_init_failed");
        if (!g.finishRequested && app->activity != nullptr) {
            g.finishRequested = true;
            ANativeActivity_finish(app->activity);
        }
        // Pump ALooper to DESTROY instead of returning immediately (avoid dead glue)
        while (!soma::quest::shouldExitNativeLoop(
                g.exiting, app->destroyRequested != 0)) {
            int events; android_poll_source* src;
            ALooper_pollOnce(50, nullptr, &events, reinterpret_cast<void**>(&src));
            if (src) src->process(app, src);
            if (app->destroyRequested) g.exiting = true;
        }
        teardown();
        return;
    }

    while (!soma::quest::shouldExitNativeLoop(
            g.exiting, app->destroyRequested != 0)) {
        // v2.1: frame-pump whenever Android resumed and XrSession running (including resumable-suspended for A)
        bool framePaced = false;
        {
            std::lock_guard<std::mutex> lock(g.mutex);
            framePaced = soma::quest::shouldFramePump(
                    g.session_running, g.androidResumed);
        }
        int timeoutMs = framePaced ? 0 : 20;
        int events = 0;
        android_poll_source* source = nullptr;
        int pollRes = ALooper_pollOnce(timeoutMs, nullptr, &events, reinterpret_cast<void**>(&source));
        bool sawLifecyclePauseStop = false;
        if (pollRes >= 0) {
            if (source != nullptr) source->process(app, source);
            if (app->destroyRequested != 0) {
                g.exiting = true;
                sawLifecyclePauseStop = true;
            }
        }
        // Burst drain all ready sources (ensure full APP_CMD_PAUSE/STOP burst processed)
        while (ALooper_pollOnce(0, nullptr, &events, reinterpret_cast<void**>(&source)) >= 0) {
            if (source != nullptr) source->process(app, source);
            if (app->destroyRequested != 0) {
                g.exiting = true;
                sawLifecyclePauseStop = true;
            }
        }
        // Handle deferred pause/stop with resumable classification after first focus
        bool do_pause = false;
        bool do_stop = false;
        {
            std::lock_guard<std::mutex> lock(g.mutex);
            if (g.pendingPause) { g.pendingPause = false; do_pause = true; }
            if (g.pendingLocalStop) { g.pendingLocalStop = false; do_stop = true; }
        }
        if (do_pause || do_stop) sawLifecyclePauseStop = true;
        if (do_pause) {
            bool resumable = false;
            { std::lock_guard<std::mutex> lock(g.mutex); resumable = g.focus_ever_reached; }
            if (soma::quest::isResumableLifecycleLoss(resumable)) {
                latch_suspend_resumable("local_pause");
            }
            else log_state("pause_pre_focus_inert");
        }
        if (do_stop) {
            bool resumable = false;
            { std::lock_guard<std::mutex> lock(g.mutex); resumable = g.focus_ever_reached; }
            if (soma::quest::isResumableLifecycleLoss(resumable)) {
                latch_suspend_resumable("local_stop");
            }
            else log_state("stop_pre_focus_inert");
        }
        if (app->destroyRequested != 0) {
            sawLifecyclePauseStop = true;
        }
        if (sawLifecyclePauseStop) {
            // Ack lifecycle immediately without blocking in XR/render
            continue;
        }
        poll_xr();
        // v2.1: eligibility controls content, not frame pacing — still pump to read A while resumable-suspended
        // Skip xrWaitFrame only while Android-paused/session-stopped, which is handled by render_frame's early return
        if (!render_frame()) {
            log_state("frame_failure");
            latch_suspend_terminal("frame_failure");
            if (!g.finishRequested && app->activity != nullptr) {
                g.finishRequested = true;
                ANativeActivity_finish(app->activity);
            }
            // keep pumping ALooper until DESTROY (do not set g.exiting directly)
        }
    }

    latch_suspend("client_exit");
    teardown();
    ANativeActivity_finish(app->activity);
}
