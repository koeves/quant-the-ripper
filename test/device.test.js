"use strict";
// Contract tests between the Max patch and the compiled scripts: every message the
// patch sends must have a handler, and the device file must match its .maxpat source.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { pack, unpack, DEFAULT_MAXPAT, DEFAULT_AMXD } = require("../scripts/amxd");
const { createLiveSet, loadQuant, loadBundle } = require("./mock-live");

const maxpatText = fs.readFileSync(DEFAULT_MAXPAT, "utf8");
const patcher = JSON.parse(maxpatText).patcher;
const boxes = new Map(patcher.boxes.map((b) => [b.box.id, b.box]));
const lines = patcher.lines.map((l) => l.patchline);

function boxBy(pred) {
    return [...boxes.values()].find(pred);
}

const quantBox = boxBy((b) => /^v8 quant\.js/.test(b.text || ""));
const graphBox = boxBy((b) => b.maxclass === "jsui" && b.filename === "graph.js");

/** Selectors of message boxes (and prepend objects) wired directly into `target`. */
function selectorsInto(target) {
    return lines
        .filter((l) => l.destination[0] === target.id)
        .map((l) => boxes.get(l.source[0]))
        .map((b) => {
            if (b.maxclass === "message") return b.text.split(" ")[0];
            const m = (b.text || "").match(/^prepend (\S+)/);
            return m ? m[1] : null;
        })
        .filter(Boolean);
}

test("amxd is the packed maxpat", () => {
    const amxd = fs.readFileSync(DEFAULT_AMXD);
    assert.equal(unpack(amxd).json, maxpatText);
    assert.ok(pack(maxpatText).equals(amxd));
});

test("patch loads quant.js and graph.js", () => {
    assert.ok(quantBox, "v8 quant.js object");
    assert.ok(graphBox, "jsui graph.js object");
});

test("every message sent to quant.js has a handler", () => {
    const q = loadQuant(createLiveSet());
    const selectors = selectorsInto(quantBox).filter((s) => s !== "jsfile");
    assert.ok(selectors.length >= 6);
    for (const s of selectors) {
        assert.equal(typeof q[s], "function", `quant.js has no function "${s}"`);
    }
});

test("every message sent to graph.js has a handler", () => {
    const g = loadBundle("graph.js", {
        mgraphics: new Proxy({}, { get: () => () => {}, set: () => true }),
        box: { rect: [0, 0, 100, 100] },
        arrayfromargs: (a) => Array.prototype.slice.call(a),
    });
    const selectors = selectorsInto(graphBox);
    assert.ok(selectors.includes("graph_json"));
    for (const s of selectors) {
        assert.equal(typeof g[s], "function", `graph.js has no function "${s}"`);
    }
});

