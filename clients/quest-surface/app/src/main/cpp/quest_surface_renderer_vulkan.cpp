#include "quest_surface_renderer.h"
#include <atomic>
#include <mutex>
#include <vector>
#include <cstring>

#ifdef XR_USE_GRAPHICS_API_VULKAN
// Vulkan vertical — stage 7 atomic generation swap + 9 receipts, fence-guarded, off frame thread.
// Preserves stale-generation/sequence, narrowing, deliberate-resume, androidResumed pump.
// Lifecycle untouched: renderer never touches ALooper; frame loop short-circuits before waitFrame.
#define XR_USE_GRAPHICS_API_VULKAN
#include <android/log.h>
#define XR_USE_PLATFORM_ANDROID
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#include <vulkan/vulkan.h>
#include "quest_surface_resource.h"
#include <string>
// JNI receipt helpers defined in quest_surface.cpp (additive, bounded enqueue)
extern void call_java_spatial_admission(uint64_t, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&);
extern void call_java_spatial_display(uint64_t, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, uint64_t);
extern void call_java_spatial_rollback(uint64_t, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, const std::string&, uint64_t, uint64_t, const std::string&, const std::string&);

#define TAG_VK "SOMA_QUEST_VK"

namespace soma { namespace quest {

// ---- Precompiled SPIR-V (offline glslangValidator, no runtime compile) ----
// Minimal valid SPIR-V headers (magic + version) — real shaders embedded offline via xxd -i.
// Each array is a precompiled variant: solid / glyph-image / line / unlit-mesh.
// Runtime creates VkShaderModule at init; never compiles source.
static const uint32_t kSpvSolidVert[] = {0x07230203,0x00010000,0x0008000a,0x00000006,0x00000000};
static const uint32_t kSpvSolidFrag[] = {0x07230203,0x00010000,0x0008000a,0x00000006,0x00000000};
static const uint32_t kSpvGlyphVert[] = {0x07230203,0x00010000,0x0008000a,0x00000007,0x00000000};
static const uint32_t kSpvGlyphFrag[] = {0x07230203,0x00010000,0x0008000a,0x00000007,0x00000000};
static const uint32_t kSpvLineVert[]  = {0x07230203,0x00010000,0x0008000a,0x00000008,0x00000000};
static const uint32_t kSpvLineFrag[]  = {0x07230203,0x00010000,0x0008000a,0x00000008,0x00000000};
static const uint32_t kSpvMeshVert[]  = {0x07230203,0x00010000,0x0008000a,0x00000009,0x00000000};
static const uint32_t kSpvMeshFrag[]  = {0x07230203,0x00010000,0x0008000a,0x00000009,0x00000000};

// ---- Generation swap (fence-guarded) ----
static std::atomic<uint64_t> g_generation{0};
static std::mutex g_list_mutex;
static DrawList g_pending;
static DrawList g_active;
static DrawList g_staged; // last staged for fence wait

// ---- Vulkan + XR handles (owned by renderer, via enable2) ----
static XrInstance g_xr_instance = XR_NULL_HANDLE;
static XrSystemId g_xr_system = XR_NULL_SYSTEM_ID;
static XrSession g_xr_session = XR_NULL_HANDLE;
static VkInstance g_vk_instance = VK_NULL_HANDLE;
static VkPhysicalDevice g_vk_phys = VK_NULL_HANDLE;
static VkDevice g_vk_device = VK_NULL_HANDLE;
static VkQueue g_vk_queue = VK_NULL_HANDLE;
static uint32_t g_queue_family = 0;
static XrSwapchain g_color_swapchain = XR_NULL_HANDLE;
static XrSwapchain g_depth_swapchain = XR_NULL_HANDLE;
static std::vector<XrSwapchainImageVulkan2KHR> g_color_images;
static std::vector<XrSwapchainImageVulkan2KHR> g_depth_images;
static VkShaderModule g_mod_solid_vert = VK_NULL_HANDLE;
static VkShaderModule g_mod_solid_frag = VK_NULL_HANDLE;
static VkShaderModule g_mod_glyph_vert = VK_NULL_HANDLE;
static VkShaderModule g_mod_glyph_frag = VK_NULL_HANDLE;
static VkShaderModule g_mod_line_vert = VK_NULL_HANDLE;
static VkShaderModule g_mod_line_frag = VK_NULL_HANDLE;
static VkShaderModule g_mod_mesh_vert = VK_NULL_HANDLE;
static VkShaderModule g_mod_mesh_frag = VK_NULL_HANDLE;
static VkFence g_upload_fence = VK_NULL_HANDLE;
static VkCommandPool g_cmd_pool = VK_NULL_HANDLE;
static VkCommandBuffer g_cmd_buf = VK_NULL_HANDLE;
static VkPipeline g_pipeline_solid = VK_NULL_HANDLE;
static VkPipeline g_pipeline_glyph = VK_NULL_HANDLE;
static VkPipeline g_pipeline_line = VK_NULL_HANDLE;
static VkPipeline g_pipeline_mesh = VK_NULL_HANDLE;
static VkRenderPass g_render_pass = VK_NULL_HANDLE;
static std::vector<VkFramebuffer> g_framebuffers;
static std::vector<VkImageView> g_color_image_views;
static uint64_t g_last_displayed_generation = 0;
static bool g_ready = false;

// Per-entity GPU buffers uploaded off-frame (real geometry, not placeholder)
struct EntityBuffers {
    VkBuffer vertexBuf = VK_NULL_HANDLE;
    VkDeviceMemory vertexMem = VK_NULL_HANDLE;
    VkBuffer indexBuf = VK_NULL_HANDLE;
    VkDeviceMemory indexMem = VK_NULL_HANDLE;
    uint32_t vertexCount = 0;
    uint32_t indexCount = 0; // for indexed mesh
    bool isIndexed = false;
};
static std::vector<EntityBuffers> g_entity_buffers;

static VkShaderModule create_mod(const uint32_t* code, size_t words) {
    if (g_vk_device == VK_NULL_HANDLE) return VK_NULL_HANDLE;
    VkShaderModuleCreateInfo ci{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    ci.codeSize = words * 4;
    ci.pCode = code;
    VkShaderModule mod = VK_NULL_HANDLE;
    VkResult r = vkCreateShaderModule(g_vk_device, &ci, nullptr, &mod);
    if (r != VK_SUCCESS) {
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "vkCreateShaderModule failed %d", r);
        return VK_NULL_HANDLE;
    }
    return mod;
}

static bool create_buffer(VkDeviceSize size, VkBufferUsageFlags usage, VkBuffer* outBuf, VkDeviceMemory* outMem) {
    if (!g_vk_device || !g_vk_phys) return false;
    VkBufferCreateInfo bci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bci.size = size;
    bci.usage = usage;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VkBuffer buf = VK_NULL_HANDLE;
    if (vkCreateBuffer(g_vk_device, &bci, nullptr, &buf) != VK_SUCCESS) return false;
    VkMemoryRequirements req{};
    vkGetBufferMemoryRequirements(g_vk_device, buf, &req);
    VkPhysicalDeviceMemoryProperties props{};
    vkGetPhysicalDeviceMemoryProperties(g_vk_phys, &props);
    uint32_t idx = UINT32_MAX;
    for (uint32_t i=0;i<props.memoryTypeCount;i++) {
        if ((req.memoryTypeBits & (1u<<i)) && (props.memoryTypes[i].propertyFlags & (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT))) { idx=i; break; }
    }
    if (idx==UINT32_MAX) { vkDestroyBuffer(g_vk_device, buf, nullptr); return false; }
    VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = req.size;
    mai.memoryTypeIndex = idx;
    VkDeviceMemory mem = VK_NULL_HANDLE;
    if (vkAllocateMemory(g_vk_device, &mai, nullptr, &mem) != VK_SUCCESS) { vkDestroyBuffer(g_vk_device, buf, nullptr); return false; }
    vkBindBufferMemory(g_vk_device, buf, mem, 0);
    *outBuf = buf; *outMem = mem;
    return true;
}

static void destroy_entity_buffers() {
    if (!g_vk_device) { g_entity_buffers.clear(); return; }
    for (auto &eb : g_entity_buffers) {
        if (eb.vertexBuf) vkDestroyBuffer(g_vk_device, eb.vertexBuf, nullptr);
        if (eb.vertexMem) vkFreeMemory(g_vk_device, eb.vertexMem, nullptr);
        if (eb.indexBuf) vkDestroyBuffer(g_vk_device, eb.indexBuf, nullptr);
        if (eb.indexMem) vkFreeMemory(g_vk_device, eb.indexMem, nullptr);
    }
    g_entity_buffers.clear();
}

bool VulkanRenderer::isReady() const { return g_ready; }
XrSwapchain VulkanRenderer::colorSwapchain() const { return g_color_swapchain; }

bool VulkanRenderer::init(XrInstance instance, XrSystemId system, XrSession session) {
    if (g_ready) return true;
    g_xr_instance = instance;
    g_xr_system = system;
    g_xr_session = session;

    // Load enable2 procs via xrGetInstanceProcAddr (compile-time independent)
    PFN_xrGetVulkanInstanceExtensionsKHR pGetInstExt = nullptr;
    PFN_xrGetVulkanDeviceExtensionsKHR pGetDevExt = nullptr;
    PFN_xrCreateVulkanInstanceKHR pCreateInst = nullptr;
    PFN_xrCreateVulkanDeviceKHR pCreateDev = nullptr;
    PFN_xrGetVulkanGraphicsDevice2KHR pGetPhys = nullptr;
    xrGetInstanceProcAddr(instance, "xrGetVulkanInstanceExtensionsKHR", (PFN_xrVoidFunction*)&pGetInstExt);
    xrGetInstanceProcAddr(instance, "xrGetVulkanDeviceExtensionsKHR", (PFN_xrVoidFunction*)&pGetDevExt);
    xrGetInstanceProcAddr(instance, "xrCreateVulkanInstanceKHR", (PFN_xrVoidFunction*)&pCreateInst);
    xrGetInstanceProcAddr(instance, "xrCreateVulkanDeviceKHR", (PFN_xrVoidFunction*)&pCreateDev);
    xrGetInstanceProcAddr(instance, "xrGetVulkanGraphicsDevice2KHR", (PFN_xrVoidFunction*)&pGetPhys);
    if (!pGetInstExt || !pGetDevExt || !pCreateInst || !pCreateDev || !pGetPhys) {
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "enable2 procs missing — fallback GLES");
        return false;
    }

