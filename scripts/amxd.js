#!/usr/bin/env node
"use strict";
// Converts between the Max for Live device (.amxd) and its patcher source (.maxpat).
//
// An unfrozen .amxd is a small chunked container around the patcher JSON:
//   "ampf" u32le(4) "aaaa"      device type (audio effect)
//   "meta" u32le(4) 01 00 00 00
//   "ptch" u32le(n) <patcher JSON> \0
// The .maxpat is that JSON as-is, so it can be diffed and reviewed in git.
//
// Usage:
//   node scripts/amxd.js pack   [maxpat] [amxd]   build the device from the patcher
//   node scripts/amxd.js unpack [amxd] [maxpat]   extract the patcher after saving in Max
//   node scripts/amxd.js check  [maxpat] [amxd]   exit 1 if they differ

const fs = require("fs");
const path = require("path");

const DEVICE_DIR = path.join(__dirname, "..", "device");
const DEFAULT_MAXPAT = path.join(DEVICE_DIR, "Quant the Ripper.maxpat");
const DEFAULT_AMXD = path.join(DEVICE_DIR, "Quant the Ripper.amxd");

function chunk(tag, body) {
    const head = Buffer.alloc(8);
    head.write(tag, 0, "ascii");
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
}

function readChunks(buf) {
    const chunks = {};
    let pos = 0;
    while (pos + 8 <= buf.length) {
        const tag = buf.toString("ascii", pos, pos + 4);
        const len = buf.readUInt32LE(pos + 4);
        if (pos + 8 + len > buf.length) throw new Error(`truncated ${tag} chunk`);
        chunks[tag] = buf.subarray(pos + 8, pos + 8 + len);
        pos += 8 + len;
    }
    return chunks;
}

/** Returns the patcher JSON text stored in an .amxd buffer. */
function unpack(amxd) {
    const chunks = readChunks(amxd);
    if (!chunks.ampf || !chunks.ptch) throw new Error("not an .amxd file (missing ampf/ptch)");
    let ptch = chunks.ptch;
    if (ptch.subarray(0, 4).toString("ascii") === "mx@c") ptch = containerJson(ptch);
    const end = ptch[ptch.length - 1] === 0 ? ptch.length - 1 : ptch.length;
    return { deviceType: chunks.ampf.toString("ascii"), meta: chunks.meta, json: ptch.subarray(0, end).toString("utf8") };
}

/**
 * Max 9 can save the patcher inside an "mx@c" container: a 16-byte header
 * (tag, header size, 0, directory offset), the files, then a "dlst"
 * directory of "dire" entries. A frozen device also holds its scripts and
 * media there; an unfrozen one holds only the patcher JSON.
 */
function containerEntries(ptch) {
    const headerSize = ptch.readUInt32BE(4);
    const dirOffset = ptch.readUInt32BE(12);
    if (ptch.toString("ascii", dirOffset, dirOffset + 4) !== "dlst") throw new Error("mx@c container without a dlst directory");
    const entries = [];
    let pos = dirOffset + 8;
    const dirEnd = dirOffset + ptch.readUInt32BE(dirOffset + 4);
    while (pos + 8 <= Math.min(dirEnd, ptch.length) && ptch.toString("ascii", pos, pos + 4) === "dire") {
        const direEnd = pos + ptch.readUInt32BE(pos + 4);
        const entry = {};
        for (let p = pos + 8; p + 8 <= direEnd; ) {
            const tag = ptch.toString("ascii", p, p + 4);
            const len = ptch.readUInt32BE(p + 4);
            const body = ptch.subarray(p + 8, p + len);
            if (tag === "type") entry.type = body.toString("ascii");
            else if (tag === "fnam") entry.name = body.toString("utf8").replace(/\0+$/, "");
            else if (tag === "sz32") entry.size = body.readUInt32BE(0);
            else if (tag === "of32") entry.offset = body.readUInt32BE(0);
            p += len;
        }
        const start = entry.offset !== undefined ? entry.offset : headerSize;
        entry.data = ptch.subarray(start, start + entry.size);
        entries.push(entry);
        pos = direEnd;
    }
    return entries;
}

function containerJson(ptch) {
    const entries = containerEntries(ptch);
    const others = entries.filter((e) => e.type !== "JSON");
    if (others.length) {
        throw new Error("frozen device (" + others.map((e) => e.name).join(", ") + "): unfreeze it in Max before extracting");
    }
    const json = entries.find((e) => e.type === "JSON");
    if (!json) throw new Error("mx@c container without a patcher");
    return json.data;
}

