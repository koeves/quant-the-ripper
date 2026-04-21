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
   - Duplicates clip to _prepared track
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
   - Make manual modifications as needed
   - Click Prep again to reanalyze the _prepared track
6. Click Snap
![](img/snap.png)
   - Creates _quanted version
   - Snap wrap markers to target beat

## Limitations
- Depends on Ableton's transient marker quality -> transients need to be clear enough and placed at the right spots (like downbeats)
- Need to add all (or most) transients as warp markers beforehand, so the device has enough points to choose from -> V8 doesn't expose transients in its API, so this can't be done automatically
- Works best with:
   - steady BPM material
   - clear transients (kicks)

## Installation
- Download it from MaxForLive: https://maxforlive.com/library/device/15084/quant-the-ripper
