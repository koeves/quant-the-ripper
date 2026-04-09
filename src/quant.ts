declare function post(...args: any[]): void;
declare function error(...args: any[]): void;
declare function outlet(index: number, ...args: any[]): void;
declare var outlets: number;
declare var inlets: number;

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

outlets = 1;
inlets = 1;

namespace Model {
    export interface WarpMarker {
        beat_time: number;
        sample_time: number;
    }

    // Still keeps the same shape so the graph logic stays unchanged.
    export interface AnalysisPoint {
        index: number;
        targetBeat: number;
        markerBeat: number;
        markerSampleTime: number;
        driftBeats: number;
        driftMs: number;
        absDriftBeats: number;
        accepted: boolean;
        reason: string;
    }

    export interface AnalysisResult {
        clipName: string;
        clipPath: string;
        filePath: string;
        tempo: number;
        gridBeats: number;
        toleranceBeats: number;
        clipStartBeat: number;
        clipEndBeat: number;
        startTime: number;
        points: AnalysisPoint[];
        summary: {
            totalTargets: number;
            accepted: number;
            rejected: number;
            uniqueMarkersUsed: number;
            minDriftBeats: number;
            maxDriftBeats: number;
            meanAbsDriftBeats: number;
            minDriftMs: number;
            maxDriftMs: number;
            meanAbsDriftMs: number;
        };
    }

    export interface GraphPoint {
        i: number;
        xBeat: number;
        yBeats: number;
        yMs: number;
        ok: boolean;
    }

    export interface GraphPayload {
        clipName: string;
        tempo: number;
        gridBeats: number;
        toleranceBeats: number;
        toleranceMs: number;
        xMin: number;
        xMax: number;
        yMinBeats: number;
        yMaxBeats: number;
        yMinMs: number;
        yMaxMs: number;
        accepted: number;
        rejected: number;
        points: GraphPoint[];
    }

    export interface RuntimeState {
        initialized: boolean;
        lastAnalysis: AnalysisResult | null;
        lastGraph: GraphPayload | null;
        lastAfterAnalysis: AnalysisResult | null;
        lastAfterGraph: GraphPayload | null;
        lastClipId: string;
    }
}

namespace State {
    export const state: Model.RuntimeState = {
        initialized: false,
        lastAnalysis: null,
        lastGraph: null,
        lastAfterAnalysis: null,
        lastAfterGraph: null,
        lastClipId: "",
    };
}

namespace Utils {
    export function lastValue(v: any): any {
        return Array.isArray(v) ? v[v.length - 1] : v;
    }

    export function toNumber(v: any): number {
        return Number(v);
    }

    export function toPropertyString(v: any): string {
        if (v === null || v === undefined) return "";

        if (Array.isArray(v)) {
            if (v.length === 0) return "";
            if (v.length === 1) return String(v[0]);
            return String(v[v.length - 1]);
        }

        return String(v);
    }

    export function round(n: number, digits: number = 7): number {
        const f = Math.pow(10, digits);
        return Math.round(n * f) / f;
    }

    export function mean(values: number[]): number {
        if (!values.length) return 0;
        let sum = 0;
        for (let i = 0; i < values.length; i++) sum += values[i];
        return sum / values.length;
    }

    export function min(values: number[]): number {
        if (!values.length) return 0;
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
            if (values[i] < m) m = values[i];
        }
        return m;
    }

    export function max(values: number[]): number {
        if (!values.length) return 0;
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
            if (values[i] > m) m = values[i];
        }
        return m;
    }

    export function abs(n: number): number {
        return n < 0 ? -n : n;
    }

    export function sampleKey(sampleTime: number): string {
        return String(round(sampleTime, 7));
    }
}

