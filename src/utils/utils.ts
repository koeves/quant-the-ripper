namespace Utils {
    export function lastValue(v: any): any {
        return Array.isArray(v) ? v[v.length - 1] : v;
    }

    export function toNumber(v: any): number {
        return Number(v);
    }

    export function toPropertyString(v: any): String {
        if (v === null || v === undefined) return "";

        if (Array.isArray(v)) {
            if (v.length === 0) return "";
            if (v.length === 1) return String(v[0]);
            return String(v[v.length - 1]);
        }

        return String(v);
    }

    export function safeSet(api: Live.LiveAPI, prop: string, value: any): void {
        try {
            api.set(prop, value);
        } catch (e: any) {
            Live.post(`Warning: failed to set ${prop}=${value}: ${String(e)}\n`);
        }
    }

    export function pad2(n: number): string {
        return n < 10 ? `0${n}` : String(n);
    }
}