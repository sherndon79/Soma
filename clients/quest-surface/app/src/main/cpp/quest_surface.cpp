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
    soma::quest::MicLatchState micLatch;
    uint64_t frames = 0;
};

AppState g;

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

bool call_java_start() {
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return false;
    jclass activity = env->GetObjectClass(g.app->activity->clazz);
    jmethodID method = env->GetStaticMethodID(activity, "startTransportFromNative", "()Z");
    bool started = false;
    if (method != nullptr) started = env->CallStaticBooleanMethod(activity, method) == JNI_TRUE;
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        started = false;
    }
    env->DeleteLocalRef(activity);
    detach_java(attached);
    return started;
}

void call_java_suspend(const char* reason) {
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    jclass activity = env->GetObjectClass(g.app->activity->clazz);
    jmethodID method = env->GetStaticMethodID(
            activity, "suspendTransportFromNative", "(Ljava/lang/String;)V");
    jstring value = env->NewStringUTF(reason);
    if (method != nullptr && value != nullptr) env->CallStaticVoidMethod(activity, method, value);
    if (env->ExceptionCheck()) env->ExceptionClear();
    if (value != nullptr) env->DeleteLocalRef(value);
    env->DeleteLocalRef(activity);
    detach_java(attached);
}

void call_java_ack(const Snapshot& snapshot) {
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    jclass activity = env->GetObjectClass(g.app->activity->clazz);
    jmethodID method = env->GetStaticMethodID(
            activity,
            "sendActualBoundsAckFromNative",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;"
            "Ljava/lang/String;FF)V");
    jstring epoch = env->NewStringUTF(snapshot.epoch.c_str());
    jstring lease = env->NewStringUTF(snapshot.lease.c_str());
    jstring revision = env->NewStringUTF(snapshot.revision.c_str());
    jstring hash = env->NewStringUTF(snapshot.hash.c_str());
    jstring surface = env->NewStringUTF(snapshot.surface.c_str());
    if (method != nullptr
            && epoch != nullptr
            && lease != nullptr
            && revision != nullptr
            && hash != nullptr
            && surface != nullptr) {
        env->CallStaticVoidMethod(
                activity,
                method,
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
    env->DeleteLocalRef(activity);
    detach_java(attached);
}

void latch_suspend(const char* reason) {
    // capture epoch for latch before locking
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
            g.snapshot = Snapshot{};
            g.shell_state = "SUSPENDED";
            g.shell_code = "EXIT AND RELAUNCH TO RESUME";
            g.content_dirty = true;
        }
        // v1b mic-off latch: narrowing-only, requires deliberate resume with fresh epoch
        soma::quest::latchMic(g.micLatch, reason ? reason : "suspend", epoch_copy);
        if (!g.suspend_notified) {
            g.suspend_notified = true;
            notify = true;
        }
    }
    if (notify) call_java_suspend(reason);
}