namespace Live {
    export function inspect(clip: LiveAPI): void {
        post("clip path: " + clip.path + "\n");
        post("is_audio_clip raw: " + clip.get("is_audio_clip") + "\n");
        post("is_arrangement_clip raw: " + clip.get("is_arrangement_clip") + "\n");
        post("file_path raw: " + clip.get("file_path") + "\n");
        post("sample_length raw: " + clip.get("sample_length") + "\n");
        post("sample_rate raw: " + clip.get("sample_rate") + "\n");
        post("name raw: " + clip.get("name") + "\n");
        post("start_marker raw: " + clip.get("start_marker") + "\n");
        post("end_marker raw: " + clip.get("end_marker") + "\n");
        post("warping raw: " + clip.get("warping") + "\n");
        post("warp_mode raw: " + clip.get("warp_mode") + "\n");
        post("start_time raw: " + clip.get("start_time") + "\n");
    }

    export function getSongTempo(): number {
        const song = new LiveAPI(undefined, "live_set");
        return Utils.toNumber(Utils.lastValue(song.get("tempo")));
    }

    export function getWarpMarkersFromClip(clip: LiveAPI): Model.WarpMarker[] | null {
        try {
            const raw = clip.get("warp_markers");
            let parsed = JSON.parse(raw);

            if (!parsed || !Array.isArray(parsed.warp_markers)) {
                error(`got invalid warp markers: ${JSON.stringify(parsed)}`);
                return null;
            }

            // post(`parsed: ${JSON.stringify(parsed)}`);
            post(`parsed ${parsed.warp_markers.length} warp markers from clip ${clip.id}`);

            const out: Model.WarpMarker[] = [];
            for (let i = 0; i < parsed.warp_markers.length; i++) {
                const item = parsed.warp_markers[i];
                if (item && typeof item === "object") {
                    out.push({
                        beat_time: Number(item.beat_time),
                        sample_time: Number(item.sample_time),
                    });
                }
            }

            out.sort((a: Model.WarpMarker, b: Model.WarpMarker) => a.beat_time - b.beat_time);
            return out.length ? out : null;
        } catch (e: any) {
            post("getWarpMarkersFromClip failed: " + String(e) + "\n");
            return null;
        }
    }

    export function dedupeWarpMarkers(markers: Model.WarpMarker[]): Model.WarpMarker[] {
        const out: Model.WarpMarker[] = [];
        const seen: { [key: string]: boolean } = {};

        for (let i = 0; i < markers.length; i++) {
            const m = markers[i];
            const key = String(Utils.round(m.sample_time, 7)) + "|" + String(Utils.round(m.beat_time, 7));
            if (!seen[key]) {
                seen[key] = true;
                out.push(m);
            }
        }

        out.sort((a: Model.WarpMarker, b: Model.WarpMarker) => a.beat_time - b.beat_time);
        return out;
    }

    export function clipInfo(): LiveAPI | null {
        const clip = new LiveAPI(undefined, "live_set view detail_clip");
        if (!clip || !clip.id || Number(clip.id) === 0) return null;
        return clip;
    }

    export function msPerBeat(tempo: number): number {
        if (tempo <= 0) return 0;
        return 60000 / tempo;
    }

    export function beatsToMs(beats: number, tempo: number): number {
        return beats * msPerBeat(tempo);
    }

    export function findNearestUnusedWarpMarkerAroundBeat(
        targetBeat: number,
        markers: Model.WarpMarker[],
        usedSampleTimes: { [key: string]: boolean }
    ): { marker: Model.WarpMarker | null; distance: number } {
        let best: Model.WarpMarker | null = null;
        let bestDist = Number.POSITIVE_INFINITY;

        for (let i = 0; i < markers.length; i++) {
            const wm = markers[i];
            const sampleKey = Utils.sampleKey(wm.sample_time);
            if (usedSampleTimes[sampleKey]) continue;

            const d = Utils.abs(wm.beat_time - targetBeat);
            if (d < bestDist) {
                best = wm;
                bestDist = d;
            }
        }

        if (!best) {
            return { marker: null, distance: Number.POSITIVE_INFINITY };
        }

        return { marker: best, distance: bestDist };
    }

