"use strict";
// Minimal in-memory stand-in for the Max/MSP LiveAPI and Task globals, enough to
// run device/quant.js end to end under Node. Models only what the device uses.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function createLiveSet(opts = {}) {
    let nextId = 1;
    const objects = new Map();

    function register(obj) {
        obj.id = nextId++;
        objects.set(obj.id, obj);
        return obj;
    }

    const song = register({ kind: "song", tempo: opts.tempo || 120, current_song_time: 0, tracks: [] });
    const view = { kind: "view", selected_track: null, detail_clip: null };

    function makeTrack(name) {
        return register({ kind: "track", name: name, arrangement_clips: [] });
    }

    function makeClip(props) {
        return register(Object.assign({
            kind: "clip",
            name: "clip",
            is_audio_clip: 1,
            is_arrangement_clip: 1,
            warping: 1,
            file_path: "/samples/rip.wav",
            start_time: 0,
            start_marker: 0,
            end_marker: 64,
            warp_markers: [],
        }, props));
    }

    function trackOf(clip) {
        return song.tracks.find((t) => t.arrangement_clips.includes(clip)) || null;
    }

    function canonicalPath(obj) {
        if (!obj) return "";
        if (obj.kind === "song") return "live_set";
        if (obj.kind === "track") return "live_set tracks " + song.tracks.indexOf(obj);
        if (obj.kind === "clip") {
            const t = trackOf(obj);
            if (!t) return "";
            return canonicalPath(t) + " arrangement_clips " + t.arrangement_clips.indexOf(obj);
        }
        return "";
    }

    function resolve(p) {
        p = String(p).trim();
        let m = p.match(/^id (\d+)$/);
        if (m) {
            const o = objects.get(Number(m[1]));
            // Deleted objects resolve to id 0.
            if (!o) return null;
            if (o.kind === "track" && !song.tracks.includes(o)) return null;
            if (o.kind === "clip" && !trackOf(o)) return null;
            return o;
        }
        if (p === "live_set") return song;
        if (p === "live_set view") return view;
        if (p === "live_set view detail_clip") return view.detail_clip && resolve("id " + view.detail_clip.id);
        if (p === "live_set view selected_track") return view.selected_track && resolve("id " + view.selected_track.id);
        m = p.match(/^live_set tracks (\d+)(?: arrangement_clips (\d+))?$/);
        if (m) {
            const t = song.tracks[Number(m[1])];
            if (!t) return null;
            if (m[2] === undefined) return t;
            return t.arrangement_clips[Number(m[2])] || null;
        }
        return null;
    }

    const calls = [];
    const refusedMoves = [];
    const dicts = new Map();
    let dictCount = 0;

    class Dict {
        constructor(name) {
            this.name = name || "u" + (++dictCount);
            dicts.set(this.name, {});
        }
        set(key, value) { dicts.get(this.name)[key] = value; }
    }

    // buffer~ objects created through patcher scripting, keyed by name.
    const audioFiles = new Map();
    const buffers = new Map();
    const patcher = {
        boxes: [],
        newdefault(_x, _y, cls, name) {
            const boxObj = {
                cls, name,
                message(msg, file) {
                    if (msg === "replace") buffers.set(name, audioFiles.get(file) || null);
                },
            };
            this.boxes.push(boxObj);
            return boxObj;
        },
        remove(b) {
            this.boxes = this.boxes.filter((x) => x !== b);
            buffers.delete(b.name);
        },
    };

    class Buffer {
        constructor(name) { this.name = name; }
        get _a() { return buffers.get(this.name); }
        framecount() { return this._a ? this._a.channels[0].length : 0; }
        channelcount() { return this._a ? this._a.channels.length : 0; }
        length() { return this._a ? 1000 * this.framecount() / this._a.sampleRate : 0; }
        peek(ch, start, count) { return Array.from(this._a.channels[ch - 1].subarray(start, start + count)); }
    }

    /** Registers decoded audio for a file path: { sampleRate, channels: [Float32Array, ...] }. */
    function addAudioFile(filePath, audio) {
        audioFiles.set(filePath, audio);
    }

    class LiveAPI {
        constructor(_cb, pathOrId) {
            this._obj = resolve(pathOrId);
        }
        get id() { return this._obj ? this._obj.id : 0; }
        get path() { return this._obj === view ? "live_set view" : canonicalPath(this._obj); }
        get unquotedpath() { return this.path; }
        goto(p) {
            if (p === "canonical_parent") {
                const o = this._obj;
                this._obj = !o ? null : o.kind === "clip" ? trackOf(o) : o.kind === "track" ? song : null;
            } else {
                this._obj = resolve(p);
            }
        }
        getcount(child) {
            const v = this._obj && this._obj[child];
            return Array.isArray(v) ? v.length : 0;
        }
        get(prop) {
            const o = this._obj;
            if (!o) return [];
            if (prop === "warp_markers") return [JSON.stringify({ warp_markers: o.warp_markers })];
            const v = o[prop];
            return v === undefined ? [] : [v];
        }
        set(prop, value) {
            const o = this._obj;
            if (!o) throw new Error("set on missing object");
            if (o === view) {
                o[prop] = resolve(value);
                return;
            }
            o[prop] = value;
        }
        call(fn, ...args) {
            const o = this._obj;
            calls.push({ fn: fn, args: args });
            if (!o) return ["id", 0];
            switch (fn) {
                case "create_audio_track": {
                    const t = makeTrack("Audio");
                    const index = Number(args[0]);
                    if (index < 0 || index > song.tracks.length) song.tracks.push(t);
                    else song.tracks.splice(index, 0, t);
                    view.selected_track = t;
                    return ["id", t.id];
                }
                case "delete_track":
                    song.tracks.splice(Number(args[0]), 1);
                    return ["id", 0];
                case "duplicate_clip_to_arrangement": {
                    const src = resolve(args[0]);
                    const time = Number(args[1]);
                    const copy = makeClip(Object.assign({}, src, {
                        id: undefined,
                        start_time: time,
                        warp_markers: src.warp_markers.map((w) => Object.assign({}, w)),
                    }));
                    // Overwrite whatever was at that position, as Live does.
                    o.arrangement_clips = o.arrangement_clips.filter((c) => Math.abs(c.start_time - time) > 1e-6);
                    o.arrangement_clips.push(copy);
                    o.arrangement_clips.sort((a, b) => a.start_time - b.start_time);
                    return ["id", copy.id];
                }
                case "remove_warp_marker": {
                    const beat = Number(args[0]);
                    o.warp_markers = o.warp_markers.filter((w) => Math.abs(w.beat_time - beat) > 1e-6);
                    return ["id", 0];
                }
                case "move_warp_marker": {
                    const beat = Number(args[0]);
                    const i = o.warp_markers.findIndex((x) => Math.abs(x.beat_time - beat) < 1e-6);
                    if (i < 0) return ["error"];
                    const to = Number((o.warp_markers[i].beat_time + Number(args[1])).toFixed(7));
                    // Like Live, a marker cannot be moved onto or past a neighbour.
                    const prev = o.warp_markers[i - 1], next = o.warp_markers[i + 1];
                    if ((prev && to <= prev.beat_time) || (next && to >= next.beat_time)) {
                        refusedMoves.push({ beat, to });
                        return ["error"];
                    }
                    o.warp_markers[i].beat_time = to;
                    return ["id", 0];
                }
                case "add_warp_marker": {
                    // Only the "dictionary <name>" form is understood, to exercise the format probing.
                    if (args[0] !== "dictionary") throw new Error("mock: add_warp_marker expects a dictionary");
                    const d = dicts.get(args[1]);
                    const m = { beat_time: Number(d.beat_time), sample_time: Number(d.sample_time) };
                    o.warp_markers.push(m);
                    o.warp_markers.sort((a, b) => a.beat_time - b.beat_time);
                    return ["id", 0];
                }
                default:
                    throw new Error("mock: unsupported call " + fn);
            }
        }
    }

    const tasks = [];
    class Task {
        constructor(fn, ctx) { this.fn = fn; this.ctx = ctx; this.cancelled = false; }
        schedule() { this.cancelled = false; if (!tasks.includes(this)) tasks.push(this); }
        repeat() { this.schedule(); }
        cancel() { this.cancelled = true; }
    }

    function runTasks(limit = 10000) {
        let n = 0;
        while (tasks.length && n++ < limit) {
            const t = tasks.shift();
            if (!t.cancelled) t.fn.call(t.ctx);
        }
        if (tasks.length) throw new Error("tasks did not settle");
    }

    function addTrack(name) {
        const t = makeTrack(name);
        song.tracks.push(t);
        return t;
    }

    function addClip(track, props) {
        const c = makeClip(props);
        track.arrangement_clips.push(c);
        return c;
    }

    return {
        song, view, LiveAPI, Task, Dict, Buffer, patcher, runTasks, addTrack, addClip, addAudioFile,
        calls, refusedMoves, canonicalPath,
    };
}

