namespace Quant {
    export function run(sliceBeats: number = 16, warpMode: Model.WarpMode = 0, startBeat: number = 0): void {
        try {
            const clip = new LiveAPI(undefined, "live_set view detail_clip");
            if (!clip || !clip.id || Number(clip.id) === 0) {
                error("No detail clip selected.\n");
                return;
            }

            const isAudio = Utils.toNumber(Utils.lastValue(clip.get("is_audio_clip")));
            const isArrangement = Utils.toNumber(Utils.lastValue(clip.get("is_arrangement_clip")));

            if (isAudio !== 1) {
                error("Selected detail clip is not an audio clip.\n");
                return;
            }

            if (isArrangement !== 1) {
                error("Selected detail clip is not an Arrangement clip.\n");
                return;
            }

            Live.inspect(clip);

            const filePath = Utils.toPropertyString(clip.get("file_path"));
            if (!filePath) {
                error("Could not read file_path from clip.\n");
                return;
            }

            const arrangementStart = Utils.toNumber(Utils.lastValue(clip.get("start_time")));
            const clipStartBeat = Utils.toNumber(Utils.lastValue(clip.get("start_marker")));
            const clipEndBeat = Utils.toNumber(Utils.lastValue(clip.get("end_marker")));

            const trackPath = Live.parentTrackPath(clip.path);
            if (!trackPath) {
                error("Could not determine parent track path.\n");
                return;
            }

            const track = new LiveAPI(undefined, trackPath);

            Live.densifySourceWarpMap(clip, sliceBeats);

            const warpMarkers = Live.getWarpMarkersFromClip(clip);
            if (!warpMarkers || warpMarkers.length < 2) {
                error("Could not parse warp_markers from selected clip.\n");
                return;
            }

            post(`Parsed ${warpMarkers.length} warp markers: ${warpMarkers}`);

            warpMarkers.sort((a, b) => a.beat_time - b.beat_time);

            const firstBeat = Math.max(startBeat, clipStartBeat);
            const lastBeat = clipEndBeat;

            let created = 0;
            let sliceIndex = 0;

            for (let segBeatStart = firstBeat; segBeatStart < lastBeat - 1e-6; segBeatStart += sliceBeats) {
                const segBeatEnd = Math.min(segBeatStart + sliceBeats, lastBeat);
                const actualBeats = segBeatEnd - segBeatStart;
                if (actualBeats <= 1e-6) continue;

                const srcSampleStart = Live.beatToSampleTime(segBeatStart, warpMarkers);
                const srcSampleEnd = Live.beatToSampleTime(segBeatEnd, warpMarkers);
                const srcDurSampleTime = srcSampleEnd - srcSampleStart;

                if (srcDurSampleTime <= 1e-6) {
                    post(`Skipping slice at beat ${segBeatStart} because duration <= 0\n`);
                    continue;
                }

                const destBeat = arrangementStart + (sliceIndex * sliceBeats);

                track.call("create_audio_clip", filePath, destBeat);

                const newClip = Live.findArrangementClipByStartTime(trackPath, destBeat);
                if (!newClip) {
                    post(`Could not find newly created clip at beat ${destBeat}\n`);
                    continue;
                }

                Utils.safeSet(newClip, "warping", 1);
                Utils.safeSet(newClip, "warp_mode", warpMode);
                Utils.safeSet(newClip, "looping", 0);

                // IMPORTANT: use beat positions here, not sample times
                Utils.safeSet(newClip, "start_marker", segBeatStart);
                Utils.safeSet(newClip, "end_marker", segBeatEnd);

                newClip.call("crop");

                // After crop, local clip time should start at 0
                Utils.safeSet(newClip, "start_marker", 0.0);
                Utils.safeSet(newClip, "end_marker", actualBeats);

                Utils.safeSet(newClip, "name", `slice_${sliceIndex + 1}`);

                sliceIndex += 1;
                created += 1;
            }

            post(`Done. Created ${created} slices.\n`);
        } catch (e: any) {
            error(`run() failed: ${String(e)}\n`);
        }
    }
}