    export function getOrCreateComparisonTrack(trackName: string): LiveAPI | null {
        const song = new LiveAPI(undefined, "live_set");
        const trackCountBefore = song.getcount("tracks");

        for (let i = 0; i < trackCountBefore; i++) {
            const t = new LiveAPI(undefined, "live_set tracks " + i);
            const name = Utils.toPropertyString(t.get("name"));
            if (name === trackName) {
                return t;
            }
        }

        post("Creating comparison track: " + trackName + "\n");
        song.call("create_audio_track", -1);

        const trackCountAfter = song.getcount("tracks");
        if (trackCountAfter <= 0) return null;

        const newTrack = new LiveAPI(undefined, "live_set tracks " + (trackCountAfter - 1));
        newTrack.set("name", trackName);
        return newTrack;
    }

    export function findArrangementClipByStartTime(trackPath: string, startBeat: number): LiveAPI | null {
        const track = new LiveAPI(undefined, trackPath);
        const count = track.getcount("arrangement_clips");

        for (let i = 0; i < count; i++) {
            const c = new LiveAPI(undefined, trackPath + " arrangement_clips " + i);
            const st = Utils.toNumber(Utils.lastValue(c.get("start_time")));
            if (Math.abs(st - startBeat) < 1e-4) {
                return c;
            }
        }

        return null;
    }

    export function duplicateOriginalClipToComparisonTrack(
        originalClip: LiveAPI,
        destinationTrack: LiveAPI,
        destinationTime: number
    ): LiveAPI {
        destinationTrack.call("duplicate_clip_to_arrangement", "id " + Number(originalClip.id), destinationTime);
        const clip = findArrangementClipByStartTime(destinationTrack.path, destinationTime)!;
        const clipName = Utils.toPropertyString(clip.get("name"));
        clip.set("name", clipName + "_quanted");
        return clip
    }

    export function selectedClipMatchesLastAnalysis(): boolean {
        const clip = clipInfo();
        if (!clip) return false;
        return String(clip.id) === State.state.lastClipId;
    }

    export function findNearestMarkerBySampleTime(
        markers: Model.WarpMarker[],
        sampleTime: number,
        maxDistanceSec: number
    ): Model.WarpMarker | null {
        let best: Model.WarpMarker | null = null;
        let bestDist = Number.POSITIVE_INFINITY;

        for (let i = 0; i < markers.length; i++) {
            const m = markers[i];
            const d = Math.abs(m.sample_time - sampleTime);
            if (d < bestDist) {
                best = m;
                bestDist = d;
            }
        }

        if (!best) return null;
        if (bestDist > maxDistanceSec) return null;
        return best;
    }

    // export function createFreshClipFromOriginalOnTrack(
    //     originalClip: LiveAPI,
    //     destinationTrack: LiveAPI,
    //     destinationTime: number,
    //     clipNameSuffix: String
    // ): LiveAPI | null {
    //     try {
    //         const filePath = Utils.toPropertyString(originalClip.get("file_path"));
    //         if (!filePath) {
    //             post("createFreshClipFromOriginalOnTrack: missing file_path\n");
    //             return null;
    //         }

    //         destinationTrack.call("create_audio_clip", filePath, destinationTime);

    //         const newClip = findArrangementClipByStartTime(destinationTrack.path, destinationTime);
    //         if (!newClip) {
    //             post("createFreshClipFromOriginalOnTrack: could not find created clip\n");
    //             return null;
    //         }

    //         const clipName = Utils.toPropertyString(originalClip.get("name"));
    //         const clipStartBeat = Utils.toNumber(Utils.lastValue(originalClip.get("start_marker")));
    //         const clipEndBeat = Utils.toNumber(Utils.lastValue(originalClip.get("end_marker")));
    //         const warping = Utils.toNumber(Utils.lastValue(originalClip.get("warping")));
    //         const warpMode = Utils.toNumber(Utils.lastValue(originalClip.get("warp_mode")));

    //         try { newClip.set("name", `${clipName}_${clipNameSuffix}`); } catch (e) { }
    //         try { newClip.set("warping", warping); } catch (e) { }
    //         try { newClip.set("warp_mode", warpMode); } catch (e) { }

