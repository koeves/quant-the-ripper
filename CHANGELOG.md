# Changelog

## Unreleased

### Added
- Drift tracking (Track, on by default): each grid point's marker is searched where the drift of the previous markers predicts, so rips that run slightly fast or slow stay matched all the way through, even past a full beat of drift. Outliers are judged against that trend.
- Kick detection (Detect): Prep reads the clip's audio file, finds the kicks (low-pass, envelope, peak picking) and adds them as warp markers on the prepared clip with `add_warp_marker`. Manual Insert Warp Markers is no longer needed.
- Snap Strength: move markers part of the way to the grid.
- Re-Pitch option: Snap sets the quanted clip to Re-Pitch warp mode.
- ← → also stop at gaps (grid points without a marker) and put the playhead where the marker should be.
- Click a bar in the graph to jump there; click it again to zoom out.
- The graph's tolerance band follows the expected drift.

### Changed
- Tolerance is set in milliseconds (5–200 ms, default 50 ms) and limited to less than half the grid instead of failing.
- Beatgrid offers 1/4, 1/2, 1 bar, 2 bars and 4 bars.
- `prep` takes the tolerance in ms. New messages to `quant.js`: `track`, `detect`, `strength`, `repitch`, `goto_point`.
- Snap moves markers in an order that never crosses a neighbour, and removes leftover unmatched markers on the quanted copy first.
- The device is wider, with an options column right of the graph.
- `_prepared` and `_quanted` tracks are inserted next to the original track instead of at the end of the set.
- Reset deletes the created tracks by id, so renamed tracks are still removed and unrelated tracks with the same name are left alone.
- Snap re-analyzes the `_prepared` clip first, so manual marker edits made after the last Prep are used.
- Left/Right move the Arrangement playhead to the selected outlier.
- Errors (no clip selected, not an audio/Arrangement clip, Warp off, too few markers, invalid settings) are shown in the device status line, not only in the Max console.
- Prep refuses to start from a `_prepared`/`_quanted` copy, and Prep/Snap are ignored while marker processing is still running.
- Pending tasks are cancelled when the device is removed.
- Verbose console logging is off by default; send `debug 1` to turn it on (hidden `debug 1`/`debug 0` message boxes in the patcher).
- Info View texts describe the new Prep, Snap, arrow and Tolerance behaviour.
- Removed the unused `markers` message box from the patcher.

### Fixed
- Graph: outlier list was appended to on every Prep instead of replaced, so stepping through outliers after a re-Prep jumped to wrong or duplicate bars.
- Graph: the highlighted outlier bar was offset but not widened.
- Graph: bars stayed hairline-thin when zoomed in on an outlier.
- First press of Left showed outlier 1 in the status line while the graph highlighted the last outlier.
- After a Snap, outlier navigation stayed disabled until Reset, even after a new Prep.
- Prep ignored changed grid, tolerance and start beat once a clip had been analyzed.
- Status text reported the number of grid points as "selected"/"snapped" markers; it now reports kept and moved markers.
- Average drift included rejected grid points; it now covers accepted markers only.
- Outlier reasons were shown wrapped in quotes.
- `_quanted` track name was built by replacing the first "prepared" in the name, which broke for clip names containing that word.
- Grid targets were accumulated by repeated addition, drifting off-grid on long tracks with grids such as 1/3 beat.
- Live's hidden trailing warp marker could be matched to a grid point.
- Warp marker call results were never recognised as successful, so the console counts were always wrong.
- Prep could crash when the duplicated clip could not be found.
- Info View text of the → button said "previous outlier".

### Development
- Device is now in the repo: `device/Quant the Ripper.maxpat` (source) and `device/Quant the Ripper.amxd` (packed with `npm run device:pack`, extracted with `npm run device:unpack`).
- Scripts build into `device/` next to the device.
- Contract tests check every patch message has a handler in the scripts and the `.amxd` matches the `.maxpat`.
- Added Node test suite (`npm test`) running the compiled scripts against a mock Live API.
- Build fails on type errors and unused code.
- `package.json` version and licence now match the project.

## 0.0.1

First release.
