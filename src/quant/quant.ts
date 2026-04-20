namespace State {
    export const state: Model.RuntimeState = {
        lastAnalysis: null,
        lastGraph: null,
        lastAfterAnalysis: null,
        lastAfterGraph: null,
        lastClipId: "",

        originalTrackId: "",
        originalClipId: "",

        progressText: "",

        pendingRemoval: null,
        pendingSnap: null,

        removalTask: null,
        snapTask: null,

        finalizePrepClip: null,
        finalizeSnapClip: null,
        finalizePrepTask: null,
        finalizeSnapTask: null,

        currentOutlierIndex: -1
    };
}

namespace Quant {
    export function clear(): void {
        const analysis = State.state.lastAnalysis;

        State.state.lastAnalysis = null;
        State.state.lastGraph = null;
        State.state.lastAfterAnalysis = null;
        State.state.lastAfterGraph = null;
        State.state.lastClipId = "";
        State.state.finalizePrepClip = null;
        State.state.finalizeSnapClip = null;

        if (State.state.removalTask) {
            State.state.removalTask.cancel();
            State.state.removalTask = null;
        }
        if (State.state.snapTask) {
            State.state.snapTask.cancel();
            State.state.snapTask = null;
        }
        if (State.state.finalizePrepTask) {
            State.state.finalizePrepTask.cancel();
            State.state.finalizePrepTask = null;
        }
        if (State.state.finalizeSnapTask) {
            State.state.finalizeSnapTask.cancel();
            State.state.finalizeSnapTask = null;
        }

        State.state.pendingRemoval = null;
        State.state.pendingSnap = null;

        if (analysis) {
            const preparedTrackName = analysis.clipName;
            const quantedTrackName = analysis.clipName.replace("prepared", "quanted");

            Live.deleteTrackByName(preparedTrackName);
            Live.deleteTrackByName(quantedTrackName);
        }

        State.state.currentOutlierIndex = -1;

        Utils.clearProgress();
    }

    export function prep(
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number
    ): void {
        post("prep");
        try {
            if (State.state.lastAnalysis) {
                post("analyze");
                analyze();
            }
            else {
                prepNew(gridBeats, toleranceBeats, startBeat);
            }

        } catch (e: any) {
            error("analyze() failed: " + String(e) + "\n");
        }
    }

    function prepNew(
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number
    ): void {
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

        post(`Analyzing fresh clip with beatgrid ${gridBeats} start beat ${startBeat} tolerance beats ${toleranceBeats}\n`);

        const originalClipName = Utils.toPropertyString(clip.get("name"));
        const originalTrack = Live.getTrackForClip(clip);
        if (!originalTrack) {
            error(`Failed to get track Id for clip ${clip.id} ${originalClipName}`);
            return;
        }
        State.state.originalTrackId = String(originalTrack.id);
        State.state.originalClipId = String(clip.id);

        const startTime = Utils.toNumber(Utils.lastValue(clip.get("start_time")));
        const preparedTrackName = originalClipName + "_prepared";
        const preparedTrack = Live.getOrCreateComparisonTrack(preparedTrackName);

        if (!preparedTrack) {
            error("Could not create prepared track.\n");
            return;
        }

        const preparedClip = Live.duplicateOriginalClipToComparisonTrack(
            clip,
            preparedTrack,
            startTime,
            `${originalClipName}_prepared`
        );

        Live.restoreViewToOriginalTrack();

        const result = Analysis.buildAnalysisForClip(preparedClip, gridBeats, toleranceBeats, startBeat);
        if (!result) return;

        State.state.lastAnalysis = result.analysis;
        State.state.lastGraph = result.graph;
        State.state.lastClipId = String(preparedClip.id);

        Utils.setProgress("Starting warp marker removal");
        Live.removeNonAcceptedWarpMarkers(preparedClip, result.analysis);
    }

    export function analyze(): void {
        try {
            if (!State.state.lastAnalysis) return;
            if (!State.state.finalizePrepClip) return;

            const clip = State.state.finalizePrepClip;
            post(`Analyzing clip ${clip.id}`);

            const previous = State.state.lastAnalysis;
            const result = Analysis.buildAnalysisForClip(
                clip,
                previous.gridBeats,
                previous.toleranceBeats,
                previous.analysisStartBeat
            );

            if (!result) return;

            State.state.lastAnalysis = result.analysis;
            State.state.lastGraph = result.graph;
            State.state.lastClipId = String(clip.id);

            outlet(0, "graph_json", JSON.stringify(result.graph));
            Utils.setProgress(
                `Done. Selected ${result.analysis.points.length} warp markers. ` +
                `Avg drift: ${result.analysis.summary.meanAbsDriftBeats.toFixed(2)} beats / ${result.analysis.summary.meanAbsDriftMs.toFixed(2)} ms`
            );
        } catch (e: any) {
            error("finishPrep() failed: " + String(e) + "\n");
        } finally {
            if (State.state.finalizePrepTask) {
                State.state.finalizePrepTask.cancel();
                State.state.finalizePrepTask = null;
            }
        }
    }

