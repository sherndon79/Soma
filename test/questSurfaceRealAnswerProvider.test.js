import assert from "node:assert/strict";
import test from "node:test";
import { createRealTextLocalAnswerProvider } from "../src/questSurfaceRealAnswerProvider.js";

function makeWav(monoPcm, sampleRate=48000){
  const h=44; const b=Buffer.alloc(h+monoPcm.length);
  b.write("RIFF",0); b.writeUInt32LE(36+monoPcm.length,4); b.write("WAVE",8);
  b.write("fmt ",12); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(sampleRate,24);
  b.writeUInt32LE(sampleRate*2,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34);
  b.write("data",36); b.writeUInt32LE(monoPcm.length,40); monoPcm.copy(b,44); return b;
}

function makePcmForChunking(ms=40){
  // S16LE 48kHz mono: 960 samples per 20ms => 1920 bytes per 20ms, 3840 per 40ms mono
  const bytes = Math.round(48000*0.001*ms*2);
  const buf=Buffer.alloc(bytes, 0);
  for(let i=0;i<buf.length;i+=2) buf.writeInt16LE(1000,i);
  return buf;
}

function createMockFetch({ onWhisper, onGemma, onKokoro, failWhisper, failGemma, failKokoro }){
  const calls={ whisper: [], gemma: [], kokoro: [] };
  const fetchImpl=async (url, opts)=>{
    if (url.includes("/transcribe")){
      calls.whisper.push({url, opts});
      if (failWhisper) return { ok:false, status:503, text: async()=>"whisper down" };
      if (onWhisper) return onWhisper(url, opts);
      return { ok:true, status:200, json: async()=>({ text: "hello soma", language:"en", duration:0.02, segments:[] }) };
    }
    if (url.includes("/v1/chat/completions")){
      calls.gemma.push({url, opts, body: opts.body ? JSON.parse(opts.body) : null});
      if (failGemma) return { ok:false, status:503, text: async()=>"gemma down" };
      if (onGemma) return onGemma(url, opts);
      return { ok:true, status:200, json: async()=>({ choices:[{ message:{ content:"hello there" }, finish_reason:"stop" }], model:"ciocan/gemma-4-E4B-it-W4A16" }) };
    }
    if (url.includes("/synthesize")){
      calls.kokoro.push({url, opts});
      if (failKokoro) return { ok:false, status:503, text: async()=>"kokoro down" };
      if (onKokoro) return onKokoro(url, opts);
      const mono=makePcmForChunking(40);
      const wav=makeWav(mono);
      return { ok:true, status:200, arrayBuffer: async()=>wav };
    }
    throw new Error(`unmocked ${url}`);
  };
  fetchImpl.calls=calls;
  return fetchImpl;
}

test("I-3 integration: happy path through real provider yields answerText, 3840 chunks, terminal", async ()=>{
  const fetchImpl=createMockFetch({});
  const provider=createRealTextLocalAnswerProvider({ fetchImpl });
  const pcm=Buffer.alloc(1920, 1);
  const events=[];
  for await (const ev of provider.respond({ pcm, utteranceId:"u1", answerId:"a1" })){
    events.push(ev);
  }
  const answerEv=events.find(e=>e.answerText);
  assert.ok(answerEv, "must yield answerText");
  assert.equal(answerEv.answerText, "hello there");
  const audioChunks=events.filter(e=>e.audioChunk);
  assert.ok(audioChunks.length>=1, "must yield at least one audio chunk");
  for(const c of audioChunks){
    assert.ok(Buffer.isBuffer(c.audioChunk) || c.audioChunk instanceof Uint8Array);
    assert.equal(c.audioChunk.length, 3840, "each chunk exactly 3840 bytes (stereo 48k 20ms)");
  }
  const term=events.find(e=>e.terminal);
  assert.ok(term && term.terminal===true, "must yield terminal");
  assert.equal(term.utteranceId, "u1"); assert.equal(term.answerId, "a1");
});