    //         // For warped audio clips these are in beats.
    //         try { newClip.set("start_marker", clipStartBeat); } catch (e) { }
    //         try { newClip.set("end_marker", clipEndBeat); } catch (e) { }

    //         return newClip;
    //     } catch (e: any) {
    //         post("createFreshClipFromOriginalOnTrack failed: " + String(e) + "\n");
    //         return null;
    //     }
    // }

    export function moveWarpMarker(
        clip: LiveAPI,
        beatTime: number,
        beatTimeDistance: number
    ): number {
        const res = JSON.stringify(clip.call("move_warp_marker", beatTime.toFixed(7), beatTimeDistance.toFixed(7)));
        post(
            "move_warp_marker beat=" + beatTime.toFixed(7) +
            " distance=" + beatTimeDistance.toFixed(7) +
            " -> " + res + "\n"
        );
        return 1;
    }

    function removeWarpMarker(
        clip: LiveAPI,
        beatTime: number,
    ): number {
        const res = JSON.stringify(clip.call("remove_warp_marker", beatTime.toFixed(7)));
        post(
            "remove_warp_marker beat=" + beatTime.toFixed(7) +
            " -> " + res + "\n"
        );
        return (res === "[\"id\": 0]") ? 1 : 0;
    }

    // export function addWarpMarker(
    //     clip: LiveAPI,
    //     beatTime: number,
    //     sampleTime: number
    // ): boolean {
    //     try {
    //         const markerDict = JSON.stringify({
    //             beat_time: beatTime,
    //             sample_time: sampleTime
    //         });

    //         clip.call("add_warp_marker", markerDict);

    //         post(
    //             "add_warp_marker beat=" + beatTime.toFixed(6) +
    //             " sample=" + Utils.round(sampleTime, 6) + "\n"
    //         );
    //         return true;
    //     } catch (e: any) {
    //         post(
    //             "add_warp_marker failed beat=" + beatTime.toFixed(6) +
    //             " sample=" + Utils.round(sampleTime, 6) +
    //             " err=" + String(e) + "\n"
    //         );
    //         return false;
    //     }
    // }

    // export function reinsertAcceptedWarpMarkers(
    //     clip: LiveAPI,
    //     analysis: Model.AnalysisResult
    // ): { inserted: number; failed: number } {
    //     let inserted = 0;
    //     let failed = 0;

    //     const accepted = analysis.points
    //         .filter(function (p) {
    //             return p.accepted && p.markerSampleTime >= 0;
    //         })
    //         .sort(function (a, b) {
    //             return a.targetBeat - b.targetBeat;
    //         });

    //     for (let i = 0; i < accepted.length; i++) {
    //         const p = accepted[i];
    //         const ok = addWarpMarker(clip, p.markerBeat, p.markerSampleTime);
    //         if (ok) inserted += 1;
    //         else failed += 1;
    //     }

    //     return { inserted: inserted, failed: failed };
    // }

    export function removeNonAcceptedWarpMarkers(
        clip: LiveAPI,
        analysis: Model.AnalysisResult
    ): { removed: number; failed: number } {
        let removed = 0;
        let failed = 0;

        const nonAccepted = analysis.points
            .filter((p) => !p.accepted)
            .sort((a, b) => a.targetBeat - b.targetBeat);

        post(`first nonaccepted marker: ${JSON.stringify(nonAccepted[0])}`);
        post(`last nonaccepted marker: ${JSON.stringify(nonAccepted[nonAccepted.length - 1])}`);
        post(`here trying to remove ${nonAccepted.length} markers`);

        nonAccepted.shift();
        nonAccepted.pop();

        post(`first nonaccepted marker after shift: ${JSON.stringify(nonAccepted[0])}`);
        post(`last nonaccepted marker after pop: ${JSON.stringify(nonAccepted[nonAccepted.length - 1])}`);
        post(`here trying to remove ${nonAccepted.length} filtered markers`);

        nonAccepted.forEach((p) => {
            post(`removing ${JSON.stringify(p)}`);
            const ok = removeWarpMarker(clip, p.markerBeat);
            if (ok) removed += 1;
            else failed += 1;
        });

        return { removed: removed, failed: failed };
    }
}

