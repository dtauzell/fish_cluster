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

## Second batch

| Owner | Scenarios | File |
| --- | --- | --- |
| Terra | Four-corner crop export, unfinished corner undo/cancel, calibration under zoom | `tests/browser/geometry.spec.mjs` |
| Terra | Reload cached app, analyze, correct and download JSON/CSV plus open cached help while offline | `tests/browser/offline-analysis.spec.mjs` |
| Luna | Reject automatic reuse and manual application of setups on mismatched video dimensions; apply again on matching dimensions | `tests/browser/setup-dimensions.spec.mjs` |
| Coordinator | Stop during background preparation or after two decoded samples; export partial results and restart | `tests/browser/cancellation.spec.mjs` |
| Coordinator | Real one-fish crossing, calibrated speed, missing-position gaps, restoration and saving a fully observed trial | `tests/browser/single-fish.spec.mjs` |

The new lossless single-fish fixture is 320 × 200, with exact 12-pixel steps at
5 fps. Its generation command is in the fixtures README; FFmpeg is not needed
to run tests. Flicker learning is disabled for this short constant-floor clip.
Cancellation tests gate the real pipeline at event boundaries so Stop is
deterministic while decoding and detection still execute normally.

The crossing regression exposed coverage rounding slightly above 100%, which
prevented saving a complete trial. Coverage now caps at 1; a Node regression
also verifies that the resulting report can be saved.

Second batch verification: all 30 Chromium tests pass (8 new in this batch),
and all 236 Node tests pass. The first batch is committed as `928fdaa`; the
second batch and the coverage-rounding fix are committed as `96b0645`.

## Third batch

| Owner | Scenarios | File |
| --- | --- | --- |
| Terra | Multiple fish, equal-fish means with unequal valid durations, absent-metric counts, trial/exposure separation, persistence and CSV downloads | `tests/browser/trial-groups.spec.mjs` |
| Terra | Frame-local Fish/Reflection labels, clearing with Unsure, comparison CSV/JSON, labels leaving results and corrections unchanged | `tests/browser/diagnostics.spec.mjs` |
| Coordinator | Stop a light/dark run, finish review, save its partial snapshot, reload and verify per-fish/group CSVs | `tests/browser/partial-trials.spec.mjs` |
| Coordinator | Invalid replacement video, mid-analysis decoder failure, corrupt data, blocked storage reads and quota failure, with analysis/export/retry recovery | `tests/browser/failure-recovery.spec.mjs` |

Trial workflows share small test helpers for real single-fish preparation,
downloads and independent CSV parsing in `tests/browser/trial-helpers.mjs`.
Storage failures are injected only at the browser Storage boundary. Decoder
failure and partial-run synchronization use test-only wrappers around the real
pipeline; no results or persisted trial records are fabricated.

Third batch verification: all 38 Chromium tests pass (8 new in this batch),
and all 236 Node tests pass. No application-source changes were needed.

## Remaining coverage and resuming work

The three implemented batches cover the main workflows. Last verified on
2026-10-28: 38 Chromium tests and 236 Node tests pass. No additional test
implementation is in progress. Remaining work, in recommended order:

| Priority | Model | Work and acceptance criteria |
| --- | --- | --- |
| 1 | Terra | Canvas correction boundaries: draw centers outside a crop and inside reflection masks, including while zoomed or showing the full frame. Verify applied counts and metrics exclude those centers while review exports preserve the marks with the correct inclusion flags. Check original-video coordinates with a crop offset and four-corner geometry. |
| 2 | Sol for setup; Terra for workflows | WebKit/Safari coverage: check both synthetic fixtures decode correctly, then run upload, seeking, corrections and downloads under Playwright WebKit. Add browser installation to CI when CI is configured. Keep real Safari checks for platform-specific behavior; WebKit automation does not replace them. Consider Firefox after WebKit. |
| 3 | Luna | Clipboard success and fallback: verify center/crop coordinate text, sample/time context where applicable, success feedback and the selection/manual-copy fallback when clipboard access is unavailable or rejected. Copying must not apply draft corrections. |

Start with the boundary checks; the existing `corrections.spec.mjs`,
`geometry.spec.mjs` and `setup.spec.mjs` provide the relevant fixtures and
canvas interactions. Recheck the working tree and run `npm run test:all` when
resuming to establish the current baseline. Follow the isolated ports/output
rules above if delegating parallel batches. Commit history contains the completed
batches; later work should target these specific risks or reported bugs.
