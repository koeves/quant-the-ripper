/* 
  Max for Live / Ableton Live - drift analyze preview

  Usage:
    init
    analyze 4 0.5 0 128

  Meaning:
    analyze <gridBeats> <toleranceBeats> <startBeat> <maxPoints>

  outlet 0:
    "analysis_json" <json-string>
    "graph_json"    <json-string>
*/

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
        lastClipId: string;
    }
}

namespace State {
    export const state: Model.RuntimeState = {
        initialized: false,
        lastAnalysis: null,
        lastGraph: null,
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

    export function round(n: number, digits: number = 6): number {
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
            post(`getWarpMarkersFromClip failed: ${String(e)}\n`);
            return null;
        }
    }

    export function dedupeWarpMarkers(markers: Model.WarpMarker[]): Model.WarpMarker[] {
        const out: Model.WarpMarker[] = [];
        const seen: { [key: string]: boolean } = {};

        for (let i = 0; i < markers.length; i++) {
            const m = markers[i];
            const key = `${Utils.round(m.sample_time, 6)}|${Utils.round(m.beat_time, 6)}`;
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
        usedSampleTimes: { [key: string]: boolean },
        toleranceBeats: number
    ): { marker: Model.WarpMarker | null; distance: number } {
        let best: Model.WarpMarker | null = null;
        let bestDist = Number.POSITIVE_INFINITY;

        for (let i = 0; i < markers.length; i++) {
            const wm = markers[i];
            const sampleKey = String(Utils.round(wm.sample_time, 6));
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

    export function analyze(
        gridBeats: number = 4,
        toleranceBeats: number = 0.5,
        startBeat: number = 0,
    ): void {
        try {
            if (!State.state.initialized) {
                error("Device not initialized yet. Trigger init first.\n");
                return;
            }

            const clip = Live.clipInfo();
            if (!clip) {
                error("No detail clip selected.\n");
                return;
            }

            const isAudio = Utils.toNumber(Utils.lastValue(clip.get("is_audio_clip")));
            const isArrangement = Utils.toNumber(Utils.lastValue(clip.get("is_arrangement_clip")));

            if (isAudio !== 1) {
                error("Selected detail clip is not an audio clip.\n");
                return;
            }

            if (isArrangement !== 1) {
                error("Selected detail clip is not an Arrangement clip.\n");
                return;
            }

            Live.inspect(clip);

            const filePath = Utils.toPropertyString(clip.get("file_path"));
            if (!filePath) {
                error("Could not read file_path from clip.\n");
                return;
            }

            const clipName = Utils.toPropertyString(clip.get("name"));
            const tempo = Live.getSongTempo();
            const clipStartBeat = Utils.toNumber(Utils.lastValue(clip.get("start_marker")));
            const clipEndBeat = Utils.toNumber(Utils.lastValue(clip.get("end_marker")));

            if (!(gridBeats > 0)) {
                error("gridBeats must be > 0\n");
                return;
            }

            if (!(toleranceBeats >= 0)) {
                error("toleranceBeats must be >= 0\n");
                return;
            }

            const rawMarkers = Live.getWarpMarkersFromClip(clip);
            if (!rawMarkers || rawMarkers.length < 2) {
                error("Could not parse source warp markers.\n");
                return;
            }

            const sourceMarkers = Live.dedupeWarpMarkers(rawMarkers);
            post(`Parsed ${sourceMarkers.length} unique source warp markers\n`);

            if (sourceMarkers.length < 8) {
                post("Warning: very few warp markers found. Did you add warp markers at transients in the UI?\n");
            }

            const firstBeat = Math.max(startBeat, clipStartBeat);
            const usedSampleTimes: { [key: string]: boolean } = {};
            const points: Model.AnalysisPoint[] = [];

            let idx = 0;
            for (let targetBeat = firstBeat; targetBeat <= clipEndBeat + 1e-9; targetBeat += gridBeats) {
                const nearest = Live.findNearestUnusedWarpMarkerAroundBeat(
                    targetBeat,
                    sourceMarkers,
                    usedSampleTimes,
                    toleranceBeats
                );

                let accepted = false;
                let markerBeat = targetBeat;
                let markerSampleTime = -1;
                let reason = "no_marker";
                let driftBeats = 0;

                if (!nearest.marker) {
                    accepted = false;
                    reason = "no_marker";
                    driftBeats = 0;
                } else {
                    markerBeat = nearest.marker.beat_time;
                    markerSampleTime = nearest.marker.sample_time;
                    driftBeats = markerBeat - targetBeat;

                    if (nearest.distance <= toleranceBeats) {
                        accepted = true;
                        reason = "accepted";
                        const sampleKey = String(Utils.round(nearest.marker.sample_time, 6));
                        usedSampleTimes[sampleKey] = true;
                    } else {
                        accepted = false;
                        reason = "outside_tolerance";
                    }
                }

                const driftMs = Live.beatsToMs(driftBeats, tempo);

                const point: Model.AnalysisPoint = {
                    index: idx,
                    targetBeat: Utils.round(targetBeat, 6),
                    markerBeat: Utils.round(markerBeat, 6),
                    markerSampleTime: Utils.round(markerSampleTime, 6),
                    driftBeats: Utils.round(driftBeats, 6),
                    driftMs: Utils.round(driftMs, 3),
                    absDriftBeats: Utils.round(Utils.abs(driftBeats), 6),
                    accepted,
                    reason,
                };

                points.push(point);

                post(
                    `[analyze ${idx}] targetBeat=${point.targetBeat}, markerBeat=${point.markerBeat}, ` +
                    `driftBeats=${point.driftBeats}, driftMs=${point.driftMs}, accepted=${point.accepted}, reason=${point.reason}\n`
                );
            }

            const acceptedPoints = points.filter((p) => p.accepted);
            const allDriftBeats = points.map((p) => p.driftBeats);
            const allDriftMs = points.map((p) => p.driftMs);
            const absDriftBeats = points.map((p) => p.absDriftBeats);
            const absDriftMs = points.map((p) => Utils.abs(p.driftMs));

            const analysis: Model.AnalysisResult = {
                clipName,
                clipPath: clip.path,
                filePath,
                tempo: Utils.round(tempo, 6),
                gridBeats,
                toleranceBeats,
                clipStartBeat: Utils.round(clipStartBeat, 6),
                clipEndBeat: Utils.round(clipEndBeat, 6),
                points,
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
                    meanAbsDriftMs: Utils.round(Utils.mean(absDriftMs), 3),
                }
            };

            const graphPoints: Model.GraphPoint[] = points.map((p) => ({
                i: p.index,
                xBeat: p.targetBeat,
                yBeats: p.driftBeats,
                yMs: p.driftMs,
                ok: p.accepted
            }));

            const toleranceMs = Live.beatsToMs(toleranceBeats, tempo);

            const graph: Model.GraphPayload = {
                clipName,
                tempo: Utils.round(tempo, 6),
                gridBeats,
                toleranceBeats: Utils.round(toleranceBeats, 6),
                toleranceMs: Utils.round(toleranceMs, 3),
                xMin: graphPoints.length ? graphPoints[0].xBeat : 0,
                xMax: graphPoints.length ? graphPoints[graphPoints.length - 1].xBeat : 0,
                yMinBeats: Utils.round(Utils.min(graphPoints.map((p) => p.yBeats)), 6),
                yMaxBeats: Utils.round(Utils.max(graphPoints.map((p) => p.yBeats)), 6),
                yMinMs: Utils.round(Utils.min(graphPoints.map((p) => p.yMs)), 3),
                yMaxMs: Utils.round(Utils.max(graphPoints.map((p) => p.yMs)), 3),
                accepted: acceptedPoints.length,
                rejected: points.length - acceptedPoints.length,
                points: graphPoints
            };

            State.state.lastAnalysis = analysis;
            State.state.lastGraph = graph;
            State.state.lastClipId = String(clip.id);

            post(
                `Analysis done. total=${analysis.summary.totalTargets}, ` +
                `accepted=${analysis.summary.accepted}, rejected=${analysis.summary.rejected}, ` +
                `meanAbsDriftBeats=${analysis.summary.meanAbsDriftBeats}, ` +
                `meanAbsDriftMs=${analysis.summary.meanAbsDriftMs}\n`
            );

            outlet(0, "graph_json", JSON.stringify(graph));
        } catch (e: any) {
            error(`analyze() failed: ${String(e)}\n`);
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

function clear_analysis(): void {
    Quant.clear_analysis();
}

function dump_graph(): void {
    Quant.dump_graph();
}