namespace Quant {
    export function init(): void {
        State.state.initialized = true;
        post("initialized\n");
    }

    export function bang(): void {
        post("ready\n");
    }

    export function clear_analysis(): void {
        State.state.lastAnalysis = null;
        State.state.lastGraph = null;
        State.state.lastAfterAnalysis = null;
        State.state.lastAfterGraph = null;
        State.state.lastClipId = "";
        outlet(0, "graph_json", JSON.stringify({ type: "graph_cleared" }));
    }

    export function dump_graph(): void {
        if (!State.state.lastGraph) {
            post("No stored graph data.\n");
            return;
        }
        post(JSON.stringify(State.state.lastGraph, null, 2) + "\n");
    }

    function validateClipForAnalysis(clip: LiveAPI): { filePath: string } | null {
        const isAudio = Utils.toNumber(Utils.lastValue(clip.get("is_audio_clip")));
        const isArrangement = Utils.toNumber(Utils.lastValue(clip.get("is_arrangement_clip")));

        if (isAudio !== 1) {
            error("Selected clip is not an audio clip.\n");
            return null;
        }

        if (isArrangement !== 1) {
            error("Selected clip is not an Arrangement clip.\n");
            return null;
        }

        const filePath = Utils.toPropertyString(clip.get("file_path"));
        if (!filePath) {
            error("Could not read file_path from clip.\n");
            return null;
        }

        return { filePath: filePath };
    }