test("the route after quant.js matches the messages quant.js sends", () => {
    const out = lines.filter((l) => l.source[0] === quantBox.id).map((l) => boxes.get(l.destination[0]));
    const route = out.find((b) => /^route /.test(b.text || ""));
    assert.ok(route, "route object after quant.js");
    const routed = route.text.split(" ").slice(1);
    const src = fs.readFileSync(require("path").join(__dirname, "..", "src", "quant", "quant.ts"), "utf8") +
        fs.readFileSync(require("path").join(__dirname, "..", "src", "utils", "utils.ts"), "utf8");
    const sent = [...src.matchAll(/(?:outlet\(0, |GraphDict\.send\()"([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(sent.includes("graph_json") && sent.includes("graph_after_json"));
    for (const s of sent) assert.ok(routed.includes(s), `route does not handle "${s}"`);
});

function param(box) {
    return box.saved_attribute_attributes.valueof;
}

test("graph clicks reach quant.js, which handles goto_point", () => {
    assert.ok(lines.some((l) => l.source[0] === graphBox.id && l.destination[0] === quantBox.id));
    const q = loadQuant(createLiveSet());
    assert.equal(typeof q.goto_point, "function");
});

test("option controls start at the same values as quant.js", () => {
    const q = loadQuant(createLiveSet());
    const byVar = (v) => boxBy((b) => b.varname === v);
    const opts = q.State.options;
    assert.equal(param(byVar("Snap Strength")).parameter_initial[0] / 100, opts.strength);
    assert.equal(param(byVar("Detect Kicks")).parameter_initial[0], opts.detectKicks ? 1 : 0);
    assert.equal(param(byVar("Re-Pitch")).parameter_initial[0], opts.repitch ? 1 : 0);
});

test("Beatgrid choices map to 1, 2, 4, 8 and 16 beats", () => {
    const dial = boxBy((b) => b.varname === "live.dial");
    const enumLabels = param(dial).parameter_enum;
    assert.equal(enumLabels.length, 5);
    const expr = boxes.get(lines.find((l) => l.source[0] === dial.id).destination[0]);
    assert.equal(expr.text, "expr 1 << $i1");
    assert.deepEqual(enumLabels.map((_, i) => 1 << i), [1, 2, 4, 8, 16]);
});

test("Detect and Re-Pitch are on by default", () => {
    const q = loadQuant(createLiveSet());
    assert.equal(q.State.options.detectKicks, true);
    assert.equal(q.State.options.repitch, true);
});

test("Prep sends grid and tolerance only, so the grid start is found automatically", () => {
    const pak = boxBy((b) => /^pak /.test(b.text || ""));
    assert.equal(pak.text, "pak 4. 50.");
    assert.ok(!boxBy((b) => b.varname === "live.dial[1]"), "Start dial removed");
    assert.ok(!boxBy((b) => b.varname === "Track Drift"), "Track toggle removed");
});

test("Prep's tolerance comes from a dial in ms and the pak default matches it", () => {
    const dial = boxBy((b) => b.varname === "live.dial[2]");
    const p = param(dial);
    assert.equal(p.parameter_unitstyle, 2);
    assert.equal(p.parameter_initial[0], 50);
    const pak = boxBy((b) => /^pak /.test(b.text || ""));
    assert.equal(pak.text.split(" ")[2], "50.");
});

test("every parameter has a unique long name and is listed in the parameter table", () => {
    const params = [...boxes.values()].filter((b) => b.parameter_enable === 1);
    const names = params.map((b) => param(b).parameter_longname);
    assert.equal(new Set(names).size, names.length);
    for (const b of params) assert.ok(patcher.parameters[b.id], `${b.id} missing from parameters`);
});

test("presentation controls fit inside the device background", () => {
    const bg = boxes.get("obj-48").presentation_rect;
    for (const b of boxes.values()) {
        if (!b.presentation || b.maxclass === "fpic" || b.id === "obj-48") continue;
        const [x, , w] = b.presentation_rect;
        assert.ok(x + w <= bg[0] + bg[2] + 0.5, `${b.id} (${b.maxclass}) sticks out`);
    }
});

// The device has no "open in presentation" flag, so Live shows the patching view:
// UI must sit at the same place in both views, and logic objects below the device.
const DEVICE_HEIGHT = 169;

test("UI objects are placed the same in patching and presentation view", () => {
    for (const b of boxes.values()) {
        if (!b.presentation) continue;
        const [px, py] = b.patching_rect;
        const [qx, qy] = b.presentation_rect;
        assert.ok(Math.abs(px - qx) <= 6 && Math.abs(py - qy) <= 6, `${b.id} (${b.varname || b.maxclass}) patching ${px},${py} vs presentation ${qx},${qy}`);
    }
});

test("no object widens the device past its background", () => {
    // Live sizes the device to the widest object in the patching view, hidden ones included.
    const bg = boxes.get("obj-48").presentation_rect;
    for (const b of boxes.values()) {
        if (b.maxclass === "fpic") continue;
        const [x, , w] = b.patching_rect;
        assert.ok(x + w <= bg[0] + bg[2] + 0.5, `${b.id} "${b.text || b.maxclass}" ends at x=${x + w}`);
    }
});

test("logic objects are outside the visible device area", () => {
    assert.ok(!patcher.openinpresentation, "test assumes the device shows its patching view");
    for (const b of boxes.values()) {
        if (b.presentation) continue;
        assert.ok(b.patching_rect[1] >= DEVICE_HEIGHT, `${b.id} "${b.text || b.maxclass}" is visible at y=${b.patching_rect[1]}`);
    }
});
