"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLiveSet, loadQuant, beatMarkers } = require("./mock-live");

// These clips have hand-placed markers and no audio file: run Prep without kick detection.
function manualQuant(live) {
    const q = loadQuant(live);
    q.detect(0);
    return q;
}

// Tolerance is given in ms: 48 ms is 0.1 beat at 125 BPM.
const TOL = 48;

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
    const q = manualQuant(live);
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
    q.prep(1, TOL, 0);
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
    q.prep(1, TOL, 0);
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
    q.prep(1, TOL, 0);
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
    q.prep(1, TOL, 0);
    live.runTasks();
    const prepared = live.song.tracks[2].arrangement_clips[0];
    prepared.warp_markers = prepared.warp_markers.filter((w) => Math.round(w.beat_time) !== 7);

    q.prep(1, TOL, 0);
    live.runTasks();
    assert.equal(live.song.tracks.length, 4);
    assert.equal(live.song.tracks[2].arrangement_clips[0], prepared);
    assert.match(progress(q), /Kept 63\/64/);
});

test("re-prep with changed settings rebuilds the prepared clip from the original", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();
    q.snap();
    live.runTasks();

    q.prep(2, TOL, 0);
    live.runTasks();
    assert.deepEqual(trackNames(live), ["Kick", "Rip", "rip_prepared", "Bass"]);
    const prepared = live.song.tracks[2].arrangement_clips[0];
    assert.equal(realMarkers(prepared).length, 32);
    assert.match(progress(q), /Kept 32\/32/);
});

test("invalid settings are reported in the device status line", () => {
    const { live, q } = setup();
    q.prep(0, TOL, 0);
    assert.match(progress(q), /Grid must be greater than 0/);
    assert.equal(live.song.tracks.length, 3);
});

test("tolerance of half the grid or more is limited and reported", () => {
    const { live, q } = setup();
    q.prep(1, 400, 0);
    live.runTasks();
    assert.match(progress(q), /tolerance limited to 216 ms/);
    assert.equal(q.State.state.lastAnalysis.toleranceBeats, 0.45);
});

test("errors are shown in the status line, not only the Max console", () => {
    const { live, q } = setup();
    live.view.detail_clip = null;
    live.view.selected_track = null;
    q.prep(1, TOL, 0);
    assert.match(progress(q), /No clip selected/);

    q.snap();
    assert.match(progress(q), /run Prep first/);
});

test("prep refuses to start from a _prepared copy", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();

    // Device reloaded: state is gone, user has the prepared clip selected.
    const q2 = manualQuant(live);
    live.view.detail_clip = live.song.tracks[2].arrangement_clips[0];
    q2.prep(1, TOL, 0);
    assert.match(progress(q2), /Select the original clip/);
    assert.equal(live.song.tracks.length, 4);
});

test("prep refuses unwarped clips", () => {
    const { live, q, clip } = setup();
    clip.warping = 0;
    q.prep(1, TOL, 0);
    assert.match(progress(q), /Warp is off/);
    assert.equal(live.song.tracks.length, 3);
});

test("outlier navigation wraps and matches the graph convention", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();

    const outliers = q.Analysis.getStopPoints();
    assert.ok(outliers.length >= 1);
    assert.ok(outliers.some((p) => p.targetBeat === 20 && p.outlier));

    // First "left" goes to the last stop, like the graph does.
    q.left();
    assert.match(progress(q), new RegExp("^" + outliers.length + "/" + outliers.length + " "));

    q.right();
    assert.match(progress(q), new RegExp("^1/" + outliers.length + " "));
    assert.ok(!progress(q).includes("\""));
});

test("navigation works again after re-prep following a snap", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();
    q.snap();
    live.runTasks();

    const before = progress(q);
    q.right();
    assert.equal(progress(q), before, "navigation is disabled after snap");

    q.prep(1, TOL, 0);
    live.runTasks();
    q.right();
    assert.match(progress(q), /^1\/\d+ /);
});

