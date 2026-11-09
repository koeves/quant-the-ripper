"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLiveSet, loadQuant, beatMarkers, synthAudio } = require("./mock-live");

const { Detect } = loadQuant(createLiveSet());
const plain = (v) => JSON.parse(JSON.stringify(v));

function detect(audio) {
    const env = new Detect.Envelope(audio.sampleRate);
    const ch = audio.channels[0];
    for (let i = 0; i < ch.length; i += 65536) env.push(ch.subarray(i, i + 65536));
    return plain(Detect.pickOnsets(env.env, env.hopSec, env.delaySec));
}

// 125 BPM four-to-the-floor with slight timing wobble, like a rip.
const beat = 60 / 125;
const kicks = Array.from({ length: 32 }, (_, i) => 0.5 + i * beat + 0.004 * Math.sin(i / 3));

test("finds every kick within 2 ms", () => {
    const onsets = detect(synthAudio({ seconds: 17, kickTimes: kicks }));
    assert.equal(onsets.length, kicks.length);
    onsets.forEach((t, i) => assert.ok(Math.abs(t - kicks[i]) < 0.002, `kick ${i}: ${t} vs ${kicks[i]}`));
});

test("ignores hats between kicks", () => {
    const hats = kicks.map((t) => t + beat / 2);
    const onsets = detect(synthAudio({ seconds: 17, kickTimes: kicks, hatTimes: hats }));
    assert.equal(onsets.length, kicks.length);
});

test("silence gives no onsets", () => {
    assert.deepEqual(detect(synthAudio({ seconds: 2, kickTimes: [] })), []);
});

test("sampleToBeat interpolates the warp map", () => {
    const m = [{ beat_time: 0, sample_time: 0 }, { beat_time: 4, sample_time: 2 }, { beat_time: 8, sample_time: 3 }];
    assert.equal(Detect.sampleToBeat(m, 1), 2);
    assert.equal(Detect.sampleToBeat(m, 2.5), 6);
    assert.equal(Detect.sampleToBeat(m, 4), 12); // extrapolates the last segment
});

test("markersForOnsets skips onsets next to existing markers or outside the file", () => {
    const existing = [{ beat_time: 0, sample_time: 0 }, { beat_time: 8, sample_time: 4 }];
    const out = plain(Detect.markersForOnsets(existing, [0.005, 1, 3.995, 2, 9], 5));
    assert.deepEqual(out, [{ beat_time: 2, sample_time: 1 }, { beat_time: 4, sample_time: 2 }]);
});

test("Prep with kick detection adds kick markers and quantizes a clip that had none", () => {
    const live = createLiveSet({ tempo: 125 });
    const track = live.addTrack("Rip");
    const audio = synthAudio({ seconds: 17, kickTimes: kicks, hatTimes: kicks.map((t) => t + beat / 2) });
    live.addAudioFile("/samples/rip.wav", audio);
    // Freshly warped clip: one marker at the start plus Live's hidden marker.
    const clip = live.addClip(track, {
        name: "rip", file_path: "/samples/rip.wav", end_marker: 34,
        warp_markers: [{ beat_time: 0, sample_time: 0 }, { beat_time: 34, sample_time: 34 * beat }],
    });
    live.view.detail_clip = clip;
    const q = loadQuant(live);
    q.Detect.resetFormat();

    // No start beat given: the grid start is found from the markers.
    q.prep(1, 30);
    live.runTasks();

    const prepared = live.song.tracks[1].arrangement_clips[0];
    assert.ok(prepared.warp_markers.length >= kicks.length, "kick markers added");
    assert.equal(clip.warp_markers.length, 2, "original untouched");
    const status = q.__outlets.filter((o) => o[0] === "progress_text").map((o) => o[1]);
    assert.ok(status.some((t) => /^Detecting kicks/.test(t)));
    // Every kick is kept (plus Live's start marker when the grid stays on 1.1.1).
    const kept = status[status.length - 1].match(/^Done\. Kept (\d+)\/(\d+)/);
    assert.ok(kept && kept[1] === kept[2] && Number(kept[1]) >= kicks.length, status[status.length - 1]);
    assert.equal(live.patcher.boxes.length, 0, "temporary buffer~ removed");
});

test("an off-beat hit just before a kick does not hide the kick", () => {
    // Off-beat bass/percussion hits shortly before a kick: closer than the
    // old 0.25 s minimum gap, which kept the first hit and dropped the kick.
    const b = 60 / 127;
    const kicks127 = Array.from({ length: 32 }, (_, i) => 0.5 + i * b);
    const ghosts = kicks127.filter((_, i) => i % 4 === 0 && i > 0).map((t) => t - 0.21);
    const onsets = detect(synthAudio({ seconds: 17, kickTimes: kicks127, ghostTimes: ghosts }));
    for (const k of kicks127) {
        assert.ok(onsets.some((t) => Math.abs(t - k) < 0.002), `kick at ${k.toFixed(3)} missing`);
    }
});
