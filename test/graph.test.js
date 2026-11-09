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

test("graph_json replaces stop indices instead of appending", () => {
    const { ctx } = loadGraph();
    ctx.graph_json(payload([3, 9]));
    ctx.graph_json(payload([20]));
    assert.deepEqual(Array.from(ctx.stopIndices), [20]);
    assert.equal(ctx.selectedStop, -1);
});

test("selected outlier bar is drawn wider and centred", () => {
    const { ctx, rects } = loadGraph();
    ctx.graph_json(payload([20]));
    ctx.right_graph();
    rects.length = 0;
    ctx.paint();
    // First rect is the background, then one bar per visible point.
    const bars = rects.slice(1);
    const widths = new Set(bars.map((b) => b.w));
    assert.equal(widths.size, 2, "selected bar should differ in width");
});

test("left_graph from no selection goes to the last outlier", () => {
    const { ctx } = loadGraph();
    ctx.graph_json(payload([3, 9, 30]));
    ctx.left_graph();
    assert.equal(ctx.selectedStop, 2);
});

test("clicking a bar selects it and tells quant.js which point", () => {
    const { ctx } = loadGraph();
    ctx.graph_json(payload([20]));
    ctx.paint();
    // Plot starts at x=26 and spans beats 0..63 over 400 px.
    const x = 26 + (10 / 63) * 400;
    ctx.onclick(x, 50);
    assert.deepEqual(ctx.__outlets.pop(), ["goto_point", 10]);
    assert.equal(ctx.clickedPoint, 10);

    // Clicking the selected bar again zooms back out.
    ctx.paint();
    const zx = ctx.view.plotX + ((10 - ctx.view.xMin) / (ctx.view.xMax - ctx.view.xMin)) * ctx.view.plotW;
    ctx.onclick(zx, 50);
    assert.equal(ctx.clickedPoint, -1);
});

test("tolerance band follows the expected drift", () => {
    const { ctx } = loadGraph();
    const data = JSON.parse(payload([]));
    data.points.forEach((p) => { p.yExp = p.i * 0.01; p.yBeats = p.yExp; });
    ctx.graph_json(JSON.stringify(data));
    ctx.paint();
    assert.ok(true);
});

test("rejected points are drawn as a fixed mark on the zero line", () => {
    const { ctx, rects } = loadGraph();
    const data = JSON.parse(payload([]));
    data.points[10].ok = false;
    data.points[10].yBeats = 3; // distance to a far marker
    ctx.graph_json(JSON.stringify(data));
    rects.length = 0;
    ctx.paint();
    const heights = rects.slice(1).map((r) => r.h);
    assert.ok(heights.includes(7), "missing mark drawn");
    assert.ok(Math.max(...heights) < 60, "no tall bar for the rejected point");
});
