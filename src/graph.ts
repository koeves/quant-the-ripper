declare function post(...args: any[]): void;
declare function arrayfromargs(...args: any[]): any[];

declare var mgraphics: any;
declare var box: any;

namespace GraphModel {
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
}

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var graph: GraphModel.GraphPayload | null = null;

var COLORS = {
    bg: [0.16, 0.16, 0.16, 1.0],
    panelBorder: [0.28, 0.28, 0.28, 1.0],
    grid: [0.24, 0.24, 0.24, 1.0],
    axis: [0.62, 0.62, 0.62, 1.0],
    zero: [0.82, 0.82, 0.82, 1.0],
    tolerance: [0.60, 0.60, 0.60, 0.95],
    toleranceFill: [0.22, 0.22, 0.22, 0.85],
    text: [0.88, 0.88, 0.88, 1.0],
    mutedText: [0.65, 0.65, 0.65, 1.0],
    ok: [0.53, 0.74, 0.53, 1.0],
    reject: [0.78, 0.42, 0.42, 0.95]
};

function loadbang() {
    mgraphics.redraw();
}

function clear_graph() {
    graph = null;
    mgraphics.redraw();
}

function graph_json() {
    try {
        var args = arrayfromargs(arguments);
        var s = "";
        for (var i = 0; i < args.length; i++) {
            if (i > 0) s += " ";
            s += String(args[i]);
        }

        graph = JSON.parse(s);

        if (graph) {
            post("graph parsed, points=" + (graph.points ? graph.points.length : -1) + "\n");
            post("yMinBeats=" + graph.yMinBeats + " yMaxBeats=" + graph.yMaxBeats + "\n");
        }

        mgraphics.redraw();
    } catch (e) {
        post("graph_json failed: " + e + "\n");
    }
}

function setColor(c: Array<number>) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], c[3]);
}

function drawDashedHorizontal(y: number, x1: number, x2: number, dash: number, gap: number) {
    var x = x1;
    while (x < x2) {
        var xEnd = Math.min(x + dash, x2);
        mgraphics.move_to(x, y);
        mgraphics.line_to(xEnd, y);
        mgraphics.stroke();
        x += dash + gap;
    }
}

function fmt(n: number, digits: number) {
    var f = Math.pow(10, digits || 2);
    return String(Math.round(n * f) / f);
}

function chooseXTickStep(gridBeats: number, xSpan: number) {
    var targetTicks = 4;
    var raw = xSpan / targetTicks;
    var base = Math.max(1, gridBeats);

    if (raw <= base) return base;
    if (raw <= base * 2) return base * 2;
    if (raw <= base * 4) return base * 4;
    if (raw <= base * 8) return base * 8;
    return base * 16;
}

function paint() {
    var w = box.rect[2] - box.rect[0];
    var h = box.rect[3] - box.rect[1];

    setColor(COLORS.bg);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    if (!graph || !graph.points || graph.points.length === 0) {
        return;
    }

    var points = graph.points;
    var tol = Math.max(Math.abs(graph.toleranceBeats), 0.0001);
    var maxAbs = Math.max(Math.abs(graph.yMinBeats), Math.abs(graph.yMaxBeats), tol);

    var plotW = w;
    var plotH = h;

    var xMin = graph.xMin;
    var xMax = graph.xMax;
    var xSpan = Math.max(1, xMax - xMin);

    var zeroY = plotH / 2;

    maxAbs = Math.max(Math.abs(maxAbs), Math.abs(tol));

    function yToPix(v: number) {
        return zeroY - (v / maxAbs) * (plotH / 2);
    }

    function xToPix(v: number) {
        return ((v - xMin) / xSpan) * plotW;
    }

    // tolerance band
    var yTolTop = yToPix(tol);
    var yTolBottom = yToPix(-tol);
    setColor(COLORS.toleranceFill);
    mgraphics.rectangle(0, yTolTop, plotW, yTolBottom - yTolTop);
    mgraphics.fill();

    // horizontal grid (minimal)
    var gridVals = [-maxAbs, -tol, 0, tol, maxAbs];
    setColor(COLORS.grid);
    mgraphics.set_line_width(1);
    for (var gi = 0; gi < gridVals.length; gi++) {
        var gy = yToPix(gridVals[gi]);
        mgraphics.move_to(0, gy);
        mgraphics.line_to(plotW, gy);
        mgraphics.stroke();
    }

    // vertical grid (no labels)
    var tickStep = chooseXTickStep(graph.gridBeats, xSpan);
    var firstTick = Math.ceil(xMin / tickStep) * tickStep;

    setColor(COLORS.grid);
    for (var xb = firstTick; xb <= xMax + 0.0001; xb += tickStep) {
        var xp = xToPix(xb);
        mgraphics.move_to(xp, 0);
        mgraphics.line_to(xp, plotH);
        mgraphics.stroke();
    }

    // axes
    setColor(COLORS.axis);
    mgraphics.set_line_width(1);

    // y-axis (left edge)
    mgraphics.move_to(0, 0);
    mgraphics.line_to(0, plotH);
    mgraphics.stroke();

    // x-axis (zero line)
    mgraphics.move_to(0, zeroY);
    mgraphics.line_to(plotW, zeroY);
    mgraphics.stroke();

    // tolerance dashed lines
    setColor(COLORS.tolerance);
    mgraphics.set_line_width(1);
    drawDashedHorizontal(yTolTop, 0, plotW, 3, 2);
    drawDashedHorizontal(yTolBottom, 0, plotW, 3, 2);

    // zero highlight
    setColor(COLORS.zero);
    mgraphics.set_line_width(1);
    mgraphics.move_to(0, zeroY);
    mgraphics.line_to(plotW, zeroY);
    mgraphics.stroke();

    // bars
    var n = points.length;
    var stepPx = plotW / Math.max(n, 1);
    var barW = Math.max(1, Math.min(4, stepPx * 0.7));

    for (var bi = 0; bi < n; bi++) {
        var p = points[bi];
        var x = xToPix(p.xBeat) - barW / 2;
        var y = yToPix(p.yBeats);

        setColor(p.ok ? COLORS.ok : COLORS.reject);

        var rectY = Math.min(y, zeroY);
        var rectH = Math.max(1, Math.abs(y - zeroY));
        mgraphics.rectangle(x, rectY, barW, rectH);
        mgraphics.fill();
    }
}