test("I-3 firewall: model sees transcript string, never PCM bytes", async ()=>{
  let gemmaBody=null;
  const fetchImpl=createMockFetch({
    onGemma: (url, opts)=>{
      const body=JSON.parse(opts.body);
      gemmaBody=body;
      return { ok:true, status:200, json: async()=>({ choices:[{ message:{ content:"hi" } }] }) };
    }
  });
  const provider=createRealTextLocalAnswerProvider({ fetchImpl });
  const pcm=Buffer.alloc(1920, 2); // non-zero PCM to detect leak
  const pcmBase64=pcm.toString("base64");
  for await (const _ of provider.respond({ pcm, utteranceId:"u2", answerId:"a2" })){
    // consume
  }
  assert.ok(gemmaBody, "gemma called");
  const userMsg=gemmaBody.messages.find(m=>m.role==="user");
  assert.ok(userMsg, "user message exists");
  assert.equal(userMsg.content, "hello soma", "user message equals transcript string");
  // walk body for any Buffer/base64 PCM
  const bodyStr=JSON.stringify(gemmaBody);
  assert.equal(bodyStr.includes("__BYTES__"), false);
  // ensure no base64 of pcm appears
  assert.equal(bodyStr.includes(pcmBase64.slice(0,20)), false, "no PCM base64 in model body");
  assert.ok(!Buffer.isBuffer(gemmaBody), "body not Buffer");
  // also check that no chunk of body is Uint8Array
  const hasBytes = JSON.stringify(gemmaBody, (k,v)=> (Buffer.isBuffer(v)|| v instanceof Uint8Array) ? "__BYTES__" : v).includes("__BYTES__");
  assert.equal(hasBytes, false, "no PCM bytes reach model");
});

test("I-3 fail-closed whisper 503 throws stt_unavailable, no partial answer", async ()=>{
  const fetchImpl=createMockFetch({ failWhisper:true });
  const provider=createRealTextLocalAnswerProvider({ fetchImpl });
  const pcm=Buffer.alloc(1920,1);
  const events=[];
  await assert.rejects(async ()=>{
    for await (const ev of provider.respond({ pcm, utteranceId:"u3", answerId:"a3" })){
      events.push(ev);
    }
  }, err=>{
    assert.ok(err.code==="stt_unavailable" || /stt/.test(err.code), `code ${err.code} should be stt_unavailable`);
    return true;
  });
  assert.equal(events.length, 0, "whisper failure must emit no partial answer before throw");
});

test("I-3 fail-closed gemma 503 throws model_unavailable, no fallback, at most transcript-stage", async ()=>{
  const fetchImpl=createMockFetch({ failGemma:true });
  const provider=createRealTextLocalAnswerProvider({ fetchImpl });
  const pcm=Buffer.alloc(1920,1);
  const events=[];
  await assert.rejects(async ()=>{
    for await (const ev of provider.respond({ pcm, utteranceId:"u4", answerId:"a4" })){
      events.push(ev);
    }
  }, err=>{
    assert.ok(err.code==="model_unavailable" || /model/.test(err.code), `code ${err.code} should be model_unavailable`);
    return true;
  });
  // whisper succeeded but gemma failed, so no answerText should have been yielded (seam fails closed before tts)
  // The current seam yields answerText only after model, so events should be empty
  assert.ok(events.length===0 || events.every(e=>!e.answerText), "gemma failure must not emit answerText fallback");
  // ensure no audio before throw beyond stt stage
  assert.equal(events.filter(e=>e.audioChunk).length, 0);
});

test("I-3 fail-closed kokoro 503 throws tts_unavailable, no silent audio fallback", async ()=>{
  const fetchImpl=createMockFetch({ failKokoro:true });
  const provider=createRealTextLocalAnswerProvider({ fetchImpl });
  const pcm=Buffer.alloc(1920,1);
  const events=[];
  await assert.rejects(async ()=>{
    for await (const ev of provider.respond({ pcm, utteranceId:"u5", answerId:"a5" })){
      events.push(ev);
    }
  }, err=>{
    assert.ok(err.code==="tts_unavailable" || /tts/.test(err.code), `code ${err.code} should be tts_unavailable`);
    return true;
  });
  // kokoro fails after stt+model, so answerText may have been yielded before failure (model succeeded)
  // but must not yield audio chunks as silent fallback, and must not yield terminal as success
  assert.equal(events.filter(e=>e.audioChunk).length, 0, "kokoro failure must not emit audio chunks");
  assert.equal(events.filter(e=>e.terminal).length, 0, "kokoro failure must not emit terminal success");
});
