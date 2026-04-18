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

    // background
    setColor(COLORS.bg);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    if (!graph || !graph.points || graph.points.length === 0) {
        return;
    }

    var points = graph.points;
    var tol = Math.max(Math.abs(graph.toleranceBeats), 0.0001);

    var payloadMin = graph.yMinBeats;
    var payloadMax = graph.yMaxBeats;

    // make plotted range a bit larger than payload/tolerance range
    var baseAbs = Math.max(Math.abs(payloadMin), Math.abs(payloadMax), tol);
    var plotAbs = baseAbs * 1.18; // headroom so red dashed lines are visible
    if (plotAbs <= 0) plotAbs = 1;

    // small left axis area
    var axisPad = 26;
    var plotX = axisPad;
    var plotY = 0;
    var plotW = Math.max(1, w - axisPad);
    var plotH = h;

    var xMin = graph.xMin;
    var xMax = graph.xMax;
    var xSpan = Math.max(1, xMax - xMin);

    var zeroY = plotY + plotH / 2;

    function yToPix(v: number) {
        return zeroY - (v / plotAbs) * (plotH / 2);
    }

    function xToPix(v: number) {
        return plotX + ((v - xMin) / xSpan) * plotW;
    }

    function clampY(y: number) {
        return Math.max(6, Math.min(plotH - 3, y));
    }

    // tolerance band
    var yTolTop = yToPix(tol);
    var yTolBottom = yToPix(-tol);
    setColor(COLORS.toleranceFill);
    mgraphics.rectangle(plotX, yTolTop, plotW, yTolBottom - yTolTop);
    mgraphics.fill();

    // horizontal grid
    var gridVals = [payloadMin, -tol, 0, tol, payloadMax];
    setColor(COLORS.grid);
    mgraphics.set_line_width(1);
    for (var gi = 0; gi < gridVals.length; gi++) {
        var gy = yToPix(gridVals[gi]);
        mgraphics.move_to(plotX, gy);
        mgraphics.line_to(plotX + plotW, gy);
        mgraphics.stroke();
    }

    // vertical grid
    var tickStep = chooseXTickStep(graph.gridBeats, xSpan);
    var firstTick = Math.ceil(xMin / tickStep) * tickStep;

    setColor(COLORS.grid);
    for (var xb = firstTick; xb <= xMax + 0.0001; xb += tickStep) {
        var xp = xToPix(xb);
        mgraphics.move_to(xp, plotY);
        mgraphics.line_to(xp, plotY + plotH);
        mgraphics.stroke();
    }

    // zero line
    setColor(COLORS.zero);
    mgraphics.set_line_width(1);
    mgraphics.move_to(plotX, zeroY);
    mgraphics.line_to(plotX + plotW, zeroY);
    mgraphics.stroke();

    // red dashed tolerance lines
    var tolRed = [0.86, 0.24, 0.24, 1.0];
    setColor(tolRed);
    mgraphics.set_line_width(1);
    drawDashedHorizontal(yTolTop, plotX, plotX + plotW, 4, 3);
    drawDashedHorizontal(yTolBottom, plotX, plotX + plotW, 4, 3);

    // small y axis on left
    setColor(COLORS.axis);
    mgraphics.set_line_width(1);
    mgraphics.move_to(plotX, 0);
    mgraphics.line_to(plotX, plotH);
    mgraphics.stroke();

    function drawAxisTick(v: number, label: string, color?: number[]) {
        var y = clampY(yToPix(v));

        setColor(color || COLORS.axis);
        mgraphics.move_to(plotX - 4, y);
        mgraphics.line_to(plotX, y);
        mgraphics.stroke();

        setColor(color || COLORS.mutedText);
        mgraphics.move_to(2, y + 3);
        mgraphics.show_text(label);
    }

    drawAxisTick(payloadMax, fmt(payloadMax, 2), COLORS.mutedText);
    drawAxisTick(tol, "+" + fmt(tol, 2), tolRed);
    drawAxisTick(-tol, "-" + fmt(tol, 2), tolRed);
    drawAxisTick(payloadMin, fmt(payloadMin, 2), COLORS.mutedText);

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