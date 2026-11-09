// Drift graph for [jsui]. jsui runs Max's classic JavaScript engine (ES5):
// keep to var/function, no arrow functions, let/const or template strings.

declare function post(...args: any[]): void;
declare function outlet(index: number, ...args: any[]): void;
declare function arrayfromargs(...args: any[]): any[];

declare var mgraphics: any;
declare var box: any;
declare var outlets: number;
declare class Dict {
    constructor(name: string);
    get(key: string): any;
}

namespace GraphModel {
    export interface GraphPoint {
        i: number;
        xBeat: number;
        yBeats: number;
        yMs: number;
        /** Expected drift (beats); the tolerance band is drawn around it. Missing in 0.0.1 payloads. */
        yExp?: number;
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
}

outlets = 1;

/** Printed on load so the Max console shows which build Max picked up. */
var GRAPH_BUILD = "0.0.2-dev";
post("Quant the Ripper graph.js " + GRAPH_BUILD + " loaded\n");

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var graph: GraphModel.GraphPayload | null = null;
/** Index into stopIndices chosen with the arrows, or -1. */
var selectedStop = -1;
/** Point index chosen by clicking, or -1. Takes precedence over selectedStop. */
var clickedPoint = -1;
/** Point indices the arrows step through: outliers and the first point of each gap. */
var stopIndices: number[] = [];
/** Horizontal mapping of the last paint, used to map clicks back to points. */
var view = { xMin: 0, xMax: 1, plotX: 0, plotW: 1 };

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
    reject: [0.78, 0.42, 0.42, 0.95],
    outlier: [0.93, 0.75, 0.18, 1.0],
    tolRed: [0.86, 0.24, 0.24, 1.0]
};

/** Same rule as Analysis.navigationStops in quant.js. */
function computeStops(points: GraphModel.GraphPoint[]): number[] {
    var stops: number[] = [];
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p.outlier || (!p.ok && (i === 0 || points[i - 1].ok))) stops.push(i);
    }
    return stops;
}

function expected(p: GraphModel.GraphPoint): number {
    return typeof p.yExp === "number" ? p.yExp : 0;
}

function selectedPoint(): number {
    if (!graph) return -1;
    if (clickedPoint >= 0 && clickedPoint < graph.points.length) return clickedPoint;
    if (selectedStop >= 0 && selectedStop < stopIndices.length) return stopIndices[selectedStop];
    return -1;
}

function loadbang() {
    mgraphics.redraw();
}

function clear_graph() {
    graph = null;
    stopIndices = [];
    selectedStop = -1;
    clickedPoint = -1;
    mgraphics.redraw();
}

function left_graph() {
    if (!graph || stopIndices.length === 0) {
        return;
    }

    clickedPoint = -1;
    selectedStop--;
    if (selectedStop < 0) {
        selectedStop = stopIndices.length - 1;
    }

    mgraphics.redraw();
}

function right_graph() {
    if (!graph || stopIndices.length === 0) {
        return;
    }

    clickedPoint = -1;
    selectedStop++;
    if (selectedStop >= stopIndices.length) {
        selectedStop = 0;
    }

    mgraphics.redraw();
}

/** Max returns a one-element list from Dict.get as a plain value. */
function asList(v: any): any[] {
    if (v === null || v === undefined) return [];
    return Object.prototype.toString.call(v) === "[object Array]" ? v : [v];
}

/** Reads the graph quant.js wrote into the named dictionary (see GraphDict in quant.js). */
function graphFromDict(name: string): GraphModel.GraphPayload {
    var d = new Dict(name);
    if (Number(d.get("format")) !== 2) throw new Error("unknown graph format in dict " + name);
    var n = Number(d.get("n")) || 0;
    var ii = asList(d.get("i")), xs = asList(d.get("x")), ys = asList(d.get("y"));
    var ms = asList(d.get("ms")), exp = asList(d.get("exp")), flags = asList(d.get("flags"));
    var points: GraphModel.GraphPoint[] = [];
    for (var k = 0; k < n; k++) {
        var f = Number(flags[k]) || 0;
        points.push({
            i: Number(ii[k]),
            xBeat: Number(xs[k]),
            yBeats: Number(ys[k]),
            yMs: Number(ms[k]),
            yExp: Number(exp[k]),
            ok: (f & 1) !== 0,
            outlier: (f & 2) !== 0
        });
    }
    return {
        clipName: String(d.get("clipName")),
        tempo: Number(d.get("tempo")),
        gridBeats: Number(d.get("gridBeats")),
        toleranceBeats: Number(d.get("toleranceBeats")),
        toleranceMs: Number(d.get("toleranceMs")),
        xMin: Number(d.get("xMin")),
        xMax: Number(d.get("xMax")),
        yMinBeats: Number(d.get("yMinBeats")),
        yMaxBeats: Number(d.get("yMaxBeats")),
        yMinMs: 0,
        yMaxMs: 0,
        accepted: Number(d.get("accepted")),
        rejected: Number(d.get("rejected")),
        outliers: Number(d.get("outliers")),
        points: points
    };
}

