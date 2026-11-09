"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLiveSet, loadQuant } = require("./mock-live");

const { Analysis } = loadQuant(createLiveSet());
const plain = (v) => JSON.parse(JSON.stringify(v));

function markers(beats) {
    return beats.map((b, i) => ({ beat_time: Number(b.toFixed(7)), sample_time: i }));
}

// A rip that runs 0.4% slow: drift grows by 0.004 beat per beat, 1.6 beats after 400 beats.
const slow = markers(Array.from({ length: 400 }, (_, i) => i * 1.004 + 0.003 * Math.sin(i)));

test("fixed grid loses a slowly drifting rip, or matches the wrong beat's marker", () => {
    const res = Analysis.matchGrid(slow, 1, 0.05, 0, false);
    const right = res.filter((r, k) => r.accepted && r.marker.sample_time === k).length;
    const wrong = res.filter((r, k) => r.accepted && r.marker.sample_time !== k).length;
    assert.ok(right < 20, `right ${right}`);
    assert.ok(wrong > 0, "accepts neighbouring beats once drift reaches a whole beat");
});

test("drift tracking follows the same rip all the way", () => {
    const res = Analysis.matchGrid(slow, 1, 0.05, 0, true);
    assert.ok(res.length >= 398);
    assert.ok(res.every((r) => r.accepted), "every grid point matched");
    // Each grid point gets the marker of its own beat, not a neighbour's, even past 1 beat of drift.
    res.forEach((r, k) => assert.equal(r.marker.sample_time, k));
});

test("drift tracking still rejects a marker far from the trend", () => {
    const beats = Array.from({ length: 40 }, (_, i) => i + 0.01 * i);
    beats[20] += 0.2;
    const res = Analysis.matchGrid(markers(beats), 1, 0.05, 0, true);
    assert.equal(res[20].reason, "outside_tolerance");
    assert.ok(res.filter((r, k) => k !== 20).every((r) => r.accepted));
});

test("drift tracking bridges a breakdown without markers", () => {
    const beats = [];
    for (let i = 0; i < 64; i++) if (i < 24 || i >= 40) beats.push(i * 1.003);
    const res = Analysis.matchGrid(markers(beats), 1, 0.03, 0, true);
    const after = res.filter((r) => r.targetBeat >= 40);
    assert.ok(after.length > 0 && after.every((r) => r.accepted));
});

test("predictDrift extrapolates a line and clamps the slope", () => {
    const hist = [0, 1, 2, 3].map((t) => ({ t, d: 0.01 * t }));
    assert.ok(Math.abs(Analysis.predictDrift(hist, 10) - 0.1) < 1e-9);
    const steep = [0, 1].map((t) => ({ t, d: 0.5 * t }));
    assert.ok(Analysis.predictDrift(steep, 11) < 0.5 + 0.02 * 10.5 + 1e-9);
    assert.equal(Analysis.predictDrift([], 5), 0);
});

test("navigationStops lists outliers and the start of each gap", () => {
    const pts = [
        { accepted: true, outlier: false },
        { accepted: false, outlier: false },
        { accepted: false, outlier: false },
        { accepted: true, outlier: true },
        { accepted: true, outlier: false },
        { accepted: false, outlier: false },
    ];
    assert.deepEqual(plain(Analysis.navigationStops(pts)), [1, 3, 5]);
});

function point(targetBeat, markerBeat, accepted = true) {
    return { targetBeat, markerBeat, markerSampleTime: 1, accepted };
}

test("planSnap removes unused markers first, then moves left ascending and right descending", () => {
    const pts = [point(0, 0.3), point(1, 0.6), point(2, 2.4), point(3, 3.2), point(4, 3.5, false), point(5, 4.8)];
    const ops = plain(Analysis.planSnap(pts, [0.3, 0.6, 1.5, 2.4, 3.2, 4.8], 1));
    assert.deepEqual(ops.map((o) => o.op + " " + o.beat), [
        "remove 1.5",
        "move 0.3", "move 2.4", "move 3.2",   // left movers, ascending
        "move 4.8", "move 0.6",               // right movers, descending
    ]);
    assert.equal(ops.find((o) => o.beat === 0.6).distance, 0.4);
});

test("planSnap with strength moves part of the way and skips zero moves", () => {
    const ops = plain(Analysis.planSnap([point(0, 0), point(1, 1.2)], [0, 1.2], 0.5));
    assert.deepEqual(ops, [{ op: "move", beat: 1.2, distance: -0.1 }]);
});

test("tiny sign flips around the trend are not outliers", () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({
        driftBeats: 0.5 + 0.01 * i + (i % 2 ? 0.002 : -0.002),
        expectedDriftBeats: 0.5 + 0.01 * i,
        accepted: true, outlier: false, outlierReason: "",
    }));
    Analysis.detectDriftOutliers(pts, 0.1, true);
    assert.equal(pts.filter((p) => p.outlier).length, 0);
});

test("findGridStart keeps 1.1.1 when the markers start there", () => {
    const m = markers(Array.from({ length: 64 }, (_, i) => i + 0.01 * Math.sin(i)));
    assert.equal(Analysis.findGridStart(m, 4, 0.1), 0);
});

test("findGridStart keeps 1.1.1 when the kicks are within tolerance of whole beats", () => {
    // Fresh warp: Live's start marker at 0, kicks 0.04 beat late. Staying on
    // Live's beat grid fits as well as starting at the first kick.
    const beats = [0].concat(Array.from({ length: 64 }, (_, i) => 1.04 + i * 1.002));
    assert.equal(Analysis.findGridStart(markers(beats), 4, 0.1), 0);
});

test("findGridStart starts at the first kick when the kicks are off the beat grid", () => {
    const beats = [0].concat(Array.from({ length: 64 }, (_, i) => 1.25 + i * 1.002));
    assert.equal(Analysis.findGridStart(markers(beats), 4, 0.1), 1.25);
});

test("findGridStart skips a stray first marker", () => {
    // A hit at 0.6 before kicks that start at 2.5.
    const beats = [0, 0.6].concat(Array.from({ length: 40 }, (_, i) => 2.5 + i));
    assert.equal(Analysis.findGridStart(markers(beats), 1, 0.05), 0.5);
});
