/** Printed on load so the Max console shows which build Max picked up. */
const QTR_BUILD = "0.0.2-dev";
post("Quant the Ripper quant.js " + QTR_BUILD + " loaded " + new Date().toISOString() + "\n");

function init(): void { }

function bang(): void { }

function clear(): void {
    Quant.clear();
}

/** `prep <grid beats> <tolerance ms> <start beat>` */
function prep(gridBeats: number, toleranceMs: number, startBeat: number): void {
    Quant.prep(gridBeats, toleranceMs, startBeat);
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

/** Option controls. */
function track(on: number): void {
    Quant.setTrackDrift(on);
}

function detect(on: number): void {
    Quant.setDetectKicks(on);
}

function strength(percent: number): void {
    Quant.setStrength(percent);
}

function repitch(on: number): void {
    Quant.setRepitch(on);
}

/** Sent by the graph when a bar is clicked. */
function goto_point(index: number): void {
    Quant.gotoPoint(index);
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
