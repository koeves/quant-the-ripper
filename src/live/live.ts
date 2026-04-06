namespace Live {
    export declare function post(...args: any[]): void;
    export declare function error(...args: any[]): void;

    export declare class LiveAPI {
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

    export function addWarpMarker(clip: Live.LiveAPI, beatTime: number, sampleTime: number): void {
        try {
            clip.call("add_warp_marker", { "beat_time": beatTime, "sample_time": sampleTime });
        } catch (e: any) {
            Live.post(`Warning: add_warp_marker failed at beat ${beatTime}: ${String(e)}\n`);
        }
    }

    export function addWarpMarkerByBeatOnly(clip: Live.LiveAPI, beatTime: number): void {
        try {
            // Intentionally DO NOT set sample_time
            clip.call("add_warp_marker", { "beat_time": beatTime });
        } catch (e: any) {
            Live.post(`Warning: addWarpMarkerByBeatOnly failed at beat ${beatTime}: ${String(e)}\n`);
        }
    }

    export function densifySourceWarpMap(clip: Live.LiveAPI, sliceBeats: number): void {
        const clipStartBeat = Number(Utils.lastValue(clip.get("start_marker")));
        const clipEndBeat = Number(Utils.lastValue(clip.get("end_marker")));

        Live.post(`Densifying warp map from ${clipStartBeat} to ${clipEndBeat} every ${sliceBeats} beats\n`);

        for (let beat = clipStartBeat; beat <= clipEndBeat + 1e-6; beat += sliceBeats) {
            addWarpMarkerByBeatOnly(clip, beat);
        }
    }

    export function parentTrackPath(path: string): string | null {
        const parts = path.split(" ");
        const idx = parts.indexOf("tracks");
        if (idx === -1 || idx + 1 >= parts.length) return null;
        return `live_set tracks ${parts[idx + 1]}`;
    }

    export function findArrangementClipByStartTime(trackPath: string, startBeat: number): Live.LiveAPI | null {
        const track = new Live.LiveAPI(undefined, trackPath);
        const count = track.getcount("arrangement_clips");

        for (let i = 0; i < count; i++) {
            const c = new Live.LiveAPI(undefined, `${trackPath} arrangement_clips ${i}`);
            const st = Utils.toNumber(Utils.lastValue(c.get("start_time")));
            if (Math.abs(st - startBeat) < 1e-4) {
                return c;
            }
        }

        return null;
    }

    export function getWarpMarkersFromClip(clip: Live.LiveAPI): Model.WarpMarker[] | null {
        try {
            const raw = clip.get("warp_markers");
            Live.post("RAW warp markers:\n");
            Live.post(JSON.stringify(raw, null, 2) + "\n");

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

            const out: Model.WarpMarker[] = [];
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
            Live.post(`getWarpMarkersFromClip failed: ${String(e)}\n`);
            return null;
        }
    }

    export function beatToSampleTime(beatTime: number, markers: Model.WarpMarker[]): number {
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

}