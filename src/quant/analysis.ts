namespace Analysis {
    export interface ForwardMatch {
        marker: Model.WarpMarker | null;
        markerIndex: number;
        distance: number;
    }

    export interface GridMatch {
        targetBeat: number;
        marker: Model.WarpMarker | null;
        accepted: boolean;
        reason: string;
    }

    /** How many markers past the target to look at when searching for the closest one. */
    const LOOKAHEAD = 12;

    export function findNearestForwardMarker(
        targetBeat: number,
        markers: Model.WarpMarker[],
        startIndex: number,
        lookaheadCount: number
    ): ForwardMatch {
        if (startIndex >= markers.length) {
            return { marker: null, markerIndex: -1, distance: Number.POSITIVE_INFINITY };
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

        return { marker: best, markerIndex: bestIndex, distance: bestDist };
    }

    /**
     * Walks the target grid (startBeat + k * gridBeats) and picks, for each
     * grid point, the closest not-yet-used marker. A marker is accepted when it
     * lies within `toleranceBeats` of the grid point. Pure: no LiveAPI access.
     */
    export function matchGrid(
        markers: Model.WarpMarker[],
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number
    ): GridMatch[] {
        const out: GridMatch[] = [];
        if (!markers.length || !(gridBeats > 0)) return out;

        const lastMarkerBeat = markers[markers.length - 1].beat_time;
        let markerIndex = 0;

        // Compute each target from its index rather than accumulating, so
        // floating point error does not build up over long tracks.
        for (let k = 0; ; k++) {
            const targetBeat = Utils.round(startBeat + k * gridBeats, 7);
            if (targetBeat > lastMarkerBeat + toleranceBeats) break;
            if (markerIndex >= markers.length) break;

            const match = findNearestForwardMarker(targetBeat, markers, markerIndex, LOOKAHEAD);

            let accepted = false;
            let reason = "no_marker";

            if (match.marker) {
                if (match.distance <= toleranceBeats + 1e-9) {
                    accepted = true;
                    reason = "accepted";
                    markerIndex = match.markerIndex + 1;
                } else {
                    reason = "outside_tolerance";
                    // Move forward if the marker is clearly behind the target.
                    if (match.marker.beat_time < targetBeat) {
                        markerIndex = Math.max(markerIndex, match.markerIndex + 1);
                    }
                }
            }

            out.push({ targetBeat: targetBeat, marker: match.marker, accepted: accepted, reason: reason });
        }

        return out;
    }

    export function validateParams(gridBeats: number, toleranceBeats: number, startBeat: number): string | null {
        if (!(gridBeats > 0)) return "Grid must be greater than 0";
        if (!(toleranceBeats >= 0)) return "Tolerance must be 0 or greater";
        if (!(toleranceBeats < gridBeats / 2)) return "Tolerance must be less than half the grid";
        if (!(startBeat >= 0)) return "Start beat must be 0 or greater";
        return null;
    }

    export function buildAnalysisForClip(
        clip: LiveAPI,
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number = 0
    ): { analysis: Model.AnalysisResult; graph: Model.GraphPayload } | null {
        const validated = validateClipForAnalysis(clip);
        if (!validated) return null;

        const clipName = Utils.toPropertyString(clip.get("name"));
        const tempo = Live.getSongTempo();
        const arrangementStart = Utils.numberProp(clip, "start_time");
        const clipStartBeat = Utils.numberProp(clip, "start_marker");
        const clipEndBeat = Utils.numberProp(clip, "end_marker");

        const allMarkers = Live.getWarpMarkersFromClip(clip);
        // Drop Live's hidden trailing marker: it is not visible and cannot be moved.
        const sourceMarkers = allMarkers ? allMarkers.slice(0, -1) : null;
        if (!sourceMarkers || sourceMarkers.length < 2) {
            Utils.fail("Not enough warp markers. Insert warp markers on the clip's transients first");
            return null;
        }

        Utils.debug("Parsed " + sourceMarkers.length + " source warp markers");

        const matches = matchGrid(sourceMarkers, gridBeats, toleranceBeats, startBeat);
        const points: Model.AnalysisPoint[] = matches.map(function (m, idx) {
            const markerBeat = m.marker ? m.marker.beat_time : m.targetBeat;
            const markerSampleTime = m.marker ? m.marker.sample_time : -1;
            const driftBeats = m.marker ? markerBeat - m.targetBeat : 0;
            return {
                index: idx,
                targetBeat: m.targetBeat,
                markerBeat: Utils.round(markerBeat, 7),
                markerSampleTime: Utils.round(markerSampleTime, 7),
                driftBeats: Utils.round(driftBeats, 7),
                driftMs: Utils.round(Live.beatsToMs(driftBeats, tempo), 3),
                absDriftBeats: Utils.round(Utils.abs(driftBeats), 7),
                accepted: m.accepted,
                reason: m.reason,
                outlier: false,
                outlierReason: "",
            };
        });

        detectDriftOutliers(points, toleranceBeats);
        const outliers = points.filter((p) => p.outlier);

        // Drift statistics only cover markers that are actually kept and snapped.
        const acceptedPoints = points.filter((p) => p.accepted);
        const driftBeats = acceptedPoints.map((p) => p.driftBeats);
        const driftMs = acceptedPoints.map((p) => p.driftMs);

        const analysis: Model.AnalysisResult = {
            clipName: clipName,
            clipPath: clip.path,
            filePath: validated.filePath,
            tempo: Utils.round(tempo, 6),
            gridBeats: gridBeats,
            toleranceBeats: toleranceBeats,
            analysisStartBeat: startBeat,
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
                minDriftBeats: Utils.round(Utils.min(driftBeats), 6),
                maxDriftBeats: Utils.round(Utils.max(driftBeats), 6),
                meanAbsDriftBeats: Utils.round(Utils.mean(driftBeats.map(Utils.abs)), 6),
                minDriftMs: Utils.round(Utils.min(driftMs), 3),
                maxDriftMs: Utils.round(Utils.max(driftMs), 3),
                meanAbsDriftMs: Utils.round(Utils.mean(driftMs.map(Utils.abs)), 3)
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
            };
        });

        const graph: Model.GraphPayload = {
            clipName: clipName,
            tempo: Utils.round(tempo, 6),
            gridBeats: gridBeats,
            toleranceBeats: Utils.round(toleranceBeats, 6),
            toleranceMs: Utils.round(Live.beatsToMs(toleranceBeats, tempo), 3),
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

        return { analysis: analysis, graph: graph };
    }

    export function getOutlierPoints(): Model.AnalysisPoint[] {
        if (!State.state.lastAnalysis) return [];
        return State.state.lastAnalysis.points.filter(p => p.outlier);
    }

    function validateClipForAnalysis(clip: LiveAPI): { filePath: string } | null {
        if (Utils.numberProp(clip, "is_audio_clip") !== 1) {
            Utils.fail("Selected clip is not an audio clip");
            return null;
        }

        if (Utils.numberProp(clip, "is_arrangement_clip") !== 1) {
            Utils.fail("Selected clip is not an Arrangement clip");
            return null;
        }

        if (Utils.numberProp(clip, "warping") !== 1) {
            Utils.fail("Warp is off for the selected clip. Enable Warp and insert warp markers first");
            return null;
        }

        const filePath = Utils.toPropertyString(clip.get("file_path"));
        if (!filePath) {
            Utils.fail("Could not read the clip's sample file");
            return null;
        }

        return { filePath: filePath };
    }

    /**
     * Flags accepted points whose drift does not fit their neighbours.
     * Only accepted points are considered, and the first/last accepted point
     * is never flagged because it has only one neighbour.
     */
    export function detectDriftOutliers(points: Model.AnalysisPoint[], toleranceBeats: number): void {
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

            const sameOuterSign = (a > eps && c > eps) || (a < -eps && c < -eps);
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

            const reasons: string[] = [];
            if (isolatedFlip) reasons.push("isolated flip");
            if (localSpike) reasons.push("local spike");
            if (jumpFromPrev) reasons.push("jump from previous");
            if (kink) reasons.push("kink");

            if (reasons.length) {
                curr.outlier = true;
                curr.outlierReason = reasons.join(", ");
            }
        }
    }
}
