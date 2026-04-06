namespace Model {
    export type WarpMode = 0 | 1 | 2 | 3 | 4 | 6;

    export interface WarpMarker {
        beat_time: number;
        sample_time: number;
    }

    export interface MaybeArray<T> extends Array<T> { }

    export interface RuntimeState {
        initialized: boolean;
    }
}