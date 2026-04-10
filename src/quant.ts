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

    export function ceilToStep(value: number, step: number): number {
        return Math.ceil(value / step) * step;
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

            post(`parsed ${parsed.warp_markers.length} warp markers from clip ${clip.id}`);

            const out: Model.WarpMarker[] = [];
            for (let i = 0; i < parsed.warp_markers.length; i++) {
                const item = parsed.warp_markers[i];
                if (item && typeof item === "object") {
                    out.push({
                        beat_time: Utils.round(Number(item.beat_time)),
                        sample_time: Utils.round(Number(item.sample_time)),
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

    export interface ForwardMatch {
        marker: Model.WarpMarker | null;
        markerIndex: number;
        distance: number;
    }

    export function findNearestForwardMarker(
        targetBeat: number,
        markers: Model.WarpMarker[],
        startIndex: number,
        lookaheadCount: number
    ): ForwardMatch {
        if (startIndex >= markers.length) {
            return {
                marker: null,
                markerIndex: -1,
                distance: Number.POSITIVE_INFINITY
            };
        }

        let i = startIndex;

        while (i + 1 < markers.length && markers[i + 1].beat_time <= targetBeat) {
            i++;
        }

        let best: Model.WarpMarker | null = null;
        let bestIndex = -1;
        let bestDist = Number.POSITIVE_INFINITY;

        const endIndex = Math.min(markers.length - 1, i + lookaheadCount);

        for (let j = startIndex; j <= endIndex; j++) {
            const d = Utils.abs(markers[j].beat_time - targetBeat);
            if (d < bestDist) {
                best = markers[j];
                bestIndex = j;
                bestDist = d;
            }

            if (markers[j].beat_time > targetBeat && d > bestDist) {
                break;
            }
        }

        return {
            marker: best,
            markerIndex: bestIndex,
            distance: bestDist
        };
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
        destinationTime: number,
        name: string,
    ): LiveAPI {
        destinationTrack.call("duplicate_clip_to_arrangement", "id " + Number(originalClip.id), destinationTime);
        const clip = findArrangementClipByStartTime(destinationTrack.path, destinationTime)!;
        clip.set("name", `${name}`);
        return clip
    }

    export function selectedClipIsAnalyzed(): boolean {
        const clip = clipInfo();
        if (!clip) return false;
        return (String(clip.id) === State.state.lastClipId) && (Utils.toPropertyString(clip.get("name")).includes("prepared"));
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

    export function moveWarpMarker(
        clip: LiveAPI,
        beatTime: number,
        beatTimeDistance: number
    ): number {
        const res = JSON.stringify(clip.call("move_warp_marker", beatTime.toFixed(7), beatTimeDistance.toFixed(7)));
        return (res === "[\"id\", 0]") ? 1 : 0;
    }

    function removeWarpMarker(
        clip: LiveAPI,
        beatTime: number,
    ): number {
        const res = JSON.stringify(clip.call("remove_warp_marker", beatTime.toFixed(7)));
        return (res === "[\"id\", 0]") ? 1 : 0;
    }

    export function removeNonAcceptedWarpMarkers(
        clip: LiveAPI,
        analysis: Model.AnalysisResult
    ): { removed: number; failed: number } {
        const markerBeats = Live.getWarpMarkersFromClip(clip)!.map((p) => p.beat_time);
        markerBeats.pop(); // last one is shadow

        let removed = 0;
        let failed = 0;

        const acceptedBeats = new Set(analysis.points
            .filter((p) => p.accepted).map((p) => p.markerBeat));

        const toRemove = markerBeats
            .filter(p => !acceptedBeats.has(p))

        post(`num markers: ${markerBeats.length}`);
        post(`num accepted markers: ${acceptedBeats.size}`);
        post(`toRemove: ${toRemove.length}`);

        toRemove
            .forEach(p => {
                const ok = removeWarpMarker(clip, p);
                if (ok) removed += 1;
                else failed += 1;
            });

        return { removed: removed, failed: failed };
    }

    export function findPreparedClipForOriginal(originalClip: LiveAPI): LiveAPI | null {
        const clipName = Utils.toPropertyString(originalClip.get("name"));
        const preparedTrack = getOrCreateComparisonTrack(clipName);

        if (!preparedTrack) {
            post("findPreparedClipForOriginal: could not find/create prepared track\n");
            return null;
        }

        const startTime = Utils.toNumber(Utils.lastValue(originalClip.get("start_time")));
        const preparedClip = findArrangementClipByStartTime(preparedTrack.path, startTime);

        if (!preparedClip) {
            post(
                "findPreparedClipForOriginal: no prepared clip found on track " +
                clipName +
                " at startTime=" + startTime + "\n"
            );
            return null;
        }

        return preparedClip;
    }

    export function snapAcceptedMarkersToTargets(
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

            const beatMarker = Utils.round(p.markerBeat, 7);
            const beatDistance = Utils.round(p.targetBeat - p.markerBeat, 7);

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
        startBeat?: number
    ): { analysis: Model.AnalysisResult; graph: Model.GraphPayload } | null {
        const validated = validateClipForAnalysis(clip);
        if (!validated) return null;

        const filePath = validated.filePath;
        const clipName = Utils.toPropertyString(clip.get("name"));
        const tempo = Live.getSongTempo();
        const arrangementStart = Utils.toNumber(Utils.lastValue(clip.get("start_time")));
        const clipStartBeat = Utils.toNumber(Utils.lastValue(clip.get("start_marker")));
        const clipEndBeat = Utils.toNumber(Utils.lastValue(clip.get("end_marker")));

        const sourceMarkers = Live.getWarpMarkersFromClip(clip);
        if (!sourceMarkers || sourceMarkers.length < 2) {
            error("Could not parse source warp markers.\n");
            return null;
        }

        post("Parsed " + sourceMarkers.length + " unique source warp markers\n");

        const points: Model.AnalysisPoint[] = [];
        let markerIndex = 0;
        let idx = 0;
        const lookaheadCount = 12;

        const lastUsableMarkerBeat = sourceMarkers[sourceMarkers.length - 1].beat_time;

        for (let targetBeat = (startBeat) ? startBeat : 0; targetBeat <= lastUsableMarkerBeat + toleranceBeats; targetBeat += gridBeats) {
            if (markerIndex >= sourceMarkers.length) break;

            const match = Live.findNearestForwardMarker(
                targetBeat,
                sourceMarkers,
                markerIndex,
                lookaheadCount
            );

            let markerBeat = targetBeat;
            let markerSampleTime = -1;
            let driftBeats = 0;
            let accepted = false;
            let reason = "no_marker";

            if (match.marker) {
                markerBeat = match.marker.beat_time;
                markerSampleTime = match.marker.sample_time;
                driftBeats = markerBeat - targetBeat;

                if (match.distance <= toleranceBeats) {
                    accepted = true;
                    reason = "accepted";
                    markerIndex = match.markerIndex + 1;
                } else {
                    accepted = false;
                    reason = "outside_tolerance";

                    // Move forward if marker is clearly behind target.
                    if (match.marker.beat_time < targetBeat) {
                        markerIndex = Math.max(markerIndex, match.markerIndex + 1);
                    }
                }
            }

            const driftMs = Live.beatsToMs(driftBeats, tempo);

            points.push({
                index: idx,
                targetBeat: Utils.round(targetBeat, 7),
                markerBeat: Utils.round(markerBeat, 7),
                markerSampleTime: Utils.round(markerSampleTime, 7),
                driftBeats: Utils.round(driftBeats, 7),
                driftMs: Utils.round(driftMs, 3),
                absDriftBeats: Utils.round(Utils.abs(driftBeats), 7),
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
                xBeat: p.targetBeat,
                yBeats: p.driftBeats,
                yMs: p.driftMs,
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

            const clip = Live.clipInfo();
            if (!clip) {
                error("No detail clip selected.\n");
                return;
            }

            Live.inspect(clip);

            if (!(gridBeats > 0)) {
                error("gridBeats must be > 0\n");
                return;
            }

            if (!(toleranceBeats >= 0)) {
                error("toleranceBeats must be >= 0\n");
                return;
            }

            const clipName = Utils.toPropertyString(clip.get("name"));
            const startTime = Utils.toNumber(Utils.lastValue(clip.get("start_time")));
            const preparedTrackName = clipName + "_prepared";
            const preparedTrack = Live.getOrCreateComparisonTrack(preparedTrackName);

            if (!preparedTrack) {
                error("Could not create or find prepared track.\n");
                return;
            }

            const preparedClip = Live.duplicateOriginalClipToComparisonTrack(
                clip,
                preparedTrack,
                startTime,
                `${clipName}_prepared`
            );

            const result = buildAnalysisForClip(preparedClip, gridBeats, toleranceBeats, startBeat);
            if (!result) return;

            State.state.lastAnalysis = result.analysis;
            State.state.lastGraph = result.graph;
            State.state.lastClipId = String(preparedClip.id);

            post(
                "Analysis done. total=" + result.analysis.summary.totalTargets +
                ", accepted=" + result.analysis.summary.accepted +
                ", rejected=" + result.analysis.summary.rejected +
                ", meanAbsDriftBeats=" + result.analysis.summary.meanAbsDriftBeats +
                ", meanAbsDriftMs=" + result.analysis.summary.meanAbsDriftMs + "\n"
            );

            outlet(0, "graph_json", JSON.stringify(result.graph));

            const { removed, failed } = Live.removeNonAcceptedWarpMarkers(preparedClip, result.analysis);
            post(`Removed ${removed} warp markers, failed ${failed}`);

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

    export function apply(): void {
        try {
            if (!State.state.initialized) {
                error("Device not initialized yet. Trigger init first.\n");
                return;
            }

            if (!State.state.lastAnalysis) {
                error("No analysis available. Run analyze first.\n");
                return;
            }

            if (!Live.selectedClipIsAnalyzed()) {
                error("Selected clip is not an analyzed clip\n");
                return;
            }

            const preparedClip = Live.clipInfo();
            if (!preparedClip) {
                error("No detail clip selected.\n");
                return;
            }

            const analysis = State.state.lastAnalysis;
            const quantedTrackName = analysis.clipName.replace("prepared", "quanted");
            const quantedTrack = Live.getOrCreateComparisonTrack(quantedTrackName);

            if (!quantedTrack) {
                error("Could not create or find quanted track.\n");
                return;
            }

            const quantedClip = Live.duplicateOriginalClipToComparisonTrack(
                preparedClip,
                quantedTrack,
                analysis.startTime,
                quantedTrackName
            );

            post("Created quanted clip at path: " + quantedClip.path + "\n");

            const snapStats = Live.snapAcceptedMarkersToTargets(quantedClip, analysis);

            post(
                "Snap done on comparison clip. " +
                "moved=" + snapStats.moved +
                ", skippedRejected=" + snapStats.skippedRejected +
                ", skippedNoSample=" + snapStats.skippedNoSample +
                ", skippedNoWarpPoint=" + snapStats.skippedNoWarpPoint + "\n"
            );

            const afterResult = buildAnalysisForClip(
                quantedClip,
                analysis.gridBeats,
                analysis.toleranceBeats
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
    Quant.apply();
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