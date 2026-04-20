namespace Analysis {
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

        let markerIndex = 0;
        let idx = 0;
        const lookaheadCount = 12;
        const lastUsableMarkerBeat = sourceMarkers[sourceMarkers.length - 1].beat_time;

        const points: Model.AnalysisPoint[] = [];

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
                reason: reason,
                outlier: false,
                outlierReason: "",
            });

            idx++;
        }

        detectDriftOutlierBeats(points, toleranceBeats);
        const outliers = points.filter((p) => p.outlier);

        const acceptedPoints = points.filter((p) => p.accepted);
        const allDriftBeats = points.map((p) => p.driftBeats);
        const allDriftMs = points.map((p) => p.driftMs);
        const absDriftBeats = points.map((p) => p.absDriftBeats);
        const absDriftMs = points.map((p) => Utils.abs(p.driftMs));

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
                outliers: outliers.length,
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
                ok: p.accepted,
                outlier: p.outlier
            }
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
            outliers: outliers.length,
            points: graphPoints
        };

        post(
            "Analysis on clip " + analysis.clipName + " done. " +
            "total=" + analysis.summary.totalTargets +
            ", accepted=" + analysis.summary.accepted +
            ", outliers=" + analysis.summary.outliers +
            ", rejected=" + analysis.summary.rejected +
            ", meanAbsDriftBeats=" + analysis.summary.meanAbsDriftBeats +
            ", meanAbsDriftMs=" + analysis.summary.meanAbsDriftMs + "\n"
        );

        return {
            analysis: analysis,
            graph: graph
        };
    }

    export function getOutlierPoints(): Model.AnalysisPoint[] {
        if (!State.state.lastAnalysis) return []
        return State.state.lastAnalysis.points.filter(p => p.outlier);
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

    function detectDriftOutlierBeats(
        points: Model.AnalysisPoint[],
        toleranceBeats: number
    ): void {
        const accepted = points.filter(function (p) { return p.accepted; });

        const eps = 0.0001;
        const ratio = 1.5;
        const minJump = Math.max(0.02, toleranceBeats * 0.25);

        for (let i = 1; i < accepted.length - 1; i++) {
            const prev = accepted[i - 1];
            const curr = accepted[i];
            const next = accepted[i + 1];

            const a = prev.driftBeats;
            const b = curr.driftBeats;
            const c = next.driftBeats;

            const absA = Math.abs(a);
            const absB = Math.abs(b);
            const absC = Math.abs(c);

            const reasons: string[] = [];

            const sameOuterSign =
                (a > eps && c > eps) || (a < -eps && c < -eps);

            const currOpposite =
                (b > eps && a < -eps && c < -eps) ||
                (b < -eps && a > eps && c > eps);

            const isolatedFlip = sameOuterSign && currOpposite;

            const localSpike =
                absB > ratio * Math.max(absA, eps) &&
                absB > ratio * Math.max(absC, eps) &&
                absB > minJump;

            const jumpFromPrev =
                Math.abs(b - a) > ratio * Math.max(absA, eps) &&
                Math.abs(b - a) > minJump;

            const kink =
                Math.abs(b - a) > minJump &&
                Math.abs(c - b) > minJump &&
                Math.abs(c - a) < minJump * 0.5;

            if (isolatedFlip) reasons.push("isolated flip")
            if (localSpike) reasons.push("local spike")
            if (jumpFromPrev) reasons.push("jump from previous");
            if (kink) reasons.push("kink");

            if (isolatedFlip || localSpike || jumpFromPrev || kink) {
                curr.outlier = true;
                curr.outlierReason = JSON.stringify(reasons.join(", "));
            }
        }
    }
}