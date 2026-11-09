namespace State {
    export const PREPARED_SUFFIX = "_prepared";
    export const QUANTED_SUFFIX = "_quanted";

    export function initialState(): Model.RuntimeState {
        return {
            lastAnalysis: null,
            lastGraph: null,
            lastAfterAnalysis: null,
            lastAfterGraph: null,
            lastClipId: "",

            originalTrackId: "",
            originalClipId: "",
            originalClipName: "",
            preparedTrackId: "",
            quantedTrackId: "",

            progressText: "",

            pendingRemoval: null,
            pendingSnap: null,

            removalTask: null,
            snapTask: null,

            finalizePrepClip: null,
            finalizeSnapClip: null,
            finalizePrepTask: null,
            finalizeSnapTask: null,

            lastSnapMoved: 0,

            currentOutlierIndex: -1
        };
    }

    export const state: Model.RuntimeState = initialState();

    export function reset(): void {
        const fresh = initialState();
        const target = state as any;
        for (const key in fresh) {
            target[key] = (fresh as any)[key];
        }
    }
}

namespace Quant {
    export function cancelTasks(): void {
        const s = State.state;
        s.removalTask = Live.cancelTask(s.removalTask);
        s.snapTask = Live.cancelTask(s.snapTask);
        s.finalizePrepTask = Live.cancelTask(s.finalizePrepTask);
        s.finalizeSnapTask = Live.cancelTask(s.finalizeSnapTask);
        s.pendingRemoval = null;
        s.pendingSnap = null;
    }

    function isBusy(): boolean {
        const s = State.state;
        return !!(s.pendingRemoval || s.pendingSnap || s.finalizePrepTask || s.finalizeSnapTask);
    }

    /** Deletes the _prepared and _quanted tracks created for the current clip and resets all state. */
    export function clear(): void {
        cancelTasks();

        const s = State.state;
        if (s.quantedTrackId) Live.deleteTrackById(s.quantedTrackId);
        if (s.preparedTrackId) Live.deleteTrackById(s.preparedTrackId);

        State.reset();
        Utils.clearProgress();
    }

    function sameParams(a: Model.AnalysisResult, gridBeats: number, toleranceBeats: number, startBeat: number): boolean {
        const eps = 1e-9;
        return Math.abs(a.gridBeats - gridBeats) < eps &&
            Math.abs(a.toleranceBeats - toleranceBeats) < eps &&
            Math.abs(a.analysisStartBeat - startBeat) < eps;
    }

    /**
     * Prep button.
     * - No previous analysis, or a different clip is selected: duplicate the
     *   selected clip to a new _prepared track and analyze it.
     * - Same clip, same parameters: re-analyze the _prepared clip, keeping
     *   manual warp marker edits.
     * - Same clip, changed parameters: rebuild the _prepared clip from the
     *   original so markers removed under the old settings come back.
     */
    export function prep(gridBeats: number, toleranceBeats: number, startBeat: number): void {
        try {
            gridBeats = Number(gridBeats);
            toleranceBeats = Number(toleranceBeats);
            startBeat = Number(startBeat) || 0;

            const invalid = Analysis.validateParams(gridBeats, toleranceBeats, startBeat);
            if (invalid) {
                Utils.fail(invalid);
                return;
            }

            if (isBusy()) {
                Utils.setProgress("Still working, please wait");
                return;
            }

            const s = State.state;
            const previous = s.lastAnalysis;
            const preparedClip = previous ? Live.byId(s.lastClipId) : null;
            const originalClip = previous ? Live.byId(s.originalClipId) : null;

            if (!previous || !preparedClip || !originalClip) {
                // Nothing analyzed yet, or the user deleted the clips: forget stale track ids.
                State.reset();
                prepNew(gridBeats, toleranceBeats, startBeat);
                return;
            }

            if (!ownsSelection(Live.clipInfo())) {
                // User moved on to another clip: leave the old tracks in place and start over.
                State.reset();
                prepNew(gridBeats, toleranceBeats, startBeat);
                return;
            }

            if (!sameParams(previous, gridBeats, toleranceBeats, startBeat)) {
                rebuildPrepared(originalClip, gridBeats, toleranceBeats, startBeat);
                return;
            }

            s.finalizePrepClip = preparedClip;
            analyze();
        } catch (e: any) {
            Utils.fail("Prep failed: " + String(e));
        }
    }

    /** True when the selected clip is the original, prepared or quanted clip of the current session. */
    function ownsSelection(selected: LiveAPI | null): boolean {
        if (!selected) return true;
        const s = State.state;
        const id = String(selected.id);
        if (id === s.originalClipId || id === s.lastClipId) return true;
        const track = Live.getTrackForClip(selected);
        return !!track && s.quantedTrackId !== "" && String(track.id) === s.quantedTrackId;
    }

