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

namespace DriftGraphUI {
    let graph: GraphModel.GraphPayload | null = null;

    export function setup(): void {
        mgraphics.init();
        mgraphics.relative_coords = 0;
        mgraphics.autofill = 0;
    }

    export function loadbang(): void {
        setup();
        mgraphics.redraw();
    }

    export function clear(): void {
        graph = null;
        mgraphics.redraw();
    }

    export function graph_json(): void {
        const s = arrayfromargs.apply(null, arguments as any).join(" ");
        try {
            const obj = JSON.parse(s);
            graph = obj.payload ? obj.payload : obj;
            mgraphics.redraw();
        } catch (e: any) {
            post("graph_json parse failed: " + String(e) + "\n");
        }
    }

    export function paint(): void {
        const w = box.rect[2] - box.rect[0];
        const h = box.rect[3] - box.rect[1];

        mgraphics.set_source_rgba(0.1, 0.1, 0.1, 1);
        mgraphics.rectangle(0, 0, w, h);
        mgraphics.fill();

        if (!graph || !graph.points || graph.points.length === 0) {
            mgraphics.set_source_rgba(0.9, 0.9, 0.9, 1);
            mgraphics.move_to(10, 20);
            mgraphics.show_text("No analysis");
            return;
        }

        const points = graph.points;
        const tol = Math.max(Math.abs(graph.toleranceBeats), 0.0001);
        const maxAbs = Math.max(
            Math.abs(graph.yMinBeats),
            Math.abs(graph.yMaxBeats),
            tol
        );

        const leftPad = 10;
        const rightPad = 10;
        const topPad = 20;
        const bottomPad = 20;

        const plotW = w - leftPad - rightPad;
        const plotH = h - topPad - bottomPad;
        const zeroY = topPad + plotH / 2;

        function yToPix(v: number): number {
            return zeroY - (v / maxAbs) * (plotH / 2);
        }

        mgraphics.set_source_rgba(0.25, 0.25, 0.25, 1);
        const yTolTop = yToPix(tol);
        const yTolBottom = yToPix(-tol);
        mgraphics.rectangle(leftPad, yTolTop, plotW, yTolBottom - yTolTop);
        mgraphics.fill();

        mgraphics.set_source_rgba(0.9, 0.9, 0.9, 1);
        mgraphics.set_line_width(1);
        mgraphics.move_to(leftPad, zeroY);
        mgraphics.line_to(leftPad + plotW, zeroY);
        mgraphics.stroke();

        const n = points.length;
        const step = plotW / Math.max(n, 1);
        const barW = Math.max(1, step * 0.7);

        for (let i = 0; i < n; i++) {
            const p = points[i];
            const x = leftPad + i * step + (step - barW) / 2;
            const y = yToPix(p.yBeats);

            if (p.ok) {
                mgraphics.set_source_rgba(0.3, 0.8, 0.4, 1);
            } else {
                mgraphics.set_source_rgba(0.8, 0.3, 0.3, 0.8);
            }

            const rectY = Math.min(y, zeroY);
            const rectH = Math.max(1, Math.abs(y - zeroY));
            mgraphics.rectangle(x, rectY, barW, rectH);
            mgraphics.fill();
        }

        mgraphics.set_source_rgba(0.95, 0.95, 0.95, 1);
        mgraphics.move_to(10, 14);
        mgraphics.show_text(
            graph.clipName +
            " | tol=" + graph.toleranceBeats +
            " beats | accepted=" + graph.accepted +
            "/" + (graph.accepted + graph.rejected)
        );
    }
}

function loadbang(): void {
    DriftGraphUI.loadbang();
}

function paint(): void {
    DriftGraphUI.paint();
}

function graph_json(): void {
    DriftGraphUI.graph_json.apply(null, arguments as any);
}

function clear(): void {
    DriftGraphUI.clear();
}