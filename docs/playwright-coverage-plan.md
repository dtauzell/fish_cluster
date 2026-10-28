# Playwright coverage expansion

The existing Chromium suite covers review issue filters, playback, distance units,
reanalysis, test switching, and offline release activation. Expand coverage at
the browser boundary: real uploads, drawing, navigation, storage, and downloads.
Keep mathematical and detector edge cases in the existing Node tests.

## Implementation batches

| Batch | Model | Scenarios | File |
| --- | --- | --- | --- |
| Navigation and basic controls | Luna | Initial chooser and disabled analysis; mode-specific controls; sampling summary; About round trip preserving results/corrections; review Help open/close | `tests/browser/navigation.spec.mjs` |
| Tank geometry and saved setups | Terra | Precise crop applied to exported settings; reflection mask drawing and undo/clear; named setup save/apply/reload/delete and duplicate validation; preview focus/zoom controls where useful | `tests/browser/setup.spec.mjs` |
| Light/dark and trial collection | Terra | Light/dark mode analyzes real video; summary CSV/JSON consistency; trial validation, duplicate prevention, explicit replacement; persistence/removal and per-fish/group CSV downloads | `tests/browser/light-dark.spec.mjs` |
| Correction lifecycle and artifacts | Sol (coordinator) | Accept automatic centers versus explicit empty correction; restore automatic centers; draft undo; review CSV and downloaded original-resolution PNG | `tests/browser/corrections.spec.mjs` |

Luna gets explicit, bounded interactions using existing helpers. Terra owns
multi-step features with storage and canvas interactions. Sol reviews assertions,
integrates the batches, and investigates failures spanning features.

## Test rules and acceptance

- Use the checked-in synthetic video and real application pipeline. No user footage,
  external services, production changes, or new dependencies are needed.
- Each test starts with isolated storage. Block service workers outside the existing
  offline suite. Use user-visible actions and exported artifacts as evidence.
- Prefer Playwright assertions to fixed sleeps. Canvas coordinates must derive from
  its displayed bounds and known video dimensions.
- Keep each batch in its own file; shared helper changes belong to the coordinator.
- Run batches on distinct `FISH_BROWSER_TEST_PORT` values while agents work,
  with a distinct `--output=/tmp/fish-<batch>-results --reporter=line` for each
  run so Playwright cannot delete another run's traces or overwrite its report.
- Run the combined browser suite and existing Node suite after integration. Retain
  failure traces/screenshots and resolve failures before declaring completion.

## Completed first batch

All four batches are implemented: Luna added 4 tests, Terra added 5 tests across
two batches, and the coordinator added 4 correction/artifact tests. The combined
Chromium suite passes all 22 tests (9 existing plus 13 new); the existing Node
suite passes all 235 tests. Application source and dependencies were unchanged.

## Follow-up coverage

These need dedicated fixtures or synchronization and are outside this first batch:
stopping a long analysis and exporting partial results (Sol), reliable single-fish
crossings and velocity gaps (Terra after a one-fish fixture is defined), mismatched
video dimensions for saved setups (Terra with a second fixture), four-corner tank
geometry/calibration under zoom (Terra), and actual analysis/downloads while offline
(Terra). Browser expansion to Firefox/WebKit should follow fixture compatibility
checks and CI browser installation planning (Sol).
