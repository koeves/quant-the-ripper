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

function inspect(clip: LiveAPI): void {
    post("clip path: " + clip.path + "\n");
    post("is_audio_clip raw: " + clip.get("is_audio_clip") + "\n");
    post("is_arrangement_clip raw: " + clip.get("is_arrangement_clip") + "\n");
    post("file_path raw: " + clip.get("file_path") + "\n");
    post("sample_length raw: " + clip.get("sample_length") + "\n");
    post("sample_rate raw: " + clip.get("sample_rate") + "\n");
    post("name raw: " + clip.get("name") + "\n");
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

        inspect(clip);

        const filePath = toPropertyString(clip.get("file_path"));
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

        densifySourceWarpMap(clip, sliceBeats);

        const warpMarkers = getWarpMarkersFromClip(clip);
        if (!warpMarkers || warpMarkers.length < 2) {
            error("Could not parse warp_markers from selected clip.\n");
            return;
        }

        post(`Parsed ${warpMarkers.length} warp markers: ${warpMarkers}`);

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
function addWarpMarker(clip: LiveAPI, beatTime: number, sampleTime: number): void {
    try {
        clip.call("add_warp_marker", { "beat_time": beatTime, "sample_time": sampleTime });
    } catch (e: any) {
        post(`Warning: add_warp_marker failed at beat ${beatTime}: ${String(e)}\n`);
    }
}

function addWarpMarkerByBeatOnly(clip: LiveAPI, beatTime: number): void {
    try {
        // Intentionally DO NOT set sample_time
        clip.call("add_warp_marker", { "beat_time": beatTime });
    } catch (e: any) {
        post(`Warning: addWarpMarkerByBeatOnly failed at beat ${beatTime}: ${String(e)}\n`);
    }
}

function densifySourceWarpMap(clip: LiveAPI, sliceBeats: number): void {
    const clipStartBeat = Number(lastValue(clip.get("start_marker")));
    const clipEndBeat = Number(lastValue(clip.get("end_marker")));

    post(`Densifying warp map from ${clipStartBeat} to ${clipEndBeat} every ${sliceBeats} beats\n`);

    for (let beat = clipStartBeat; beat <= clipEndBeat + 1e-6; beat += sliceBeats) {
        addWarpMarkerByBeatOnly(clip, beat);
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

function getWarpMarkersFromClip(clip: LiveAPI): WarpMarker[] | null {
    try {
        const raw = clip.get("warp_markers");
        post("RAW warp markers:\n");
        post(JSON.stringify(raw, null, 2) + "\n");

        let parsed: any = null;

        if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
            parsed = JSON.parse(raw[0]);
        } else if (typeof raw === "string") {
            parsed = JSON.parse(raw);
        } else {
            return null;
        }

        if (!parsed || !Array.isArray(parsed.warp_markers)) {
            return null;
        }

        const out: WarpMarker[] = [];
        for (const item of parsed.warp_markers) {
            if (item && typeof item === "object") {
                out.push({
                    beat_time: Number(item.beat_time),
                    sample_time: Number(item.sample_time),
                });
            }
        }

        out.sort((a, b) => a.beat_time - b.beat_time);
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

// ---------- Utils ----------

function lastValue(v: any): any {
    return Array.isArray(v) ? v[v.length - 1] : v;
}

function toNumber(v: any): number {
    return Number(v);
}

function toPropertyString(v: any): String {
    if (v === null || v === undefined) return "";

    if (Array.isArray(v)) {
        if (v.length === 0) return "";
        if (v.length === 1) return String(v[0]);
        return String(v[v.length - 1]);
    }

    return String(v);
}

function safeSet(api: LiveAPI, prop: string, value: any): void {
    try {
        api.set(prop, value);
    } catch (e: any) {
        post(`Warning: failed to set ${prop}=${value}: ${String(e)}\n`);
    }
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}