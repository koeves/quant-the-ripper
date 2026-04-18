namespace State {
    export const state: Model.RuntimeState = {
        initialized: false,
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
    };
}

namespace Quant {
    export function init(): void {
        State.state.initialized = true;
        post("initialized\n");
    }

    export function bang(): void {
        post("ready\n");
    }

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

        Utils.clearProgress();
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

    export function buildAnalysisForClip(
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
            analysisStartBeat: (startBeat !== undefined) ? startBeat : 0,
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

        post(
            "Analysis on clip " + analysis.clipName + " done. " +
            "total=" + analysis.summary.totalTargets +
            ", accepted=" + analysis.summary.accepted +
            ", rejected=" + analysis.summary.rejected +
            ", meanAbsDriftBeats=" + analysis.summary.meanAbsDriftBeats +
            ", meanAbsDriftMs=" + analysis.summary.meanAbsDriftMs + "\n"
        );

        return {
            analysis: analysis,
            graph: graph
        };
    }

    export function prep(
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number
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

            post(`Running with beatgrid ${gridBeats} start beat ${startBeat} tolerance beats ${toleranceBeats}`);

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

            const result = buildAnalysisForClip(preparedClip, gridBeats, toleranceBeats, startBeat);
            if (!result) return;

            State.state.lastAnalysis = result.analysis;
            State.state.lastGraph = result.graph;
            State.state.lastClipId = String(preparedClip.id);

            Utils.setProgress("Starting warp marker removal");
            Live.removeNonAcceptedWarpMarkers(preparedClip, result.analysis);
        } catch (e: any) {
            error("analyze() failed: " + String(e) + "\n");
        }
    }

    export function finishPrep(): void {
        try {
            if (!State.state.lastAnalysis) return;
            if (!State.state.finalizePrepClip) return;

            const clip = State.state.finalizePrepClip;

            const previous = State.state.lastAnalysis;
            const result = buildAnalysisForClip(
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
            State.state.finalizePrepClip = null;
            if (State.state.finalizePrepTask) {
                State.state.finalizePrepTask.cancel();
                State.state.finalizePrepTask = null;
            }
        }
    }

    export function snap(): void {
        try {
            if (!State.state.initialized) {
                error("Device not initialized yet. Trigger init first.\n");
                return;
            }

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
            const result = buildAnalysisForClip(
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
}