/** Files a patcher loads from disk: scripts that are not embedded, and pictures that are not embedded. */
function externalFiles(patcher, out = new Set()) {
    for (const { box } of patcher.boxes || []) {
        if (box.patcher) externalFiles(box.patcher, out);
        const embedded = box.embed === 1 || (box.textfile && box.textfile.embed === 1);
        if (box.filename && !embedded) out.add(box.filename);
        if (box.pic && !embedded) out.add(box.pic);
    }
    return out;
}

/**
 * Checks whether a device can be shared on its own: every file the patcher
 * loads from disk must be embedded (a frozen device carries them in its mx@c
 * container). With `buildDir`, embedded files are also compared with the
 * files there, to catch a device frozen with stale scripts.
 */
function inspect(amxd, buildDir) {
    const chunks = readChunks(amxd);
    const ptch = chunks.ptch;
    const frozen = ptch.subarray(0, 4).toString("ascii") === "mx@c";
    const entries = frozen ? containerEntries(ptch) : [];
    const jsonEntry = entries.find((e) => e.type === "JSON");
    const jsonBuf = frozen ? jsonEntry.data : ptch;
    const json = jsonBuf.toString("utf8").replace(/\0+$/, "");
    const files = entries.filter((e) => e.type !== "JSON");
    const problems = [];
    const notes = [];
    for (const name of externalFiles(JSON.parse(json).patcher)) {
        const file = files.find((f) => f.name === name);
        if (!file) {
            problems.push(`${name} is loaded from disk and not embedded`);
            continue;
        }
        const built = buildDir && path.join(buildDir, name);
        if (built && fs.existsSync(built)) {
            if (fs.readFileSync(built).equals(file.data)) notes.push(`${name} embedded, matches ${path.relative(process.cwd(), built)}`);
            else problems.push(`${name} embedded but differs from ${path.relative(process.cwd(), built)} (stale build?)`);
        } else {
            notes.push(`${name} embedded (${file.size} bytes)`);
        }
    }
    return { frozen, files: files.map((f) => ({ type: f.type, name: f.name, size: f.size })), problems, notes };
}

/** Builds an .amxd buffer from patcher JSON text. */
function pack(json, deviceType = "aaaa", meta = Buffer.from([1, 0, 0, 0])) {
    JSON.parse(json); // fail early on invalid JSON
    return Buffer.concat([
        chunk("ampf", Buffer.from(deviceType, "ascii")),
        chunk("meta", meta),
        chunk("ptch", Buffer.concat([Buffer.from(json, "utf8"), Buffer.from([0])])),
    ]);
}

function main(argv) {
    const [cmd, a, b] = argv;
    if (cmd === "pack") {
        const maxpat = a || DEFAULT_MAXPAT;
        const amxd = b || DEFAULT_AMXD;
        fs.writeFileSync(amxd, pack(fs.readFileSync(maxpat, "utf8")));
        console.log(`packed ${path.relative(process.cwd(), maxpat)} -> ${path.relative(process.cwd(), amxd)}`);
    } else if (cmd === "unpack") {
        const amxd = a || DEFAULT_AMXD;
        const maxpat = b || DEFAULT_MAXPAT;
        fs.writeFileSync(maxpat, unpack(fs.readFileSync(amxd)).json);
        console.log(`unpacked ${path.relative(process.cwd(), amxd)} -> ${path.relative(process.cwd(), maxpat)}`);
    } else if (cmd === "check") {
        const maxpat = a || DEFAULT_MAXPAT;
        const amxd = b || DEFAULT_AMXD;
        if (unpack(fs.readFileSync(amxd)).json !== fs.readFileSync(maxpat, "utf8")) {
            console.error(`${path.basename(amxd)} and ${path.basename(maxpat)} differ: run "npm run device:pack" or "npm run device:unpack"`);
            process.exit(1);
        }
        console.log("device in sync");
    } else if (cmd === "inspect") {
        const amxd = a || DEFAULT_AMXD;
        const report = inspect(fs.readFileSync(amxd), b || DEVICE_DIR);
        console.log(`${path.basename(amxd)}: ${report.frozen ? "frozen" : "not frozen"}`);
        for (const f of report.files) console.log(`  contains ${f.type} ${f.name} (${f.size} bytes)`);
        for (const n of report.notes) console.log(`  ok: ${n}`);
        for (const p of report.problems) console.log(`  problem: ${p}`);
        if (report.problems.length) {
            console.log("Not self-contained. Run npm run build, open the device in Max, click Freeze Device, and save.");
            process.exit(1);
        }
        console.log("Self-contained: ready to share.");
    } else {
        console.error("usage: node scripts/amxd.js pack|unpack|check|inspect [src] [dst]");
        process.exit(2);
    }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { pack, unpack, inspect, DEFAULT_MAXPAT, DEFAULT_AMXD };
