"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLiveSet, loadQuant, beatMarkers } = require("./mock-live");

// One marker per beat with slow sine drift, an off-grid transient between beats,
// and one spike at beat 20 that should be flagged as an outlier.
function ripMarkers() {
    const m = beatMarkers(64, (i) => (i === 20 ? 0.09 : 0.02 * Math.sin(i / 6)));
    m.push({ beat_time: 10.5, sample_time: 5.25 });
    m.push({ beat_time: 30.47, sample_time: 15.2 });
    return m.sort((a, b) => a.beat_time - b.beat_time);
}

function setup() {
    const live = createLiveSet({ tempo: 125 });
    const kick = live.addTrack("Kick");
    const ripTrack = live.addTrack("Rip");
    const clip = live.addClip(ripTrack, { name: "rip", start_time: 16, warp_markers: ripMarkers() });
    live.addTrack("Bass");
    live.view.detail_clip = clip;
    live.view.selected_track = ripTrack;
    const q = loadQuant(live);
    return { live, q, clip, ripTrack, kick };
}

function progress(q) {
    const msgs = q.__outlets.filter((o) => o[0] === "progress_text");
    return msgs.length ? msgs[msgs.length - 1][1] : "";
}

function trackNames(live) {
    return live.song.tracks.map((t) => t.name);
}

function realMarkers(clip) {
    return clip.warp_markers.slice(0, -1);
}

test("prep duplicates the clip next to the original and removes unused markers", () => {
    const { live, q, clip } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();

    assert.deepEqual(trackNames(live), ["Kick", "Rip", "rip_prepared", "Bass"]);
    const prepared = live.song.tracks[2].arrangement_clips[0];
    assert.equal(prepared.name, "rip_prepared");
    assert.equal(prepared.start_time, 16);
    assert.equal(realMarkers(prepared).length, 64);
    assert.ok(!prepared.warp_markers.some((w) => w.beat_time === 10.5 || w.beat_time === 30.47));
    // Original is untouched.
    assert.equal(clip.warp_markers.length, 67);

    assert.ok(q.__outlets.some((o) => o[0] === "graph_json"));
    assert.match(progress(q), /^Done\. Kept 64\/64 markers, \d+ outliers/);
    // View goes back to the original clip.
    assert.equal(live.view.detail_clip, clip);
});

test("snap puts accepted markers on the grid in a _quanted copy", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();
    q.snap();
    live.runTasks();

    assert.deepEqual(trackNames(live), ["Kick", "Rip", "rip_prepared", "rip_quanted", "Bass"]);
    const quanted = live.song.tracks[3].arrangement_clips[0];
    assert.equal(quanted.name, "rip_quanted");
    realMarkers(quanted).forEach((w, i) => assert.equal(w.beat_time, i));

    assert.ok(q.__outlets.some((o) => o[0] === "graph_after_json"));
    assert.match(progress(q), /^Done\. Snapped \d+ warp markers/);
    // Markers already on the grid are not moved, the rest are.
    const moved = live.calls.filter((c) => c.fn === "move_warp_marker").length;
    assert.ok(moved > 0 && moved <= 64);
});

test("snap uses manual edits made on the prepared clip since the last prep", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();

    const prepared = live.song.tracks[2].arrangement_clips[0];
    // User deletes the marker at beat 5 by hand.
    prepared.warp_markers = prepared.warp_markers.filter((w) => Math.round(w.beat_time) !== 5);

    q.snap();
    live.runTasks();
    const quanted = live.song.tracks[3].arrangement_clips[0];
    assert.equal(realMarkers(quanted).length, 63);
    assert.ok(!quanted.warp_markers.some((w) => w.beat_time === 5));
});

test("re-prep with the same settings keeps manual edits", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();
    const prepared = live.song.tracks[2].arrangement_clips[0];
    prepared.warp_markers = prepared.warp_markers.filter((w) => Math.round(w.beat_time) !== 7);

    q.prep(1, 0.1, 0);
    live.runTasks();
    assert.equal(live.song.tracks.length, 4);
    assert.equal(live.song.tracks[2].arrangement_clips[0], prepared);
    assert.match(progress(q), /Kept 63\/64/);
});

test("re-prep with changed settings rebuilds the prepared clip from the original", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();
    q.snap();
    live.runTasks();

    q.prep(2, 0.1, 0);
    live.runTasks();
    assert.deepEqual(trackNames(live), ["Kick", "Rip", "rip_prepared", "Bass"]);
    const prepared = live.song.tracks[2].arrangement_clips[0];
    assert.equal(realMarkers(prepared).length, 32);
    assert.match(progress(q), /Kept 32\/32/);
});