test("clear deletes the created tracks by id, even after renaming", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
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
    q.prep(1, TOL, 0);
    live.runTasks();
    q.clear();
    assert.deepEqual(trackNames(live), ["Kick", "Rip", "Bass", "other_prepared"]);
});

test("a clip whose name contains 'prepared' gets a correct _quanted name", () => {
    const live = createLiveSet();
    const t = live.addTrack("T");
    const clip = live.addClip(t, { name: "prepared mix", warp_markers: beatMarkers(16) });
    live.view.detail_clip = clip;
    const q = manualQuant(live);
    q.prep(1, TOL, 0);
    live.runTasks();
    q.snap();
    live.runTasks();
    assert.deepEqual(trackNames(live), ["T", "prepared mix_prepared", "prepared mix_quanted"]);
});

test("selecting a different clip starts a new session and keeps old tracks", () => {
    const { live, q, kick } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();

    const other = live.addClip(kick, { name: "kick", warp_markers: beatMarkers(16) });
    live.view.detail_clip = other;
    q.prep(1, TOL, 0);
    live.runTasks();
    assert.deepEqual(trackNames(live), ["Kick", "kick_prepared", "Rip", "rip_prepared", "Bass"]);
});

test("prep while marker removal is running is ignored", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
    q.prep(1, TOL, 0);
    assert.match(progress(q), /Still working/);
    live.runTasks();
    assert.equal(live.song.tracks.length, 4);
});

test("notifydeleted cancels pending work", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
    q.notifydeleted();
    live.runTasks();
    assert.ok(!q.__outlets.some((o) => o[0] === "graph_json"));
});

function driftingClipSetup(driftPerBeat, count = 64) {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    const clip = live.addClip(t, { name: "rip", warp_markers: beatMarkers(count, (i) => i * driftPerBeat) });
    live.view.detail_clip = clip;
    return { live, q: manualQuant(live), clip };
}

for (const [label, perBeat] of [["late", 0.03], ["early", -0.03]]) {
    test(`snap lands every marker on the grid when the rip runs ${label} by more than a beat`, () => {
        const { live, q } = driftingClipSetup(perBeat);
        q.prep(1, TOL, 0);
        live.runTasks();
        assert.match(progress(q), /Kept 64\/64 markers, 0 outliers, 0 gaps/);
        q.snap();
        live.runTasks();
        assert.deepEqual(live.refusedMoves, [], "no move crossed a neighbour");
        const quanted = live.song.tracks[2].arrangement_clips[0];
        realMarkers(quanted).forEach((w, i) => assert.equal(w.beat_time, i));
    });
}

test("without a start beat the grid starts at the first kick of a fresh clip", () => {
    // Fresh warp: Live's start marker at beat 0, kicks from beat 1.25 on.
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    const kicks = beatMarkers(64, (i) => 1.25 + 0.01 * Math.sin(i / 5)).slice(0, -1);
    const m = [{ beat_time: 0, sample_time: 0 }].concat(kicks, [{ beat_time: 70, sample_time: 33.6 }]);
    const clip = live.addClip(t, { name: "rip", warp_markers: m });
    live.view.detail_clip = clip;
    const q = manualQuant(live);
    q.prep(4, TOL);
    live.runTasks();
    assert.equal(q.State.state.lastAnalysis.analysisStartBeat, 1.25);
    assert.match(progress(q), /^Done\. Kept 16\/16 markers/);
    q.snap();
    live.runTasks();
    const quanted = live.song.tracks[2].arrangement_clips[0];
    realMarkers(quanted).forEach((w, i) => assert.ok(Math.abs(w.beat_time - (1.25 + 4 * i)) < 1e-6, `marker ${i}: ${w.beat_time}`));
});

test("re-Prep keeps the grid start it found", () => {
    const { live, q } = setup();
    q.prep(1, TOL);
    live.runTasks();
    const prepared = live.song.tracks[2].arrangement_clips[0];
    q.prep(1, TOL);
    live.runTasks();
    assert.equal(live.song.tracks[2].arrangement_clips[0], prepared, "not rebuilt");
    assert.equal(q.State.state.lastAnalysis.analysisStartBeat, 0);
});

