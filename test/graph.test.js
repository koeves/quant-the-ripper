"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBundle } = require("./mock-live");

function loadGraph() {
    const rects = [];
    const mgraphics = new Proxy({ rects }, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === "rectangle") return (x, y, w, h) => rects.push({ x, y, w, h });
            return () => {};
        },
        set() { return true; },
    });
    const ctx = loadBundle("graph.js", {
        mgraphics,
        box: { rect: [0, 0, 426, 120] },
        arrayfromargs: (args) => Array.prototype.slice.call(args),
    });
    return { ctx, rects };
}

function payload(outlierAt) {
    const points = Array.from({ length: 64 }, (_, i) => ({
        i, xBeat: i, yBeats: 0.01, yMs: 5, ok: true, outlier: outlierAt.includes(i),
    }));
    return JSON.stringify({
        clipName: "c", tempo: 120, gridBeats: 1, toleranceBeats: 0.1, toleranceMs: 50,
        xMin: 0, xMax: 63, yMinBeats: 0.01, yMaxBeats: 0.01, yMinMs: 5, yMaxMs: 5,
        accepted: 64, rejected: 0, outliers: outlierAt.length, points,
    });
}

test("graph_json replaces outlier indices instead of appending", () => {
    const { ctx } = loadGraph();
    ctx.graph_json(payload([3, 9]));
    ctx.graph_json(payload([20]));
    assert.deepEqual(Array.from(ctx.outlierPointIndices), [20]);
    assert.equal(ctx.selectedOutlierIndex, -1);
});

test("selected outlier bar is drawn wider and centred", () => {
    const { ctx, rects } = loadGraph();
    ctx.graph_json(payload([20]));
    ctx.right_graph();
    rects.length = 0;
    ctx.paint();
    // First rect is the background, second the tolerance band, then one bar per visible point.
    const bars = rects.slice(2);
    const widths = new Set(bars.map((b) => b.w));
    assert.equal(widths.size, 2, "selected bar should differ in width");
});

test("left_graph from no selection goes to the last outlier", () => {
    const { ctx } = loadGraph();
    ctx.graph_json(payload([3, 9, 30]));
    ctx.left_graph();
    assert.equal(ctx.selectedOutlierIndex, 2);
});
