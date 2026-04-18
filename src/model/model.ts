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
        analysisStartBeat: number;
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

        originalTrackId: string;
        originalClipId: string;

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
            accepted: AnalysisPoint[];
            index: number;
            moved: number;
            skippedRejected: number;
            skippedNoSample: number;
            skippedNoWarpPoint: number;
        } | null;

        removalTask: Task | null;
        snapTask: Task | null;

        finalizePrepClip: LiveAPI | null;
        finalizeSnapClip: LiveAPI | null;
        finalizePrepTask: Task | null;
        finalizeSnapTask: Task | null;
    }
}