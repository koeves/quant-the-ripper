namespace Analysis {
    export interface ForwardMatch {
        marker: Model.WarpMarker | null;
        markerIndex: number;
        distance: number;
    }

    export interface GridMatch {
        targetBeat: number;
        /** Predicted drift at this grid point; the marker is searched around targetBeat + this. */
        expectedDrift: number;
        marker: Model.WarpMarker | null;
        accepted: boolean;
        reason: string;
    }

    /** How many markers past the target to look at when searching for the closest one. */
    const LOOKAHEAD = 12;
    /** Accepted markers used to predict the next drift value. */
    const DRIFT_HISTORY = 8;
    /** Largest drift slope the tracker will follow: beats of drift per beat (2% speed change). */
    const MAX_DRIFT_SLOPE = 0.02;

    interface DriftSample { t: number; d: number; }

    /**
     * Predicts the drift at `beat` from recent accepted markers with a
     * least-squares line, so slowly changing speed (vinyl wow, a rip that is
     * slightly off tempo) is followed instead of falling out of tolerance.
     */
    export function predictDrift(history: DriftSample[], beat: number): number {
        const n = history.length;
        if (n === 0) return 0;
        if (n === 1) return history[0].d;

        let mt = 0, md = 0;
        for (let i = 0; i < n; i++) { mt += history[i].t; md += history[i].d; }
        mt /= n; md /= n;

        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
            const dt = history[i].t - mt;
            num += dt * (history[i].d - md);
            den += dt * dt;
        }
        let slope = den > 0 ? num / den : 0;
        slope = Math.max(-MAX_DRIFT_SLOPE, Math.min(MAX_DRIFT_SLOPE, slope));
        return md + slope * (beat - mt);
    }

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
     * lies within `toleranceBeats` of where it is expected: the grid point
     * itself, or with `trackDrift` the grid point shifted by the drift
     * predicted from earlier accepted markers. Pure: no LiveAPI access.
     */
    export function matchGrid(
        markers: Model.WarpMarker[],
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number,
        trackDrift: boolean = false
    ): GridMatch[] {
        const out: GridMatch[] = [];
        if (!markers.length || !(gridBeats > 0)) return out;

        const lastMarkerBeat = markers[markers.length - 1].beat_time;
        const history: DriftSample[] = [];
        let markerIndex = 0;

        // Compute each target from its index rather than accumulating, so
        // floating point error does not build up over long tracks.
        for (let k = 0; ; k++) {
            const targetBeat = Utils.round(startBeat + k * gridBeats, 7);
            const expectedDrift = trackDrift ? predictDrift(history, targetBeat) : 0;
            const expectedBeat = targetBeat + expectedDrift;
            if (expectedBeat > lastMarkerBeat + toleranceBeats) break;
            if (markerIndex >= markers.length) break;

            const match = findNearestForwardMarker(expectedBeat, markers, markerIndex, LOOKAHEAD);

            let accepted = false;
            let reason = "no_marker";

            if (match.marker) {
                if (match.distance <= toleranceBeats + 1e-9) {
                    accepted = true;
                    reason = "accepted";
                    markerIndex = match.markerIndex + 1;
                    history.push({ t: targetBeat, d: match.marker.beat_time - targetBeat });
                    if (history.length > DRIFT_HISTORY) history.shift();
                } else {
                    reason = "outside_tolerance";
                    // Move forward if the marker is clearly behind the expected position.
                    if (match.marker.beat_time < expectedBeat) {
                        markerIndex = Math.max(markerIndex, match.markerIndex + 1);
                    }
                }
            }

            out.push({
                targetBeat: targetBeat,
                expectedDrift: Utils.round(expectedDrift, 7),
                marker: match.marker,
                accepted: accepted,
                reason: reason,
            });
        }

        return out;
    }

    /**
     * Grid points the arrows step through: every outlier, plus the first point
     * of each run of rejected points (a gap where a marker is missing).
     * graph.js implements the same rule; keep them in sync.
     */
    /** Markers whose positions are tried as the grid start. */
    const START_CANDIDATES = 16;

    /**
     * Finds where the grid starts when the user did not set it: tries the
     * position of each of the first markers (folded into the first grid
     * interval) and keeps the one that matches the most markers. Beat 0
     * (1.1.1) wins a near tie, so a clip whose 1.1.1 is already on the first
     * downbeat keeps it; otherwise the earliest marker wins, which is the
     * first kick of a freshly detected clip.
     */
    export function findGridStart(
        markers: Model.WarpMarker[],
        gridBeats: number,
        toleranceBeats: number,
        trackDrift: boolean = true
    ): number {
        if (!markers.length || !(gridBeats > 0)) return 0;
        const score = (start: number) =>
            matchGrid(markers, gridBeats, toleranceBeats, start, trackDrift).filter((m) => m.accepted).length;

        const candidates: number[] = [0];
        for (let i = 0; i < markers.length && i < START_CANDIDATES; i++) {
            let c = markers[i].beat_time % gridBeats;
            if (c < 0) c += gridBeats;
            if (gridBeats - c <= toleranceBeats) c = 0;
            c = Utils.round(c, 7);
            if (!candidates.some((x) => Math.abs(x - c) <= toleranceBeats)) candidates.push(c);
        }

        const scores = candidates.map(score);
        const best = Math.max.apply(null, scores);
        if (best <= 0) return 0;
        const nearTie = Math.max(best - 2, best * 0.98);
        if (scores[0] >= nearTie) return 0;
        for (let i = 1; i < candidates.length; i++) {
            if (scores[i] >= nearTie) return candidates[i];
        }
        return 0;
    }

    export function navigationStops(points: { accepted: boolean; outlier: boolean }[]): number[] {
        const stops: number[] = [];
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.outlier || (!p.accepted && (i === 0 || points[i - 1].accepted))) stops.push(i);
        }
        return stops;
    }

    /** Number of consecutive rejected points starting at `index`. */
    export function gapLength(points: Model.AnalysisPoint[], index: number): number {
        let n = 0;
        while (index + n < points.length && !points[index + n].accepted) n++;
        return n;
    }

    /**
     * Warp marker operations that turn the prepared clip's markers into the
     * snapped result:
     * 1. remove markers that are not accepted (manual additions after Prep),
     * 2. move markers left onto the grid in ascending order,
     * 3. move markers right onto the grid in descending order.
     * This order never moves a marker past a neighbour, even when drift is
     * larger than the grid step. `strength` < 1 moves markers part of the way.
     */
    export function planSnap(
        points: Model.AnalysisPoint[],
        clipMarkerBeats: number[],
        strength: number
    ): Model.WarpOp[] {
        const s = Math.max(0, Math.min(1, strength));
        const accepted = points.filter((p) => p.accepted && p.markerSampleTime >= 0);
        const keep = new Set(accepted.map((p) => p.markerBeat));

        const ops: Model.WarpOp[] = [];
        for (let i = 0; i < clipMarkerBeats.length; i++) {
            if (!keep.has(clipMarkerBeats[i])) ops.push({ op: "remove", beat: clipMarkerBeats[i] });
        }

        const moves = accepted
            .map((p) => ({ beat: p.markerBeat, distance: Utils.round(s * (p.targetBeat - p.markerBeat), 7) }))
            .filter((m) => m.distance !== 0)
            .sort((a, b) => a.beat - b.beat);

        const left = moves.filter((m) => m.distance < 0);
        const right = moves.filter((m) => m.distance > 0).reverse();
        for (const m of left.concat(right)) ops.push({ op: "move", beat: m.beat, distance: m.distance });
        return ops;
    }

    export function validateParams(gridBeats: number, toleranceBeats: number, startBeat: number | null): string | null {
        if (!(gridBeats > 0)) return "Grid must be greater than 0";
        if (!(toleranceBeats >= 0)) return "Tolerance must be 0 or greater";
        if (!(toleranceBeats < gridBeats / 2)) return "Tolerance must be less than half the grid";
        if (startBeat !== null && !(startBeat >= 0)) return "Start beat must be 0 or greater";
        return null;
    }

    export function buildAnalysisForClip(
        clip: LiveAPI,
        gridBeats: number,
        toleranceBeats: number,
        startBeat: number | null = 0,
        trackDrift: boolean = false
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
        if (!sourceMarkers || sourceMarkers.length < 1) {
            Utils.fail("Not enough warp markers. Insert warp markers on the clip's transients first");
            return null;
        }

        Utils.debug("Parsed " + sourceMarkers.length + " source warp markers");

        if (startBeat === null) {
            startBeat = findGridStart(sourceMarkers, gridBeats, toleranceBeats, trackDrift);
            post("Grid starts at beat " + startBeat + "\n");
        }
        const matches = matchGrid(sourceMarkers, gridBeats, toleranceBeats, startBeat, trackDrift);
        const points: Model.AnalysisPoint[] = matches.map(function (m, idx) {
            const markerBeat = m.marker ? m.marker.beat_time : m.targetBeat;
            const markerSampleTime = m.marker ? m.marker.sample_time : -1;
            const driftBeats = m.marker ? markerBeat - m.targetBeat : 0;
            return {
                index: idx,
                targetBeat: m.targetBeat,
                expectedBeat: Utils.round(m.targetBeat + m.expectedDrift, 7),
                expectedDriftBeats: m.expectedDrift,
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

        detectDriftOutliers(points, toleranceBeats, trackDrift);
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
            trackDrift: trackDrift,
            clipStartBeat: Utils.round(clipStartBeat, 6),
            clipEndBeat: Utils.round(clipEndBeat, 6),
            startTime: Utils.round(arrangementStart, 6),
            points: points,
            summary: {
                totalTargets: points.length,
                accepted: acceptedPoints.length,
                outliers: outliers.length,
                rejected: points.length - acceptedPoints.length,
                gaps: navigationStops(points).filter((i) => !points[i].outlier).length,
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
                yExp: p.expectedDriftBeats,
                ok: p.accepted,
                outlier: p.outlier
            };
        });

        const keptGraphPoints = graphPoints.filter(function (p) { return p.ok; });

        const graph: Model.GraphPayload = {
            clipName: clipName,
            tempo: Utils.round(tempo, 6),
            gridBeats: gridBeats,
            toleranceBeats: Utils.round(toleranceBeats, 6),
            toleranceMs: Utils.round(Live.beatsToMs(toleranceBeats, tempo), 3),
            xMin: graphPoints.length ? graphPoints[0].xBeat : 0,
            xMax: graphPoints.length ? graphPoints[graphPoints.length - 1].xBeat : 0,
            // The vertical range covers kept markers only: a rejected point's
            // "drift" is the distance to some marker outside tolerance and would
            // dwarf the real drift.
            yMinBeats: Utils.round(Utils.min(keptGraphPoints.map(function (p) { return p.yBeats; })), 6),
            yMaxBeats: Utils.round(Utils.max(keptGraphPoints.map(function (p) { return p.yBeats; })), 6),
            yMinMs: Utils.round(Utils.min(keptGraphPoints.map(function (p) { return p.yMs; })), 3),
            yMaxMs: Utils.round(Utils.max(keptGraphPoints.map(function (p) { return p.yMs; })), 3),
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

    /** Outliers and gaps of the last analysis, in clip order. */
    export function getStopPoints(): Model.AnalysisPoint[] {
        const a = State.state.lastAnalysis;
        if (!a) return [];
        return navigationStops(a.points).map((i) => a.points[i]);
    }

    export function validateClipForAnalysis(clip: LiveAPI): { filePath: string } | null {
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
     * Flags accepted points whose drift (or, with `relativeToTrend`, distance
     * from the predicted drift) does not fit their neighbours.
     * Only accepted points are considered, and the first/last accepted point
     * is never flagged because it has only one neighbour.
     */
    export function detectDriftOutliers(points: Model.AnalysisPoint[], toleranceBeats: number, relativeToTrend: boolean = false): void {
        const accepted = points.filter(function (p) { return p.accepted; });
        // With drift tracking, judge each marker against the predicted trend so a
        // steadily drifting rip does not look like a series of jumps.
        const value = (p: Model.AnalysisPoint) => relativeToTrend ? p.driftBeats - (p.expectedDriftBeats || 0) : p.driftBeats;

        const eps = 0.0001;
        const ratio = 1.5;
        const minJump = Math.max(0.02, toleranceBeats * 0.25);

        // The trend needs two accepted markers before its prediction means anything.
        const first = relativeToTrend ? 2 : 1;
        for (let i = first; i < accepted.length - 1; i++) {
            const prev = accepted[i - 1];
            const curr = accepted[i];
            const next = accepted[i + 1];

            const a = value(prev);
            const b = value(curr);
            const c = value(next);

            const absA = Math.abs(a);
            const absB = Math.abs(b);
            const absC = Math.abs(c);

            const sameOuterSign = (a > eps && c > eps) || (a < -eps && c < -eps);
            const currOpposite =
                (b > eps && a < -eps && c < -eps) ||
                (b < -eps && a > eps && c > eps);

            // A sign flip only matters when the point is also clearly away from
            // its neighbours; around a trend the sign of tiny residuals is noise.
            const isolatedFlip = sameOuterSign && currOpposite && Math.abs(b - (a + c) / 2) > minJump;

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
