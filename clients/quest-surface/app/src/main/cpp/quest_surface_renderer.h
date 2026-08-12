#pragma once
// Split unit: Vulkan renderer seam (precompiled SPIR-V, no runtime compile).
// GLES path remains primary until Vulkan vertical lands; this header reserves the interface
// and keeps lifecycle defenses out of renderer.
// Default OFF preserves GLES fallback; -DUSE_VULKAN=ON enables XR_KHR_vulkan_enable2 path.
#include "quest_surface_composition.h"
#include <openxr/openxr.h>

namespace soma { namespace quest {

#ifdef XR_USE_GRAPHICS_API_VULKAN
// Vulkan renderer owns instance/device/queues via XR_KHR_vulkan_enable2,
// stereo color+depth swapchains, transparent XrCompositionLayerProjection over passthrough,
// and precompiled SPIR-V pipelines (solid / glyph-image / line / unlit-mesh).
struct VulkanRenderer {
    bool init(XrInstance instance, XrSystemId system, XrSession session);
    void shutdown();
    // Upload is off frame thread; generation handle published at frame boundary behind fences.
    bool stage_draw_list(const DrawList& list);
    bool submit_frame(XrTime display_time, XrSpace view_space);
    bool isReady() const;
    XrSwapchain colorSwapchain() const;
};
#else
// Gated OFF: stub keeps call sites compilable; lifecycle/ANR defenses stay in GLES path.
struct VulkanRenderer {
    bool init(XrInstance, XrSystemId, XrSession) { return false; }
    void shutdown() {}
    bool stage_draw_list(const DrawList&) { return false; }
    bool submit_frame(XrTime, XrSpace) { return false; }
    bool isReady() const { return false; }
};
#endif

}} // soma::quest
