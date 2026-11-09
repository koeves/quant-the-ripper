namespace Model {
    export interface WarpMarker {
        beat_time: number;
        sample_time: number;
    }

    export interface AnalysisPoint {
        index: number;
        targetBeat: number;
        /** Where the marker was expected: target plus the drift predicted from earlier markers. */
        expectedBeat: number;
        markerBeat: number;
        markerSampleTime: number;
        driftBeats: number;
        driftMs: number;
        /** Predicted drift at this grid point (0 when drift tracking is off). */
        expectedDriftBeats: number;
        absDriftBeats: number;
        accepted: boolean;
        reason: string;
        outlier: boolean;
        outlierReason: string;
    }

    /** Settings a Prep runs with. Changing any of them rebuilds the prepared clip. */
    export interface PrepSettings {
        gridBeats: number;
        toleranceBeats: number;
        /** Grid start in clip beats, or null to find it from the markers. */
        startBeat: number | null;
        trackDrift: boolean;
        detectKicks: boolean;
    }

    export interface AnalysisResult {
        clipName: string;
        clipPath: string;
        filePath: string;
        tempo: number;
        gridBeats: number;
        toleranceBeats: number;
        analysisStartBeat: number;
        trackDrift: boolean;
        clipStartBeat: number;
        clipEndBeat: number;
        startTime: number;
        points: AnalysisPoint[];
        summary: {
            totalTargets: number;
            accepted: number;
            rejected: number;
            outliers: number;
            gaps: number;
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
        /** Expected drift in beats; the tolerance band is drawn around it. */
        yExp: number;
        ok: boolean;
        outlier: boolean;
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
        outliers: number;
        points: GraphPoint[];
    }

    /** Values set by the device's option controls; kept across Reset. */
    export interface Options {
        detectKicks: boolean;
        /** Snap strength, 0..1. */
        strength: number;
        repitch: boolean;
    }

    export type WarpOp =
        | { op: "remove"; beat: number }
        | { op: "move"; beat: number; distance: number };

    export interface RuntimeState {
        lastAnalysis: AnalysisResult | null;
        lastGraph: GraphPayload | null;
        lastAfterAnalysis: AnalysisResult | null;
        lastAfterGraph: GraphPayload | null;
        lastClipId: string;
        lastSettings: PrepSettings | null;

        originalTrackId: string;
        originalClipId: string;
        originalClipName: string;
        preparedTrackId: string;
        quantedTrackId: string;

        progressText: string;

        pendingRemoval: {
            clip: LiveAPI;
            beats: number[];
            index: number;
            removed: number;
            failed: number;
        } | null;

        pendingSnap: {
            clip: LiveAPI;
            ops: WarpOp[];
            index: number;
            moved: number;
            removed: number;
            skippedRejected: number;
            failed: number;
        } | null;

        pendingDetect: Detect.Job | null;

        removalTask: Task | null;
        snapTask: Task | null;
        detectTask: Task | null;

        finalizePrepClip: LiveAPI | null;
        finalizeSnapClip: LiveAPI | null;
        finalizePrepTask: Task | null;
        finalizeSnapTask: Task | null;

        lastSnapMoved: number;

        currentOutlierIndex: number;
    }
}