    function buildAnalysisForClip(
        clip: LiveAPI,
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number
    ): { analysis: Model.AnalysisResult; graph: Model.GraphPayload } | null {
        const validated = validateClipForAnalysis(clip);
        if (!validated) return null;

        const filePath = validated.filePath;
        const clipName = Utils.toPropertyString(clip.get("name"));
        const tempo = Live.getSongTempo();
        const arrangementStart = Utils.toNumber(Utils.lastValue(clip.get("start_time")));
        const clipStartBeat = Utils.toNumber(Utils.lastValue(clip.get("start_marker")));
        const clipEndBeat = Utils.toNumber(Utils.lastValue(clip.get("end_marker")));

        const rawMarkers = Live.getWarpMarkersFromClip(clip);
        if (!rawMarkers || rawMarkers.length < 2) {
            error("Could not parse source warp markers.\n");
            return null;
        }

        const sourceMarkers = Live.dedupeWarpMarkers(rawMarkers);
        post("Parsed " + sourceMarkers.length + " unique source warp markers\n");

        const firstBeat = Math.max(startBeat, clipStartBeat);
        const usedSampleTimes: { [key: string]: boolean } = {};
        const points: Model.AnalysisPoint[] = [];

        let idx = 0;
        for (let targetBeat = firstBeat; targetBeat <= clipEndBeat + 1e-9; targetBeat += gridBeats) {
            const nearest = Live.findNearestUnusedWarpMarkerAroundBeat(
                targetBeat,
                sourceMarkers,
                usedSampleTimes
            );

            let accepted = false;
            let markerBeat = targetBeat;
            let markerSampleTime = -1;
            let reason = "no_marker";
            let driftBeats = 0;

            if (!nearest.marker) {
                accepted = false;
                reason = "no_marker";
            } else {
                markerBeat = nearest.marker.beat_time;
                markerSampleTime = nearest.marker.sample_time;
                driftBeats = markerBeat - targetBeat;

                if (nearest.distance <= toleranceBeats) {
                    accepted = true;
                    reason = "accepted";
                    usedSampleTimes[Utils.sampleKey(nearest.marker.sample_time)] = true;
                } else {
                    accepted = false;
                    reason = "outside_tolerance";
                }
            }

            const driftMs = Live.beatsToMs(driftBeats, tempo);

            points.push({
                index: idx,
                targetBeat: targetBeat,
                markerBeat: markerBeat,
                markerSampleTime: markerSampleTime,
                driftBeats: driftBeats,
                driftMs: driftMs,
                absDriftBeats: Utils.abs(driftBeats),
                accepted: accepted,
                reason: reason
            });

            idx++;
        }

        const acceptedPoints = points.filter(function (p) { return p.accepted; });
        const allDriftBeats = points.map(function (p) { return p.driftBeats; });
        const allDriftMs = points.map(function (p) { return p.driftMs; });
        const absDriftBeats = points.map(function (p) { return p.absDriftBeats; });
        const absDriftMs = points.map(function (p) { return Utils.abs(p.driftMs); });

        const analysis: Model.AnalysisResult = {
            clipName: clipName,
            clipPath: clip.path,
            filePath: filePath,
            tempo: Utils.round(tempo, 6),
            gridBeats: gridBeats,
            toleranceBeats: toleranceBeats,
            clipStartBeat: Utils.round(clipStartBeat, 6),
            clipEndBeat: Utils.round(clipEndBeat, 6),
            startTime: Utils.round(arrangementStart, 6),
            points: points,
            summary: {
                totalTargets: points.length,
                accepted: acceptedPoints.length,
                rejected: points.length - acceptedPoints.length,
                uniqueMarkersUsed: acceptedPoints.length,
                minDriftBeats: Utils.round(Utils.min(allDriftBeats), 6),
                maxDriftBeats: Utils.round(Utils.max(allDriftBeats), 6),
                meanAbsDriftBeats: Utils.round(Utils.mean(absDriftBeats), 6),
                minDriftMs: Utils.round(Utils.min(allDriftMs), 3),
                maxDriftMs: Utils.round(Utils.max(allDriftMs), 3),
                meanAbsDriftMs: Utils.round(Utils.mean(absDriftMs), 3)
            }
        };

        const graphPoints: Model.GraphPoint[] = points.map(function (p) {
            return {
                i: p.index,
                xBeat: Utils.round(p.targetBeat, 6),
                yBeats: Utils.round(p.driftBeats, 6),
                yMs: Utils.round(p.driftMs, 3),
                ok: p.accepted
            };
        });

        const toleranceMs = Live.beatsToMs(toleranceBeats, tempo);

        const graph: Model.GraphPayload = {
            clipName: clipName,
            tempo: Utils.round(tempo, 6),
            gridBeats: gridBeats,
            toleranceBeats: Utils.round(toleranceBeats, 6),
            toleranceMs: Utils.round(toleranceMs, 3),
            xMin: graphPoints.length ? graphPoints[0].xBeat : 0,
            xMax: graphPoints.length ? graphPoints[graphPoints.length - 1].xBeat : 0,
            yMinBeats: Utils.round(Utils.min(graphPoints.map(function (p) { return p.yBeats; })), 6),
            yMaxBeats: Utils.round(Utils.max(graphPoints.map(function (p) { return p.yBeats; })), 6),
            yMinMs: Utils.round(Utils.min(graphPoints.map(function (p) { return p.yMs; })), 3),
            yMaxMs: Utils.round(Utils.max(graphPoints.map(function (p) { return p.yMs; })), 3),
            accepted: acceptedPoints.length,
            rejected: points.length - acceptedPoints.length,
            points: graphPoints
        };

        return {
            analysis: analysis,
            graph: graph
        };
    }

