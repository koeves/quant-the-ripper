/* 
  Max for Live / Ableton Live slicer
  TypeScript source -> compile to JS -> load in Max v8 object

  Usage in Max:
    init
    run 16 0 0

  Meaning:
    run <sliceBeats> <warpMode> <startBeat>

  warpMode:
    0 = Beats
    1 = Tones
    2 = Texture
    3 = Re-Pitch
    4 = Complex
    6 = Complex Pro
*/

// ---------- Max globals exposed at runtime ----------
declare function post(...args: any[]): void;
declare function error(...args: any[]): void;

declare class Dict {
    name: string;
    constructor(name?: string);
    get(key: string): any;
    getkeys(): string[] | null;
    set(key: string, value: any): void;
}

declare class LiveAPI {
    id: number | string;
    path: string;
    unquotedpath: string;
    property: string;
    mode: number;
    type: string;
    info: string;

    constructor(callback?: ((args: any[]) => void) | null, pathOrId?: string | number);
    get(property: string): any;
    set(property: string, value: any): void;
    call(functionName: string, ...args: any[]): any;
    goto(path: string): void;
    getcount(child: string): number;
}

// ---------- Types ----------
type WarpMode = 0 | 1 | 2 | 3 | 4 | 6;

interface WarpMarker {
    beat_time: number;
    sample_time: number;
}

interface MaybeArray<T> extends Array<T> { }

interface RuntimeState {
    initialized: boolean;
}

const state: RuntimeState = {
    initialized: false,
};

// ---------- Max entry points ----------
function init(): void {
    state.initialized = true;
    post("vinyl_slice_warp initialized\n");
}

function bang(): void {
    post("ready\n");
}

/**
 * run <sliceBeats> <warpMode> <startBeat>
 * Example: run 16 0 0
 */
function run(sliceBeats: number = 16, warpMode: WarpMode = 0, startBeat: number = 0): void {
    if (!state.initialized) {
        error("Device not initialized yet. Trigger init from live.thisdevice first.\n");
        return;
    }

    try {
        const clip = new LiveAPI(undefined, "live_set view detail_clip");
        if (!clip || !clip.id || Number(clip.id) === 0) {
            error("No detail clip selected.\n");
            return;
        }

        const isAudio = toNumber(lastValue(clip.get("is_audio_clip")));
        const isArrangement = toNumber(lastValue(clip.get("is_arrangement_clip")));

        if (isAudio !== 1) {
            error("Selected detail clip is not an audio clip.\n");
            return;
        }

        if (isArrangement !== 1) {
            error("Selected detail clip is not an Arrangement clip.\n");
            return;
        }

        const filePath = toJoinedString(clip.get("file_path"));
        if (!filePath) {
            error("Could not read file_path from clip.\n");
            return;
        }

        const arrangementStart = toNumber(lastValue(clip.get("start_time")));
        const clipStartBeat = toNumber(lastValue(clip.get("start_marker")));
        const clipEndBeat = toNumber(lastValue(clip.get("end_marker")));

        const trackPath = parentTrackPath(clip.path);
        if (!trackPath) {
            error("Could not determine parent track path.\n");
            return;
        }

        const track = new LiveAPI(undefined, trackPath);

        const warpMarkers = getWarpMarkersFromClip(clip);
        if (!warpMarkers || warpMarkers.length < 2) {
            error("Could not parse warp_markers from selected clip.\n");
            return;
        }

        warpMarkers.sort((a, b) => a.beat_time - b.beat_time);

        const firstBeat = Math.max(startBeat, clipStartBeat);
        const lastBeat = clipEndBeat;

        let created = 0;
        let sliceIndex = 0;

        for (let segBeatStart = firstBeat; segBeatStart < lastBeat - 1e-6; segBeatStart += sliceBeats) {
            const segBeatEnd = Math.min(segBeatStart + sliceBeats, lastBeat);
            const actualBeats = segBeatEnd - segBeatStart;

            if (actualBeats <= 1e-6) continue;

            // IMPORTANT:
            // splice points come from the EXISTING warp map, not from BPM math
            const srcSecStart = beatToSampleTime(segBeatStart, warpMarkers);
            const srcSecEnd = beatToSampleTime(segBeatEnd, warpMarkers);
            const srcDurSec = srcSecEnd - srcSecStart;

            if (srcDurSec <= 1e-6) {
                post(`Skipping slice at beat ${segBeatStart} because duration <= 0\n`);
                continue;
            }

            const destBeat = arrangementStart + (sliceIndex * sliceBeats);

            // Create clip from full file at destination
            track.call("create_audio_clip", filePath, destBeat);

            const newClip = findArrangementClipByStartTime(trackPath, destBeat);
            if (!newClip) {
                post(`Could not find newly created clip at beat ${destBeat}\n`);
                continue;
            }

            // Crop to source region
            safeSet(newClip, "looping", 0);
            safeSet(newClip, "start_marker", srcSecStart);
            safeSet(newClip, "end_marker", srcSecEnd);
            newClip.call("crop");

            // Enable warp and set warp mode
            safeSet(newClip, "warping", 1);
            safeSet(newClip, "warp_mode", warpMode);

            // Add local anchors:
            // local sample 0 sec -> beat 0
            // local sample srcDurSec -> beat actualBeats
            addWarpMarker(newClip, 0.0, 0.0);
            addWarpMarker(newClip, actualBeats, srcDurSec);

            // Set resulting musical range
            safeSet(newClip, "looping", 0);
            safeSet(newClip, "start_marker", 0.0);
            safeSet(newClip, "end_marker", actualBeats);
            safeSet(newClip, "name", `slice_${pad2(sliceIndex + 1)}`);

            sliceIndex += 1;
            created += 1;
        }

        post(`Done. Created ${created} slices.\n`);
    } catch (e: any) {
        error(`run() failed: ${String(e)}\n`);
    }
}