// Deliberate resume requires fresh epoch and explicit intent; re-don alone never clears.
bool try_deliberate_mic_resume(const char* fresh_epoch, bool explicit_intent) {
    std::lock_guard<std::mutex> lock(g.mutex);
    return soma::quest::tryDeliberateMicResume(g.micLatch, fresh_epoch, explicit_intent);
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

void call_java_ptt_held(bool held) {
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    jclass activity = env->GetObjectClass(g.app->activity->clazz);
    jmethodID method = env->GetStaticMethodID(activity, "onPttHeldFromNative", "(Z)V");
    if (method != nullptr) env->CallStaticVoidMethod(activity, method, held ? JNI_TRUE : JNI_FALSE);
    if (env->ExceptionCheck()) env->ExceptionClear();
    env->DeleteLocalRef(activity);
    detach_java(attached);
}

void call_java_toggle_mode() {
    bool attached = false;
    JNIEnv* env = attach_java(&attached);
    if (env == nullptr) return;
    jclass activity = env->GetObjectClass(g.app->activity->clazz);
    jmethodID method = env->GetStaticMethodID(activity, "onToggleModeFromNative", "()V");
    if (method != nullptr) env->CallStaticVoidMethod(activity, method);
    if (env->ExceptionCheck()) env->ExceptionClear();
    env->DeleteLocalRef(activity);
    detach_java(attached);
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
        // Fail closed: controller loss while held must not stream indefinitely
        if (g.pttHeld) {
            g.pttHeld = false;
            call_java_ptt_held(false);
        }
        return;
    }
    // Trigger float with hysteresis 0.6 / 0.4
    XrActionStateFloat hold_state{XR_TYPE_ACTION_STATE_FLOAT};
    XrActionStateGetInfo get_hold{XR_TYPE_ACTION_STATE_GET_INFO};
    get_hold.action = g.pttHoldAction;
    XrResult hr = xrGetActionStateFloat(g.session, &get_hold, &hold_state);
    if (XR_FAILED(hr) || hold_state.isActive != XR_TRUE) {
        if (g.pttHeld) {
            g.pttHeld = false;
            call_java_ptt_held(false);
        }
    } else {
        bool held = false;
        if (g.pttHeld) held = hold_state.currentState > 0.4f;
        else held = hold_state.currentState > 0.6f;
        if (held != g.pttHeld) {
            g.pttHeld = held;
            call_java_ptt_held(held);
        }
    }
    XrActionStateBoolean toggle_state{XR_TYPE_ACTION_STATE_BOOLEAN};
    XrActionStateGetInfo get_toggle{XR_TYPE_ACTION_STATE_GET_INFO};
    get_toggle.action = g.modeToggleAction;
    if (XR_SUCCEEDED(xrGetActionStateBoolean(g.session, &get_toggle, &toggle_state)) && toggle_state.isActive == XR_TRUE) {
        bool pressed = toggle_state.currentState == XR_TRUE && toggle_state.changedSinceLastSync == XR_TRUE;
        if (pressed) call_java_toggle_mode();
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
    for (;;) {
        XrEventDataBuffer event{XR_TYPE_EVENT_DATA_BUFFER};
        XrResult result = xrPollEvent(g.instance, &event);
        if (result == XR_EVENT_UNAVAILABLE) break;
        if (XR_FAILED(result)) {
            g.exiting = true;
            break;
        }
        if (event.type == XR_TYPE_EVENT_DATA_USER_PRESENCE_CHANGED_EXT) {
            const auto* presence =
                    reinterpret_cast<const XrEventDataUserPresenceChangedEXT*>(&event);
            if (presence->session != g.session) continue;
            g.presence_known = true;
            g.user_present = presence->isUserPresent == XR_TRUE;
            log_state("user_presence", g.user_present ? "present" : "absent");
            if (!g.user_present) latch_suspend("user_presence_lost");
            continue;
        }
        if (event.type != XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED) continue;
        const auto* changed =
                reinterpret_cast<const XrEventDataSessionStateChanged*>(&event);
        const XrSessionState previous = g.session_state;
        g.session_state = changed->state;
        log_state("session_state", state_name(previous));
        if (previous == XR_SESSION_STATE_FOCUSED
                && changed->state != XR_SESSION_STATE_FOCUSED) {
            latch_suspend("openxr_focus_lost");
        }
        if (changed->state == XR_SESSION_STATE_READY && !g.session_running) {
            XrSessionBeginInfo begin_info{XR_TYPE_SESSION_BEGIN_INFO};
            begin_info.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
            result = xrBeginSession(g.session, &begin_info);
            g.session_running = XR_SUCCEEDED(result);
            if (!g.session_running) g.exiting = true;
        } else if (changed->state == XR_SESSION_STATE_FOCUSED) {
            g.focus_ever_reached = true;
        } else if (changed->state == XR_SESSION_STATE_STOPPING) {
            if (g.session_running) xrEndSession(g.session);
            g.session_running = false;
            g.exiting = true;
        } else if (changed->state == XR_SESSION_STATE_EXITING
                || changed->state == XR_SESSION_STATE_LOSS_PENDING) {
            g.exiting = true;
        }
    }

    if (g.session_state == XR_SESSION_STATE_FOCUSED
            && g.presence_known
            && g.user_present
            && !g.transport_started
            && !g.suspended_latched) {
        // NativeActivity can start android_main while the Java subclass is still completing
        // onCreate. Retry until the Java transport boundary confirms it actually started.
        g.transport_started = call_java_start();
    }
}

bool render_frame() {
    if (!g.session_running || g.exiting) return true;
    XrFrameWaitInfo wait_info{XR_TYPE_FRAME_WAIT_INFO};
    XrFrameState frame_state{XR_TYPE_FRAME_STATE};
    XrResult result = xrWaitFrame(g.session, &wait_info, &frame_state);
    if (XR_FAILED(result)) return false;
    if (g.session_state == XR_SESSION_STATE_FOCUSED) poll_ptt_actions();
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
    const bool eligible = g.session_state == XR_SESSION_STATE_FOCUSED
            && g.presence_known
            && g.user_present;

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
        if (should_ack) call_java_ack(frame_snapshot);
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
        JNIEnv* env, jclass, jstring state, jstring code, jint) {
    std::string next_state = from_jstring(env, state);
    std::string next_code = from_jstring(env, code);
    std::lock_guard<std::mutex> lock(g.mutex);
    if (g.suspended_latched) return;
    // Every state transition precedes or replaces capability content. Never retain a panel
    // from the prior connection while negotiation, reconnect, or teardown is in progress.
    g.snapshot = Snapshot{};
    g.shell_state = next_state.empty() ? "OFFLINE" : next_state;
    g.shell_code = next_code;
    g.content_dirty = true;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeTryDeliberateMicResume(
        JNIEnv* env, jclass, jstring fresh_epoch, jboolean explicit_intent) {
    std::string epoch = from_jstring(env, fresh_epoch);
    return try_deliberate_mic_resume(
            epoch.c_str(), explicit_intent == JNI_TRUE) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeOnPanelSnapshot(
        JNIEnv* env,
        jclass,
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
    if (g.suspended_latched) return;
    g.snapshot = std::move(snapshot);
    g.content_dirty = true;
}

extern "C" JNIEXPORT void JNICALL
Java_org_soma_questsurface_QuestSurfaceActivity_nativeOnCaptureStatus(
        JNIEnv* env, jclass, jint mode, jstring state) {
    std::string next = from_jstring(env, state);
    if (next.empty()) next = "idle";
    std::lock_guard<std::mutex> lock(g.mutex);
    if (g.captureMode == static_cast<int>(mode) && g.captureState == next) return;
    g.captureMode = static_cast<int>(mode);
    g.captureState = next;
    g.content_dirty = true;
}

extern "C" void android_main(android_app* app) {
    app->onAppCmd = [](android_app*, int32_t command) {
        if (command == APP_CMD_STOP) latch_suspend("local_stop");
        if (command == APP_CMD_DESTROY) g.exiting = true;
    };
    log_state("startup", "perceives_nothing");
    if (!xr_init(app)) {
        log_state("startup_failed");
        teardown();
        ANativeActivity_finish(app->activity);
        return;
    }

    while (!g.exiting) {
        int events = 0;
        android_poll_source* source = nullptr;
        while (ALooper_pollOnce(
                       g.session_running ? 0 : 100,
                       nullptr,
                       &events,
                       reinterpret_cast<void**>(&source)) >= 0) {
            if (source != nullptr) source->process(app, source);
            if (app->destroyRequested != 0) g.exiting = true;
        }
        poll_xr();
        if (!render_frame()) {
            log_state("frame_failure");
            latch_suspend("frame_failure");
            g.exiting = true;
        }
    }

    latch_suspend("client_exit");
    teardown();
    ANativeActivity_finish(app->activity);
}