    function snapAcceptedMarkersToTargets(
        clip: LiveAPI,
        analysis: Model.AnalysisResult
    ): { moved: number; skippedRejected: number; skippedNoSample: number; skippedNoWarpPoint: number } {
        const accepted = analysis.points
            .filter(function (p) { return p.accepted && p.markerSampleTime > 0 })
            .sort(function (a, b) { return a.targetBeat - b.targetBeat; });

        let moved = 0;
        let skippedRejected = analysis.points.length - accepted.length;
        let skippedNoSample = 0;
        let skippedNoWarpPoint = 0;

        for (let i = 0; i < accepted.length; i++) {
            const p = accepted[i];

            if (p.markerSampleTime < 0) {
                skippedNoSample += 1;
                continue;
            }

            const markers = Live.getWarpMarkersFromClip(clip);
            if (!markers) {
                skippedNoWarpPoint += 1;
                post("[snap " + i + "] could not refresh duplicate markers\n");
                continue;
            }

            const marker = Live.findNearestMarkerBySampleTime(
                markers,
                p.markerSampleTime,
                0.001
            );

            if (!marker) {
                skippedNoWarpPoint += 1;
                post(
                    "[snap " + i + "] no duplicate marker near sampleTime=" +
                    p.markerSampleTime + "\n"
                );
                continue;
            }

            const beatMarker = Utils.round(marker.beat_time, 7);
            const beatDistance = Utils.round(p.targetBeat - marker.beat_time, 7);

            post(
                "[snap " + i + "] currentBeat=" + beatMarker.toFixed(7) +
                ", targetBeat=" + p.targetBeat.toFixed(7) +
                ", beatDistance=" + beatDistance.toFixed(7) + "\n"
            );

            Live.moveWarpMarker(clip, beatMarker, beatDistance);
            moved += 1;
        }

        return {
            moved: moved,
            skippedRejected: skippedRejected,
            skippedNoSample: skippedNoSample,
            skippedNoWarpPoint: skippedNoWarpPoint
        };
    }

    export function analyze(
        gridBeats: number = 4,
        toleranceBeats: number = 0.5,
        startBeat: number = 0
    ): void {
        try {
            if (!State.state.initialized) {
                error("Device not initialized yet. Trigger init first.\n");
                return;
            }

            const originalClip = Live.clipInfo();
            if (!originalClip) {
                error("No detail clip selected.\n");
                return;
            }

            Live.inspect(originalClip);

            if (!(gridBeats > 0)) {
                error("gridBeats must be > 0\n");
                return;
            }

            if (!(toleranceBeats >= 0)) {
                error("toleranceBeats must be >= 0\n");
                return;
            }

            const result = buildAnalysisForClip(originalClip, gridBeats, toleranceBeats, startBeat);
            if (!result) return;

            post(
                "Analysis done. total=" + result.analysis.summary.totalTargets +
                ", accepted=" + result.analysis.summary.accepted +
                ", rejected=" + result.analysis.summary.rejected +
                ", meanAbsDriftBeats=" + result.analysis.summary.meanAbsDriftBeats +
                ", meanAbsDriftMs=" + result.analysis.summary.meanAbsDriftMs + "\n"
            );

            post(`analysis: ${JSON.stringify(result.analysis)}`);

            const preparedTrackName = result.analysis.clipName + "_prepared";
            const preparedTrack = Live.getOrCreateComparisonTrack(preparedTrackName);

            if (!preparedTrack) {
                error("Could not create or find prepared track.\n");
                return;
            }

            // const preparedClip = Live.duplicateOriginalClipToComparisonTrack(
            //     originalClip,
            //     preparedTrack,
            //     result.analysis.startTime,
            //     "prepared"
            // );

            const preparedClip = Live.duplicateOriginalClipToComparisonTrack(
                originalClip,
                preparedTrack,
                result.analysis.startTime
            );

            post("Created prepared clip at path: " + preparedClip.path + "\n");

            if (!preparedClip) {
                error("Could not create fresh prepared clip from original source file.\n");
                return;
            }

            // try {
            //     preparedClip.set("warping", 1);
            // } catch (e: any) {
            //     post("Could not force warping on prepared clip: " + String(e) + "\n");
            // }

            // const insertStats = Live.removeNonAcceptedWarpMarkers(preparedClip, result.analysis);

            // post(
            //     "Reinserted accepted warp markers. inserted=" + insertStats.inserted +
            //     ", failed=" + insertStats.failed + "\n"
            // );

            // // const preparedAnalysis = buildAnalysisForClip(
            // //     preparedClip,
            // //     gridBeats,
            // //     toleranceBeats,
            // //     startBeat
            // // );

            // // if (!preparedAnalysis) {
            // //     error("Failed to analyze prepared clip after reinserting warp markers.\n");
            // //     return;
            // // }

            // // State.state.lastAnalysis = preparedAnalysis.analysis;
            // // State.state.lastGraph = preparedAnalysis.graph;
            // // State.state.lastClipId = String(preparedClip.id);

            // post(
            //     "Prepared analysis stored. total=" + preparedAnalysis.analysis.summary.totalTargets +
            //     ", accepted=" + preparedAnalysis.analysis.summary.accepted +
            //     ", rejected=" + preparedAnalysis.analysis.summary.rejected +
            //     ", meanAbsDriftBeats=" + preparedAnalysis.analysis.summary.meanAbsDriftBeats +
            //     ", meanAbsDriftMs=" + preparedAnalysis.analysis.summary.meanAbsDriftMs + "\n"
            // );

            outlet(0, "graph_json", JSON.stringify(result.graph));

            // apply(preparedClip);
        } catch (e: any) {
            error("analyze() failed: " + String(e) + "\n");
        }
    }

