#pragma once
// Split unit: admission stages 1-6 (host-testable, off frame thread).
// Stages: 1 frame caps, 2 schema/graph, 3 closure/integrity, 4 decode limits, 5 recompute, 6 static admission vs profile.
// Commit (7) and runtime (8) + receipts (9) remain in composition/renderer.
#include <cstdint>
#include <string>
namespace soma { namespace quest {
enum class AdmissionStage : int { FRAME=1,SCHEMA=2,CLOSURE=3,DECODE=4,RECOMPUTE=5,STATIC_ADMISSION=6,PREPARE_COMMIT=7,RUNTIME=8,RECEIPT=9 };
struct AdmissionResult { bool ok=false; AdmissionStage failed_stage=AdmissionStage::FRAME; std::string reason; };
AdmissionResult admit_spatial_snapshot(const uint8_t* doc, size_t len); // stub host-testable
}} // soma::quest
