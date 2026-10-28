`moving-fish.webm` is a synthetic 160 × 100 grayscale video, 12 frames at 5 fps.
It contains two 12 × 10 dark rectangles, 60 pixels apart, moving four pixels to
the right each frame on a uniform light background. It contains no user footage.

The large contrast makes browser regressions independent of subtle video-decoder
differences. At the default 30.6 px/in calibration, a 4.2 cm link leaves the two
regions separate; a 5 in link joins them. The file includes a finite duration so
tests exercise the real video upload, metadata, seeking, and detection pipeline.
FFmpeg is not required to run the tests; the small video is checked in.

`single-fish.webm` is a lossless 320 × 200 grayscale video, 12 frames at 5 fps.
One 24 × 20 rectangle moves right by 12 pixels per frame on a uniform background.
Its first center is (51.5, 99.5); it crosses x=160 between samples 10 and 11.
The expected observed window is 2.2 seconds and speed is 60 pixels per second.
Its different resolution also exercises saved-setup dimension checks.

Regenerate with FFmpeg (only needed when changing the fixture):

```sh
ffmpeg -f lavfi -i 'color=c=0xdddddd:s=320x200:r=5:d=2.4' \
  -vf "geq=lum='if(between(X,40+12*N,63+12*N)*between(Y,90,109),25,220)':cb=128:cr=128" \
  -c:v libvpx-vp9 -lossless 1 -pix_fmt yuv420p -an single-fish.webm
```
