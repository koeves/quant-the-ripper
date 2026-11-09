namespace Utils {
    /** Set to true to print verbose diagnostics to the Max console. */
    export let DEBUG = false;

    export function debug(...args: any[]): void {
        if (DEBUG) post(...args, "\n");
    }

    export function lastValue(v: any): any {
        return Array.isArray(v) ? v[v.length - 1] : v;
    }

    export function toNumber(v: any): number {
        return Number(v);
    }

    /** Reads a numeric LiveAPI property (LiveAPI.get returns arrays). */
    export function numberProp(obj: LiveAPI, property: string): number {
        return toNumber(lastValue(obj.get(property)));
    }

    export function toPropertyString(v: any): string {
        if (v === null || v === undefined) return "";

        if (Array.isArray(v)) {
            if (v.length === 0) return "";
            if (v.length === 1) return String(v[0]);
            return String(v[v.length - 1]);
        }

        return String(v);
    }

    export function round(n: number, digits: number = 7): number {
        const f = Math.pow(10, digits);
        return Math.round(n * f) / f;
    }

    export function mean(values: number[]): number {
        if (!values.length) return 0;
        let sum = 0;
        for (let i = 0; i < values.length; i++) sum += values[i];
        return sum / values.length;
    }

    export function min(values: number[]): number {
        if (!values.length) return 0;
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
            if (values[i] < m) m = values[i];
        }
        return m;
    }

    export function max(values: number[]): number {
        if (!values.length) return 0;
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
            if (values[i] > m) m = values[i];
        }
        return m;
    }

    export function abs(n: number): number {
        return n < 0 ? -n : n;
    }

    /** Ids that LiveAPI hands back for missing objects are 0. */
    export function isValidId(id: any): boolean {
        return id !== undefined && id !== null && id !== "" && Number(id) !== 0;
    }

    export function setProgress(text: string): void {
        State.state.progressText = text;
        outlet(0, "progress_text", String(text).replace(/"/g, ""));
    }

    export function clearProgress(): void {
        setProgress("");
    }

    /** Reports an error both to the Max console and to the device's status line. */
    export function fail(message: string): void {
        error(message + "\n");
        setProgress(message);
    }
}
