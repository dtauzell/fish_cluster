# Overlap failures: frames 1201 and 1501

Reproduce with `node benchmarks/zef-small/diagnose.mjs` (Node + FFmpeg).
Generated masks and stage results: `results/diagnostics/`.
Production detector source and benchmark baseline are unchanged by this diagnostic.

Both frames preserve the actual fish in the threshold/morphology mask, but the
fish touch and form a single connected component. That region is then rejected
by the default maximum component area of 2,500 pixels, before overlap splitting.

| Frame | Merged fish component area | Surviving false component area |
| --- | ---: | ---: |
| 1201 | 3,818 | 971 |
| 1501 | 3,819 | 74 |

The 1201 false component corresponds visually to the reflection below the fish.
The 1501 survivor is a tiny separate fragment below the merged fish.
Contrast and border exclusion do not eliminate the real fish in these examples.

Diagnostic reruns with maxArea=20,000 retain the merged fish component in both
frames, but still retain the false component. They do not recover two distinct
fish. `splitLargeBlobs` only enters its ordinary splitting loop when candidate
count is below expectedFish; merged fish plus false component already equals
the expected count of two. Thus false positives can suppress overlap recovery.

Recommended follow-up: allow plausible merged components to reach overlap
analysis, assess component size/shape rather than candidate count alone, and
validate reflection rejection separately. Raising maxArea alone is insufficient.
This is evidence for these two frames, not a general accuracy assessment.
