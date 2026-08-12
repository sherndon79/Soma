#pragma once
// Split unit: resource / admission / GLB-subset scan.
// Hosts the URI-free geometry-only GLB decoder interface and independent byte scan with bounded caps (§7).
// Implementation deferred to v1 admission stage; this header reserves the contract without pulling code into the frame loop.
#include <cstdint>
#include <string>
#include <vector>

namespace soma { namespace quest {

// Bounded caps for v1 GLB subset (profile q3.spatial-document.v1)
struct GlbCaps {
    uint32_t max_vertices = 65536;
    uint32_t max_triangles = 65536;
    uint32_t max_buffer_bytes = 8 * 1024 * 1024;
    uint32_t max_texture_dim = 2048;
};

// Decode result — no live GPU objects; caller stages upload off frame thread.
struct GlbDecodeResult {
    bool ok = false;
    std::string reason; // stable bounded code for receipt
    uint32_t vertex_count = 0;
    uint32_t triangle_count = 0;
    std::vector<float> positions; // tightly packed VEC3
    std::vector<float> colors;    // optional VEC4 [0,1]
    std::vector<uint32_t> indices;
    float aabb_min[3]{};
    float aabb_max[3]{};
};

// Independent scan + decode with allocation/output quotas, off frame thread.
GlbDecodeResult scan_and_decode_glb(const uint8_t* data, size_t len, const GlbCaps& caps);

}} // soma::quest