/**
 * `graph_json <dict name>` from quant.js. A JSON string is still accepted
 * (older quant.js builds), but long ones get cut by Max, hence the dictionary.
 */
function graph_json() {
    var s = "";
    try {
        var args = arrayfromargs(arguments);
        for (var i = 0; i < args.length; i++) {
            if (i > 0) s += " ";
            s += String(args[i]);
        }

        graph = s.charAt(0) === "{" ? JSON.parse(s) : graphFromDict(s);
        stopIndices = graph && graph.points ? computeStops(graph.points) : [];
        selectedStop = -1;
        clickedPoint = -1;
        post("graph.js: received " + (graph && graph.points ? graph.points.length : 0) + " points\n");

        mgraphics.redraw();
    } catch (e) {
        post("graph_json failed: " + e + " (" + s.length + " chars: " + s.substring(0, 40) + ")\n");
    }
}

/** Click a bar to select it and move the playhead there; click it again to zoom back out. */
function onclick(x: number, _y: number) {
    if (!graph || !graph.points || graph.points.length === 0) return;
    if (x < view.plotX) return;

    var beat = view.xMin + ((x - view.plotX) / Math.max(1, view.plotW)) * (view.xMax - view.xMin);
    var best = -1;
    var bestDist = Infinity;
    for (var i = 0; i < graph.points.length; i++) {
        var d = Math.abs(graph.points[i].xBeat - beat);
        if (d < bestDist) {
            best = i;
            bestDist = d;
        }
    }
    if (best < 0) return;

    if (best === selectedPoint()) {
        clickedPoint = -1;
        selectedStop = -1;
        mgraphics.redraw();
        return;
    }

    clickedPoint = best;
    var stop = stopIndices.indexOf(best);
    selectedStop = stop;
    mgraphics.redraw();
    outlet(0, "goto_point", graph.points[best].i);
}

function setColor(c: Array<number>) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], c[3]);
}

