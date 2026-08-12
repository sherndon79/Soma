#pragma once
// Split unit: composition / draw-list IR after hierarchy resolve (muse flattened IR).
// Preserved from v1a single-panel; v1 extends to multi-entity with mesh/quad/line.
// This header is the seam for the Vulkan draw-list; GLES path remains in quest_surface.cpp until migration lands.
#include <openxr/openxr.h>
#include <vector>
#include <string>

namespace soma { namespace quest {

struct DrawEntity {
    uint32_t id = 0;
    XrPosef pose{{0,0,0,1},{0,0,0}};
    XrExtent2Df extent{0,0};
    uint32_t material_id = 0;
    uint32_t mesh_resource_id = 0; // 0 = procedural quad/line
    bool visible = true;
};

struct DrawList {
    std::vector<DrawEntity> entities;
    uint64_t generation = 0; // atomic generation handle for fence-guarded swap
    uint64_t revision = 0;
};

}} // soma::quest
