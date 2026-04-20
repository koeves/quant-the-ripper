post("LOADED quant.js", new Date().toISOString(), "\n");

function init(): void { }

function bang(): void { }

function clear(): void {
    Quant.clear();
}

function prep(
    gridBeats: number,
    toleranceBeats: number,
    startBeat: number,
): void {
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