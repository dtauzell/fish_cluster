# Background subtraction trial

Run `python3 experiments/background_subtraction.py` from the repository root. It requires `ffmpeg`, NumPy, and SciPy.

The script samples `fish.mov` at 5 frames/second (the app's default 200 ms interval), crops the tank to `(x=50, y=240, width=420, height=290)`, and forms a median grayscale background from all sampled frames. Darker regions with a difference of at least 24 gray levels are cleaned with binary morphology and filtered to areas of 45–2500 pixels. Exported coordinates refer to the original 540 × 960 video.

The run on this video produced 602 frames, 5.29 detections/frame on average, and a median of 5. The tank contains five fish; the detector found 3–9 blobs/frame. These are detection counts, not verified fish counts: tank edges and fixtures can be false positives, while adjacent or overlapping fish can merge into one blob. Around 50 seconds, the detector finds four blobs; at 50.2 seconds it finds five as a close pair separates. A central, unobstructed part of the paper grid measures roughly 15–16 px per 0.5-inch square, or about 30–32 px/in. Scale elsewhere in the image may vary because of perspective and water optics.

Results are in `background_results/detections.csv`. The script also creates `dist/background-test.html` with ten annotated frames and their detected counts; red boxes mark blobs and green crosses mark exported positions. This is an exploratory detector, not a validated replacement for the app's browser detector.