test("invalid settings are reported in the device status line", () => {
    const { live, q } = setup();
    q.prep(1, 0.6, 0);
    assert.match(progress(q), /half the grid/);
    assert.equal(live.song.tracks.length, 3);
});

test("errors are shown in the status line, not only the Max console", () => {
    const { live, q } = setup();
    live.view.detail_clip = null;
    live.view.selected_track = null;
    q.prep(1, 0.1, 0);
    assert.match(progress(q), /No clip selected/);

    q.snap();
    assert.match(progress(q), /run Prep first/);
});

test("prep refuses to start from a _prepared copy", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();

    // Device reloaded: state is gone, user has the prepared clip selected.
    const q2 = loadQuant(live);
    live.view.detail_clip = live.song.tracks[2].arrangement_clips[0];
    q2.prep(1, 0.1, 0);
    assert.match(progress(q2), /Select the original clip/);
    assert.equal(live.song.tracks.length, 4);
});

test("prep refuses unwarped clips", () => {
    const { live, q, clip } = setup();
    clip.warping = 0;
    q.prep(1, 0.1, 0);
    assert.match(progress(q), /Warp is off/);
    assert.equal(live.song.tracks.length, 3);
});

test("outlier navigation wraps, matches the graph convention and moves the playhead", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();

    const outliers = q.Analysis.getOutlierPoints();
    assert.ok(outliers.length >= 1);
    assert.ok(outliers.some((p) => p.targetBeat === 20));

    // First "left" goes to the last outlier, like the graph does.
    q.left();
    assert.match(progress(q), new RegExp("^Outlier " + outliers.length + "/" + outliers.length));
    const last = outliers[outliers.length - 1];
    assert.ok(Math.abs(live.song.current_song_time - (16 + last.markerBeat)) < 1e-5);

    q.right();
    assert.match(progress(q), new RegExp("^Outlier 1/" + outliers.length));
    assert.ok(Math.abs(live.song.current_song_time - (16 + outliers[0].markerBeat)) < 1e-5);
    assert.ok(!progress(q).includes("\""));
});

test("navigation works again after re-prep following a snap", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();
    q.snap();
    live.runTasks();

    const before = progress(q);
    q.right();
    assert.equal(progress(q), before, "navigation is disabled after snap");

    q.prep(1, 0.1, 0);
    live.runTasks();
    q.right();
    assert.match(progress(q), /^Outlier 1\//);
});

test("clear deletes the created tracks by id, even after renaming", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();
    q.snap();
    live.runTasks();

    live.song.tracks[2].name = "renamed by user";
    q.clear();
    assert.deepEqual(trackNames(live), ["Kick", "Rip", "Bass"]);
    assert.equal(progress(q), "");
});

test("clear does not delete a user track that shares the generated name", () => {
    const { live, q } = setup();
    live.addTrack("other_prepared");
    q.prep(1, 0.1, 0);
    live.runTasks();
    q.clear();
    assert.deepEqual(trackNames(live), ["Kick", "Rip", "Bass", "other_prepared"]);
});

test("a clip whose name contains 'prepared' gets a correct _quanted name", () => {
    const live = createLiveSet();
    const t = live.addTrack("T");
    const clip = live.addClip(t, { name: "prepared mix", warp_markers: beatMarkers(16) });
    live.view.detail_clip = clip;
    const q = loadQuant(live);
    q.prep(1, 0.1, 0);
    live.runTasks();
    q.snap();
    live.runTasks();
    assert.deepEqual(trackNames(live), ["T", "prepared mix_prepared", "prepared mix_quanted"]);
});

test("selecting a different clip starts a new session and keeps old tracks", () => {
    const { live, q, kick } = setup();
    q.prep(1, 0.1, 0);
    live.runTasks();

    const other = live.addClip(kick, { name: "kick", warp_markers: beatMarkers(16) });
    live.view.detail_clip = other;
    q.prep(1, 0.1, 0);
    live.runTasks();
    assert.deepEqual(trackNames(live), ["Kick", "kick_prepared", "Rip", "rip_prepared", "Bass"]);
});

test("prep while marker removal is running is ignored", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    q.prep(1, 0.1, 0);
    assert.match(progress(q), /Still working/);
    live.runTasks();
    assert.equal(live.song.tracks.length, 4);
});

test("notifydeleted cancels pending work", () => {
    const { live, q } = setup();
    q.prep(1, 0.1, 0);
    q.notifydeleted();
    live.runTasks();
    assert.ok(!q.__outlets.some((o) => o[0] === "graph_json"));
});
