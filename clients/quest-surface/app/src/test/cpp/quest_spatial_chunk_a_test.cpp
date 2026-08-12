#include "quest_surface_resource.h"
#include "quest_surface_admission.h"
#include "quest_surface_lifecycle.h"
#include "quest_surface_latch.h"
#include <cassert>
#include <cstring>
#include <string>
// Host-testable Chunk A: GLB independent scan + admission stages 1-6 + lifecycle + latch, cause-matched for §7 hostile cases.
static void build_glb(unsigned char* out, size_t* out_len, const char* json, uint32_t blen){
    size_t jl=strlen(json);
    uint32_t jlen=(jl+3)&~3u;
    uint32_t total=12+8+jlen+8+blen;
    memset(out,0,512);
    memcpy(out,"glTF",4); out[4]=2;
    out[8]= total &0xFF; out[9]=(total>>8)&0xFF; out[10]=(total>>16)&0xFF; out[11]=(total>>24)&0xFF;
    out[12]= jlen &0xFF; out[13]=(jlen>>8)&0xFF; out[14]=(jlen>>16)&0xFF; out[15]=(jlen>>24)&0xFF;
    out[16]=0x4A; out[17]=0x53; out[18]=0x4F; out[19]=0x4E;
    memcpy(out+20,json,jl); memset(out+20+jl,' ', jlen-jl);
    out[12+8+jlen]= blen &0xFF; out[13+8+jlen]=(blen>>8)&0xFF; out[14+8+jlen]=(blen>>16)&0xFF; out[15+8+jlen]=(blen>>24)&0xFF;
    out[16+8+jlen]=0x42; out[17+8+jlen]=0x49; out[18+8+jlen]=0x4E; out[19+8+jlen]=0x00;
    *out_len=total;
}
int main(){
 using namespace soma::quest;
 GlbCaps caps;
 // URI forbidden
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"accessors\":[],\"bufferViews\":[],\"buffers\":[],\"uri\":\"http://evil\"}";
  unsigned char glb[512]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && r.reason=="uri_forbidden");
 }
 // Benign string value containing 'uri' must NOT be rejected (evasion-safe) — use valid GLB with extras
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":3,\"type\":\"VEC3\"},{\"bufferView\":1,\"byteOffset\":0,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}],\"extras\":{\"text\":\"a uri inside\"}}";
  unsigned char glb[1024]; size_t len; build_glb(glb,&len,j,44);
  uint8_t* bin = glb + 12+8+ ((strlen(j)+3)&~3u) +8;
  float pos[9]={-0.5f,-0.5f,0, 0.5f,-0.5f,0, 0,0.5f,0}; memcpy(bin,pos,36); uint16_t idx[3]={0,1,2}; memcpy(bin+36,idx,6);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(r.ok);
 }
 // Escaped forbidden key \u0075ri (=uri) must be rejected (evasion)
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"accessors\":[],\"bufferViews\":[],\"buffers\":[],\"\\u0075ri\":\"http://evil\"}";
  unsigned char glb[512]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && r.reason=="uri_forbidden");
 }
 // extensions forbidden
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"accessors\":[],\"bufferViews\":[],\"buffers\":[],\"extensions\":{\"X\":1}}";
  unsigned char glb[512]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && r.reason=="extensions_forbidden");
 }
 // NORMAL forbidden
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0,\"NORMAL\":1},\"indices\":1,\"mode\":4}]}],\"accessors\":[],\"bufferViews\":[],\"buffers\":[]}";
  unsigned char glb[512]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && r.reason=="attribute_forbidden");
 }
 // TEXCOORD forbidden
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0,\"TEXCOORD_0\":1},\"indices\":1,\"mode\":4}]}],\"accessors\":[],\"bufferViews\":[],\"buffers\":[]}";
  unsigned char glb[512]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && r.reason=="attribute_forbidden");
 }
 // Valid minimal with real recompute
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":3,\"type\":\"VEC3\",\"min\":[-0.5,-0.5,0],\"max\":[0.5,0.5,0]},{\"bufferView\":1,\"byteOffset\":0,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}]}";
  unsigned char glb[1024]; size_t len; build_glb(glb,&len,j,44);
  uint8_t* bin = glb + 12+8+ ((strlen(j)+3)&~3u) +8;
  float pos[9]={-0.5f,-0.5f,0, 0.5f,-0.5f,0, 0,0.5f,0};
  memcpy(bin, pos, 36);
  uint16_t idx[3]={0,1,2};
  memcpy(bin+36, idx, 6);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(r.ok);
  assert(r.vertex_count==3);
  assert(r.triangle_count==1);
  assert(r.aabb_min[0]==-0.5f && r.aabb_max[0]==0.5f);
  // Also test escaping bounds via recomputed AABB exceeding caps? For GLB, escaping bounds is not a check, but for admission it is — tested there.
 }
 // Mismatch declared count vs byte count
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":100,\"type\":\"VEC3\",\"min\":[-0.5,-0.5,0],\"max\":[0.5,0.5,0]},{\"bufferView\":1,\"byteOffset\":0,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}]}";
  unsigned char glb[1024]; size_t len; build_glb(glb,&len,j,44);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && (r.reason=="bufferView_too_small" || r.reason=="accessor_out_of_range" || r.reason=="vertex_cap_exceeded"));
 }
 // NaN/Inf position
 {
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":3,\"type\":\"VEC3\",\"min\":[-0.5,-0.5,0],\"max\":[0.5,0.5,0]},{\"bufferView\":1,\"byteOffset\":0,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}]}";
  unsigned char glb[1024]; size_t len; build_glb(glb,&len,j,44);
  uint8_t* bin2 = glb + 12+8+ ((strlen(j)+3)&~3u) +8;
  float nanpos[9]={std::numeric_limits<float>::quiet_NaN(),-0.5f,0, 0.5f,-0.5f,0, 0,0.5f,0};
  memcpy(bin2, nanpos, 36);
  uint16_t idx2[3]={0,1,2}; memcpy(bin2+36, idx2, 6);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && r.reason=="nan_inf_position");
 }
 // Fuzz hostile corpus — must not throw/crash, must return !ok with bounded reason (parser_exception or specific reject)
 {
  // Oversized mode number (stoi overflow — unguarded stoi would throw)
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":99999999999999999999}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":3,\"type\":\"VEC3\"},{\"bufferView\":1,\"byteOffset\":0,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}]}";
  unsigned char glb[2048]; size_t len; build_glb(glb,&len,j,44);
  uint8_t* bin = glb + 12+8+ ((strlen(j)+3)&~3u) +8; float pos[9]={-0.5f,-0.5f,0,0.5f,-0.5f,0,0,0.5f,0}; memcpy(bin,pos,36); uint16_t idx[3]={0,1,2}; memcpy(bin+36,idx,6);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok); // must not throw
 }
 {
  // Deep nesting / many brackets
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"accessors\":[[[[[[[[[[\"x\"]]]]]]]]]],\"bufferViews\":[],\"buffers\":[]}";
  unsigned char glb[2048]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok);
 }
 {
  // Whitespace bomb — valid GLB with heavy whitespace
  const char* j=" { \n\t \"asset\" \t : \t { \"version\" : \"2.0\" } , \"scene\" : 0 , \"scenes\" : [ { \"nodes\" : [ 0 ] } ] , \"nodes\" : [ { \"mesh\" : 0 } ] , \"meshes\" : [ { \"primitives\" : [ { \"attributes\" : { \"POSITION\" : 0 } , \"indices\" : 1 , \"mode\" : 4 } ] } ] , \"buffers\" : [ { \"byteLength\" : 42 } ] , \"bufferViews\" : [ { \"buffer\" : 0 , \"byteOffset\" : 0 , \"byteLength\" : 36 } , { \"buffer\" : 0 , \"byteOffset\" : 36 , \"byteLength\" : 6 } ] , \"accessors\" : [ { \"bufferView\" : 0 , \"byteOffset\" : 0 , \"componentType\" : 5126 , \"count\" : 3 , \"type\" : \"VEC3\" , \"min\" : [ -0.5 , -0.5 , 0 ] , \"max\" : [ 0.5 , 0.5 , 0 ] } , { \"bufferView\" : 1 , \"byteOffset\" : 0 , \"componentType\" : 5123 , \"count\" : 3 , \"type\" : \"SCALAR\" } ] } ";
  unsigned char glb[2048]; size_t len; build_glb(glb,&len,j,44);
  uint8_t* bin = glb + 12+8+ ((strlen(j)+3)&~3u) +8; float pos[9]={-0.5f,-0.5f,0,0.5f,-0.5f,0,0,0.5f,0}; memcpy(bin,pos,36); uint16_t idx[3]={0,1,2}; memcpy(bin+36,idx,6);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(r.ok); // whitespace should be tolerated when valid
 }
 {
  // Unterminated string / truncated JSON — must not throw
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"accessors\":[],\"bufferViews\":[],\"buffers\":[]";
  unsigned char glb[1024]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok);
 }
 {
  // Non-numeric accessor count (hostile) — get_int_field would return false, not throw
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":\"three\",\"type\":\"VEC3\"},{\"bufferView\":1,\"byteOffset\":0,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}]}";
  unsigned char glb[2048]; size_t len; build_glb(glb,&len,j,44);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && (r.reason=="accessor_count_invalid" || r.reason=="parser_exception" || r.reason=="position_missing"));
 }
 {
  // Large accessor byteOffset OOB — must be accessor_out_of_range, not over-read (residual fix)
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":100,\"componentType\":5126,\"count\":3,\"type\":\"VEC3\"},{\"bufferView\":1,\"byteOffset\":0,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}]}";
  unsigned char glb[2048]; size_t len; build_glb(glb,&len,j,44);
  uint8_t* bin = glb + 12+8+ ((strlen(j)+3)&~3u) +8; float pos[9]={-0.5f,-0.5f,0,0.5f,-0.5f,0,0,0.5f,0}; memcpy(bin,pos,36); uint16_t idx[3]={0,1,2}; memcpy(bin+36,idx,6);
  auto r=scan_and_decode_glb(glb,len,caps);
  assert(!r.ok && r.reason=="accessor_out_of_range");
 }
 {
  // Large index accessor byteOffset OOB
  const char* j2="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"buffers\":[{\"byteLength\":42}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],\"accessors\":[{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":3,\"type\":\"VEC3\"},{\"bufferView\":1,\"byteOffset\":10,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}]}";
  unsigned char glb[2048]; size_t len2; build_glb(glb,&len2,j2,44);
  uint8_t* bin2 = glb + 12+8+ ((strlen(j2)+3)&~3u) +8; float pos2[9]={-0.5f,-0.5f,0,0.5f,-0.5f,0,0,0.5f,0}; memcpy(bin2,pos2,36); uint16_t idx2[3]={0,1,2}; memcpy(bin2+36,idx2,6);
  auto r2=scan_and_decode_glb(glb,len2,caps);
  assert(!r2.ok && r2.reason=="index_out_of_range");
 }
 // Overflow via huge buffer
 {
  GlbCaps small; small.max_buffer_bytes=16;
  const char* j="{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1,\"mode\":4}]}],\"accessors\":[],\"bufferViews\":[],\"buffers\":[]}";
  unsigned char glb[512]; size_t len; build_glb(glb,&len,j,32);
  auto r=scan_and_decode_glb(glb,len,small);
  assert(!r.ok);
 }
 // Admission stages 1-6 + evasion (declared-count vs byte-count, escaping bounds)
 {
  auto a1=admit_spatial_snapshot(nullptr,0);
  assert(!a1.ok && a1.failed_stage==AdmissionStage::FRAME);
  const char* valid = "{\"schema_version\":1,\"entities\":[],\"resources\":[],\"presentation\":[],\"dynamics\":[],\"semantics\":[]}";
  auto a2=admit_spatial_snapshot((const uint8_t*)valid, strlen(valid));
  assert(a2.ok);
  // declared-count vs byte-count mismatch: entity count 33 > limit 32 → reject at STATIC_ADMISSION
  std::string many="{\"schema_version\":1,\"entities\":[";
  for(int i=0;i<33;i++){ if(i) many+=","; many+="{\"id\":\"e"+std::to_string(i)+"\"}"; }
  many+="],\"resources\":[],\"presentation\":[],\"dynamics\":[],\"semantics\":[]}";
  auto a3=admit_spatial_snapshot((const uint8_t*)many.c_str(), many.size());
  assert(!a3.ok && a3.failed_stage==AdmissionStage::STATIC_ADMISSION);
  // escaping bounds: declared_local_bounds with 1000 → RECOMPUTE reject
  const char* esc="{\"schema_version\":1,\"entities\":[{\"id\":\"e0\",\"declared_local_bounds\":{\"min\":[-1000,-1000,-1000]}}],\"resources\":[],\"presentation\":[],\"dynamics\":[],\"semantics\":[]}";
  auto a4=admit_spatial_snapshot((const uint8_t*)esc, strlen(esc));
  assert(!a4.ok && a4.failed_stage==AdmissionStage::RECOMPUTE);
  // dynamics not empty → SCHEMA reject
  const char* dyn="{\"schema_version\":1,\"entities\":[],\"resources\":[],\"presentation\":[],\"dynamics\":[{\"x\":1}],\"semantics\":[]}";
  auto a5=admit_spatial_snapshot((const uint8_t*)dyn, strlen(dyn));
  assert(!a5.ok && a5.failed_stage==AdmissionStage::SCHEMA);
 }
 // Lifecycle + latch exact-match
 assert(isResumableLifecycleLoss(true)==true);
 assert(isResumableLifecycleLoss(false)==false);
 assert(shouldFramePump(true,true)==true);
 assert(shouldFramePump(true,false)==false);
 assert(shouldExitNativeLoop(false,false)==false);
 assert(shouldExitNativeLoop(true,false)==true);
 MicLatchState s; latchMic(s,"revoke","300"); assert(!tryDeliberateMicResume(s,"",true)); assert(!tryDeliberateMicResume(s,"0",true)); assert(tryDeliberateMicResume(s," 300 ",true));
 return 0;
}