// ---------- Helpers ----------
function lastValue(v: any): any {
    return Array.isArray(v) ? v[v.length - 1] : v;
}

function toNumber(v: any): number {
    return Number(v);
}

function toJoinedString(v: any): string {
    if (Array.isArray(v)) {
        return v.slice(1).join(" ");
    }
    return String(v ?? "");
}

function safeSet(api: LiveAPI, prop: string, value: any): void {
    try {
        api.set(prop, value);
    } catch (e: any) {
        post(`Warning: failed to set ${prop}=${value}: ${String(e)}\n`);
    }
}

function addWarpMarker(clip: LiveAPI, beatTime: number, sampleTime: number): void {
    try {
        const d = new Dict();
        d.set("beat_time", beatTime);
        d.set("sample_time", sampleTime);
        clip.call("add_warp_marker", "dict", d.name);
    } catch (e: any) {
        post(`Warning: add_warp_marker failed at beat ${beatTime}: ${String(e)}\n`);
    }
}

function parentTrackPath(path: string): string | null {
    const parts = path.split(" ");
    const idx = parts.indexOf("tracks");
    if (idx === -1 || idx + 1 >= parts.length) return null;
    return `live_set tracks ${parts[idx + 1]}`;
}

function findArrangementClipByStartTime(trackPath: string, startBeat: number): LiveAPI | null {
    const track = new LiveAPI(undefined, trackPath);
    const count = track.getcount("arrangement_clips");

    for (let i = 0; i < count; i++) {
        const c = new LiveAPI(undefined, `${trackPath} arrangement_clips ${i}`);
        const st = toNumber(lastValue(c.get("start_time")));
        if (Math.abs(st - startBeat) < 1e-4) {
            return c;
        }
    }

    return null;
}

/**
 * Parse warp_markers dict returned by Live.
 * The exact nested shape can vary a bit in practice, so this function is defensive.
 */
function getWarpMarkersFromClip(clip: LiveAPI): WarpMarker[] | null {
    try {
        const raw = clip.get("warp_markers");

        let dictName: string | null = null;
        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === "string" && item !== "dictionary") {
                    dictName = item;
                    break;
                }
            }
        } else if (typeof raw === "string") {
            dictName = raw;
        }

        if (!dictName) return null;

        const d = new Dict(dictName);
        const keys = d.getkeys();
        if (!keys) return null;

        const wm = d.get("warp_markers");
        if (!wm) return null;

        const out: WarpMarker[] = [];

        // Typical case: array of marker-like dict objects
        if (Array.isArray(wm)) {
            for (const item of wm) {
                if (item && typeof item === "object" && "beat_time" in item && "sample_time" in item) {
                    out.push({
                        beat_time: Number((item as any).beat_time),
                        sample_time: Number((item as any).sample_time),
                    });
                }
            }
        }

        return out.length ? out : null;
    } catch (e: any) {
        post(`getWarpMarkersFromClip failed: ${String(e)}\n`);
        return null;
    }
}

function beatToSampleTime(beatTime: number, markers: WarpMarker[]): number {
    if (beatTime <= markers[0].beat_time) return markers[0].sample_time;

    for (let i = 0; i < markers.length - 1; i++) {
        const a = markers[i];
        const b = markers[i + 1];

        if (beatTime >= a.beat_time && beatTime <= b.beat_time) {
            const spanBeats = b.beat_time - a.beat_time;
            if (spanBeats <= 0) return a.sample_time;

            const ratio = (beatTime - a.beat_time) / spanBeats;
            return a.sample_time + ratio * (b.sample_time - a.sample_time);
        }
    }

    return markers[markers.length - 1].sample_time;
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}