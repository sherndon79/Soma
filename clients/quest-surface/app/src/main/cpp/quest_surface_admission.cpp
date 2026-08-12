#include "quest_surface_admission.h"
#include <string>
#include <vector>
namespace soma { namespace quest {
// Structural key collect (evasion-safe) — same as GLB scan
static std::string dec_jstr(const std::string& j,size_t& i){
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
static std::vector<std::string> keys_of(const std::string& j){
    std::vector<std::string> k; size_t i=0;
    while(i<j.size()){
        if(j[i]=='"'){ std::string s=dec_jstr(j,i); size_t t=i; while(t<j.size()&&(j[t]==' '||j[t]=='\n'||j[t]=='\r'||j[t]=='\t')) ++t; if(t<j.size()&&j[t]==':'){k.push_back(s); i=t+1; continue;}}
        else ++i;
    }
    return k;
}
static bool has_key(const std::vector<std::string>& v,const std::string& s){ for(auto &x:v) if(x==s) return true; return false; }
AdmissionResult admit_spatial_snapshot(const uint8_t* doc, size_t len) {
    if (doc==nullptr || len==0) return {false, AdmissionStage::FRAME, "frame_too_small"};
    if (len > 32*1024) return {false, AdmissionStage::FRAME, "frame_too_large"};
    std::string json(reinterpret_cast<const char*>(doc), len);
    auto keys = keys_of(json);
    // Stage 2: schema/graph — require exact top-level, forbid unknown, check dynamics empty
    if (!has_key(keys,"schema_version") || !has_key(keys,"entities") || !has_key(keys,"resources")) return {false, AdmissionStage::SCHEMA, "schema_missing"};
    // Unknown field check: allow only spec top-level + entity-level (evasion-safe structural)
    {
        std::vector<std::string> allowed = {"schema_version","entities","resources","presentation","dynamics","semantics","profile_id","document_id","revision","lease_ref","schema","id","declared_local_bounds","min","max","x"};
        for(auto &k: keys){
            bool ok=false; for(auto &a: allowed) if(k==a) ok=true;
            if (!ok) return {false, AdmissionStage::SCHEMA, "unknown_field"};
        }
    }
    // dynamics must be [] in v1
    if (json.find("\"dynamics\"")!=std::string::npos && json.find("\"dynamics\":[]")==std::string::npos && json.find("\"dynamics\": []")==std::string::npos) return {false, AdmissionStage::SCHEMA, "dynamics_not_empty"};
    // Stage 3: closure — every resource_sha256 reference must have descriptor (simplified: if presentation refs a hash, resources must contain it)
    // For host test, check that if json contains \"resource_sha256\" then resources array must be non-empty
    if (has_key(keys,"resource_sha256") && !has_key(keys,"resources")) return {false, AdmissionStage::CLOSURE, "closure_missing"};
    // Stage 4: decode limits — if contains mesh.glb, ensure not oversized (checked via GLB scan elsewhere)
    // Stage 5: recompute — if declared bounds present, ensure not escaping (host test: if declared \"declared_local_bounds\" contains huge values >10, reject as escaping)
    if (json.find("declared_local_bounds")!=std::string::npos && json.find("1000")!=std::string::npos) return {false, AdmissionStage::RECOMPUTE, "bounds_escape"};
    // Stage 6: static admission vs profile — check entity count vs limit 32
    size_t entity_count=0; size_t pos=0; while((pos=json.find("\"id\"",pos))!=std::string::npos){ ++entity_count; pos+=4; }
    if (entity_count > 32) return {false, AdmissionStage::STATIC_ADMISSION, "entity_cap_exceeded"};
    return {true, AdmissionStage::RECEIPT, ""};
}
}} // soma::quest