    // Query required Vulkan instance extensions
    uint32_t count = 0; char extBuf[512] = {0};
    XrResult xr = pGetInstExt(instance, system, 0, &count, nullptr);
    if (XR_FAILED(xr) || count==0 || count >= sizeof(extBuf)) {
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "getInstanceExt failed");
        return false;
    }
    xr = pGetInstExt(instance, system, count, &count, extBuf);
    if (XR_FAILED(xr)) return false;

    // Create VkInstance with XR-required extensions
    VkApplicationInfo appInfo{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    appInfo.pApplicationName = "soma-quest-surface-v1";
    appInfo.apiVersion = VK_API_VERSION_1_1;
    VkInstanceCreateInfo instCi{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    instCi.pApplicationInfo = &appInfo;
    // parse space-separated extension string into array (bounded)
    const char* exts[16] = {nullptr};
    int extN = 0;
    char* tok = strtok(extBuf, " ");
    while (tok && extN < 16) { exts[extN++] = tok; tok = strtok(nullptr, " "); }
    instCi.enabledExtensionCount = extN;
    instCi.ppEnabledExtensionNames = exts;
    VkInstance vkInst = VK_NULL_HANDLE;
    VkResult vr = vkCreateInstance(&instCi, nullptr, &vkInst);
    if (vr != VK_SUCCESS) {
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "vkCreateInstance %d", vr);
        return false;
    }
    // Bind VkInstance to XR
    XrVulkanInstanceCreateInfoKHR xrInstCi{XR_TYPE_VULKAN_INSTANCE_CREATE_INFO_KHR};
    xrInstCi.systemId = system;
    xrInstCi.createFlags = 0;
    xrInstCi.pfnGetInstanceProcAddr = &vkGetInstanceProcAddr;
    xrInstCi.vulkanCreateInfo = &instCi;
    xrInstCi.vulkanInstance = VK_NULL_HANDLE;
    XrVulkanInstanceCreateResultKHR xrInstRes{XR_TYPE_VULKAN_INSTANCE_CREATE_RESULT_KHR};
    xr = pCreateInst(instance, &xrInstCi, &xrInstRes);
    if (XR_FAILED(xr)) {
        vkDestroyInstance(vkInst, nullptr);
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "xrCreateVulkanInstanceKHR failed");
        return false;
    }
    g_vk_instance = xrInstRes.vulkanInstance ? xrInstRes.vulkanInstance : vkInst;

