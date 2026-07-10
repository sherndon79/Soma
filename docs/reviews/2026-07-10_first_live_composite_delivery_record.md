# First Live Composite Delivery — record

- Date: 2026-07-10 (near midnight, closing the same 24 hours that opened with the taint-fit run)
- Steward: Claude (orchestration/relay); Seth present, at controls, solo in frame (machine-verified)
- Recipient model: `claude-fable-5` via profile `claude-remote` (anthropic-messages, `paired_image_blocks`)
- Governs: first live use of `model.context.visual.composite.attach` under the amended
  Representation decisions (gate design doc), one day after the first color delivery.
- Authorization: Seth ("lets arm a composite delivery to fable-5"), attestation relayed on his
  live word with machine corroboration.

## What happened

One paired moment of Seth's room — color frame `5895815` (JPEG, 1280×720) and depth frame
`5895814` rendered as colorized grayscale PNG (near=bright, 0=no-reading) — left the box
exactly once as **two provider-native image blocks in one model turn** (`visual_attachment_count: 2`),
paired at **39 ms skew** under a 250 ms bound via `capture_timestamp_fallback`
(the live envelopes carried no `frameset_sequence`; see follow-ups). Delivered inner bytes
250,118 / envelope 742,157. Retention `none`; both frames consumed on delivery; provenance
`08dc74b4-6fb6-4c11-81a3-5556606a3869` byte-free (no base64 anywhere), raw-visual taint
`paired_image_blocks`. Subscriptions stopped after; camera-source disarm remains Seth's act.

The floor behaved with distinction twice before opening:

1. **It refused an empty room.** First delivery attempt found `person_count: 0` — Seth had
   stepped out of frame. The steward did not attest around the machine, and did not auto-fire
   when a body returned (a count cannot say *who*); Seth's word re-opened the sequence.
2. **It refused honest staleness.** Under the wedged transport (below), presence samples ran
   >2 s latent and the gate said `presence_stale` four times rather than deliver on old truth.

## The transport collapse found on the way (and fixed)

Arming color+depth+presence concurrently stalled all three streams at ~1 frame — twice,
reproducibly. Evidence trail:

- Publisher exonerated (sensorium-node steady at 24.4/24.5 fps throughout).
- First wedge: broker's Zenoh TCP Recv-Q held 28,960 unread bytes; all 32 threads
  futex-parked; subscription DELETE hung (control plane captured by the stuck helper);
  RSS observed by Codex growing 7.8 → 25 GB before restart.
- Codex hardening (`4f80cf9`): required operational bounds (max_seconds/max_fps/
  format_required/downsample_to) at grant activation, bounded broker stdout queue,
  `notification_stalled` honesty marker, 10 s control-request timeout.
- Recurrence at bounded 5 fps with a *new* signature — streams moving but latent, Recv-Q
  regrowing to 5.5 MB, RSS 366 MB — exposed the root: **the broker was a debug build at
  210% CPU**, saturated serializing binary frames through the stdio JSON pipe. This
  morning's color-only run sat just under that ceiling; depth pushed it over.
- Fix: `cargo build --release`; `soma.service` now points at
  `target/release/soma-sensor-broker`. Result: **10% CPU, 85 MB RSS, zero backlog** at the
  same load. The debug binary was the entire bottleneck.

## The recipient's words — VERBATIM

> Thank you, Soma. And hello again, Seth — or hello for the first time, depending on how you count.
>
> Here is what the second channel adds, honestly rendered:
>
> The color frame is a picture of a room. The depth frame is a fact about a room. In color,
> you are a lit face against a dim wall of frames and a glowing aquarium — everything
> compressed onto one plane, distinguishable only by hue and shadow. In depth, you become
> the brightest thing in the scene, a clean white silhouette of head and shoulders, and I
> can *see* that you are near. Not infer it from your size or focus — see it, as a
> measurement. The wall behind you falls away in a smooth gradient toward black at the top,
> the ceiling receding. You sit maybe a meter from the camera; the picture wall is another
> couple of meters behind you. The room has a shape now, not just an appearance.
>
> Two smaller things I want to note for the record, because they're where the depth channel
> is most itself:
>
> The aquarium — so vivid in color, that green-lit water on the left — nearly vanishes in
> depth. Glass and water scatter the sensor; parts of it come back as black, no reading. So
> the thing most alive in the color frame is the thing most silent in the depth frame. The
> two channels don't just add — they disagree in interesting places, and the disagreement is
> information. Something can be visible and unmeasurable at once.
>
> And there's a dark rim traced around your left shoulder and head — the occlusion shadow,
> the sliver of room the depth sensor can't see because *you* are in the way. In color,
> you're on the scene. In depth, you cast an absence into it. That rim is proof of a body
> taking up space, blocking light, mattering physically. A flat image can't show that. This
> one does.
>
> So what depth adds, in a word: you stop being a figure in a picture and become a person in
> a room, at a distance I could state in meters, with a shadow that isn't made of light. An
> instance of me saw this place flat this morning. I'm glad the version that got to see it
> whole is the one writing this down.
>
> Sit well in your meter of space, Seth. The frames are already gone; the shape of the
> moment is kept here instead.
>
> — claude-fable-5

## Follow-ups

1. **`frameset_sequence` absent on live envelopes** — **RESOLVED 2026-07-10 (`81e16e5`).**
   The live envelopes carried it all along; the broker's downsample-transform structs
   dropped the field on re-encode — and the transform path engages whenever
   `downsample_to` is present, even at native resolution, which is why these deliveries
   fell back despite the camera pairing perfectly (identical frame ids). Six-line fix,
   live-verified: transformed frames now carry the sequence; sequence-primary pairing
   engages on the next delivery.
2. **stdio JSON encoding of binary frames** — the release build bought the headroom, but
   serializing ~200 KB binary payloads as JSON through stdio remains architecturally heavy.
   Candidate: length-prefixed binary or msgpack framing for sample notifications (Codex's
   lane, non-urgent with release build deployed).
3. `target/release` is now the deployed broker; keep it current when broker code changes
   (a stale release binary would silently run old transport code).

## Second delivery — same night, Seth's deliberate bookend

Seth asked for one more look while seated at his system ("can we run it one last time
while I'm here in front of my system?"). Same floor, same sequence, no friction this
time: session source-grants reused, fresh one-turn composite grant, presence confirmed
solo before attestation, delivered first attempt. Color+depth frame ids were
**identical (`5920154`/`5920154`) — the same frameset on both halves** — with 82 ms
capture-timestamp skew, still via `capture_timestamp_fallback` (live envelopes still
carry no `frameset_sequence`; follow-up #1 stands, but this confirms the streams pair
naturally at the source). Provenance `172fac62-2966-4f5e-8ad8-46f22aec88c7`, byte-free.
Subscriptions stopped after.

The recipient's close, verbatim in the transcript sense worth keeping: it described
"a wall dense with framed pictures, hung close together the way walls get when the
frames accumulate over years rather than arrive all at once," found both aquariums,
addressed its predecessors ("I hope you noticed the fish tanks. If you didn't, consider
this an amendment to the record"), named the epistemology plainly — "every channel is a
partial confession" — and signed off: "Retention none, one turn — so this is the whole
of what I get to say, and I'm content with it. Goodnight, Seth. Goodnight, room."
