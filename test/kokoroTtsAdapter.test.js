import assert from "node:assert/strict";
import test from "node:test";
import { createKokoroTtsAdapter, parseWavPcm, monoToStereo, chunkStereo } from "../src/adapters/kokoroTts.js";

function makeWav(monoPcm, sampleRate=48000) {
  const headerSize=44;
  const buf=Buffer.alloc(headerSize+monoPcm.length);
  buf.write("RIFF",0); buf.writeUInt32LE(36+monoPcm.length,4); buf.write("WAVE",8);
  buf.write("fmt ",12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(1,22); buf.writeUInt32LE(sampleRate,24);
  buf.writeUInt32LE(sampleRate*1*16/8,28); buf.writeUInt16LE(2,32); buf.writeUInt16LE(16,34);
  buf.write("data",36); buf.writeUInt32LE(monoPcm.length,40); monoPcm.copy(buf,44); return buf;
}

test("kokoro adapter returns correctly formatted 48kHz stereo 3840-byte chunks", async () => {
  // simulate mono 48kHz PCM: 960*2 bytes per 20ms? Actually 960 samples *2 =1920 per 20ms mono; 40ms =3840 mono -> 7680 stereo
  // Create 40ms mono: 1920*2 =3840 mono bytes -> stereo 7680 -> 2 chunks of 3840
  const mono = Buffer.alloc(3840, 0);
  for(let i=0;i<mono.length;i+=2) mono.writeInt16LE(1000,i);
  const wav = makeWav(mono, 48000);
  const fetchImpl = async (url, opts) => {
    assert.ok(url === "http://127.0.0.1:4010/synthesize");
    assert.equal(opts.method, "POST");
    const body=JSON.parse(opts.body);
    assert.equal(body.text, "hello there");
    assert.ok(body.voice);
    return { ok:true, status:200, arrayBuffer: async () => wav };
  };
  const tts = createKokoroTtsAdapter({ fetchImpl, endpoint:"http://127.0.0.1:4010", voice:"default" });
  const chunks = await tts("hello there", { answerId:"a1" });
  assert.equal(chunks.length, 2, "40ms mono -> 2 stereo chunks");
  for(const c of chunks){
    assert.equal(c.length, 3840, "each chunk 3840 bytes/20ms stereo 48kHz");
    // verify stereo: every 4 bytes is duplicate mono sample
    for(let i=0;i<c.length;i+=4){
      const l=c.readInt16LE(i), r=c.readInt16LE(i+2);
      assert.equal(l,r, "stereo duplicated");
      assert.equal(l,1000);
    }
  }
});

test("kokoro respects config-driven endpoint", async () => {
  const mono=Buffer.alloc(1920,1);
  const wav=makeWav(mono);
  let seenUrl=null;
  const fetchImpl=async (url)=>{ seenUrl=url; return { ok:true, status:200, arrayBuffer: async()=>wav }; };
  const tts=createKokoroTtsAdapter({ fetchImpl, endpoint:"http://kokoro-tts:4010" });
  await tts("hi", {});
  assert.equal(seenUrl, "http://kokoro-tts:4010/synthesize");
});

test("kokoro fail-closed: non-2xx throws typed error", async () => {
  const fetch503=async()=>({ ok:false, status:503, text: async()=>"overloaded" });
  const tts=createKokoroTtsAdapter({ fetchImpl: fetch503, endpoint:"http://127.0.0.1:4010" });
  await assert.rejects(()=>tts("hello", {}), err=>{ assert.equal(err.code,"tts_unavailable"); return true; });
  const fetch400=async()=>({ ok:false, status:400, text: async()=>"bad" });
  const tts2=createKokoroTtsAdapter({ fetchImpl: fetch400, endpoint:"http://127.0.0.1:4010" });
  await assert.rejects(()=>tts2("hello", {}), err=>{ assert.equal(err.code,"tts_failed"); return true; });
});

test("kokoro fail-closed: network, malformed, empty -> typed throw (red->green)", async () => {
  const fetchNet=async()=>{ throw new Error("ECONNREFUSED"); };
  const tts=createKokoroTtsAdapter({ fetchImpl: fetchNet, endpoint:"http://127.0.0.1:4010" });
  await assert.rejects(()=>tts("hello", {}), err=>{ assert.equal(err.code,"tts_unavailable"); return true; });
  const fetchEmpty=async()=>({ ok:true, status:200, arrayBuffer: async()=>Buffer.alloc(0) });
  const tts2=createKokoroTtsAdapter({ fetchImpl: fetchEmpty, endpoint:"http://127.0.0.1:4010" });
  await assert.rejects(()=>tts2("hello", {}), err=>{ assert.equal(err.code,"tts_failed"); return true; });
  const fetchBadWav=async()=>({ ok:true, status:200, arrayBuffer: async()=>Buffer.from("notwav") });
  const tts3=createKokoroTtsAdapter({ fetchImpl: fetchBadWav, endpoint:"http://127.0.0.1:4010" });
  await assert.rejects(()=>tts3("hello", {}), err=>{ assert.equal(err.code,"tts_failed"); return true; });
});

test("kokoro helpers: monoToStereo and chunkStereo invariants", () => {
  const mono=Buffer.alloc(4,0); mono.writeInt16LE(1,0); mono.writeInt16LE(2,2);
  const stereo=monoToStereo(mono);
  assert.equal(stereo.length, 8); // 2 samples *4
  assert.equal(stereo.readInt16LE(0),1); assert.equal(stereo.readInt16LE(2),1);
  assert.equal(stereo.readInt16LE(4),2); assert.equal(stereo.readInt16LE(6),2);
  const chunks=chunkStereo(Buffer.alloc(3840*2, 0));
  assert.equal(chunks.length,2); assert.equal(chunks[0].length,3840);
  // parseWav
  const wav=makeWav(Buffer.alloc(100,0));
  const parsed=parseWavPcm(wav);
  assert.equal(parsed.sampleRate,48000); assert.equal(parsed.channels,1);
});