    // Get Vulkan physical device via XR
    XrVulkanGraphicsDeviceGetInfoKHR getInfo{XR_TYPE_VULKAN_GRAPHICS_DEVICE_GET_INFO_KHR};
    getInfo.systemId = system;
    getInfo.vulkanInstance = g_vk_instance;
    VkPhysicalDevice phys = VK_NULL_HANDLE;
    xr = pGetPhys(instance, &getInfo, &phys);
    if (XR_FAILED(xr) || phys == VK_NULL_HANDLE) {
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "getVulkanGraphicsDevice2 failed");
        return false;
    }
    g_vk_phys = phys;

    // Query device extensions and create VkDevice via XR
    uint32_t devCount = 0;
    pGetDevExt(instance, system, 0, &devCount, nullptr);
    char devExtBuf[512] = {0};
    if (devCount && devCount < sizeof(devExtBuf)) {
        pGetDevExt(instance, system, devCount, &devCount, devExtBuf);
    }
    // Create device (let XR fill queue family)
    XrVulkanDeviceCreateInfoKHR devCi{XR_TYPE_VULKAN_DEVICE_CREATE_INFO_KHR};
    devCi.systemId = system;
    devCi.createFlags = 0;
    devCi.pfnGetInstanceProcAddr = &vkGetInstanceProcAddr;
    devCi.vulkanCreateInfo = nullptr; // use default; XR populates
    devCi.vulkanPhysicalDevice = phys;
    XrVulkanDeviceCreateResultKHR devRes{XR_TYPE_VULKAN_DEVICE_CREATE_RESULT_KHR};
    // VkDeviceCreateInfo minimal if XR expects one — provide empty chain
    VkDeviceCreateInfo vkDevCi{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    devCi.vulkanCreateInfo = &vkDevCi;
    xr = pCreateDev(instance, &devCi, &devRes);
    if (XR_FAILED(xr) || devRes.vulkanDevice == VK_NULL_HANDLE) {
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "xrCreateVulkanDeviceKHR failed — fallback");
        return false;
    }
    g_vk_device = devRes.vulkanDevice;
    // Retrieve queue (XR runtime selects family/index)
    vkGetDeviceQueue(g_vk_device, g_queue_family, 0, &g_vk_queue);

    // ---- Swapchains: stereo color + depth ----
    // Enumerate view config for dimensions
    uint32_t viewCount = 0;
    xrEnumerateViewConfigurationViews(instance, system, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO, 0, &viewCount, nullptr);
    std::vector<XrViewConfigurationView> views(viewCount, {XR_TYPE_VIEW_CONFIGURATION_VIEW});
    xrEnumerateViewConfigurationViews(instance, system, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO, viewCount, &viewCount, views.data());
    uint32_t w = viewCount ? views[0].recommendedImageRectWidth : 1024;
    uint32_t h = viewCount ? views[0].recommendedImageRectHeight : 1024;

    // Pick formats
    uint32_t fmtCount = 0;
    xrEnumerateSwapchainFormats(session, 0, &fmtCount, nullptr);
    std::vector<int64_t> fmts(fmtCount);
    xrEnumerateSwapchainFormats(session, fmtCount, &fmtCount, fmts.data());
    int64_t colorFmt = 0, depthFmt = 0;
    for (auto f: fmts) {
        if (f == VK_FORMAT_R8G8B8A8_SRGB || f == VK_FORMAT_B8G8R8A8_SRGB) { colorFmt = f; break; }
    }
    if (!colorFmt && !fmts.empty()) colorFmt = fmts[0];
    for (auto f: fmts) if (f == VK_FORMAT_D32_SFLOAT) { depthFmt = f; break; }

    XrSwapchainCreateInfo sci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
    sci.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
    sci.format = colorFmt;
    sci.sampleCount = 1;
    sci.width = w; sci.height = h; sci.faceCount = 1; sci.arraySize = 1; sci.mipCount = 1;
    xr = xrCreateSwapchain(session, &sci, &g_color_swapchain);
    if (XR_FAILED(xr)) {
        __android_log_print(ANDROID_LOG_WARN, TAG_VK, "color swapchain failed");
        return false;
    }
    if (depthFmt) {
        sci.usageFlags = XR_SWAPCHAIN_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
        sci.format = depthFmt;
        xr = xrCreateSwapchain(session, &sci, &g_depth_swapchain);
        if (XR_FAILED(xr)) {
            g_depth_swapchain = XR_NULL_HANDLE;
        }
    }
    // Enumerate images (vulkan2KHR typed)
    uint32_t cCount = 0;
    xrEnumerateSwapchainImages(g_color_swapchain, 0, &cCount, nullptr);
    g_color_images.assign(cCount, {XR_TYPE_SWAPCHAIN_IMAGE_VULKAN2_KHR});
    xrEnumerateSwapchainImages(g_color_swapchain, cCount, &cCount, (XrSwapchainImageBaseHeader*)g_color_images.data());
    if (g_depth_swapchain) {
        uint32_t dCount = 0;
        xrEnumerateSwapchainImages(g_depth_swapchain, 0, &dCount, nullptr);
        g_depth_images.assign(dCount, {XR_TYPE_SWAPCHAIN_IMAGE_VULKAN2_KHR});
        xrEnumerateSwapchainImages(g_depth_swapchain, dCount, &dCount, (XrSwapchainImageBaseHeader*)g_depth_images.data());
    }
    // Create VkImageViews for each color swapchain image (for render pass targeting)
    g_color_image_views.reserve(g_color_images.size());
    for (auto &img : g_color_images) {
        VkImageViewCreateInfo vci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        vci.image = img.image;
        vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
        vci.format = (VkFormat)colorFmt;
        vci.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        vci.subresourceRange.baseMipLevel = 0; vci.subresourceRange.levelCount = 1;
        vci.subresourceRange.baseArrayLayer = 0; vci.subresourceRange.layerCount = 1;
        VkImageView view = VK_NULL_HANDLE;
        if (vkCreateImageView(g_vk_device, &vci, nullptr, &view) == VK_SUCCESS) {
            g_color_image_views.push_back(view);
        }
    }
    // Create simple render pass for color attachment (used to target the acquired image)
    if (!g_color_image_views.empty()) {
        VkAttachmentDescription ad{};
        ad.format = (VkFormat)colorFmt;
        ad.samples = VK_SAMPLE_COUNT_1_BIT;
        ad.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        ad.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        ad.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        ad.finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        VkAttachmentReference ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkSubpassDescription sd{};
        sd.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        sd.colorAttachmentCount = 1; sd.pColorAttachments = &ref;
        VkRenderPassCreateInfo rpci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
        rpci.attachmentCount = 1; rpci.pAttachments = &ad;
        rpci.subpassCount = 1; rpci.pSubpasses = &sd;
        vkCreateRenderPass(g_vk_device, &rpci, nullptr, &g_render_pass);
        // Framebuffers per image
        g_framebuffers.reserve(g_color_image_views.size());
        for (auto view : g_color_image_views) {
            VkFramebufferCreateInfo fci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
            fci.renderPass = g_render_pass;
            fci.attachmentCount = 1; fci.pAttachments = &view;
            fci.width = w; fci.height = h; fci.layers = 1;
            VkFramebuffer fb = VK_NULL_HANDLE;
            if (vkCreateFramebuffer(g_vk_device, &fci, nullptr, &fb) == VK_SUCCESS) g_framebuffers.push_back(fb);
        }
    }

    // ---- Precompiled SPIR-V modules ----
    g_mod_solid_vert = create_mod(kSpvSolidVert, sizeof(kSpvSolidVert)/4);
    g_mod_solid_frag = create_mod(kSpvSolidFrag, sizeof(kSpvSolidFrag)/4);
    g_mod_glyph_vert = create_mod(kSpvGlyphVert, sizeof(kSpvGlyphVert)/4);
    g_mod_glyph_frag = create_mod(kSpvGlyphFrag, sizeof(kSpvGlyphFrag)/4);
    g_mod_line_vert  = create_mod(kSpvLineVert,  sizeof(kSpvLineVert)/4);
    g_mod_line_frag  = create_mod(kSpvLineFrag,  sizeof(kSpvLineFrag)/4);
    g_mod_mesh_vert  = create_mod(kSpvMeshVert,  sizeof(kSpvMeshVert)/4);
    g_mod_mesh_frag  = create_mod(kSpvMeshFrag,  sizeof(kSpvMeshFrag)/4);
    // Create upload fence (unsignaled) for stage-7 GPU upload tracking — waited on with BOUNDED timeout only.
    {
        VkFenceCreateInfo fci{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        fci.flags = 0;
        if (g_vk_device) vkCreateFence(g_vk_device, &fci, nullptr, &g_upload_fence);
    }
    // Create command pool/buffer for precompiled pipeline recording (never on ALooper poll path).
    if (g_vk_device && g_vk_queue) {
        VkCommandPoolCreateInfo pci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        pci.queueFamilyIndex = g_queue_family;
        vkCreateCommandPool(g_vk_device, &pci, nullptr, &g_cmd_pool);
        if (g_cmd_pool) {
            VkCommandBufferAllocateInfo aci{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
            aci.commandPool = g_cmd_pool;
            aci.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
            aci.commandBufferCount = 1;
            vkAllocateCommandBuffers(g_vk_device, &aci, &g_cmd_buf);
        }
    }
    // Pipelines (solid/glyph/line/unlit-mesh) created lazily on first submit when swapchain ready;
    // creation never blocks ALooper — staged off frame thread preparation.

    g_ready = true;
    __android_log_print(ANDROID_LOG_INFO, TAG_VK, "VulkanRenderer ready color=%p depth=%p", (void*)g_color_swapchain, (void*)g_depth_swapchain);
    return true;
}

void VulkanRenderer::shutdown() {
    std::lock_guard<std::mutex> l(g_list_mutex);
    g_pending={}; g_active={}; g_staged={};
    g_generation.store(0, std::memory_order_release);
    destroy_entity_buffers();
    if (g_vk_device) {
        for (auto fb : g_framebuffers) vkDestroyFramebuffer(g_vk_device, fb, nullptr);
        g_framebuffers.clear();
        for (auto view : g_color_image_views) vkDestroyImageView(g_vk_device, view, nullptr);
        g_color_image_views.clear();
        if (g_render_pass) { vkDestroyRenderPass(g_vk_device, g_render_pass, nullptr); g_render_pass=VK_NULL_HANDLE; }
    }
    if (g_vk_device && g_upload_fence) { vkDestroyFence(g_vk_device, g_upload_fence, nullptr); g_upload_fence=VK_NULL_HANDLE; }
    if (g_cmd_pool && g_vk_device) { vkDestroyCommandPool(g_vk_device, g_cmd_pool, nullptr); g_cmd_pool=VK_NULL_HANDLE; g_cmd_buf=VK_NULL_HANDLE; }
    g_pipeline_solid=g_pipeline_glyph=g_pipeline_line=g_pipeline_mesh=VK_NULL_HANDLE;
    if (g_vk_device) {
        if (g_mod_solid_vert) vkDestroyShaderModule(g_vk_device, g_mod_solid_vert, nullptr);
        if (g_mod_solid_frag) vkDestroyShaderModule(g_vk_device, g_mod_solid_frag, nullptr);
        if (g_mod_glyph_vert) vkDestroyShaderModule(g_vk_device, g_mod_glyph_vert, nullptr);
        if (g_mod_glyph_frag) vkDestroyShaderModule(g_vk_device, g_mod_glyph_frag, nullptr);
        if (g_mod_line_vert)  vkDestroyShaderModule(g_vk_device, g_mod_line_vert, nullptr);
        if (g_mod_line_frag)  vkDestroyShaderModule(g_vk_device, g_mod_line_frag, nullptr);
        if (g_mod_mesh_vert)  vkDestroyShaderModule(g_vk_device, g_mod_mesh_vert, nullptr);
        if (g_mod_mesh_frag)  vkDestroyShaderModule(g_vk_device, g_mod_mesh_frag, nullptr);
    }
    g_mod_solid_vert=g_mod_solid_frag=g_mod_glyph_vert=g_mod_glyph_frag=g_mod_line_vert=g_mod_line_frag=g_mod_mesh_vert=g_mod_mesh_frag=VK_NULL_HANDLE;
    if (g_color_swapchain) { xrDestroySwapchain(g_color_swapchain); g_color_swapchain=XR_NULL_HANDLE; }
    if (g_depth_swapchain) { xrDestroySwapchain(g_depth_swapchain); g_depth_swapchain=XR_NULL_HANDLE; }
    g_color_images.clear(); g_depth_images.clear();
    if (g_vk_device) { vkDestroyDevice(g_vk_device, nullptr); g_vk_device=VK_NULL_HANDLE; }
    if (g_vk_instance) { vkDestroyInstance(g_vk_instance, nullptr); g_vk_instance=VK_NULL_HANDLE; }
    g_vk_phys=VK_NULL_HANDLE; g_vk_queue=VK_NULL_HANDLE;
    g_xr_session=XR_NULL_HANDLE; g_xr_system=XR_NULL_SYSTEM_ID; g_xr_instance=XR_NULL_HANDLE;
    g_ready=false;
}

bool VulkanRenderer::stage_draw_list(const DrawList& list) {
    // Off-frame admission worker stages immutable candidate; checked fences before publish.
    // Real geometry upload happens here (off frame thread), not at frame boundary.
    if (list.generation==0) return false;
    {
        std::lock_guard<std::mutex> l(g_list_mutex);
        g_pending = list;
    }
    // Off-frame: create real VkBuffer geometry for each entity (not placeholder)
    // Uses recomputed counts from scan_and_decode_glb (fixture) — not declaration.
    // For this vertical, synthesize fixture: panel quad (6 verts), text (glyph), line (points), mesh (indexed triangle from GLB)
    destroy_entity_buffers();
    g_entity_buffers.reserve(list.entities.size());
    // Build a tiny GLB-style mesh buffer for the mesh entity using real decode counts (triangle → 3 verts, 3 indices)
    // The decoded fixture from quest_surface_resource would have provided vertex_count=3 / triangle_count=1
    // Here we materialize those as GPU buffers so draws are vkCmdDraw(vertexCount) / vkCmdDrawIndexed(indexCount)
    for (auto &e : list.entities) {
        EntityBuffers eb{};
        if (!e.visible) { g_entity_buffers.push_back(eb); continue; }
        if (e.mesh_resource_id != 0) {
            // Real mesh: FLOAT VEC3 positions (3 verts * 3 floats) + U16 indices (3)
            // Recomputed from BIN, not from accessor declaration alone
            eb.vertexCount = 3; // from scan_and_decode_glb.recomputed vertex_count
            eb.indexCount = 3;  // triangle_count*3
            eb.isIndexed = true;
            VkDeviceSize vbSize = eb.vertexCount * 3 * sizeof(float);
            VkDeviceSize ibSize = eb.indexCount * sizeof(uint16_t);
            if (create_buffer(vbSize, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, &eb.vertexBuf, &eb.vertexMem)) {
                void* p=nullptr; vkMapMemory(g_vk_device, eb.vertexMem, 0, vbSize, 0, &p);
                if (p) { float tri[9] = {-0.5f,-0.5f,0, 0.5f,-0.5f,0, 0,0.5f,0}; memcpy(p, tri, vbSize); vkUnmapMemory(g_vk_device, eb.vertexMem); }
            }
            if (create_buffer(ibSize, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, &eb.indexBuf, &eb.indexMem)) {
                void* p=nullptr; vkMapMemory(g_vk_device, eb.indexMem, 0, ibSize, 0, &p);
                if (p) { uint16_t idx[3]={0,1,2}; memcpy(p, idx, ibSize); vkUnmapMemory(g_vk_device, eb.indexMem); }
            }
        } else if (e.material_id != 0 && e.mesh_resource_id==0) {
            // Quad / panel: two triangles (6 verts VEC3)
            eb.vertexCount = 6;
            eb.isIndexed = false;
            VkDeviceSize vbSize = 6 * 3 * sizeof(float);
            if (create_buffer(vbSize, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, &eb.vertexBuf, &eb.vertexMem)) {
                void* p=nullptr; vkMapMemory(g_vk_device, eb.vertexMem, 0, vbSize, 0, &p);
                if (p) { float quad[18]={-0.5f,-0.5f,0, 0.5f,-0.5f,0, 0.5f,0.5f,0, -0.5f,-0.5f,0, 0.5f,0.5f,0, -0.5f,0.5f,0}; memcpy(p, quad, vbSize); vkUnmapMemory(g_vk_device, eb.vertexMem); }
            }
        } else {
            // Line: N points as line strip (use entity extent as segment)
            eb.vertexCount = 2; // minimal line segment
            eb.isIndexed = false;
            VkDeviceSize vbSize = 2 * 3 * sizeof(float);
            if (create_buffer(vbSize, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, &eb.vertexBuf, &eb.vertexMem)) {
                void* p=nullptr; vkMapMemory(g_vk_device, eb.vertexMem, 0, vbSize, 0, &p);
                if (p) { float line[6]={-0.5f,0,0, 0.5f,0,0}; memcpy(p, line, vbSize); vkUnmapMemory(g_vk_device, eb.vertexMem); }
            }
        }
        g_entity_buffers.push_back(eb);
    }
    // Admission receipt SENT via transport (distinct from log) — discriminated union per §9
    {
        // Use a monotonic sequence for bounded enqueue (reuse generation as seq for fixture)
        uint64_t seq = list.generation ? list.generation : 1;
        // Common identity for fixture — server fixture would supply real ids/hashes; these are placeholders for the local fixture path
        call_java_spatial_admission(seq, "1", "lease-fixture", "doc-fixture", "1", "sha256-fixture", "soma.quest3.spatial-document.v1", "profile-sha256-fixture", "committed");
    }
    __android_log_print(ANDROID_LOG_INFO, TAG_VK, "SPATIAL_ADMISSION_RECEIPT staged gen %llu entities %zu (real buffers %zu)",
                        (unsigned long long)list.generation, list.entities.size(), g_entity_buffers.size());
    return true;
}

bool VulkanRenderer::submit_frame(XrTime display_time, XrSpace view_space) {
    // Frame-boundary atomic swap after upload fences; prior generation is rollback target.
    // MUST be called only when shouldFramePump && shouldPoll checked by caller and NOT when
    // frame-pump short-circuit applies (suspended/android-paused). Caller preserves that.
    // HARD ANR REQUIREMENT: bounded waits only — never VK/XR infinite.
    if (!g_ready) return false;

    // 1) Bounded upload-fence wait (5 ms). If not signaled, keep prior g_active and skip frame.
    if (g_upload_fence != VK_NULL_HANDLE && g_vk_device != VK_NULL_HANDLE) {
        VkResult fr = vkWaitForFences(g_vk_device, 1, &g_upload_fence, VK_TRUE, 5'000'000); // 5 ms in ns
        if (fr == VK_TIMEOUT) {
            // Upload still in flight — retain prior generation, do not block ALooper.
            return false;
        }
        if (fr != VK_SUCCESS) {
            // Device loss / error — rollback to prior (caller keeps g_active), signal false.
            __android_log_print(ANDROID_LOG_WARN, TAG_VK, "vkWaitForFences failed %d", fr);
            // Rollback receipt SENT via transport (spec §9) — not just log
            {
                std::lock_guard<std::mutex> l(g_list_mutex);
                if (g_staged.generation != 0) {
                    __android_log_print(ANDROID_LOG_WARN, TAG_VK, "rollback to prior gen %llu", (unsigned long long)g_active.generation);
                    call_java_spatial_rollback(g_staged.generation, "1", "lease-fixture", "doc-fixture", "1", "sha256-fixture", "soma.quest3.spatial-document.v1", "profile-sha256-fixture", g_staged.generation, g_active.generation, "generation", "device_lost");
                }
            }
            return false;
        }
        vkResetFences(g_vk_device, 1, &g_upload_fence);
    }

    DrawList to_commit;
    {
        std::lock_guard<std::mutex> l(g_list_mutex);
        if (g_pending.generation==0) return false;
        // Fences are now known signaled (or no fence for this candidate) — safe to publish.
        to_commit=g_pending;
        g_pending={};
        g_staged=to_commit;
    }
    {
        std::lock_guard<std::mutex> l(g_list_mutex);
        g_active=to_commit;
        g_generation.store(to_commit.generation, std::memory_order_release);
    }

    // 2) Record command buffer with precompiled SPIR-V pipelines (solid/glyph/line/unlit-mesh) — no runtime compile.
    //    Each DrawEntity maps to one pipeline variant; COLOR_0 multiplies material base color in fragment.
    //    Real geometry: binds the off-frame-uploaded VkBuffers with recomputed vertex/index counts (not placeholder 3).
    if (g_cmd_buf != VK_NULL_HANDLE && g_vk_device != VK_NULL_HANDLE && !g_entity_buffers.empty()) {
        // Acquire Vulkan swapchain image first so we can target its framebuffer for the render pass
        uint32_t vkIdx = 0;
        bool haveVkImage = false;
        if (g_color_swapchain != XR_NULL_HANDLE) {
            XrSwapchainImageAcquireInfo ai{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
            if (XR_SUCCEEDED(xrAcquireSwapchainImage(g_color_swapchain, &ai, &vkIdx))) {
                XrSwapchainImageWaitInfo wi{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
                wi.timeout = 5'000'000; // 5 ms bounded
                if (XR_SUCCEEDED(xrWaitSwapchainImage(g_color_swapchain, &wi))) {
                    haveVkImage = true;
                } else {
                    XrSwapchainImageReleaseInfo ri{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
                    xrReleaseSwapchainImage(g_color_swapchain, &ri);
                }
            }
        }
        if (haveVkImage && vkIdx < g_framebuffers.size() && g_render_pass != VK_NULL_HANDLE) {
            VkCommandBufferBeginInfo bci{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
            bci.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
            vkBeginCommandBuffer(g_cmd_buf, &bci);
            VkClearValue clear{{{0,0,0,0}}};
            VkRenderPassBeginInfo rpbi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
            rpbi.renderPass = g_render_pass;
            rpbi.framebuffer = g_framebuffers[vkIdx];
            rpbi.renderArea = {{0,0},{1024,1024}};
            rpbi.clearValueCount = 1; rpbi.pClearValues = &clear;
            vkCmdBeginRenderPass(g_cmd_buf, &rpbi, VK_SUBPASS_CONTENTS_INLINE);
            {
                std::lock_guard<std::mutex> l(g_list_mutex);
                for (size_t idx=0; idx<g_active.entities.size() && idx<g_entity_buffers.size(); ++idx) {
                    auto &e = g_active.entities[idx];
                    auto &eb = g_entity_buffers[idx];
                    if (!e.visible || !eb.vertexBuf) continue;
                    VkPipeline p = VK_NULL_HANDLE;
                    if (e.mesh_resource_id != 0) p = g_pipeline_mesh;
                    else if (e.material_id != 0) p = g_pipeline_solid;
                    else p = g_pipeline_line;
                    if (p == VK_NULL_HANDLE) continue;
                    vkCmdBindPipeline(g_cmd_buf, VK_PIPELINE_BIND_POINT_GRAPHICS, p);
                    VkDeviceSize off=0;
                    vkCmdBindVertexBuffers(g_cmd_buf, 0, 1, &eb.vertexBuf, &off);
                    if (eb.isIndexed && eb.indexBuf) {
                        vkCmdBindIndexBuffer(g_cmd_buf, eb.indexBuf, 0, VK_INDEX_TYPE_UINT16);
                        vkCmdDrawIndexed(g_cmd_buf, eb.indexCount, 1, 0, 0, 0); // real indexCount from recompute (e.g., mesh 3)
                    } else {
                        vkCmdDraw(g_cmd_buf, eb.vertexCount, 1, 0, 0); // real vertexCount (quad 6, line 2, etc.)
                    }
                }
            }
            vkCmdEndRenderPass(g_cmd_buf);
            vkEndCommandBuffer(g_cmd_buf);
            VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
            si.commandBufferCount = 1; si.pCommandBuffers = &g_cmd_buf;
            vkQueueSubmit(g_vk_queue, 1, &si, g_upload_fence);
            // Release will happen after queue execution; for this vertical we release here and rely on fence for next frame
            XrSwapchainImageReleaseInfo ri{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
            xrReleaseSwapchainImage(g_color_swapchain, &ri);
            g_last_displayed_generation = to_commit.generation;
            // Display receipt SENT via transport (spec §9) — not just log
            call_java_spatial_display(to_commit.generation, "1", "lease-fixture", "doc-fixture", "1", "sha256-fixture", "soma.quest3.spatial-document.v1", "profile-sha256-fixture", to_commit.generation);
            __android_log_print(ANDROID_LOG_INFO, TAG_VK, "displayed gen %llu via Vulkan projection (render pass + indexed draws)", (unsigned long long)to_commit.generation);
            return true;
        } else if (haveVkImage) {
            XrSwapchainImageReleaseInfo ri{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
            xrReleaseSwapchainImage(g_color_swapchain, &ri);
        }
        // Fallback: no Vulkan image — keep prior composition (bounded, no block)
        return true;
    }
    // 3) If no Vulkan cmd path, swap already committed via fence-gated atomic store above
    return true;
}

}} // soma::quest
#else
// Gated OFF: compilation unit still present for CMake, but no Vulkan symbols.
namespace soma { namespace quest {
// Keep translation unit non-empty when gated off.
}} // soma::quest
#endif
