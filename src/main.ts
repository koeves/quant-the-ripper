const state: Model.RuntimeState = {
    initialized: false,
};

function init(): void {
    state.initialized = true;
    Live.post("vinyl_slice_warp initialized\n");
}

function bang(): void {
    Live.post("ready\n");
}

/**
     * run <sliceBeats> <Model.WarpMode> <startBeat>
     * Example: run 16 0 0
     */
function run(sliceBeats: number = 16, warpMode: Model.WarpMode = 0, startBeat: number = 0): void {
    if (!state.initialized) {
        Live.error("Device not initialized yet. Trigger init from live.thisdevice first.\n");
        return;
    }

    Quant.run(sliceBeats, warpMode, startBeat);
}

