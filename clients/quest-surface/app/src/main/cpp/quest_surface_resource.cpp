#include "quest_surface_resource.h"
#include <cstring>
#include <string>
#include <vector>
#include <cmath>
namespace soma { namespace quest {

static std::string dec_str(const std::string& j,size_t& i){
    std::string o; ++i;
    while(i<j.size()){
        char c=j[i++];
        if(c=='"') break;
        if(c=='\\' && i<j.size()){
            char e=j[i++];
            if(e=='u'&& i+3<j.size()){
                std::string h=j.substr(i,4); i+=4;
                int code=0; for(char ch:h){code<<=4; if('0'<=ch&&ch<='9') code|=ch-'0'; else if('a'<=ch&&ch<='f') code|=ch-'a'+10; else if('A'<=ch&&ch<='F') code|=ch-'A'+10; else code=-1;}
                if(code>=0&&code<128) o.push_back(char(code)); else if(code>=0) o.push_back('?');
                continue;
            } else {
                if(e=='"'||e=='\\'||e=='/') o.push_back(e);
                else if(e=='b') o.push_back('\b');
                else if(e=='f') o.push_back('\f');
                else if(e=='n') o.push_back('\n');
                else if(e=='r') o.push_back('\r');
                else if(e=='t') o.push_back('\t');
                else o.push_back(e);
                continue;
            }
        } else o.push_back(c);
    }
    return o;
}
static std::vector<std::string> collect_keys(const std::string& j){
    std::vector<std::string> k; size_t i=0;
    while(i<j.size()){
        if(j[i]=='"'){ std::string s=dec_str(j,i); size_t t=i; while(t<j.size()&&(j[t]==' '||j[t]=='\n'||j[t]=='\r'||j[t]=='\t')) ++t; if(t<j.size()&&j[t]==':'){k.push_back(s); i=t+1; continue;}}
        else ++i;
    }
    return k;
}
static bool has_key(const std::vector<std::string>& v,const std::string& s){ for(auto &x:v) if(x==s) return true; return false; }

// Find nth object in array starting at arr_start (which is '[' ), return its string and next pos
static bool nth_object_in_array(const std::string& json, size_t arr_start, size_t n, std::string& out){
    size_t i=arr_start;
    while(i<json.size() && json[i]!='[') ++i;
    if(i>=json.size()) return false;
    ++i; // after [
    size_t idx=0;
    int depth=0;
    size_t obj_start=std::string::npos;
    for(; i<json.size(); ++i){
        char c=json[i];
        if(c=='"'){ size_t tmp=i; dec_str(json, tmp); i=tmp-1; continue; }
        if(c=='{'){
            if(depth==0 && idx==n) obj_start=i;
            ++depth;
        } else if(c=='}'){
            --depth;
            if(depth==0 && obj_start!=std::string::npos){
                if(idx==n){ out=json.substr(obj_start, i-obj_start+1); return true; }
                ++idx;
                obj_start=std::string::npos;
            }
        } else if(c=='['){
            // handle nested array depth? For accessors array, objects don't contain arrays except maybe, but track
            ++depth;
        } else if(c==']'){
            --depth;
            if(depth<0) break;
        }
    }
    return false;
}
static bool get_int_field(const std::string& obj, const std::string& key, int& out){
    std::string q="\""+key+"\"";
    size_t p=obj.find(q);
    if(p==std::string::npos) return false;
    size_t colon=obj.find(':', p+q.size());
    if(colon==std::string::npos) return false;
    size_t v=colon+1; while(v<obj.size()&&(obj[v]==' '||obj[v]=='\n'||obj[v]=='\r'||obj[v]=='\t')) ++v;
    size_t e=v; while(e<obj.size() && ((obj[e]>='0'&&obj[e]<='9')||obj[e]=='-')) ++e;
    if(e==v) return false;
    try{ out=std::stoi(obj.substr(v,e-v)); return true; }catch(...){ return false; }
}
static bool get_uint_field(const std::string& obj, const std::string& key, uint32_t& out){
    int tmp; if(!get_int_field(obj,key,tmp)) return false;
    if(tmp<0) return false;
    out=(uint32_t)tmp; return true;
}

GlbDecodeResult scan_and_decode_glb(const uint8_t* data, size_t len, const GlbCaps& caps) {
    GlbDecodeResult r;
    if (data==nullptr || len < 20) { r.reason="frame_too_small"; return r; }
    if (len > caps.max_buffer_bytes + 1024) { r.reason="buffer_too_large"; return r; }
    if (std::memcmp(data, "glTF", 4) != 0) { r.reason="magic_invalid"; return r; }
    uint32_t version = data[4] | (data[5]<<8) | (data[6]<<16) | (data[7]<<24);
    if (version != 2) { r.reason="version_unsupported"; return r; }
    uint32_t total_len = data[8] | (data[9]<<8) | (data[10]<<16) | (data[11]<<24);
    if (total_len != len) { r.reason="length_mismatch"; return r; }
    if ((total_len % 4) != 0) { r.reason="alignment_invalid"; return r; }
    if (len < 20+8) { r.reason="chunks_missing"; return r; }
    uint32_t j_chunk_len = data[12] | (data[13]<<8) | (data[14]<<16) | (data[15]<<24);
    uint32_t j_chunk_type = data[16] | (data[17]<<8) | (data[18]<<16) | (data[19]<<24);
    if (j_chunk_type != 0x4E4F534Au) { r.reason="json_chunk_type_invalid"; return r; }
    if (j_chunk_len %4 !=0 || 12+8+j_chunk_len+8 > len) { r.reason="json_chunk_length_invalid"; return r; }
    uint32_t b_chunk_len = data[12+8+j_chunk_len] | (data[13+8+j_chunk_len]<<8) | (data[14+8+j_chunk_len]<<16) | (data[15+8+j_chunk_len]<<24);
    uint32_t b_chunk_type = data[16+8+j_chunk_len] | (data[17+8+j_chunk_len]<<8) | (data[18+8+j_chunk_len]<<16) | (data[19+8+j_chunk_len]<<24);
    if (b_chunk_type != 0x004E4942u) { r.reason="bin_chunk_type_invalid"; return r; }
    if (b_chunk_len %4 !=0 || 12+8+j_chunk_len+8+b_chunk_len != len) { r.reason="bin_chunk_length_invalid"; return r; }
    std::string json(reinterpret_cast<const char*>(data+20), j_chunk_len);
    auto keys = collect_keys(json);
    if (has_key(keys,"uri")) { r.reason="uri_forbidden"; return r; }
    if (has_key(keys,"extensions")) { r.reason="extensions_forbidden"; return r; }
    if (has_key(keys,"NORMAL")) { r.reason="attribute_forbidden"; return r; }
    for(auto &k: keys) if (k.rfind("TEXCOORD",0)==0) { r.reason="attribute_forbidden"; return r; }
    if (!has_key(keys,"scene") || !has_key(keys,"scenes") || !has_key(keys,"nodes") || !has_key(keys,"meshes") || !has_key(keys,"accessors")) { r.reason="top_level_missing"; return r; }
    if (!has_key(keys,"POSITION")) { r.reason="position_missing"; return r; }
    {
        bool mode_ok=false;
        size_t i=0;
        while (i < json.size()){
            if (json[i]=='"'){
                std::string s=dec_str(json,i);
                size_t j=i; while(j<json.size() && (json[j]==' '||json[j]=='\n'||json[j]=='\r'||json[j]=='\t')) ++j;
                if (j<json.size() && json[j]==':' && s=="mode"){
                    ++j; while(j<json.size() && (json[j]==' '||json[j]=='\n'||json[j]=='\r'||json[j]=='\t')) ++j;
                    size_t k=j; while(k<json.size() && json[k]>='0' && json[k]<='9') ++k;
                    if (k>j){ int v=std::stoi(json.substr(j,k-j)); if (v==4) mode_ok=true; }
                    i=j; continue;
                }
            } else ++i;
        }
        if (!mode_ok){ r.reason="mode_not_triangles"; return r; }
    }
    if (b_chunk_len > caps.max_buffer_bytes) { r.reason="buffer_cap_exceeded"; return r; }
    // Real recompute: parse accessors and bufferViews to locate POSITION and indices
    // Find accessors array start
    size_t acc_pos = json.find("\"accessors\"");
    if (acc_pos==std::string::npos){ r.reason="accessors_missing"; return r; }
    // Extract accessor 0 (POSITION) and 1 (indices) if present
    std::string acc0, acc1;
    bool has_acc0 = nth_object_in_array(json, acc_pos, 0, acc0);
    bool has_acc1 = nth_object_in_array(json, acc_pos, 1, acc1);
    if (!has_acc0){ r.reason="accessor_missing"; return r; }
    uint32_t acc0_count=0, acc0_bv=0, acc0_comp=0, acc0_offset=0;
    std::string acc0_type;
    {
        // type is string like "VEC3" or "SCALAR" — extract
        size_t p=acc0.find("\"type\"");
        if(p!=std::string::npos){ size_t c=acc0.find(':',p); size_t q=acc0.find('"',c); size_t qq=acc0.find('"',q+1); if(q!=std::string::npos&&qq!=std::string::npos) acc0_type=acc0.substr(q+1,qq-q-1); }
        if(!get_uint_field(acc0,"count",acc0_count)) { r.reason="accessor_count_invalid"; return r; }
        if(!get_uint_field(acc0,"bufferView",acc0_bv)) { r.reason="accessor_bufferview_invalid"; return r; }
        if(!get_uint_field(acc0,"componentType",acc0_comp)) { r.reason="accessor_component_invalid"; return r; }
        int off=0; if(get_int_field(acc0,"byteOffset",off)) acc0_offset=(uint32_t)off; else acc0_offset=0;
        if(acc0_type!="VEC3") { r.reason="position_type_invalid"; return r; }
        if(acc0_comp!=5126) { r.reason="position_component_invalid"; return r; }
    }
    // bufferViews
    size_t bv_pos=json.find("\"bufferViews\"");
    if(bv_pos==std::string::npos){ r.reason="bufferviews_missing"; return r; }
    std::string bv0;
    if(!nth_object_in_array(json, bv_pos, acc0_bv, bv0)){ r.reason="bufferview_missing"; return r; }
    uint32_t bv0_offset=0, bv0_len=0;
    {
        int off=0; if(get_int_field(bv0,"byteOffset",off)) bv0_offset=(uint32_t)off; else bv0_offset=0;
        if(!get_uint_field(bv0,"byteLength",bv0_len)){ r.reason="bufferview_length_invalid"; return r; }
        // buffer field must be 0
        uint32_t buf=0; if(get_uint_field(bv0,"buffer",buf) && buf!=0){ r.reason="buffer_index_invalid"; return r; }
    }
    // Validate byte counts vs actual BIN
    uint32_t pos_bytes = acc0_count * 12; // VEC3 float
    if (bv0_len < pos_bytes) { r.reason="bufferView_too_small"; return r; }
    if (bv0_offset + pos_bytes > b_chunk_len) { r.reason="accessor_out_of_range"; return r; }
    if (acc0_count > caps.max_vertices) { r.reason="vertex_cap_exceeded"; return r; }
    // Indices if present
    uint32_t tri_count=0;
    if(has_acc1){
        uint32_t acc1_count=0, acc1_bv=0, acc1_comp=0, acc1_off=0;
        std::string acc1_type;
        size_t p=acc1.find("\"type\"");
        if(p!=std::string::npos){ size_t c=acc1.find(':',p); size_t q=acc1.find('"',c); size_t qq=acc1.find('"',q+1); if(q!=std::string::npos&&qq!=std::string::npos) acc1_type=acc1.substr(q+1,qq-q-1); }
        if(!get_uint_field(acc1,"count",acc1_count)){ r.reason="index_count_invalid"; return r; }
        if(!get_uint_field(acc1,"bufferView",acc1_bv)){ r.reason="index_bufferview_invalid"; return r; }
        if(!get_uint_field(acc1,"componentType",acc1_comp)){ r.reason="index_component_invalid"; return r; }
        int off=0; if(get_int_field(acc1,"byteOffset",off)) acc1_off=(uint32_t)off;
        if(acc1_type!="SCALAR"){ r.reason="index_type_invalid"; return r; }
        if(acc1_comp!=5123 && acc1_comp!=5125){ r.reason="index_component_invalid"; return r; }
        if(acc1_count %3 !=0){ r.reason="index_count_not_triangles"; return r; }
        // bufferView for indices
        std::string bv1;
        if(!nth_object_in_array(json, bv_pos, acc1_bv, bv1)){ r.reason="index_bufferview_missing"; return r; }
        uint32_t bv1_off=0, bv1_len=0;
        { int o=0; if(get_int_field(bv1,"byteOffset",o)) bv1_off=(uint32_t)o; if(!get_uint_field(bv1,"byteLength",bv1_len)){ r.reason="index_bufferview_length_invalid"; return r; } }
        uint32_t idx_bytes = acc1_count * (acc1_comp==5123?2:4);
        if (bv1_len < idx_bytes) { r.reason="index_bufferview_too_small"; return r; }
        if (bv1_off + idx_bytes > b_chunk_len) { r.reason="index_out_of_range"; return r; }
        tri_count = acc1_count /3;
        if (tri_count > caps.max_triangles) { r.reason="triangle_cap_exceeded"; return r; }
        // Validate indices in range and non-degenerate
        const uint8_t* bin = data + 12+8+j_chunk_len+8;
        for(uint32_t i=0;i<acc1_count;i+=3){
            uint32_t i0,i1,i2;
            if(acc1_comp==5123){ i0 = bin[bv1_off+acc1_off + i*2] | (bin[bv1_off+acc1_off + i*2+1]<<8); i1 = bin[bv1_off+acc1_off + (i+1)*2] | (bin[bv1_off+acc1_off + (i+1)*2+1]<<8); i2 = bin[bv1_off+acc1_off + (i+2)*2] | (bin[bv1_off+acc1_off + (i+2)*2+1]<<8); }
            else { i0 = bin[bv1_off+acc1_off + i*4] | (bin[bv1_off+acc1_off + i*4+1]<<8) | (bin[bv1_off+acc1_off + i*4+2]<<16) | (bin[bv1_off+acc1_off + i*4+3]<<24); i1 = bin[bv1_off+acc1_off + (i+1)*4] | (bin[bv1_off+acc1_off + (i+1)*4+1]<<8) | (bin[bv1_off+acc1_off + (i+1)*4+2]<<16) | (bin[bv1_off+acc1_off + (i+1)*4+3]<<24); i2 = bin[bv1_off+acc1_off + (i+2)*4] | (bin[bv1_off+acc1_off + (i+2)*4+1]<<8) | (bin[bv1_off+acc1_off + (i+2)*4+2]<<16) | (bin[bv1_off+acc1_off + (i+2)*4+3]<<24); }
            if(i0>=acc0_count || i1>=acc0_count || i2>=acc0_count){ r.reason="index_out_of_range"; return r; }
            if(i0==i1 || i1==i2 || i0==i2){ r.reason="degenerate_triangle"; return r; }
        }
    } else {
        tri_count = acc0_count /3;
    }
    // Recompute AABB from POSITION floats
    const uint8_t* bin = data + 12+8+j_chunk_len+8;
    const float* pos = reinterpret_cast<const float*>(bin + bv0_offset + acc0_offset);
    float minx=pos[0], miny=pos[1], minz=pos[2], maxx=minx, maxy=miny, maxz=minz;
    for(uint32_t i=1;i<acc0_count;++i){
        float x=pos[i*3], y=pos[i*3+1], z=pos[i*3+2];
        if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)){ r.reason="nan_inf_position"; return r; }
        if(x<minx) minx=x; if(y<miny) miny=y; if(z<minz) minz=z;
        if(x>maxx) maxx=x; if(y>maxy) maxy=y; if(z>maxz) maxz=z;
    }
    if (!std::isfinite(minx)||!std::isfinite(miny)||!std::isfinite(minz)||!std::isfinite(maxx)||!std::isfinite(maxy)||!std::isfinite(maxz)){ r.reason="nan_inf_position"; return r; }
    r.aabb_min[0]=minx; r.aabb_min[1]=miny; r.aabb_min[2]=minz;
    r.aabb_max[0]=maxx; r.aabb_max[1]=maxy; r.aabb_max[2]=maxz;
    r.vertex_count = acc0_count;
    r.triangle_count = tri_count;
    r.ok = true;
    r.reason.clear();
    return r;
}
}} // soma::quest
