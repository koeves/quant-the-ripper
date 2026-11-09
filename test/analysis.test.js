"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLiveSet, loadQuant } = require("./mock-live");

const { Analysis } = loadQuant(createLiveSet());

// Arrays created inside the VM have a different prototype; copy before deepEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));

function markers(beats) {
    return beats.map((b, i) => ({ beat_time: b, sample_time: i }));
}

function point(driftBeats, accepted = true) {
    return { driftBeats, accepted, outlier: false, outlierReason: "" };
}

test("matchGrid accepts markers within tolerance and rejects the rest", () => {
    const m = markers([0, 1.02, 2.2, 3, 3.98]);
    const res = Analysis.matchGrid(m, 1, 0.1, 0);
    assert.deepEqual(plain(res.map((r) => r.reason)), ["accepted", "accepted", "outside_tolerance", "accepted", "accepted"]);
    assert.equal(res[1].marker.beat_time, 1.02);
    assert.equal(res[4].marker.beat_time, 3.98);
});

test("matchGrid never uses one marker for two grid points", () => {
    const m = markers([0, 1.04, 5]);
    const res = Analysis.matchGrid(m, 1, 0.45, 0);
    const used = res.filter((r) => r.accepted).map((r) => r.marker.beat_time);
    assert.equal(new Set(used).size, used.length);
});

test("matchGrid honours the start beat", () => {
    const m = markers([0, 0.5, 2.5, 4.5]);
    const res = Analysis.matchGrid(m, 2, 0.1, 0.5);
    assert.deepEqual(plain(res.map((r) => r.targetBeat)), [0.5, 2.5, 4.5]);
    assert.ok(res.every((r) => r.accepted));
});

test("matchGrid targets do not accumulate floating point error", () => {
    const grid = 1 / 3;
    const n = 3000;
    const m = markers(Array.from({ length: n }, (_, i) => Number((i * grid).toFixed(7))));
    const res = Analysis.matchGrid(m, grid, 0.01, 0);
    assert.equal(res.length, n);
    assert.equal(res[n - 1].targetBeat, Number(((n - 1) * grid).toFixed(7)));
    assert.ok(res.every((r) => r.accepted));
});

test("validateParams rejects bad input", () => {
    assert.equal(Analysis.validateParams(1, 0.1, 0), null);
    assert.match(Analysis.validateParams(0, 0.1, 0), /Grid/);
    assert.match(Analysis.validateParams(1, -1, 0), /Tolerance/);
    assert.match(Analysis.validateParams(1, 0.5, 0), /half the grid/);
    assert.match(Analysis.validateParams(1, 0.1, -2), /Start/);
});

test("detectDriftOutliers flags an isolated spike with a plain-text reason", () => {
    const pts = [0.01, 0.012, 0.011, 0.2, 0.012, 0.013].map((d) => point(d));
    Analysis.detectDriftOutliers(pts, 0.25);
    assert.deepEqual(pts.map((p) => p.outlier), [false, false, false, true, false, false]);
    assert.ok(pts[3].outlierReason.includes("local spike"));
    assert.ok(!pts[3].outlierReason.includes("\""));
});

test("detectDriftOutliers ignores rejected points", () => {
    const pts = [point(0.01), point(0.01), point(0.3, false), point(0.01), point(0.01)];
    Analysis.detectDriftOutliers(pts, 0.1);
    assert.ok(pts.every((p) => !p.outlier));
});

test("smooth drift produces no outliers", () => {
    const pts = Array.from({ length: 50 }, (_, i) => point(0.001 * i));
    Analysis.detectDriftOutliers(pts, 0.1);
    assert.ok(pts.every((p) => !p.outlier));
});
