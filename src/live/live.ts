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

declare class Task {
    constructor(fn: Function, context?: any);
    interval: number;
    repeat(count?: number, delay?: number): void;
    schedule(delay?: number): void;
    cancel(): void;
}

outlets = 1;
inlets = 1;

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
        const detailClip = new LiveAPI(undefined, "live_set view detail_clip");
        if (detailClip && detailClip.id && Number(detailClip.id) !== 0) {
            return detailClip;
        }

        const selectedTrack = new LiveAPI(undefined, "live_set view selected_track");
        if (!selectedTrack || !selectedTrack.id || Number(selectedTrack.id) === 0) {
            return null;
        }

        const arrangementClipCount = selectedTrack.getcount("arrangement_clips");
        if (arrangementClipCount > 0) {
            const clip = new LiveAPI(undefined, selectedTrack.path + " arrangement_clips 0");
            if (clip && clip.id && Number(clip.id) !== 0) {
                return clip;
            }
        }

        const clipSlotCount = selectedTrack.getcount("clip_slots");
        for (let i = 0; i < clipSlotCount; i++) {
            const slot = new LiveAPI(undefined, selectedTrack.path + " clip_slots " + i);
            const hasClip = Utils.toNumber(Utils.lastValue(slot.get("has_clip")));
            if (hasClip === 1) {
                const clip = new LiveAPI(undefined, selectedTrack.path + " clip_slots " + i + " clip");
                if (clip && clip.id && Number(clip.id) !== 0) {
                    return clip;
                }
            }
        }

        return null;
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

    export function removeWarpMarker(
        clip: LiveAPI,
        beatTime: number,
    ): number {
        const res = JSON.stringify(clip.call("remove_warp_marker", beatTime.toFixed(7)));
        return (res === "[\"id\", 0]") ? 1 : 0;
    }

    export function removeNonAcceptedWarpMarkers(
        clip: LiveAPI,
        analysis: Model.AnalysisResult
    ): void {
        const markerBeats = Live.getWarpMarkersFromClip(clip)!.map((p) => p.beat_time);
        markerBeats.pop(); // last one is shadow

        const acceptedBeats = new Set(
            analysis.points
                .filter((p) => p.accepted)
                .map((p) => p.markerBeat)
        );

        const toRemove = markerBeats.filter((p) => !acceptedBeats.has(p));

        post(`num markers: ${markerBeats.length}`);
        post(`num accepted markers: ${acceptedBeats.size}`);
        post(`toRemove: ${toRemove.length}`);

        State.state.pendingRemoval = {
            clip: clip,
            beats: toRemove,
            index: 0,
            removed: 0,
            failed: 0
        };

        State.state.finalizePrepClip = clip;

        if (State.state.removalTask) {
            State.state.removalTask.cancel();
        }

        State.state.removalTask = new Task(removeNonAcceptedWarpMarkersBatch, Live);
        State.state.removalTask.schedule(1);
    }

    function removeNonAcceptedWarpMarkersBatch(): void {
        const pending = State.state.pendingRemoval;
        if (!pending) return;

        const batchSize = 100;
        const total = pending.beats.length;

        let processed = 0;
        while (processed < batchSize && pending.index < total) {
            const beat = pending.beats[pending.index];
            const ok = removeWarpMarker(pending.clip, beat);

            if (ok) pending.removed += 1;
            else pending.failed += 1;

            pending.index += 1;
            processed += 1;
        }

        const progress = total > 0 ? pending.index / total : 1;
        Utils.setProgress("Analyzing warp markers " + pending.index + "/" + total);

        if (pending.index < total) {
            State.state.removalTask!.schedule(3);
            return;
        }

        post(`Removed ${pending.removed} warp markers, failed ${pending.failed}\n`);

        State.state.pendingRemoval = null;
        if (State.state.removalTask) {
            State.state.removalTask.cancel();
            State.state.removalTask = null;
        }

        if (State.state.finalizePrepTask) {
            State.state.finalizePrepTask.cancel();
        }
        State.state.finalizePrepTask = new Task(Quant.finishPrep, Quant);
        State.state.finalizePrepTask.schedule(1);
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

    export function snapAcceptedMarkers(
        clip: LiveAPI,
        analysis: Model.AnalysisResult
    ): void {
        const accepted = analysis.points
            .filter(function (p) { return p.accepted && p.markerSampleTime > 0; })
            .sort(function (a, b) { return a.targetBeat - b.targetBeat; });

        State.state.pendingSnap = {
            clip: clip,
            accepted: accepted,
            index: 0,
            moved: 0,
            skippedRejected: analysis.points.length - accepted.length,
            skippedNoSample: 0,
            skippedNoWarpPoint: 0
        };

        State.state.finalizeSnapClip = clip;

        if (State.state.snapTask) {
            State.state.snapTask.cancel();
        }

        State.state.snapTask = new Task(snapAcceptedMarkersBatch, Live);
        State.state.snapTask.schedule(1);
    }

    function snapAcceptedMarkersBatch(): void {
        const pending = State.state.pendingSnap;
        if (!pending) return;

        const batchSize = 100;
        const total = pending.accepted.length;

        let processed = 0;
        while (processed < batchSize && pending.index < total) {
            const p = pending.accepted[pending.index];

            const beatMarker = Utils.round(p.markerBeat, 7);
            const beatDistance = Utils.round(p.targetBeat - p.markerBeat, 7);

            const ok = moveWarpMarker(pending.clip, beatMarker, beatDistance);
            if (ok) pending.moved += 1;
            else pending.skippedNoWarpPoint += 1;

            pending.index += 1;
            processed += 1;
        }

        const progress = total > 0 ? pending.index / total : 1;
        Utils.setProgress("Snapping warp markers " + pending.index + "/" + total);

        if (pending.index < total) {
            State.state.snapTask!.schedule(3);
            return;
        }

        post(
            "Snap done on comparison clip. " +
            "moved=" + pending.moved +
            ", skippedRejected=" + pending.skippedRejected +
            ", skippedNoSample=" + pending.skippedNoSample +
            ", skippedNoWarpPoint=" + pending.skippedNoWarpPoint + "\n"
        );

        State.state.pendingSnap = null;
        if (State.state.snapTask) {
            State.state.snapTask.cancel();
            State.state.snapTask = null;
        }

        if (State.state.finalizeSnapTask) {
            State.state.finalizeSnapTask.cancel();
        }
        State.state.finalizeSnapTask = new Task(Quant.finishSnap, Quant);
        State.state.finalizeSnapTask.schedule(1);
    }

    export function deleteTrackByName(trackName: string): boolean {
        const song = new LiveAPI(undefined, "live_set");
        const trackCount = song.getcount("tracks");

        for (let i = 0; i < trackCount; i++) {
            const track = new LiveAPI(undefined, "live_set tracks " + i);
            const name = Utils.toPropertyString(track.get("name"));

            if (name === trackName) {
                try {
                    song.call("delete_track", i);
                    post("Deleted track: " + trackName + "\n");
                    return true;
                } catch (e: any) {
                    post("Failed deleting track " + trackName + ": " + String(e) + "\n");
                    return false;
                }
            }
        }

        return false;
    }
}