# Sequential decoding experiment — 2026-10-23

**Decision: do not enable this path in the application.** Capture-only savings
were small, while rendered pixels failed the accuracy comparison. The experiment
and its reproduction tools are kept here; no application code was changed.

## What was tested

On the same Apple M1 / 16 GiB / Safari 27.0.1 setup as the earlier profiles,
WebCodecs `VideoDecoder` decoded all 3,608 H.264 packets of `fish.mov` in decoding
order. Output frames were selected in presentation order for the 602 analysis
samples and 25 background-building samples. The decoder queue was bounded to 24
pending chunks and frames were closed when no longer needed.

Packet offsets, timestamps, and the AVC decoder description were prepared with
`ffprobe` offline. This deliberately excludes browser container parsing and its
implementation cost, giving sequential decoding a favorable early test before
adding a demuxing dependency to the app. Video loading was outside both timers.

For each comparison, the current crop-sized HTML video capture read the same 627
requested timestamps after seeking. The prototype caches sampled grayscale
images so the existing detector can use its normal background-first order after
a single sequential pass. That cache alone is **76,368,600 bytes** (about 72.8
MiB), in addition to the compressed video, decoder buffers, and other state.

## Timing

| Full-frame VideoFrame rendering case | Current seek + cropped read | Sequential decode + sample capture |
| --- | ---: | ---: |
| Default decoder color settings | 3.596 s | 3.476 s |
| Explicit container color settings | 3.634 s | 3.376 s |
| Repeated default settings | 3.633 s | 3.473 s |
| Mean | **3.621 s** | **3.442 s** |

This is a **5.0% reduction in capture time**, about 179 ms. It is not an
end-to-end analysis speedup: container parsing, visible preview updates, and
analysis are outside these capture timers. Each pair decoded sequentially first
and sought second, so small scheduling/cache differences can affect the result.
Earlier direct crop drawing with explicit color settings took 3.594 s versus
3.737 s for seeking, and failed the pixel comparison as well.

## Timestamp and pixel checks

- All 627 selected decoded timestamps matched the independently computed packet
  presentation interval containing the requested sample timestamp. The largest
  offset between the requested timestamp and the start of its selected frame
  was 33,333 microseconds. This verifies packet selection, not equivalence to
  the HTML video's internal frame presentation behavior.
- All 627 sampled grayscale images differed from the existing capture path.
- With full-frame VideoFrame drawing, **76,368,266 of 76,368,600 grayscale bytes
  differed**, with a maximum absolute difference of 105 levels. On the first
  sample, mean gray level was 168.86 versus 177.87 for the current capture path.
- Direct cropped VideoFrame drawing produced a different mismatch pattern
  (75,860,503 differing bytes, maximum difference 218), so both rendering
  approaches were examined.
- The recording's metadata reports Display P3 primaries (`smpte432`), BT.709
  transfer, SMPTE 170M matrix, and full range. Returned VideoFrames reported
  `bt709` primaries, `iec61966-2-1` transfer, `bt709` matrix, and full range.
  Supplying the recording's color settings in `VideoDecoderConfig` did not change
  the reported output color space or fix the pixel differences in this test.
  This identifies an unresolved conversion/rendering difference; it does not
  establish a general browser bug or prove that color metadata is its only cause.
- The baseline cached images reproduced the established analysis result exactly:
  358 retained frames, 244 skipped, and SHA-256
  `19a799bc51e7c7d111591a3ddd30de5690f55d6c4262c80bebaed4538b29fdb8`.
- Sequential images were not passed through the full detector after failing
  pixel parity. No equivalent detection-result claim is made for that path.

Cached baseline analysis uses a fetched copy of `pipeline.mjs` with its
cooperative timer yield removed. This avoids Safari's timer throttling for
data-only work and isolates the CPU check; those CPU timings should not be
compared with normal-app wall time. Production modules were not modified.

## Consequence

There is no validated performance improvement to ship from this prototype.
Before reconsidering this approach, it would need correct frame rendering,
support for the actual uploaded container and its metadata, a bounded-memory
sampling strategy, and an end-to-end benchmark showing a worthwhile gain. A
second decoding pass to avoid caching all samples, or extra pixel conversion to
match the current capture path, could consume the small observed saving.

The API's required output handling, color-space fields, and frame lifecycle are
documented in the [WebCodecs specification](https://www.w3.org/TR/webcodecs/).
These are measurements of this prototype on this recording and Safari, not a
general conclusion about sequential decoding or other browsers.

Raw measurements: [sequential-decode-results.json](sequential-decode-results.json).
Reproduction instructions: [README.md](README.md).
