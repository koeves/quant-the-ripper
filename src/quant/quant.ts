namespace State {
    export const PREPARED_SUFFIX = "_prepared";
    export const QUANTED_SUFFIX = "_quanted";
    export const REPITCH_WARP_MODE = 3;

    export function initialState(): Model.RuntimeState {
        return {
            lastAnalysis: null,
            lastGraph: null,
            lastAfterAnalysis: null,
            lastAfterGraph: null,
            lastClipId: "",
            lastSettings: null,

            originalTrackId: "",
            originalClipId: "",
            originalClipName: "",
            preparedTrackId: "",
            quantedTrackId: "",

            progressText: "",

            pendingRemoval: null,
            pendingSnap: null,
            pendingDetect: null,

            removalTask: null,
            snapTask: null,
            detectTask: null,

            finalizePrepClip: null,
            finalizeSnapClip: null,
            finalizePrepTask: null,
            finalizeSnapTask: null,

            lastSnapMoved: 0,

            currentOutlierIndex: -1
        };
    }

    export const state: Model.RuntimeState = initialState();

    /** Set by the option controls; not touched by Reset. */
    export const options: Model.Options = {
        trackDrift: true,
        detectKicks: false,
        strength: 1,
        repitch: false,
    };

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
        Detect.cancel();
        s.removalTask = Live.cancelTask(s.removalTask);
        s.snapTask = Live.cancelTask(s.snapTask);
        s.finalizePrepTask = Live.cancelTask(s.finalizePrepTask);
        s.finalizeSnapTask = Live.cancelTask(s.finalizeSnapTask);
        s.pendingRemoval = null;
        s.pendingSnap = null;
    }

    function isBusy(): boolean {
        const s = State.state;
        return !!(s.pendingRemoval || s.pendingSnap || s.pendingDetect || s.finalizePrepTask || s.finalizeSnapTask);
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

    // ---- Options -------------------------------------------------------------

    export function setTrackDrift(on: number): void {
        State.options.trackDrift = !!Number(on);
    }

    export function setDetectKicks(on: number): void {
        State.options.detectKicks = !!Number(on);
    }

    /** Snap strength in percent. */
    export function setStrength(percent: number): void {
        const v = Number(percent);
        State.options.strength = isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 1;
    }

    export function setRepitch(on: number): void {
        State.options.repitch = !!Number(on);
    }

    // ---- Prep ----------------------------------------------------------------

    function sameSettings(a: Model.PrepSettings | null, b: Model.PrepSettings): boolean {
        if (!a) return false;
        const eps = 1e-6;
        return Math.abs(a.gridBeats - b.gridBeats) < eps &&
            Math.abs(a.toleranceBeats - b.toleranceBeats) < eps &&
            Math.abs(a.startBeat - b.startBeat) < eps &&
            a.trackDrift === b.trackDrift &&
            a.detectKicks === b.detectKicks;
    }

    /**
     * Prep button. `toleranceMs` is converted to beats at the song tempo.
     * - No previous analysis, or a different clip is selected: duplicate the
     *   selected clip to a new _prepared track and analyze it.
     * - Same clip, same settings: re-analyze the _prepared clip, keeping
     *   manual warp marker edits.
     * - Same clip, changed settings: rebuild the _prepared clip from the
     *   original so markers removed under the old settings come back.
     */
    export function prep(gridBeats: number, toleranceMs: number, startBeat: number): void {
        try {
            gridBeats = Number(gridBeats);
            toleranceMs = Number(toleranceMs);
            startBeat = Number(startBeat) || 0;

            const msPerBeat = Live.msPerBeat(Live.getSongTempo());
            let toleranceBeats = msPerBeat > 0 ? toleranceMs / msPerBeat : NaN;
            let note = "";
            // A tolerance of half the grid or more would let one marker match two grid points.
            if (gridBeats > 0 && toleranceBeats >= gridBeats / 2) {
                toleranceBeats = Utils.round(gridBeats * 0.45, 6);
                note = ` (tolerance limited to ${(toleranceBeats * msPerBeat).toFixed(0)} ms)`;
            }

            const invalid = Analysis.validateParams(gridBeats, toleranceBeats, startBeat);
            if (invalid) {
                Utils.fail(invalid);
                return;
            }

            if (isBusy()) {
                Utils.setProgress("Still working, please wait");
                return;
            }

            const settings: Model.PrepSettings = {
                gridBeats: gridBeats,
                toleranceBeats: Utils.round(toleranceBeats, 7),
                startBeat: startBeat,
                trackDrift: State.options.trackDrift,
                detectKicks: State.options.detectKicks,
            };

            const s = State.state;
            const previous = s.lastAnalysis;
            const preparedClip = previous ? Live.byId(s.lastClipId) : null;
            const originalClip = previous ? Live.byId(s.originalClipId) : null;

            if (!previous || !preparedClip || !originalClip) {
                // Nothing analyzed yet, or the user deleted the clips: forget stale track ids.
                State.reset();
                prepNew(settings, note);
                return;
            }

            if (!ownsSelection(Live.clipInfo())) {
                // User moved on to another clip: leave the old tracks in place and start over.
                State.reset();
                prepNew(settings, note);
                return;
            }

            if (!sameSettings(s.lastSettings, settings)) {
                rebuildPrepared(originalClip, settings, note);
                return;
            }

            s.finalizePrepClip = preparedClip;
            analyze(note);
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

    function rebuildPrepared(originalClip: LiveAPI, settings: Model.PrepSettings, note: string): void {
        const s = State.state;
        if (s.quantedTrackId) Live.deleteTrackById(s.quantedTrackId);
        if (s.preparedTrackId) Live.deleteTrackById(s.preparedTrackId);
        s.quantedTrackId = "";
        s.preparedTrackId = "";

        post("Settings changed, rebuilding prepared clip from original\n");
        prepNew(settings, note, originalClip);
    }

    /** Fewer real warp markers than this on the original and Prep has nothing to work with. */
    const MIN_MARKERS = 2;

    /** Below this share of grid points matched, the status suggests adding markers. */
    const FEW_MATCHED = 0.25;

    function prepNew(settings: Model.PrepSettings, note: string, source?: LiveAPI): void {
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

        // Validate before creating any tracks. With kick detection the
        // original does not need warp markers yet.
        const validated = Analysis.validateClipForAnalysis(clip);
        if (!validated) return;
        if (!settings.detectKicks) {
            // Without detection the original needs real markers to choose from
            // (a freshly warped clip only has its start marker).
            const markers = Live.getWarpMarkersFromClip(clip);
            const real = markers ? markers.length - 1 : 0;
            if (real < MIN_MARKERS) {
                Utils.fail(`Only ${Math.max(real, 0)} warp marker${real === 1 ? "" : "s"} on the clip. Turn on Detect, or insert warp markers (Cmd+I)`);
                return;
            }
            if (!Analysis.buildAnalysisForClip(clip, settings.gridBeats, settings.toleranceBeats, settings.startBeat, settings.trackDrift)) {
                return;
            }
        }

        post(`Analyzing fresh clip with grid ${settings.gridBeats}, start beat ${settings.startBeat}, ` +
            `tolerance ${settings.toleranceBeats}, track drift ${settings.trackDrift}, detect kicks ${settings.detectKicks}\n`);

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

        s.lastClipId = String(preparedClip.id);
        s.lastSettings = settings;

        if (settings.detectKicks) {
            Detect.start(preparedClip, validated.filePath, function (ok: boolean) {
                if (ok) analyzeAndPrune(preparedClip, settings, note);
            });
            return;
        }
        analyzeAndPrune(preparedClip, settings, note);
    }

    /** Analyzes the prepared clip and removes the markers that were not accepted. */
    function analyzeAndPrune(preparedClip: LiveAPI, settings: Model.PrepSettings, note: string): void {
        const s = State.state;
        const result = Analysis.buildAnalysisForClip(
            preparedClip, settings.gridBeats, settings.toleranceBeats, settings.startBeat, settings.trackDrift
        );
        if (!result) return;

        s.lastAnalysis = result.analysis;
        s.lastGraph = result.graph;
        s.lastClipId = String(preparedClip.id);
        pendingNote = note;

        Utils.setProgress("Removing unused warp markers");
        Live.removeNonAcceptedWarpMarkers(preparedClip, result.analysis);
    }

    let pendingNote = "";

    function analyzeWith(clip: LiveAPI, previous: Model.AnalysisResult) {
        return Analysis.buildAnalysisForClip(
            clip,
            previous.gridBeats,
            previous.toleranceBeats,
            previous.analysisStartBeat,
            previous.trackDrift
        );
    }

    /** Re-analyzes the prepared clip and sends the graph. Runs after marker removal and on re-Prep. */
    export function analyze(note?: string): void {
        const s = State.state;
        const suffix = typeof note === "string" ? note : pendingNote;
        pendingNote = "";
        try {
            if (!s.lastAnalysis || !s.finalizePrepClip) return;

            const clip = s.finalizePrepClip;
            const result = analyzeWith(clip, s.lastAnalysis);
            if (!result) return;

            s.lastAnalysis = result.analysis;
            s.lastGraph = result.graph;
            s.lastClipId = String(clip.id);
            s.lastAfterAnalysis = null;
            s.lastAfterGraph = null;
            s.currentOutlierIndex = -1;

            GraphDict.send("graph_json", result.graph);
            const sum = result.analysis.summary;
            const hint = sum.accepted < Math.max(MIN_MARKERS, sum.totalTargets * FEW_MATCHED) && !(s.lastSettings && s.lastSettings.detectKicks)
                ? ". Few markers matched: turn on Detect or insert warp markers"
                : "";
            Utils.setProgress(
                `Done. Kept ${sum.accepted}/${sum.totalTargets} markers, ${sum.outliers} outliers, ${sum.gaps} gaps. ` +
                `Avg drift: ${sum.meanAbsDriftMs.toFixed(1)} ms` + suffix + hint
            );
        } catch (e: any) {
            Utils.fail("Analysis failed: " + String(e));
        } finally {
            s.finalizePrepTask = Live.cancelTask(s.finalizePrepTask);
        }
    }

    // ---- Snap ----------------------------------------------------------------

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
            const fresh = analyzeWith(preparedClip, previous);
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

            if (State.options.repitch) {
                // Vinyl drift is a speed change: Re-Pitch follows it without stretching artifacts.
                quantedClip.set("warp_mode", State.REPITCH_WARP_MODE);
            }

            Utils.debug("Created quanted clip at path: " + quantedClip.path);
            Live.snapAcceptedMarkers(quantedClip, fresh.analysis, State.options.strength);
        } catch (e: any) {
            Utils.fail("Snap failed: " + String(e));
        }
    }

    export function finishSnap(): void {
        const s = State.state;
        try {
            if (!s.lastAnalysis || !s.finalizeSnapClip) return;

            const result = analyzeWith(s.finalizeSnapClip, s.lastAnalysis);
            if (!result) return;

            s.lastAfterAnalysis = result.analysis;
            s.lastAfterGraph = result.graph;

            GraphDict.send("graph_after_json", result.graph);
            const sum = result.analysis.summary;
            const strength = State.options.strength < 1 ? ` at ${Math.round(State.options.strength * 100)}%` : "";
            Utils.setProgress(
                `Done. Snapped ${s.lastSnapMoved} warp markers${strength}. ` +
                `Avg drift: ${sum.meanAbsDriftMs.toFixed(1)} ms`
            );
        } catch (e: any) {
            Utils.fail("Snap failed: " + String(e));
        } finally {
            s.finalizeSnapClip = null;
            s.finalizeSnapTask = Live.cancelTask(s.finalizeSnapTask);
        }
    }

    // ---- Navigation ----------------------------------------------------------

    /** Clip beat to put the playhead on: the marker for outliers, the expected position for gaps. */
    function jumpBeat(p: Model.AnalysisPoint): number {
        return p.accepted ? p.markerBeat : p.expectedBeat;
    }

    function jump(analysis: Model.AnalysisResult, p: Model.AnalysisPoint): void {
        try {
            Live.jumpToClipBeat(analysis, jumpBeat(p));
        } catch (e: any) {
            Utils.debug("jumpToClipBeat failed: " + String(e));
        }
    }

    function stepStop(direction: number): void {
        const s = State.state;
        if (!s.lastAnalysis) {
            Utils.setProgress("No analysis available, run Prep first");
            return;
        }

        if (s.lastAfterAnalysis) return;

        const stops = Analysis.getStopPoints();
        if (stops.length === 0) {
            s.currentOutlierIndex = -1;
            Utils.setProgress("No outliers or gaps found");
            return;
        }

        const n = stops.length;
        if (s.currentOutlierIndex < 0 || s.currentOutlierIndex >= n) {
            // Same convention as the graph: right starts at the first stop, left at the last.
            s.currentOutlierIndex = direction > 0 ? 0 : n - 1;
        } else {
            s.currentOutlierIndex = (s.currentOutlierIndex + direction + n) % n;
        }

        const p = stops[s.currentOutlierIndex];
        jump(s.lastAnalysis, p);
        Utils.setProgress(describeStop(s.lastAnalysis, p, s.currentOutlierIndex, n));
    }

    function describeStop(analysis: Model.AnalysisResult, p: Model.AnalysisPoint, index: number, total: number): string {
        const prefix = (index + 1) + "/" + total + " ";
        if (p.outlier) {
            return prefix + "Outlier: " + p.outlierReason +
                " | Beat " + p.targetBeat.toFixed(2) +
                " | Drift " + p.driftMs.toFixed(1) + " ms";
        }
        const len = Analysis.gapLength(analysis.points, p.index);
        return prefix + "Gap: " + len + " grid point" + (len === 1 ? "" : "s") +
            " without a marker from beat " + p.targetBeat.toFixed(2);
    }

    export function left(): void {
        stepStop(-1);
    }

    export function right(): void {
        stepStop(1);
    }

    /** Graph click: show the clicked grid point and move the playhead to it. */
    export function gotoPoint(index: number): void {
        const s = State.state;
        const analysis = s.lastAfterAnalysis || s.lastAnalysis;
        if (!analysis) return;
        const p = analysis.points[Math.round(Number(index))];
        if (!p) return;

        if (!s.lastAfterAnalysis) {
            const stops = Analysis.navigationStops(analysis.points);
            const stop = stops.indexOf(p.index);
            if (stop >= 0) {
                s.currentOutlierIndex = stop;
                jump(analysis, p);
                Utils.setProgress(describeStop(analysis, p, stop, stops.length));
                return;
            }
        }

        jump(analysis, p);
        const status = p.outlier ? "outlier" : p.accepted ? "kept" : "no marker";
        Utils.setProgress(
            "Beat " + p.targetBeat.toFixed(2) + " | " + status +
            (p.accepted ? " | Drift " + p.driftMs.toFixed(1) + " ms" : "")
        );
    }
}