test("snap strength moves markers part of the way", () => {
    const { live, q } = driftingClipSetup(0.002);
    q.strength(50);
    q.prep(1, TOL, 0);
    live.runTasks();
    q.snap();
    live.runTasks();
    const quanted = live.song.tracks[2].arrangement_clips[0];
    realMarkers(quanted).forEach((w, i) => assert.ok(Math.abs(w.beat_time - (i + i * 0.001)) < 1e-6, `marker ${i}: ${w.beat_time}`));
    assert.match(progress(q), /at 50%/);
});

test("Re-Pitch (on by default) sets the quanted clip's warp mode, not the others", () => {
    const { live, q, clip } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();
    q.snap();
    live.runTasks();
    assert.equal(live.song.tracks[3].arrangement_clips[0].warp_mode, 3);
    assert.equal(live.song.tracks[2].arrangement_clips[0].warp_mode, undefined);
    assert.equal(clip.warp_mode, undefined);
});

test("with Re-Pitch off Snap leaves the warp mode alone", () => {
    const { live, q } = setup();
    q.repitch(0);
    q.prep(1, TOL, 0);
    live.runTasks();
    q.snap();
    live.runTasks();
    assert.equal(live.song.tracks[3].arrangement_clips[0].warp_mode, undefined);
});

test("arrows also stop at gaps", () => {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    const m = beatMarkers(64).filter((w) => w.beat_time < 30 || w.beat_time > 33);
    const clip = live.addClip(t, { name: "rip", start_time: 8, warp_markers: m });
    live.view.detail_clip = clip;
    const q = manualQuant(live);
    q.prep(1, TOL, 0);
    live.runTasks();
    assert.match(progress(q), /1 gaps/);

    q.right();
    assert.match(progress(q), /^1\/1 Gap: 4 grid points without a marker from beat 30\.00/);
});

test("graph click shows the point in the status line", () => {
    const { live, q } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();
    q.goto_point(5);
    assert.match(progress(q), /^Beat 5\.00 \| kept \| Drift/);

    q.goto_point(20);
    assert.match(progress(q), /Outlier/);
});

test("graph and quant agree on the navigation stops", () => {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    const m = ripMarkers().filter((w) => w.beat_time < 40 || w.beat_time > 43);
    live.view.detail_clip = live.addClip(t, { name: "rip", warp_markers: m });
    const q = manualQuant(live);
    q.prep(1, TOL, 0);
    live.runTasks();

    const graphCtx = require("./mock-live").loadGraphFor(live);
    const payload = q.__outlets.filter((o) => o[0] === "graph_json").pop()[1];
    graphCtx.graph_json(payload);
    const quantStops = Array.from(q.Analysis.getStopPoints(), (p) => p.index);
    assert.deepEqual(Array.from(graphCtx.stopIndices), quantStops);
    assert.ok(quantStops.length >= 2);
});

test("graph data goes through a dictionary, so long tracks are not cut off", () => {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    // 2000 grid points: the JSON would be ~190k characters.
    live.view.detail_clip = live.addClip(t, { name: "rip", warp_markers: beatMarkers(2000, (i) => 0.01 * Math.sin(i / 9)) });
    const q = manualQuant(live);
    q.prep(1, TOL, 0);
    live.runTasks();

    for (const o of q.__outlets) {
        for (const a of o.slice(1)) assert.ok(String(a).length < 1000, `${o[0]} sends ${String(a).length} characters`);
    }

    const g = require("./mock-live").loadGraphFor(live);
    const name = q.__outlets.filter((o) => o[0] === "graph_json").pop()[1];
    g.graph_json(name);
    assert.equal(g.graph.points.length, q.State.state.lastAnalysis.points.length);
    const a = q.State.state.lastAnalysis.points;
    g.graph.points.forEach((p, k) => {
        assert.equal(p.ok, a[k].accepted);
        assert.equal(p.outlier, a[k].outlier);
        assert.ok(Math.abs(p.yBeats - a[k].driftBeats) < 1e-5);
    });
    assert.ok(g.__posts.some((m) => /received 2000 points/.test(m)));
});