    function rebuildPrepared(originalClip: LiveAPI, gridBeats: number, toleranceBeats: number, startBeat: number): void {
        const s = State.state;
        if (s.quantedTrackId) Live.deleteTrackById(s.quantedTrackId);
        if (s.preparedTrackId) Live.deleteTrackById(s.preparedTrackId);
        s.quantedTrackId = "";
        s.preparedTrackId = "";

        post("Settings changed, rebuilding prepared clip from original\n");
        prepNew(gridBeats, toleranceBeats, startBeat, originalClip);
    }

    function prepNew(gridBeats: number, toleranceBeats: number, startBeat: number, source?: LiveAPI): void {
        const clip = source || Live.clipInfo();
        if (!clip) {
            Utils.fail("No clip selected. Select an Arrangement audio clip");
            return;
        }

        Live.inspect(clip);

        const clipName = Utils.toPropertyString(clip.get("name"));
        if (clipName.endsWith(State.PREPARED_SUFFIX) || clipName.endsWith(State.QUANTED_SUFFIX)) {
            Utils.fail("Select the original clip, not a " + State.PREPARED_SUFFIX + "/" + State.QUANTED_SUFFIX + " copy");
            return;
        }

        // Validate before creating any tracks.
        if (!Analysis.buildAnalysisForClip(clip, gridBeats, toleranceBeats, startBeat)) return;

        post(`Analyzing fresh clip with grid ${gridBeats}, start beat ${startBeat}, tolerance ${toleranceBeats}\n`);

        const originalTrack = Live.getTrackForClip(clip);
        if (!originalTrack) {
            Utils.fail(`Could not find the track of clip ${clipName}`);
            return;
        }

        const s = State.state;
        s.originalTrackId = String(originalTrack.id);
        s.originalClipId = String(clip.id);
        s.originalClipName = clipName;

        const originalIndex = Live.findTrackIndexById(s.originalTrackId);
        const startTime = Utils.numberProp(clip, "start_time");
        const preparedName = clipName + State.PREPARED_SUFFIX;
        const preparedTrack = Live.getOrCreateComparisonTrack(preparedName, originalIndex >= 0 ? originalIndex + 1 : -1);

        if (!preparedTrack) {
            Utils.fail("Could not create the " + State.PREPARED_SUFFIX + " track");
            return;
        }
        s.preparedTrackId = String(preparedTrack.id);

        const preparedClip = Live.duplicateClipToTrack(clip, preparedTrack, startTime, preparedName);
        Live.restoreViewToOriginalTrack();

        if (!preparedClip) {
            Utils.fail("Could not duplicate the clip to the " + State.PREPARED_SUFFIX + " track");
            return;
        }

        const result = Analysis.buildAnalysisForClip(preparedClip, gridBeats, toleranceBeats, startBeat);
        if (!result) return;

        s.lastAnalysis = result.analysis;
        s.lastGraph = result.graph;
        s.lastClipId = String(preparedClip.id);

        Utils.setProgress("Removing unused warp markers");
        Live.removeNonAcceptedWarpMarkers(preparedClip, result.analysis);
    }

    /** Re-analyzes the prepared clip and sends the graph. Runs after marker removal and on re-Prep. */
    export function analyze(): void {
        const s = State.state;
        try {
            if (!s.lastAnalysis || !s.finalizePrepClip) return;

            const clip = s.finalizePrepClip;
            const previous = s.lastAnalysis;
            const result = Analysis.buildAnalysisForClip(
                clip,
                previous.gridBeats,
                previous.toleranceBeats,
                previous.analysisStartBeat
            );

            if (!result) return;

            s.lastAnalysis = result.analysis;
            s.lastGraph = result.graph;
            s.lastClipId = String(clip.id);
            s.lastAfterAnalysis = null;
            s.lastAfterGraph = null;
            s.currentOutlierIndex = -1;

            outlet(0, "graph_json", JSON.stringify(result.graph));
            const sum = result.analysis.summary;
            Utils.setProgress(
                `Done. Kept ${sum.accepted}/${sum.totalTargets} markers, ${sum.outliers} outliers. ` +
                `Avg drift: ${sum.meanAbsDriftBeats.toFixed(3)} beats / ${sum.meanAbsDriftMs.toFixed(2)} ms`
            );
        } catch (e: any) {
            Utils.fail("Analysis failed: " + String(e));
        } finally {
            s.finalizePrepTask = Live.cancelTask(s.finalizePrepTask);
        }
    }

