declare var patcher: any;
declare class Buffer {
    constructor(name: string);
    framecount(): number;
    channelcount(): number;
    /** Length in milliseconds. */
    length(): number;
    peek(channel: number, frame: number, count: number): number[] | number;
}
declare class Dict {
    constructor(name?: string);
    name: string;
    set(key: string, ...values: any[]): void;
    get(key: string): any;
    clear(): void;
}

/**
 * Kick detection from the clip's audio file, so warp markers no longer have
 * to be inserted by hand on Ableton's (broadband) transients.
 *
 * Pipeline: mono mix -> 4th-order Butterworth low-pass (kick band) ->
 * peak envelope with fast release -> peak picking with a minimum gap ->
 * onset = where the envelope rises through a fraction of the hit's level,
 * corrected for the filter's group delay.
 */
namespace Detect {
    export interface Settings {
        /** Low-pass cutoff isolating the kick. */
        lowpassHz: number;
        /** A kick must be the loudest point within ±minGapSec/2. */
        minGapSec: number;
        /** A hit must reach this fraction of the loudest hit within ±2 s. */
        threshold: number;
        /** The onset is where the envelope crosses this fraction of the hit's rise. */
        onsetFraction: number;
        /** Envelope release time. */
        releaseSec: number;
        /** Envelope frames per second. */
        envRate: number;
    }

    export const DEFAULTS: Settings = {
        lowpassHz: 150,
        minGapSec: 0.15,
        threshold: 0.35,
        onsetFraction: 0.2,
        releaseSec: 0.02,
        envRate: 2000,
    };

    interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number; z1: number; z2: number; }

    /** RBJ cookbook low-pass. */
    function lowpass(f: number, sr: number, q: number): Biquad {
        const w = 2 * Math.PI * f / sr;
        const alpha = Math.sin(w) / (2 * q);
        const cos = Math.cos(w);
        const a0 = 1 + alpha;
        return {
            b0: (1 - cos) / 2 / a0,
            b1: (1 - cos) / a0,
            b2: (1 - cos) / 2 / a0,
            a1: -2 * cos / a0,
            a2: (1 - alpha) / a0,
            z1: 0,
            z2: 0,
        };
    }

    /** Group delay of a biquad cascade at frequency f, in seconds (numeric phase derivative). */
    export function groupDelaySec(stages: Biquad[], f: number, sr: number): number {
        function phase(freq: number): number {
            let total = 0;
            const w = 2 * Math.PI * freq / sr;
            for (const s of stages) {
                // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (1 + a1 e^-jw + a2 e^-2jw)
                const nr = s.b0 + s.b1 * Math.cos(w) + s.b2 * Math.cos(2 * w);
                const ni = -s.b1 * Math.sin(w) - s.b2 * Math.sin(2 * w);
                const dr = 1 + s.a1 * Math.cos(w) + s.a2 * Math.cos(2 * w);
                const di = -s.a1 * Math.sin(w) - s.a2 * Math.sin(2 * w);
                total += Math.atan2(ni, nr) - Math.atan2(di, dr);
            }
            return total;
        }
        const df = 0.5;
        let dp = phase(f + df) - phase(f - df);
        while (dp > Math.PI) dp -= 2 * Math.PI;
        while (dp < -Math.PI) dp += 2 * Math.PI;
        return -dp / (2 * Math.PI * 2 * df);
    }

    /** Streaming kick-band envelope: feed audio in chunks, read `env` at the end. */
    export class Envelope {
        readonly hop: number;
        readonly hopSec: number;
        readonly delaySec: number;
        readonly env: number[] = [];
        private stages: Biquad[];
        private release: number;
        private level = 0;
        private hopMax = 0;
        private count = 0;

        constructor(readonly sampleRate: number, readonly settings: Settings = DEFAULTS) {
            // Two biquads with these Qs make a 4th-order Butterworth.
            this.stages = [
                lowpass(settings.lowpassHz, sampleRate, 0.54119610),
                lowpass(settings.lowpassHz, sampleRate, 1.30656296),
            ];
            this.release = Math.exp(-1 / (sampleRate * settings.releaseSec));
            this.hop = Math.max(1, Math.round(sampleRate / settings.envRate));
            this.hopSec = this.hop / sampleRate;
            // Delay at a typical kick fundamental.
            this.delaySec = groupDelaySec(this.stages, 60, sampleRate);
        }

        push(samples: ArrayLike<number>): void {
            const s1 = this.stages[0], s2 = this.stages[1];
            const rel = this.release, hop = this.hop;
            let level = this.level, hopMax = this.hopMax, count = this.count;
            for (let i = 0; i < samples.length; i++) {
                const x = samples[i];
                // Transposed direct form II, two stages.
                const y1 = s1.b0 * x + s1.z1;
                s1.z1 = s1.b1 * x - s1.a1 * y1 + s1.z2;
                s1.z2 = s1.b2 * x - s1.a2 * y1;
                const y2 = s2.b0 * y1 + s2.z1;
                s2.z1 = s2.b1 * y1 - s2.a1 * y2 + s2.z2;
                s2.z2 = s2.b2 * y1 - s2.a2 * y2;

                const a = y2 < 0 ? -y2 : y2;
                level = a > level ? a : level * rel;
                if (level > hopMax) hopMax = level;
                if (++count === hop) {
                    this.env.push(hopMax);
                    hopMax = 0;
                    count = 0;
                }
            }
            this.level = level;
            this.hopMax = hopMax;
            this.count = count;
        }
    }

    /** Picks kick onsets (seconds into the file) from an envelope. */
    export function pickOnsets(env: number[], hopSec: number, delaySec: number, settings: Settings = DEFAULTS): number[] {
        const n = env.length;
        if (!n) return [];

        let globalMax = 0;
        for (let i = 0; i < n; i++) if (env[i] > globalMax) globalMax = env[i];
        if (globalMax <= 0) return [];

        const gap = Math.max(1, Math.round(settings.minGapSec / hopSec));
        const half = Math.max(1, Math.floor(gap / 2));
        const ctx = Math.round(2 / hopSec);
        const localMax = slidingMax(env, ctx);

        const onsets: number[] = [];
        for (let i = 1; i < n - 1; i++) {
            const v = env[i];
            if (v < globalMax * 0.05 || v < settings.threshold * localMax[i]) continue;
            if (v < env[i - 1] || v < env[i + 1]) continue;

            // Must be the largest value within half a gap on either side. There
            // is deliberately no "first hit wins" spacing rule: an off-beat hit
            // just before a kick would suppress the kick. Extra hits are fine,
            // Prep keeps only the markers that match the grid.
            let isPeak = true;
            for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
                if (env[j] > v || (env[j] === v && j < i)) { isPeak = false; break; }
            }
            if (!isPeak) continue;

            // A new hit has to rise well above what came before it.
            let floor = v;
            for (let j = Math.max(0, i - gap); j < i; j++) if (env[j] < floor) floor = env[j];
            if (v - floor < 0.5 * v) continue;

            // Walk back to where the envelope crosses the onset level, then interpolate.
            const level = floor + settings.onsetFraction * (v - floor);
            let k = i;
            while (k > 0 && env[k - 1] >= level && i - k < gap) k--;
            let t = k;
            if (k > 0 && env[k] !== env[k - 1]) {
                t = (k - 1) + (level - env[k - 1]) / (env[k] - env[k - 1]);
            }
            // env[j] summarizes samples [j*hop, (j+1)*hop), so frame j ends at (j+1)*hopSec.
            const sec = (t + 1) * hopSec - delaySec;
            onsets.push(Math.max(0, sec));
        }
        return onsets;
    }

    function slidingMax(a: number[], radius: number): number[] {
        // Block-based approximation, plenty for a ±2 s context.
        const out = new Array(a.length);
        const block = Math.max(1, radius);
        const blocks: number[] = [];
        for (let b = 0; b * block < a.length; b++) {
            let m = 0;
            for (let i = b * block; i < Math.min(a.length, (b + 1) * block); i++) if (a[i] > m) m = a[i];
            blocks.push(m);
        }
        for (let i = 0; i < a.length; i++) {
            const b = Math.floor(i / block);
            out[i] = Math.max(blocks[b], b > 0 ? blocks[b - 1] : 0, b + 1 < blocks.length ? blocks[b + 1] : 0);
        }
        return out;
    }

    // ---- Mapping onsets to warp markers -------------------------------------

    /** Maps a time in the file to a beat using the clip's current warp markers (linear between them). */
    export function sampleToBeat(markers: Model.WarpMarker[], sec: number): number {
        const m = markers.slice().sort((a, b) => a.sample_time - b.sample_time);
        if (m.length === 0) return 0;
        if (m.length === 1) return m[0].beat_time;
        let i = 0;
        while (i < m.length - 2 && m[i + 1].sample_time < sec) i++;
        const a = m[i], b = m[i + 1];
        const ds = b.sample_time - a.sample_time;
        if (ds <= 0) return a.beat_time;
        return a.beat_time + (sec - a.sample_time) * (b.beat_time - a.beat_time) / ds;
    }

    /** New markers for onsets that are not within `minDistSec` of an existing marker. */
    export function markersForOnsets(
        existing: Model.WarpMarker[],
        onsets: number[],
        sampleLengthSec: number,
        minDistSec: number = 0.01
    ): Model.WarpMarker[] {
        const times = existing.map((m) => m.sample_time).sort((a, b) => a - b);
        const out: Model.WarpMarker[] = [];
        let j = 0;
        for (const sec of onsets) {
            if (sec <= 0 || sec >= sampleLengthSec) continue;
            while (j + 1 < times.length && times[j + 1] <= sec) j++;
            const near = Math.min(
                times.length ? Math.abs(times[j] - sec) : Infinity,
                j + 1 < times.length ? Math.abs(times[j + 1] - sec) : Infinity
            );
            if (near < minDistSec) continue;
            out.push({ beat_time: Utils.round(sampleToBeat(existing, sec), 7), sample_time: Utils.round(sec, 7) });
        }
        return out;
    }

    // ---- Running a detection inside Max -------------------------------------

    export interface Job {
        clip: LiveAPI;
        bufferName: string;
        bufferBox: any;
        buffer: Buffer | null;
        frames: number;
        channels: number;
        sampleRate: number;
        position: number;
        lastFrames: number;
        waitTicks: number;
        envelope: Envelope | null;
        onsets: number[];
        toInsert: Model.WarpMarker[];
        insertIndex: number;
        inserted: number;
        onDone: (ok: boolean) => void;
    }

    const CHUNK = 65536;
    const CHUNKS_PER_TICK = 8;
    const INSERTS_PER_TICK = 100;
    const MAX_WAIT_TICKS = 300; // 30 s at 100 ms

    let addFormat = -1;

    /** Starts detecting kicks in the clip's file and adding them as warp markers. */
    export function start(clip: LiveAPI, filePath: string, onDone: (ok: boolean) => void): void {
        cancel();
        const name = "qtr_detect_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
        const box = patcher.newdefault(-200, -200, "buffer~", name);
        box.message("replace", filePath);

        State.state.pendingDetect = {
            clip, bufferName: name, bufferBox: box, buffer: null,
            frames: 0, channels: 0, sampleRate: 0, position: 0, lastFrames: -1, waitTicks: 0,
            envelope: null, onsets: [], toInsert: [], insertIndex: 0, inserted: 0, onDone,
        };
        State.state.detectTask = new Task(tick, Detect);
        State.state.detectTask.schedule(100);
        Utils.setProgress("Loading audio for kick detection");
    }

    export function cancel(): void {
        const job = State.state.pendingDetect;
        State.state.detectTask = Live.cancelTask(State.state.detectTask);
        State.state.pendingDetect = null;
        if (job && job.bufferBox) {
            try { patcher.remove(job.bufferBox); } catch (e) { /* already gone */ }
        }
    }

    function finish(ok: boolean): void {
        const job = State.state.pendingDetect;
        cancel();
        if (job) job.onDone(ok);
    }

    function tick(): void {
        const job = State.state.pendingDetect;
        if (!job) return;
        try {
            if (!job.envelope) {
                if (!waitForBuffer(job)) return;
            } else if (job.position < job.frames) {
                analyzeChunks(job);
            } else if (job.insertIndex < job.toInsert.length) {
                insertMarkers(job);
            } else {
                post(`Kick detection: ${job.onsets.length} kicks, added ${job.inserted} warp markers\n`);
                finish(true);
                return;
            }
            State.state.detectTask!.schedule(job.envelope ? 1 : 100);
        } catch (e: any) {
            Utils.fail("Kick detection failed: " + String(e));
            finish(false);
        }
    }

    /** Waits until buffer~ has finished loading (frame count present and stable). */
    function waitForBuffer(job: Job): boolean {
        if (!job.buffer) job.buffer = new Buffer(job.bufferName);
        const frames = job.buffer.framecount();
        if (frames > 0 && frames === job.lastFrames) {
            job.frames = frames;
            job.channels = Math.max(1, job.buffer.channelcount());
            job.sampleRate = frames / (job.buffer.length() / 1000);
            job.envelope = new Envelope(job.sampleRate);
            return true;
        }
        job.lastFrames = frames;
        if (++job.waitTicks > MAX_WAIT_TICKS) throw new Error("audio file did not load");
        State.state.detectTask!.schedule(100);
        return false;
    }

    function readMono(job: Job, start: number, count: number): number[] {
        const out = new Array(count).fill(0);
        for (let c = 1; c <= job.channels; c++) {
            const raw = job.buffer!.peek(c, start, count);
            const arr = Array.isArray(raw) ? raw : [raw];
            for (let i = 0; i < count && i < arr.length; i++) out[i] += arr[i] / job.channels;
        }
        return out;
    }

    function analyzeChunks(job: Job): void {
        for (let n = 0; n < CHUNKS_PER_TICK && job.position < job.frames; n++) {
            const count = Math.min(CHUNK, job.frames - job.position);
            job.envelope!.push(readMono(job, job.position, count));
            job.position += count;
        }
        Utils.setProgress("Detecting kicks " + Math.round(100 * job.position / job.frames) + "%");

        if (job.position >= job.frames) {
            const env = job.envelope!;
            job.onsets = pickOnsets(env.env, env.hopSec, env.delaySec);
            const existing = Live.getWarpMarkersFromClip(job.clip) || [];
            job.toInsert = markersForOnsets(existing, job.onsets, job.frames / job.sampleRate);
            // Release the audio as soon as it is no longer needed.
            try { patcher.remove(job.bufferBox); } catch (e) { /* ignore */ }
            job.bufferBox = null;
            job.buffer = null;
        }
    }

    function insertMarkers(job: Job): void {
        for (let n = 0; n < INSERTS_PER_TICK && job.insertIndex < job.toInsert.length; n++) {
            if (addWarpMarker(job.clip, job.toInsert[job.insertIndex])) job.inserted++;
            job.insertIndex++;
        }
        Utils.setProgress("Adding kick markers " + job.insertIndex + "/" + job.toInsert.length);
    }

    function markerCount(clip: LiveAPI): number {
        const m = Live.getWarpMarkersFromClip(clip);
        return m ? m.length : 0;
    }

    /**
     * Clip.add_warp_marker takes a dict with beat_time and sample_time. How a
     * dict is passed through LiveAPI.call from JS is not documented, so the
     * formats below are tried once and the first that adds a marker is kept.
     */
    export function addWarpMarker(clip: LiveAPI, marker: Model.WarpMarker): boolean {
        const attempts: Array<() => void> = [
            () => {
                const d = new Dict();
                d.set("beat_time", marker.beat_time);
                d.set("sample_time", marker.sample_time);
                clip.call("add_warp_marker", d);
            },
            () => {
                const d = new Dict();
                d.set("beat_time", marker.beat_time);
                d.set("sample_time", marker.sample_time);
                clip.call("add_warp_marker", "dictionary", d.name);
            },
            () => clip.call("add_warp_marker", JSON.stringify({ beat_time: marker.beat_time, sample_time: marker.sample_time })),
        ];

        if (addFormat >= 0) {
            attempts[addFormat]();
            return true;
        }

        for (let i = 0; i < attempts.length; i++) {
            const before = markerCount(clip);
            try { attempts[i](); } catch (e) { continue; }
            if (markerCount(clip) > before) {
                addFormat = i;
                Utils.debug("add_warp_marker format " + i + " works");
                return true;
            }
        }
        throw new Error("add_warp_marker is not supported by this Live version");
    }

    /** For tests: forget the detected add_warp_marker format. */
    export function resetFormat(): void {
        addFormat = -1;
    }
}
