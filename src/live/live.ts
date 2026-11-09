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
        if (!Utils.DEBUG) return;
        const props = [
            "is_audio_clip", "is_arrangement_clip", "file_path", "sample_length", "sample_rate",
            "name", "start_marker", "end_marker", "warping", "warp_mode", "start_time",
        ];
        Utils.debug("clip path: " + clip.path);
        for (let i = 0; i < props.length; i++) {
            Utils.debug(props[i] + ": " + clip.get(props[i]));
        }
    }

    export function getSongTempo(): number {
        const song = new LiveAPI(undefined, "live_set");
        return Utils.numberProp(song, "tempo");
    }

    export function byId(id: string | number): LiveAPI | null {
        if (!Utils.isValidId(id)) return null;
        const obj = new LiveAPI(undefined, "id " + id);
        return Utils.isValidId(obj.id) ? obj : null;
    }

    /**
     * Returns the clip's warp markers sorted by beat time. The last entry of
     * Live's list is a hidden marker that is not shown in the UI and cannot be
     * moved or removed; it is kept here and dropped by the callers that need to.
     */
    export function getWarpMarkersFromClip(clip: LiveAPI): Model.WarpMarker[] | null {
        try {
            const raw = clip.get("warp_markers");
            const parsed = JSON.parse(Array.isArray(raw) ? raw.join(" ") : raw);

            if (!parsed || !Array.isArray(parsed.warp_markers)) {
                error(`got invalid warp markers: ${JSON.stringify(parsed)}\n`);
                return null;
            }

            Utils.debug(`parsed ${parsed.warp_markers.length} warp markers from clip ${clip.id}`);

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
            error("getWarpMarkersFromClip failed: " + String(e) + "\n");
            return null;
        }
    }

    /** The clip shown in Detail View. Falls back to the first arrangement clip of the selected track. */
    export function clipInfo(): LiveAPI | null {
        const detailClip = new LiveAPI(undefined, "live_set view detail_clip");
        if (detailClip && Utils.isValidId(detailClip.id)) {
            return detailClip;
        }

        const selectedTrack = new LiveAPI(undefined, "live_set view selected_track");
        if (!selectedTrack || !Utils.isValidId(selectedTrack.id)) {
            return null;
        }

        if (selectedTrack.getcount("arrangement_clips") > 0) {
            const clip = new LiveAPI(undefined, selectedTrack.path + " arrangement_clips 0");
            if (clip && Utils.isValidId(clip.id)) {
                return clip;
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

    /** Extracts the track index from a canonical path such as `live_set tracks 3 arrangement_clips 0`. */
    export function trackIndexFromPath(path: string): number {
        const m = String(path).match(/live_set tracks (\d+)/);
        return m ? Number(m[1]) : -1;
    }

    export function findTrackIndexById(trackId: string): number {
        if (!Utils.isValidId(trackId)) return -1;
        const song = new LiveAPI(undefined, "live_set");
        const count = song.getcount("tracks");
        for (let i = 0; i < count; i++) {
            const t = new LiveAPI(undefined, "live_set tracks " + i);
            if (String(t.id) === String(trackId)) return i;
        }
        return -1;
    }

    /**
     * Returns the track named `trackName`, creating an audio track at
     * `insertIndex` (or at the end when -1) if none exists.
     */
    export function getOrCreateComparisonTrack(trackName: string, insertIndex: number = -1): LiveAPI | null {
        const song = new LiveAPI(undefined, "live_set");
        const trackCountBefore = song.getcount("tracks");

        for (let i = 0; i < trackCountBefore; i++) {
            const t = new LiveAPI(undefined, "live_set tracks " + i);
            const name = Utils.toPropertyString(t.get("name"));
            if (name === trackName) {
                return t;
            }
        }

        const index = (insertIndex >= 0 && insertIndex <= trackCountBefore) ? insertIndex : -1;
        Utils.debug("Creating comparison track: " + trackName + " at index " + index);
        song.call("create_audio_track", index);

        const trackCountAfter = song.getcount("tracks");
        if (trackCountAfter <= trackCountBefore) return null;

        const newTrack = new LiveAPI(undefined, "live_set tracks " + (index >= 0 ? index : trackCountAfter - 1));
        newTrack.set("name", trackName);
        return newTrack;
    }

    export function findArrangementClipByStartTime(trackPath: string, startBeat: number): LiveAPI | null {
        const track = new LiveAPI(undefined, trackPath);
        const count = track.getcount("arrangement_clips");

        for (let i = 0; i < count; i++) {
            const c = new LiveAPI(undefined, trackPath + " arrangement_clips " + i);
            const st = Utils.numberProp(c, "start_time");
            if (Math.abs(st - startBeat) < 1e-4) {
                return c;
            }
        }

        return null;
    }

    /** Parses an `id N` reply from LiveAPI.call into a LiveAPI object. */
    function objectFromCallResult(res: any): LiveAPI | null {
        const parts = Array.isArray(res) ? res : String(res === undefined ? "" : res).split(" ");
        for (let i = 0; i + 1 < parts.length; i++) {
            if (String(parts[i]) === "id") return byId(parts[i + 1]);
        }
        return null;
    }

    export function duplicateClipToTrack(
        clip: LiveAPI,
        destinationTrack: LiveAPI,
        destinationTime: number,
        name: string,
    ): LiveAPI | null {
        const res = destinationTrack.call("duplicate_clip_to_arrangement", "id " + Number(clip.id), destinationTime);
        const created = objectFromCallResult(res) || findArrangementClipByStartTime(destinationTrack.path, destinationTime);
        if (!created) return null;
        created.set("name", name);
        return created;
    }

    /**
     * LiveAPI.call returns `id 0` for functions without a return value.
     * Compare without whitespace so both `["id",0]` and `["id", 0]` match.
     */
    function isVoidCallResult(res: any): boolean {
        return JSON.stringify(res).replace(/\s/g, "") === "[\"id\",0]";
    }

    export function moveWarpMarker(clip: LiveAPI, beatTime: number, beatTimeDistance: number): boolean {
        return isVoidCallResult(clip.call("move_warp_marker", beatTime.toFixed(7), beatTimeDistance.toFixed(7)));
    }

    export function removeWarpMarker(clip: LiveAPI, beatTime: number): boolean {
        return isVoidCallResult(clip.call("remove_warp_marker", beatTime.toFixed(7)));
    }

    export function cancelTask(task: Task | null): null {
        if (task) task.cancel();
        return null;
    }

    export function removeNonAcceptedWarpMarkers(clip: LiveAPI, analysis: Model.AnalysisResult): void {
        const markerBeats = Live.getWarpMarkersFromClip(clip)!.map((p) => p.beat_time);
        markerBeats.pop(); // hidden trailing marker

        const acceptedBeats = new Set(
            analysis.points
                .filter((p) => p.accepted)
                .map((p) => p.markerBeat)
        );

        const toRemove = markerBeats.filter((p) => !acceptedBeats.has(p));

        Utils.debug(`num markers: ${markerBeats.length}, accepted: ${acceptedBeats.size}, toRemove: ${toRemove.length}`);

        State.state.pendingRemoval = {
            clip: clip,
            beats: toRemove,
            index: 0,
            removed: 0,
            failed: 0
        };

        State.state.finalizePrepClip = clip;

        State.state.removalTask = cancelTask(State.state.removalTask);
        State.state.removalTask = new Task(removeNonAcceptedWarpMarkersBatch, Live);
        State.state.removalTask.schedule(1);
    }

    function removeNonAcceptedWarpMarkersBatch(): void {
        const pending = State.state.pendingRemoval;
        if (!pending) return;

        const batchSize = 500;
        const total = pending.beats.length;

        let processed = 0;
        while (processed < batchSize && pending.index < total) {
            const beat = pending.beats[pending.index];
            if (removeWarpMarker(pending.clip, beat)) pending.removed += 1;
            else pending.failed += 1;

            pending.index += 1;
            processed += 1;
        }

        Utils.setProgress("Removing unused warp markers " + pending.index + "/" + total);

        if (pending.index < total) {
            State.state.removalTask!.schedule(3);
            return;
        }

        post(`Removed ${pending.removed} warp markers, failed ${pending.failed}\n`);

        State.state.pendingRemoval = null;
        State.state.removalTask = cancelTask(State.state.removalTask);

        State.state.finalizePrepTask = cancelTask(State.state.finalizePrepTask);
        State.state.finalizePrepTask = new Task(Quant.analyze, Quant);
        State.state.finalizePrepTask.schedule(1);
    }

    /** Snaps the clip's accepted markers onto the grid; `strength` 0..1 moves them part of the way. */
    export function snapAcceptedMarkers(clip: LiveAPI, analysis: Model.AnalysisResult, strength: number = 1): void {
        const markers = getWarpMarkersFromClip(clip) || [];
        const beats = markers.slice(0, -1).map((m) => m.beat_time); // without the hidden marker
        const ops = Analysis.planSnap(analysis.points, beats, strength);
        const acceptedCount = analysis.points.filter((p) => p.accepted).length;

        State.state.pendingSnap = {
            clip: clip,
            ops: ops,
            index: 0,
            moved: 0,
            removed: 0,
            skippedRejected: analysis.points.length - acceptedCount,
            failed: 0
        };

        State.state.finalizeSnapClip = clip;

        State.state.snapTask = cancelTask(State.state.snapTask);
        State.state.snapTask = new Task(snapAcceptedMarkersBatch, Live);
        State.state.snapTask.schedule(1);
    }

    function snapAcceptedMarkersBatch(): void {
        const pending = State.state.pendingSnap;
        if (!pending) return;

        const batchSize = 100;
        const total = pending.ops.length;

        let processed = 0;
        while (processed < batchSize && pending.index < total) {
            const op = pending.ops[pending.index];
            if (op.op === "remove") {
                if (removeWarpMarker(pending.clip, op.beat)) pending.removed += 1;
                else pending.failed += 1;
            } else {
                if (moveWarpMarker(pending.clip, op.beat, op.distance)) pending.moved += 1;
                else pending.failed += 1;
            }
            pending.index += 1;
            processed += 1;
        }

        Utils.setProgress("Snapping warp markers " + pending.index + "/" + total);

        if (pending.index < total) {
            State.state.snapTask!.schedule(3);
            return;
        }

        post(
            "Snap done. moved=" + pending.moved +
            ", removed=" + pending.removed +
            ", skippedRejected=" + pending.skippedRejected +
            ", failed=" + pending.failed + "\n"
        );

        State.state.lastSnapMoved = pending.moved;
        State.state.pendingSnap = null;
        State.state.snapTask = cancelTask(State.state.snapTask);

        State.state.finalizeSnapTask = cancelTask(State.state.finalizeSnapTask);
        State.state.finalizeSnapTask = new Task(Quant.finishSnap, Quant);
        State.state.finalizeSnapTask.schedule(1);
    }

    export function deleteTrackById(trackId: string): boolean {
        const index = findTrackIndexById(trackId);
        if (index < 0) return false;

        try {
            new LiveAPI(undefined, "live_set").call("delete_track", index);
            Utils.debug("Deleted track id " + trackId);
            return true;
        } catch (e: any) {
            error("Failed deleting track " + trackId + ": " + String(e) + "\n");
            return false;
        }
    }

    export function getTrackForClip(clip: LiveAPI): LiveAPI | null {
        let index = trackIndexFromPath(clip.unquotedpath || clip.path);
        if (index < 0) {
            // Path was not canonical; resolve via the parent (clip slot -> track for session clips).
            let parent = new LiveAPI(undefined, clip.path + " canonical_parent");
            index = trackIndexFromPath(parent.unquotedpath || parent.path);
            if (index < 0 && Utils.isValidId(parent.id)) {
                parent = new LiveAPI(undefined, parent.path + " canonical_parent");
                index = trackIndexFromPath(parent.unquotedpath || parent.path);
            }
        }
        if (index < 0) return null;
        const track = new LiveAPI(undefined, "live_set tracks " + index);
        return Utils.isValidId(track.id) ? track : null;
    }

    export function restoreViewToOriginalTrack(): void {
        if (State.state.originalTrackId === "" || State.state.originalClipId === "") {
            error(`Failed to restore view because originalTrackId is ${State.state.originalTrackId} and originalClipId is ${State.state.originalClipId}\n`);
            return;
        }
        const view = new LiveAPI(undefined, "live_set view");
        view.set("selected_track", "id " + State.state.originalTrackId);
        view.set("detail_clip", "id " + State.state.originalClipId);
    }
}