test("a graph with a single point survives the dictionary round trip", () => {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    live.view.detail_clip = live.addClip(t, { name: "rip", warp_markers: beatMarkers(3) });
    const q = manualQuant(live);
    q.prep(4, TOL, 0);
    live.runTasks();
    const g = require("./mock-live").loadGraphFor(live);
    g.graph_json(q.__outlets.filter((o) => o[0] === "graph_json").pop()[1]);
    assert.equal(g.graph.points.length, 1);
    assert.equal(g.graph.points[0].ok, true);
});

test("graph data still arrives if Dict.set only accepts a list as one array", () => {
    const live = createLiveSet({ tempo: 125 });
    live.Dict.arrayOnly = true;
    const t = live.addTrack("Rip");
    live.view.detail_clip = live.addClip(t, { name: "rip", warp_markers: beatMarkers(64) });
    const q = manualQuant(live);
    q.prep(1, TOL, 0);
    live.runTasks();
    const g = require("./mock-live").loadGraphFor(live);
    g.graph_json(q.__outlets.filter((o) => o[0] === "graph_json").pop()[1]);
    assert.equal(g.graph.points.length, 64);
});

test("Prep without Detect on a clip with only its start marker says to turn on Detect", () => {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    live.view.detail_clip = live.addClip(t, {
        name: "rip", warp_markers: [{ beat_time: 0, sample_time: 0 }, { beat_time: 400, sample_time: 192 }],
    });
    const q = manualQuant(live);
    q.prep(4, TOL, 0);
    live.runTasks();
    assert.match(progress(q), /^Only 1 warp marker on the clip\. Turn on Detect/);
    assert.equal(live.song.tracks.length, 1, "no tracks created");
});

test("status suggests Detect when only a few grid points get a marker", () => {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    const m = beatMarkers(400).filter((w, i) => i % 16 === 0 || w.beat_time > 399);
    live.view.detail_clip = live.addClip(t, { name: "rip", warp_markers: m });
    const q = manualQuant(live);
    q.prep(1, TOL, 0);
    live.runTasks();
    assert.match(progress(q), /Few markers matched: turn on Detect/);
});

test("graph scale follows kept markers, not rejected points", () => {
    const live = createLiveSet({ tempo: 125 });
    const t = live.addTrack("Rip");
    // Small drift, plus a hole whose grid points would see a far-away marker.
    const m = beatMarkers(64, (i) => 0.01 * Math.sin(i)).filter((w) => w.beat_time < 20 || w.beat_time > 27);
    live.view.detail_clip = live.addClip(t, { name: "rip", warp_markers: m });
    const q = manualQuant(live);
    q.prep(1, TOL, 0);
    live.runTasks();
    const graph = q.State.state.lastGraph;
    assert.ok(graph.rejected > 0);
    assert.ok(Math.max(Math.abs(graph.yMinBeats), Math.abs(graph.yMaxBeats)) <= 0.011, `range ${graph.yMinBeats}..${graph.yMaxBeats}`);

    // After Snap every kept marker is on the grid: the after-graph is flat.
    q.snap();
    live.runTasks();
    const after = q.State.state.lastAfterGraph;
    assert.equal(after.yMinBeats, 0);
    assert.equal(after.yMaxBeats, 0);
    assert.equal(after.outliers, 0);
});

test("arrows and graph clicks leave the playhead and Live's selection alone", () => {
    // Moving the playhead from the device clears Live's clip and track selection.
    const { live, q, clip, ripTrack } = setup();
    q.prep(1, TOL, 0);
    live.runTasks();
    live.view.selected_track = ripTrack;
    live.view.detail_clip = clip;
    live.song.current_song_time = 7;
    const before = live.calls.length;
    q.right();
    q.left();
    q.goto_point(5);
    live.runTasks();
    assert.equal(live.song.current_song_time, 7);
    assert.equal(live.view.selected_track, ripTrack);
    assert.equal(live.view.detail_clip, clip);
    assert.equal(live.calls.length, before, "no Live API calls");
});
