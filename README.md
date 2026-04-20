# Quant the Ripper
A Max For Live device to quantize and warp vinyl rips with varying drift

![](img/ripper-demo.gif)

## Overview
Quant the Ripper analyzes warp marker drift relative to a fixed beat grid and:

* selects warp markers within tolerance closest to the target beat
* removes unneeded markers
* detects drift outliers
* snaps accepted markers to the grid in a second pass

The workflow is designed for techno / 4x4 material where timing consistency matters but full-track warping is too destructive.

## Step-by-step
1. Select an Arrangement audio clip
2. Add all transients as warp markers (go to sample view, enable Warp, select the whole sample/song, right click and select Insert Warp Marker(s) / or press Cmd+I)
3. Click Prep
![](img/prep.png)
   - this duplicates clip to _prepared track
   - analyzes drift
   - removes unneeded markers
4. Review graph / navigate outliers 
![](img/outlier.png)
5. Click Snap
![](img/snap.png)
   - creates _quanted version
   - aligns markers to grid

## How It Works
- Finds nearest warp marker per grid point
- Computes drift:
    ```
    drift = markerBeat - targetBeat
    ```
- Accepts markers within tolerance
- Detects outliers via:
   - sign inconsistencies
   - local spikes
   - sudden jumps
- Snaps remaining markers to grid

## Limitations
- Assumes 4/4 rhythmic structure
- Depends on initial warp and transient quality
- Works best with:
   - steady BPM material
   - clear transients (kicks)

## Installation
- Copy .amxd into your Ableton User Library
- Load device onto a track
- Ensure clip is in Arrangement View