/** Loads a compiled bundle into a fresh VM context and returns the context. */
function loadBundle(file, globals) {
    const outlets = [];
    const posts = [];
    const errors = [];
    const ctx = Object.assign({
        post: (...a) => posts.push(a.join(" ")),
        error: (...a) => errors.push(a.join(" ")),
        outlet: (i, ...a) => outlets.push(a),
        console,
        outlets: 0,
        inlets: 0,
    }, globals);
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(process.env.QTR_PLUGIN_DIR || path.join(ROOT, "device"), file), "utf8"), ctx, { filename: file });
    ctx.__outlets = outlets;
    ctx.__posts = posts;
    ctx.__errors = errors;
    return ctx;
}

function loadQuant(live) {
    return loadBundle("quant.js", {
        LiveAPI: live.LiveAPI, Task: live.Task, Dict: live.Dict, Buffer: live.Buffer, patcher: live.patcher,
    });
}

/** Warp markers one per beat with the given drift function, plus Live's hidden trailing marker. */
function beatMarkers(count, drift = () => 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push({ beat_time: Number((i + drift(i)).toFixed(7)), sample_time: Number((i * 0.5).toFixed(7)) });
    }
    // Live's hidden marker always sits after the last real one.
    const lastBeat = out.length ? out[out.length - 1].beat_time : 0;
    out.push({ beat_time: Math.max(count, lastBeat + 1) + 0.03125, sample_time: count * 0.5 + 0.015625 });
    return out;
}