function drawDashed(points: number[][], dash: number, gap: number) {
    // Dashes along a polyline given as [[x, y], ...].
    var on = true;
    var left = dash;
    for (var i = 1; i < points.length; i++) {
        var x0 = points[i - 1][0], y0 = points[i - 1][1];
        var x1 = points[i][0], y1 = points[i][1];
        var len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        var pos = 0;
        while (pos < len) {
            var step = Math.min(left, len - pos);
            var ax = x0 + (x1 - x0) * (pos / len), ay = y0 + (y1 - y0) * (pos / len);
            var bx = x0 + (x1 - x0) * ((pos + step) / len), by = y0 + (y1 - y0) * ((pos + step) / len);
            if (on) {
                mgraphics.move_to(ax, ay);
                mgraphics.line_to(bx, by);
                mgraphics.stroke();
            }
            pos += step;
            left -= step;
            if (left <= 0) {
                on = !on;
                left = on ? dash : gap;
            }
        }
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

var paintFailed = false;

function paint() {
    try {
        drawGraph();
        paintFailed = false;
    } catch (e) {
        // Report once per failure streak instead of on every redraw.
        if (!paintFailed) post("graph.js: paint failed: " + e + "\n");
        paintFailed = true;
    }
}

function drawGraph() {
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

    // Plot range covers the data and the tolerance band around the expected drift.
    var baseAbs = Math.max(Math.abs(payloadMin), Math.abs(payloadMax), tol);
    for (var ei = 0; ei < points.length; ei++) {
        baseAbs = Math.max(baseAbs, Math.abs(expected(points[ei])) + tol);
    }
    var plotAbs = baseAbs * 1.18; // headroom so the dashed lines are visible
    if (plotAbs <= 0) plotAbs = 1;

    // small left axis area
    var axisPad = 26;
    var plotX = axisPad;
    var plotY = 0;
    var plotW = Math.max(1, w - axisPad);
    var plotH = h;

    var xMin = graph.xMin;
    var xMax = graph.xMax;

    var sel = selectedPoint();
    if (sel >= 0) {
        var centerPoint = points[sel];
        var halfWindow = Math.max(graph.gridBeats * 4, 16); // show context around the selection

        xMin = Math.max(graph.xMin, centerPoint.xBeat - halfWindow);
        xMax = Math.min(graph.xMax, centerPoint.xBeat + halfWindow);

        // fallback if range collapses near boundaries
        if (xMax - xMin < graph.gridBeats * 2) {
            xMin = Math.max(graph.xMin, centerPoint.xBeat - graph.gridBeats * 2);
            xMax = Math.min(graph.xMax, centerPoint.xBeat + graph.gridBeats * 2);
        }
    }

    var xSpan = Math.max(1, xMax - xMin);
    view = { xMin: xMin, xMax: xMin + xSpan, plotX: plotX, plotW: plotW };

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

    // visible points, plus one on each side so band edges reach the borders
    var first = 0, last = points.length - 1;
    while (first < points.length - 1 && points[first + 1].xBeat < xMin) first++;
    while (last > 0 && points[last - 1].xBeat > xMax) last--;

    // tolerance band around the expected drift
    var top: number[][] = [];
    var bottom: number[][] = [];
    for (var ti = first; ti <= last; ti++) {
        var tx = Math.max(plotX, Math.min(plotX + plotW, xToPix(points[ti].xBeat)));
        top.push([tx, yToPix(expected(points[ti]) + tol)]);
        bottom.push([tx, yToPix(expected(points[ti]) - tol)]);
    }
    if (top.length === 1) {
        top = [[plotX, top[0][1]], [plotX + plotW, top[0][1]]];
        bottom = [[plotX, bottom[0][1]], [plotX + plotW, bottom[0][1]]];
    }
    setColor(COLORS.toleranceFill);
    mgraphics.move_to(top[0][0], top[0][1]);
    for (var bi1 = 1; bi1 < top.length; bi1++) mgraphics.line_to(top[bi1][0], top[bi1][1]);
    for (var bi2 = bottom.length - 1; bi2 >= 0; bi2--) mgraphics.line_to(bottom[bi2][0], bottom[bi2][1]);
    mgraphics.close_path();
    mgraphics.fill();

    // horizontal grid
    var gridVals = [payloadMin, 0, payloadMax];
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

    // red dashed tolerance edges
    setColor(COLORS.tolRed);
    mgraphics.set_line_width(1);
    drawDashed(top, 4, 3);
    drawDashed(bottom, 4, 3);

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
    drawAxisTick(payloadMin, fmt(payloadMin, 2), COLORS.mutedText);
    drawAxisTick(0, "0", COLORS.mutedText);

    // bars
    var visible = 0;
    for (var vi = 0; vi < points.length; vi++) {
        if (points[vi].xBeat >= xMin && points[vi].xBeat <= xMax) visible++;
    }
    var stepPx = plotW / Math.max(visible, 1);
    var barW = Math.max(1, Math.min(4, stepPx * 0.7));

    for (var bi = 0; bi < points.length; bi++) {
        var p = points[bi];

        if (p.xBeat < xMin || p.xBeat > xMax) {
            continue;
        }

        var thisBarW = bi === sel ? Math.max(barW + 2, barW * 1.5) : barW;
        var x = xToPix(p.xBeat) - thisBarW / 2;
        var y = yToPix(p.yBeats);

        if (p.outlier) {
            setColor(COLORS.outlier);
        } else {
            setColor(p.ok ? COLORS.ok : COLORS.reject);
        }

        var rectY = Math.min(y, zeroY);
        var rectH = Math.max(1, Math.abs(y - zeroY));
        mgraphics.rectangle(x, rectY, thisBarW, rectH);
        mgraphics.fill();
    }

    if (sel >= 0) {
        var sp = points[sel];

        if (sp.xBeat >= xMin && sp.xBeat <= xMax) {
            var sx = xToPix(sp.xBeat);
            var sy = yToPix(sp.yBeats);

            var label = fmt(sp.xBeat, 2) + (sp.ok ? "  " + fmt(sp.yMs, 1) + " ms" : "");
            var labelY = Math.max(12, Math.min(plotH - 8, sy - 8));
            var labelX = Math.max(plotX + 4, Math.min(plotX + plotW - 90, sx + 4));

            setColor(sp.outlier || !sp.ok ? COLORS.outlier : COLORS.text);
            mgraphics.move_to(labelX, labelY);
            mgraphics.show_text(label);
        }
    }
}
