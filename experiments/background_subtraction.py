"""Evaluate simple fixed-camera fish detection on fish.mov.

Requires ffmpeg, NumPy, and SciPy. Writes CSV and a ten-frame HTML report.
Run: python3 experiments/background_subtraction.py
"""

from pathlib import Path
import csv
import subprocess

import numpy as np
from scipy import ndimage as ndi


ROOT = Path(__file__).resolve().parents[1]
VIDEO = ROOT / "fish.mov"
OUT = ROOT / "experiments" / "background_results"
PUBLIC_OUT = ROOT / "dist" / "background-test"
FPS = 5
X, Y, W, H = 50, 240, 420, 290
THRESHOLD = 24
MIN_AREA = 45
MAX_AREA = 2500
EXPECTED_FISH = 5
SAMPLE_INDICES = [0, 25, 50, 100, 150, 250, 300, 350, 450, 550]


def decode_gray():
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(VIDEO),
        "-vf", f"fps={FPS},crop={W}:{H}:{X}:{Y},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    raw = subprocess.check_output(command)
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W)


def detect(frame, background):
    # Fish appear darker than the empty tank. Ignore bright reflections.
    difference = background.astype(np.int16) - frame.astype(np.int16)
    mask = difference >= THRESHOLD
    mask = ndi.binary_opening(mask, iterations=1)
    mask = ndi.binary_closing(mask, iterations=2)
    # The fish stay inside the white floor; these strips contain tank edges.
    mask[:20, :] = False
    mask[-20:, :] = False
    mask[:, :12] = False
    mask[:, -12:] = False
    labels, count = ndi.label(mask)
    boxes = []
    for label in range(1, count + 1):
        ys, xs = np.where(labels == label)
        area = len(xs)
        if not MIN_AREA <= area <= MAX_AREA:
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        width, height = x1 - x0 + 1, y1 - y0 + 1
        if max(width, height) < 10:
            continue
        boxes.append((x0 + X, y0 + Y, x1 + X, y1 + Y, int(xs.mean() + X), int(ys.mean() + Y), area))
    return boxes, mask


def preview(frame, boxes, destination):
    image = np.repeat(frame[:, :, None], 3, axis=2).copy()
    for x0, y0, x1, y1, cx, cy, _ in boxes:
        x0, x1 = x0 - X, x1 - X
        y0, y1 = y0 - Y, y1 - Y
        image[max(0, y0):min(H, y0 + 2), x0:x1 + 1] = (255, 45, 45)
        image[max(0, y1 - 1):min(H, y1 + 1), x0:x1 + 1] = (255, 45, 45)
        image[y0:y1 + 1, max(0, x0):min(W, x0 + 2)] = (255, 45, 45)
        image[y0:y1 + 1, max(0, x1 - 1):min(W, x1 + 1)] = (255, 45, 45)
        for offset in range(-3, 4):
            if 0 <= cy - Y + offset < H and 0 <= cx - X < W:
                image[cy - Y + offset, cx - X] = (30, 240, 40)
            if 0 <= cx - X + offset < W and 0 <= cy - Y < H:
                image[cy - Y, cx - X + offset] = (30, 240, 40)
    with destination.open("wb") as output:
        output.write(f"P6\n{W} {H}\n255\n".encode())
        output.write(image.tobytes())


