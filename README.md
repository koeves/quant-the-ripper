# Quant the Ripper
A Max For Live device to quantize and warp audio with varying drift (e.g. vinyl rips)

![](img/ripper-demo.gif)

## Overview
Quant the Ripper analyzes warp marker drift relative to a fixed beat grid and:

* selects warp markers within tolerance closest to the target beat
* removes unneeded markers
* detects drift outliers
* snaps accepted markers to the grid in a second pass

The workflow is designed for techno / 4x4 material where timing consistency matters but full-track warping is too destructive or inconsistent.

## Step-by-step
1. Select an Arrangement audio clip
2. Add all transients as warp markers (go to sample view, enable Warp, select the whole sample/song, right click and select Insert Warp Marker(s) / or press Cmd+I)
3. Click Prep
![](img/prep.png)
   - Duplicates clip to a _prepared track right below the original
   - Finds nearest warp marker per grid point
   - Analyzes drift:
     ```
     drift = markerBeat - targetBeat
     ```
   - Accepts markers within tolerance closest to the specified beat grid interval
   - Detects outliers via:
      - sign inconsistencies
      - local spikes
      - sudden jumps
4. Review graph / navigate outliers 
![](img/outlier.png)
   - Left/right step through outliers and move the Arrangement playhead to each one
   - Make manual modifications on the _prepared clip as needed
   - Click Prep again to reanalyze the _prepared clip (manual edits are kept)
   - Changing grid, tolerance or start beat and clicking Prep rebuilds the _prepared clip from the original
5. Click Snap
![](img/snap.png)
   - Re-reads the _prepared clip, so edits made since the last Prep are included
   - Creates a _quanted version
   - Snaps warp markers to the target beat
6. Click Clear to delete the _prepared and _quanted tracks

## Limitations
- Depends on Ableton's transient marker quality -> transients need to be clear enough and placed at the right spots (like downbeats)
- Need to add all (or most) transients as warp markers beforehand, so the device has enough points to choose from -> V8 doesn't expose transients in its API, so this can't be done automatically
- Works best with:
   - steady BPM material
   - clear transients (kicks)
- Tolerance must be less than half the grid, so a marker can never be matched to two grid points

## Installation
- Download it from MaxForLive: https://maxforlive.com/library/device/15084/quant-the-ripper

## Build
The device's JavaScript is written in TypeScript and compiled to `plugin/quant.js` (device logic) and `plugin/graph.js` (drift graph), which the device loads.
```bash
npm ci
npm run build
```

Tests run the compiled scripts under Node against an in-memory mock of the Live API (`test/mock-live.js`):
```bash
npm test
```

Send `debug 1` to the `quant.js` object to print verbose diagnostics to the Max console.

## Licence
Apache-2.0, see [LICENSE](LICENSE).