    /** Snap button: duplicates the prepared clip to a _quanted track and moves accepted markers onto the grid. */
    export function snap(): void {
        const s = State.state;
        try {
            if (!s.lastAnalysis) {
                Utils.fail("No analysis available, please run Prep first");
                return;
            }

            if (isBusy()) {
                Utils.setProgress("Still working, please wait");
                return;
            }

            const preparedClip = Live.byId(s.lastClipId);
            if (!preparedClip) {
                Utils.fail("Prepared clip no longer exists, please run Prep again");
                return;
            }

            // Re-analyze so manual edits made on the prepared clip since the last Prep are used.
            const previous = s.lastAnalysis;
            const fresh = Analysis.buildAnalysisForClip(
                preparedClip, previous.gridBeats, previous.toleranceBeats, previous.analysisStartBeat
            );
            if (!fresh) return;
            s.lastAnalysis = fresh.analysis;
            s.lastGraph = fresh.graph;

            const quantedName = (s.originalClipName || previous.clipName.replace(new RegExp(State.PREPARED_SUFFIX + "$"), "")) + State.QUANTED_SUFFIX;
            const preparedIndex = Live.findTrackIndexById(s.preparedTrackId);
            const quantedTrack = Live.getOrCreateComparisonTrack(quantedName, preparedIndex >= 0 ? preparedIndex + 1 : -1);

            if (!quantedTrack) {
                Utils.fail("Could not create the " + State.QUANTED_SUFFIX + " track");
                return;
            }
            s.quantedTrackId = String(quantedTrack.id);

            const quantedClip = Live.duplicateClipToTrack(preparedClip, quantedTrack, fresh.analysis.startTime, quantedName);
            Live.restoreViewToOriginalTrack();

            if (!quantedClip) {
                Utils.fail("Could not duplicate the clip to the " + State.QUANTED_SUFFIX + " track");
                return;
            }

            Utils.debug("Created quanted clip at path: " + quantedClip.path);
            Live.snapAcceptedMarkers(quantedClip, fresh.analysis);
        } catch (e: any) {
            Utils.fail("Snap failed: " + String(e));
        }
    }

    export function finishSnap(): void {
        const s = State.state;
        try {
            if (!s.lastAnalysis || !s.finalizeSnapClip) return;

            const clip = s.finalizeSnapClip;
            const previous = s.lastAnalysis;
            const result = Analysis.buildAnalysisForClip(
                clip,
                previous.gridBeats,
                previous.toleranceBeats,
                previous.analysisStartBeat
            );

            if (!result) return;

            s.lastAfterAnalysis = result.analysis;
            s.lastAfterGraph = result.graph;

            outlet(0, "graph_after_json", JSON.stringify(result.graph));
            const sum = result.analysis.summary;
            Utils.setProgress(
                `Done. Snapped ${s.lastSnapMoved} warp markers. ` +
                `Avg drift: ${sum.meanAbsDriftBeats.toFixed(3)} beats / ${sum.meanAbsDriftMs.toFixed(2)} ms`
            );
        } catch (e: any) {
            Utils.fail("Snap failed: " + String(e));
        } finally {
            s.finalizeSnapClip = null;
            s.finalizeSnapTask = Live.cancelTask(s.finalizeSnapTask);
        }
    }

    function stepOutlier(direction: number): void {
        const s = State.state;
        if (!s.lastAnalysis) {
            Utils.setProgress("No analysis available, run Prep first");
            return;
        }

        if (s.lastAfterAnalysis) return;

        const outliers = Analysis.getOutlierPoints();
        if (outliers.length === 0) {
            s.currentOutlierIndex = -1;
            Utils.setProgress("No outliers found");
            return;
        }

        const n = outliers.length;
        if (s.currentOutlierIndex < 0 || s.currentOutlierIndex >= n) {
            // Same convention as the graph: right starts at the first outlier, left at the last.
            s.currentOutlierIndex = direction > 0 ? 0 : n - 1;
        } else {
            s.currentOutlierIndex = (s.currentOutlierIndex + direction + n) % n;
        }

        const p = outliers[s.currentOutlierIndex];
        try {
            Live.jumpToClipBeat(s.lastAnalysis, p.markerBeat);
        } catch (e: any) {
            Utils.debug("jumpToClipBeat failed: " + String(e));
        }
        showOutlier(p, s.currentOutlierIndex, n);
    }

    export function left(): void {
        stepOutlier(-1);
    }

    export function right(): void {
        stepOutlier(1);
    }

    function showOutlier(p: Model.AnalysisPoint, index: number, total: number): void {
        Utils.setProgress(
            "Outlier " + (index + 1) + "/" + total +
            " Reason: " + p.outlierReason +
            " | Beat: " + p.targetBeat.toFixed(2) +
            " | Drift: " + p.driftMs.toFixed(2) + " ms"
        );
    }
}