def write_report(sample_counts):
    cards = []
    for index in SAMPLE_INDICES:
        if index not in sample_counts:
            continue
        seconds = index / FPS
        count = sample_counts[index]
        delta = count - EXPECTED_FISH
        comparison = "Matches known count" if delta == 0 else f"{abs(delta)} {'above' if delta > 0 else 'below'} known count"
        flag = " match" if delta == 0 else " mismatch"
        cards.append(f'''<article class="frame-card">
          <div class="image-wrap"><img src="./background-test/frame_{index:03d}.png" width="{W}" height="{H}" alt="Tank at {seconds:g} seconds with {count} detected blobs outlined in red" loading="lazy"></div>
          <div class="card-footer"><span>{seconds:g} seconds</span><strong>{count} detected</strong></div>
          <div class="comparison{flag}">{comparison}</div>
        </article>''')
    document = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Background subtraction test · Fish Cluster</title>
  <link rel="icon" href="./favicon.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; background: #071a22; color: #eaf5f3; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 1260px; margin: auto; padding: clamp(20px, 4vw, 52px); }
    a { color: #a2f2d3; }
    .back { text-decoration: none; font-size: 14px; }
    .eyebrow { color: #8ee4c5; font-size: 12px; font-weight: 700; letter-spacing: .16em; margin-top: 40px; }
    h1 { font-size: clamp(32px, 5vw, 58px); line-height: 1.05; letter-spacing: -.04em; margin: 12px 0 16px; }
    .intro { color: #b7c9c8; line-height: 1.6; max-width: 760px; margin: 0 0 30px; }
    .legend { display: flex; gap: 20px; flex-wrap: wrap; color: #cadbd7; font-size: 14px; margin-bottom: 25px; }
    .swatch { display: inline-block; width: 13px; height: 13px; margin-right: 7px; vertical-align: -1px; }
    .red { background: #ff2d2d; } .green { background: #1ef028; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr)); gap: 18px; }
    .frame-card { background: #102b33; border: 1px solid #24505a; border-radius: 14px; overflow: hidden; }
    .image-wrap { background: #15262a; }
    img { display: block; width: 100%; height: auto; }
    .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 18px; }
    .card-footer span { color: #a9c1bd; }
    .card-footer strong { color: #a2f2d3; font-size: 20px; }
    .comparison { padding: 0 18px 17px; color: #c9dcda; font-size: 13px; }
    .comparison.mismatch { color: #e8d38c; }
    .note { margin-top: 28px; padding: 18px 22px; border-left: 3px solid #e4c772; background: #163038; color: #d6e3df; line-height: 1.55; }
  </style>
</head>
<body>
<main>
  <a class="back" href="./index.html">← Fish Cluster app</a>
  <div class="eyebrow">EXPERIMENTAL DETECTION / FISH.MOV</div>
  <h1>Ten frames, counted</h1>
  <p class="intro">Background subtraction sampled the video every 200 ms. These ten frames span the clip. This tank contains five fish. Each card compares its detected dark blobs with that known count.</p>
  <div class="legend"><span><i class="swatch red"></i>Detected region</span><span><i class="swatch green"></i>Exported center position</span></div>
  <section class="grid" aria-label="Ten annotated video frames">
''' + "\n".join(cards) + '''
  </section>
  <p class="note">Tank walls and reflections can create false detections. Fish that touch or overlap can appear as one blob. A count of five does not guarantee that all five positions are correct. The 0.5-inch paper grid measures roughly 15–16 pixels per square in the central tank area, or about 30–32 pixels per inch; perspective makes this an approximate distance scale. The page shows the tank crop; exported coordinates refer to the original video.</p>
</main>
</body>
</html>
'''
    (ROOT / "dist" / "background-test.html").write_text(document)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT.mkdir(parents=True, exist_ok=True)
    frames = decode_gray()
    background = np.median(frames, axis=0).astype(np.uint8)
    with (OUT / "background.pgm").open("wb") as output:
        output.write(f"P5\n{W} {H}\n255\n".encode())
        output.write(background.tobytes())
    rows = []
    counts = []
    sample_counts = {}
    for index, frame in enumerate(frames):
        boxes, _ = detect(frame, background)
        counts.append(len(boxes))
        for x0, y0, x1, y1, cx, cy, area in boxes:
            rows.append((index / FPS, cx, cy, area, x0, y0, x1, y1))
        if index in SAMPLE_INDICES:
            sample_counts[index] = len(boxes)
            ppm = OUT / f"frame_{index:03d}.ppm"
            preview(frame, boxes, ppm)
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(ppm), str(PUBLIC_OUT / f"frame_{index:03d}.png")], check=True)
    with (OUT / "detections.csv").open("w", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["time_s", "x", "y", "area_px", "x0", "y0", "x1", "y1"])
        writer.writerows(rows)
    write_report(sample_counts)
    print(f"frames={len(frames)}, average_detections={np.mean(counts):.2f}, median={np.median(counts):.0f}")
    print("count_histogram=" + str(dict(zip(*np.unique(counts, return_counts=True)))))
    print("sample_counts=" + str({index / FPS: count for index, count in sample_counts.items()}))


if __name__ == "__main__":
    main()
