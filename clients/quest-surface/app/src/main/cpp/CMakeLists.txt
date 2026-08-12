cmake_minimum_required(VERSION 3.22.1)
project(somaquestsurface)

find_package(OpenXR REQUIRED CONFIG)

add_library(native_app_glue STATIC
    ${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.c)
target_include_directories(native_app_glue PUBLIC
    ${ANDROID_NDK}/sources/android/native_app_glue)

add_library(somaquestsurface SHARED quest_surface.cpp quest_surface_resource.cpp quest_surface_admission.cpp
    quest_surface_renderer_vulkan.cpp)
target_compile_options(somaquestsurface PRIVATE
    -Wall -Wextra -Werror -Wno-missing-field-initializers)

# Vulkan split — dominant-cost vertical; keep GLES primary until Vulkan lands.
# Preserves lifecycle/ANR defenses; Vulkan renderer compiled only when -DUSE_VULKAN=ON.
# Default OFF preserves GLES fallback (ratified).
option(USE_VULKAN "Enable XR_KHR_vulkan_enable2 Vulkan renderer (Soma v1 spatial)" OFF)
if(USE_VULKAN)
    target_compile_definitions(somaquestsurface PRIVATE XR_USE_GRAPHICS_API_VULKAN USE_VULKAN)
    find_package(Vulkan REQUIRED)
    target_link_libraries(somaquestsurface Vulkan::Vulkan)
endif()

# Passing "-u SYMBOL" as one quoted token silently strips NativeActivity_onCreate.
target_link_options(somaquestsurface PRIVATE -Wl,--undefined=ANativeActivity_onCreate)

target_link_libraries(somaquestsurface
    native_app_glue
    OpenXR::openxr_loader
    android
    log
    EGL
    GLESv3)
