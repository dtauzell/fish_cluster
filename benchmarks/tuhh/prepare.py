#!/usr/bin/env python3
"""Prepare the annotated TUHH testing subset from the author's original ZIP.
No model predictions are treated as ground truth. Requires FFmpeg/FFprobe.
"""
import argparse, html, json, shutil, subprocess, time, zipfile
from pathlib import Path
from urllib.parse import quote

EXPECTED_SIZE = 72894837227
SOURCE = 'https://tore.tuhh.de/entities/product/01d8baa1-b6a5-4163-924a-01f40ff3bc81'
p = argparse.ArgumentParser()
p.add_argument('directory', type=Path)
p.add_argument('--wait', action='store_true', help='Wait for the ongoing resumable download')
a = p.parse_args()
root = a.directory.expanduser().resolve()
archive = root / 'FishTracking_Data.zip'
if a.wait:
    last_size, last_change = -1, time.monotonic()
    while True:
        size = archive.stat().st_size if archive.exists() else 0
        if size == EXPECTED_SIZE:
            break
        if size > EXPECTED_SIZE:
            raise RuntimeError('Archive larger than published size; inspect download before proceeding')
        if size != last_size:
            last_size, last_change = size, time.monotonic()
        if time.monotonic() - last_change > 1800:
            raise RuntimeError('Download has made no progress for 30 minutes. Resume it, then rerun preparation.')
        print(f'Waiting for download: {size:,} / {EXPECTED_SIZE:,} bytes', flush=True)
        time.sleep(60)
if archive.stat().st_size != EXPECTED_SIZE:
    raise RuntimeError('Archive is not complete; resume download first')

original = root / 'testing-originals'
original.mkdir(exist_ok=True)
selected = []
with zipfile.ZipFile(archive) as z:
    inventory = [{'name': i.filename, 'bytes': i.file_size, 'compressedBytes': i.compress_size, 'crc32': f'{i.CRC:08x}'} for i in z.infolist()]
    (root / 'archive-inventory.json').write_text(json.dumps(inventory, indent=2))
    for i in z.infolist():
        path = Path(i.filename)
        name = path.name
        group = next((v for v in ('2_Fish', '5_Fish', '10_Fish') if v in path.parts), None)
        annotation = group and name.lower().startswith('annotated_') and path.suffix.lower() == '.txt'
        video = group in ('2_Fish', '5_Fish') and path.suffix.lower() == '.mkv' and name.startswith(group + '_Camera_')
        if not annotation and not video:
            continue
        target = original / group / name
        target.parent.mkdir(exist_ok=True)
        print(f'Extracting {i.filename} ({i.file_size:,} bytes)', flush=True)
        # Reading to EOF verifies each selected entry's ZIP CRC.
        partial = target.with_suffix(target.suffix + '.partial')
        with z.open(i) as src, partial.open('wb') as dst:
            shutil.copyfileobj(src, dst, 8 * 1024 * 1024)
        partial.replace(target)
        selected.append({'archivePath': i.filename, 'path': str(target.relative_to(root)), 'bytes': i.file_size, 'crc32': f'{i.CRC:08x}'})
if not any(v['path'].endswith('.mkv') for v in selected):
    raise RuntimeError('Expected 2/5-fish videos were not found; inspect archive-inventory.json')

browser = root / 'browser-videos'
browser.mkdir(exist_ok=True)
cards, clips = [], []
for record in selected:
    source = root / record['path']
    if source.suffix != '.mkv':
        continue
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', str(source)]))['streams'][0]
    output = browser / (source.stem + '.mp4')
    print(f'Converting {source.name} at original resolution and frame timing', flush=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(source), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-movflags', '+faststart', str(output)], check=True)
    thumb = browser / (source.stem + '.jpg')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '2', '-i', str(output), '-frames:v', '1', '-vf', 'scale=640:-2', str(thumb)], check=True)
    # Small, deterministic native-resolution image subset for future automated tests.
    frames = root / 'sample-frames' / source.stem
    frames.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(source), '-vf', 'select=lt(n\\,1000)*not(mod(n\\,40))', '-fps_mode', 'vfr', '-frames:v', '25', str(frames / 'sample-%03d.png')], check=True)
    metadata = {**record, 'browserVideo': str(output.relative_to(root)), 'width': info['width'], 'height': info['height'], 'frameRate': info['r_frame_rate'], 'sampleSourceFrameNumbers': list(range(1, 1000, 40)), 'sampleFrameNumbering': 'One-based native frame numbers, not timestamps or detector samples; original labels are preserved unchanged.'}
    clips.append(metadata)
    cards.append(f'<article><h2>{html.escape(source.stem)}</h2><video controls preload="none" poster="{quote(str(thumb.relative_to(root)))}" src="{quote(str(output.relative_to(root)))}"></video><p>{info["width"]} × {info["height"]}; original labels in testing-originals.</p></article>')
manifest = {'source': SOURCE, 'archiveBytes': EXPECTED_SIZE, 'publishedArchiveMd5': '5fa2fd51d7a82fb7264653dbbc294505', 'integrity': 'Selected ZIP entries verified against ZIP CRC32 during extraction. Published MD5 recorded, not recomputed.', 'selected': selected, 'clips': clips}
(root / 'testing-manifest.json').write_text(json.dumps(manifest, indent=2))
(root / 'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>TUHH zebrafish test recordings</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:16px}video{width:100%;max-height:650px;background:#111}article{margin:32px 0}</style><h1>TUHH zebrafish testing subset</h1><p>Original footage and manual labels from <a href="'+SOURCE+'">Neidhardt &amp; Bhattacharya (2026)</a>. No trained-model predictions used as reference. See SOURCES.txt for license notes.</p>'+''.join(cards)+'</html>')
(root / 'PREPARATION-COMPLETE.txt').write_text('Testing subset extracted and browser MP4s prepared. Open index.html. See testing-manifest.json for source paths and dimensions.\n')
print('COMPLETE: ' + str(root / 'index.html'), flush=True)
