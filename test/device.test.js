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
    const sent = [...src.matchAll(/outlet\(0, "([a-z_]+)"/g)].map((m) => m[1]);
    for (const s of sent) assert.ok(routed.includes(s), `route does not handle "${s}"`);
});
