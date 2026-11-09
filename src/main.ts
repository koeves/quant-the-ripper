post("LOADED quant.js", new Date().toISOString(), "\n");

function init(): void { }

function bang(): void { }

function clear(): void {
    Quant.clear();
}

function prep(gridBeats: number, toleranceBeats: number, startBeat: number): void {
    Quant.prep(gridBeats, toleranceBeats, startBeat);
}

function snap(): void {
    Quant.snap();
}

function left(): void {
    Quant.left();
}

function right(): void {
    Quant.right();
}

/** `debug 1` / `debug 0` toggles verbose logging to the Max console. */
function debug(on: number): void {
    Utils.DEBUG = !!Number(on);
    post("quant debug " + (Utils.DEBUG ? "on" : "off") + "\n");
}

/** Called by Max when the device is removed or the set is closed. */
function notifydeleted(): void {
    Quant.cancelTasks();
}
