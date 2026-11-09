/**
 * Hands graph data to graph.js through a named Max dictionary.
 *
 * Sending the graph as one JSON string through the patch breaks on long
 * tracks: Max cuts very long symbols (the 0.0.2 payload for ~400 grid points
 * was ~38k characters and arrived truncated). A dictionary holds plain number
 * lists of any length, and only its short name travels through the patch.
 */
namespace GraphDict {
    /** Bumped when the layout below changes; graph.js checks it. */
    export const FORMAT = 2;

    /** Point flags: bit 0 = kept (accepted), bit 1 = outlier. */
    export const FLAG_OK = 1;
    export const FLAG_OUTLIER = 2;

    const instance = Math.floor(Math.random() * 1e9).toString(36);

    export function nameFor(selector: string): string {
        return "qtr_" + instance + "_" + selector;
    }

    function listLength(v: any): number {
        return Array.isArray(v) ? v.length : (v === undefined || v === null ? 0 : 1);
    }

    /**
     * Stores a number list. Max's docs are vague on whether Dict.set takes a
     * list as separate arguments or as one array, so read it back and fall
     * back to the array form if the length is wrong.
     */
    function setList(d: Dict, key: string, values: number[]): void {
        if (!values.length) {
            d.set(key, 0);
            return;
        }
        d.set.apply(d, [key].concat(values as any[]) as [string, ...any[]]);
        if (listLength(d.get(key)) !== values.length) d.set(key, values);
        if (listLength(d.get(key)) !== values.length) {
            throw new Error("could not store " + values.length + " values for " + key + " in dict");
        }
    }

    function round(values: number[], digits: number): number[] {
        return values.map((v) => Utils.round(v, digits));
    }

    /** Writes the graph into a dictionary and sends `<selector> <dict name>` to the patch. */
    export function send(selector: string, graph: Model.GraphPayload): void {
        const name = nameFor(selector);
        const d = new Dict(name);
        d.clear();
        const pts = graph.points;
        d.set("format", FORMAT);
        d.set("n", pts.length);
        d.set("clipName", graph.clipName);
        d.set("tempo", graph.tempo);
        d.set("gridBeats", graph.gridBeats);
        d.set("toleranceBeats", graph.toleranceBeats);
        d.set("toleranceMs", graph.toleranceMs);
        d.set("xMin", graph.xMin);
        d.set("xMax", graph.xMax);
        d.set("yMinBeats", graph.yMinBeats);
        d.set("yMaxBeats", graph.yMaxBeats);
        d.set("accepted", graph.accepted);
        d.set("rejected", graph.rejected);
        d.set("outliers", graph.outliers);
        setList(d, "i", pts.map((p) => p.i));
        setList(d, "x", round(pts.map((p) => p.xBeat), 5));
        setList(d, "y", round(pts.map((p) => p.yBeats), 5));
        setList(d, "ms", round(pts.map((p) => p.yMs), 2));
        setList(d, "exp", round(pts.map((p) => p.yExp), 5));
        setList(d, "flags", pts.map((p) => (p.ok ? FLAG_OK : 0) | (p.outlier ? FLAG_OUTLIER : 0)));
        outlet(0, selector, name);
    }
}
