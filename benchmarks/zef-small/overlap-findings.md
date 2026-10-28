# Motion-guided overlap trial

82 frames across two 2-second windows, sampled at 20 fps. Original resolution,
fixed median background, same labels and scoring as the small benchmark.

| Method | Visible matched / 126 | Occluded matched / 38 | False detections |
| --- | ---: | ---: | ---: |
| Current detector | 118 | 4 | 84 |
| Larger component limit alone | 126 | 21 | 84 |
| Kalman-guided selection and splitting | 88 | 9 | 6 |

At frame 1501, both predictions supported the merged region. Seeded splitting
produced two estimated centers inside the two labeled boxes, with no extra
selected detection. This is a localization match, not evidence of correct
individual identity or precise recovery of each body.

At frame 1201, predictions were at approximately (1087,1328) and (1383,1344),
while the merged component center was around (1168,1301). The support/gating
conditions did not accept a split, and no observed position was returned.
The real fish maneuvered beyond the useful predictions. This prototype has no
robust track reacquisition after a sustained loss.

Conclusion: temporal seeds can help this overlap (1501), but this implementation
is not an overall improvement. It substantially reduces false detections at the
cost of missing more real fish. Increasing the component limit alone improves
recall more on these windows, but leaves the reflection problem unresolved.

Next work should test uncertainty growth, maneuver handling, and controlled
reacquisition, plus distinguishing merged bodies from reflections. Evaluate on
additional windows before changing production. Do not tune only on these two
known failures. The experiment combines multiple changes and does not isolate
the effect of a Kalman filter alone.

Run instructions: README.md, “Motion-guided overlap experiment”. Full metrics,
per-frame positions, and selected overlays: results/overlap-experiment/.