/**
 * Synthetic techno-ish audio: kicks (decaying 50-60 Hz sine with a pitch drop)
 * at `kickTimes`, plus noise-burst hats on the off-beats if `hatTimes` given.
 */
function synthAudio({ sampleRate = 44100, seconds, kickTimes, hatTimes = [], ghostTimes = [], channels = 2 }) {
    const n = Math.round(seconds * sampleRate);
    const mono = new Float32Array(n);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    // Ghost hits: shorter, quieter low hits (off-beat bass/percussion).
    for (const t0 of ghostTimes) {
        const start = Math.round(t0 * sampleRate);
        let phase = 0;
        for (let i = 0; i < 0.12 * sampleRate && start + i < n; i++) {
            const t = i / sampleRate;
            phase += 2 * Math.PI * 70 / sampleRate;
            mono[start + i] += 0.5 * Math.exp(-t / 0.03) * Math.sin(phase);
        }
    }
    for (const t0 of kickTimes) {
        const start = Math.round(t0 * sampleRate);
        let phase = 0;
        for (let i = 0; i < 0.35 * sampleRate && start + i < n; i++) {
            const t = i / sampleRate;
            const f = 50 + 70 * Math.exp(-t / 0.03);
            phase += 2 * Math.PI * f / sampleRate;
            mono[start + i] += 0.9 * Math.exp(-t / 0.12) * Math.sin(phase);
        }
    }
    for (const t0 of hatTimes) {
        const start = Math.round(t0 * sampleRate);
        for (let i = 0; i < 0.05 * sampleRate && start + i < n; i++) {
            mono[start + i] += 0.5 * Math.exp(-i / (0.01 * sampleRate)) * rand();
        }
    }
    return { sampleRate, channels: Array.from({ length: channels }, () => mono) };
}

module.exports = { createLiveSet, loadBundle, loadQuant, beatMarkers, synthAudio };
