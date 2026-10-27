`moving-fish.webm` is a synthetic 160 × 100 grayscale video, 12 frames at 5 fps.
It contains two 12 × 10 dark rectangles, 60 pixels apart, moving four pixels to
the right each frame on a uniform light background. It contains no user footage.

The large contrast makes browser regressions independent of subtle video-decoder
differences. At the default 30.6 px/in calibration, a 4.2 cm link leaves the two
regions separate; a 5 in link joins them. The file includes a finite duration so
tests exercise the real video upload, metadata, seeking, and detection pipeline.
FFmpeg is not required to run the tests; the small video is checked in.
