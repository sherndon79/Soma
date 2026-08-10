cmake_minimum_required(VERSION 3.22.1)
project(somaquestsurface)

find_package(OpenXR REQUIRED CONFIG)

add_library(native_app_glue STATIC
    ${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.c)
target_include_directories(native_app_glue PUBLIC
    ${ANDROID_NDK}/sources/android/native_app_glue)

add_library(somaquestsurface SHARED quest_surface.cpp)
target_compile_options(somaquestsurface PRIVATE
    -Wall -Wextra -Werror -Wno-missing-field-initializers)

# Passing "-u SYMBOL" as one quoted token silently strips NativeActivity_onCreate.
target_link_options(somaquestsurface PRIVATE -Wl,--undefined=ANativeActivity_onCreate)

target_link_libraries(somaquestsurface
    native_app_glue
    OpenXR::openxr_loader
    android
    log
    EGL
    GLESv3)