    export function markers(): void {
        const clip = Live.clipInfo()!;
        Live.inspect(clip);
        const markers = Live.getWarpMarkersFromClip(clip);
        post(JSON.stringify(markers));
    }

    export function apply(clip: LiveAPI | null): void {
        try {
            if (!State.state.initialized) {
                error("Device not initialized yet. Trigger init first.\n");
                return;
            }

            if (!State.state.lastAnalysis) {
                error("No analysis available. Run analyze first.\n");
                return;
            }

            if (!Live.selectedClipMatchesLastAnalysis()) {
                error("Selected clip is not the same clip that was analyzed. Re-run analyze.\n");
                return;
            }

            // const originalClip = Live.clipInfo();
            // if (!originalClip) {
            //     error("No detail clip selected.\n");
            //     return;
            // }

            const analysis = State.state.lastAnalysis;
            const comparisonTrackName = analysis.clipName + "_quanted";
            const comparisonTrack = Live.getOrCreateComparisonTrack(comparisonTrackName);

            if (!comparisonTrack) {
                error("Could not create or find comparison track.\n");
                return;
            }

            const newClip = Live.duplicateOriginalClipToComparisonTrack(
                clip!,
                comparisonTrack,
                analysis.startTime
            );

            post("Created comparison clip at path: " + newClip.path + "\n");

            const snapStats = snapAcceptedMarkersToTargets(newClip, analysis);

            post(
                "Snap done on comparison clip. " +
                "moved=" + snapStats.moved +
                ", skippedRejected=" + snapStats.skippedRejected +
                ", skippedNoSample=" + snapStats.skippedNoSample +
                ", skippedNoWarpPoint=" + snapStats.skippedNoWarpPoint + "\n"
            );

            const afterResult = buildAnalysisForClip(
                newClip,
                analysis.gridBeats,
                analysis.toleranceBeats,
                analysis.clipStartBeat
            );

            if (afterResult) {
                State.state.lastAfterAnalysis = afterResult.analysis;
                State.state.lastAfterGraph = afterResult.graph;

                post(
                    "Post-snap analysis done. total=" + afterResult.analysis.summary.totalTargets +
                    ", accepted=" + afterResult.analysis.summary.accepted +
                    ", rejected=" + afterResult.analysis.summary.rejected +
                    ", meanAbsDriftBeats=" + afterResult.analysis.summary.meanAbsDriftBeats +
                    ", meanAbsDriftMs=" + afterResult.analysis.summary.meanAbsDriftMs + "\n"
                );

                outlet(0, "graph_after_json", JSON.stringify(afterResult.graph));
            }
        } catch (e: any) {
            error("apply() failed: " + String(e) + "\n");
        }
    }
}

function init(): void {
    Quant.init();
}

function bang(): void {
    Quant.bang();
}

function analyze(
    gridBeats?: number,
    toleranceBeats?: number,
    startBeat?: number,
): void {
    Quant.analyze(gridBeats, toleranceBeats, startBeat);
}

function apply(): void {
    Quant.apply(null);
}

function markers(): void {
    Quant.markers();
}

function clear_analysis(): void {
    Quant.clear_analysis();
}

function dump_graph(): void {
    Quant.dump_graph();
}