    export function snap(): void {
        try {
            if (!State.state.lastAnalysis) {
                error("No analysis available. Run analyze first.\n");
                Utils.setProgress("No analysis available, please run Prep first");
                return;
            }

            const preparedClip = new LiveAPI(undefined, "id " + State.state.lastClipId);
            if (!preparedClip || !preparedClip.id || Number(preparedClip.id) === 0) {
                error("Saved prepared clip could not be found.\n");
                Utils.setProgress("Prepared clip no longer exists, please run Prep again");
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

            Live.restoreViewToOriginalTrack();

            post("Created quanted clip at path: " + quantedClip.path + "\n");

            Live.snapAcceptedMarkers(quantedClip, analysis);
        } catch (e: any) {
            error("apply() failed: " + String(e) + "\n");
        }
    }

    export function finishSnap(): void {
        try {
            if (!State.state.lastAnalysis) return;
            if (!State.state.finalizeSnapClip) return;

            const clip = State.state.finalizeSnapClip;

            const previous = State.state.lastAnalysis;
            const result = Analysis.buildAnalysisForClip(
                clip,
                previous.gridBeats,
                previous.toleranceBeats,
                previous.analysisStartBeat
            );

            if (!result) return;

            State.state.lastAfterAnalysis = result.analysis;
            State.state.lastAfterGraph = result.graph;

            outlet(0, "graph_after_json", JSON.stringify(result.graph));
            Utils.setProgress(
                `Done. Snapped ${result.analysis.points.length} warp markers. ` +
                `Avg drift: ${result.analysis.summary.meanAbsDriftBeats.toFixed(2)} beats / ${result.analysis.summary.meanAbsDriftMs.toFixed(2)} ms`
            );
        } catch (e: any) {
            error("finishSnap() failed: " + String(e) + "\n");
        } finally {
            State.state.finalizeSnapClip = null;
            if (State.state.finalizeSnapTask) {
                State.state.finalizeSnapTask.cancel();
                State.state.finalizeSnapTask = null;
            }
        }
    }

    export function markers(): void {
        const clip = Live.clipInfo()!;
        Live.inspect(clip);
        const markers = Live.getWarpMarkersFromClip(clip);
        post(JSON.stringify(markers));
    }

    export function left(): void {
        if (!State.state.lastAnalysis) {
            Utils.setProgress("No analysis available, run prep first");
            return;
        }

        const outliers = Analysis.getOutlierPoints();
        if (outliers.length === 0) {
            State.state.currentOutlierIndex = -1;
            Utils.setProgress("No outliers found");
            return;
        }

        if (State.state.currentOutlierIndex < 0 || State.state.currentOutlierIndex >= outliers.length) {
            State.state.currentOutlierIndex = 0;
        } else if (State.state.currentOutlierIndex === 0) {
            State.state.currentOutlierIndex = outliers.length - 1;
        } else {
            State.state.currentOutlierIndex--;
        }

        showCurrentOutlierProgress();
    }

    export function right(): void {
        if (!State.state.lastAnalysis) {
            Utils.setProgress("No analysis available");
            return;
        }

        const outliers = Analysis.getOutlierPoints();
        if (outliers.length === 0) {
            State.state.currentOutlierIndex = -1;
            Utils.setProgress("No outliers found");
            return;
        }

        if (State.state.currentOutlierIndex < 0 || State.state.currentOutlierIndex >= outliers.length) {
            State.state.currentOutlierIndex = 0;
        } else if (State.state.currentOutlierIndex === outliers.length - 1) {
            State.state.currentOutlierIndex = 0;
        } else {
            State.state.currentOutlierIndex++;
        }

        showCurrentOutlierProgress();
    }

    function showCurrentOutlierProgress(): void {
        if (!State.state.lastAnalysis) return;
        const outliers = Analysis.getOutlierPoints();

        if (outliers.length === 0) {
            State.state.currentOutlierIndex = -1;
            Utils.setProgress("No outliers found");
            return;
        }

        if (State.state.currentOutlierIndex < 0 || State.state.currentOutlierIndex >= outliers.length) {
            State.state.currentOutlierIndex = 0;
        }

        const p = outliers[State.state.currentOutlierIndex];

        Utils.setProgress(
            "Outlier " +
            (State.state.currentOutlierIndex + 1) +
            "/" +
            outliers.length +
            " Reason: " +
            p.outlierReason +
            " | Beat: " +
            p.targetBeat.toFixed(2) +
            " | Drift: " +
            p.driftMs.toFixed(2) +
            " ms"
        );
    }
}

