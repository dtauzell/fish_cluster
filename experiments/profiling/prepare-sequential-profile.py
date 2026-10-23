"""Extract packet offsets and decoder configuration for the local browser experiment.

Usage: python3 prepare-sequential-profile.py fish.mov /tmp/profile-metadata.json
Requires ffprobe. This is an offline fixture builder, not an application dependency.
"""
import json
import subprocess
import sys
from pathlib import Path


def probe(video, *arguments):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", *arguments,
        "-of", "json", str(video)
    ]))


def prepare(video, output):
    packets = probe(video, "-show_packets", "-show_entries",
                    "packet=pts,dts,duration,pos,size,flags")["packets"]
    stream = probe(video, "-show_streams", "-show_data")["streams"][0]
    if stream["codec_name"] != "h264":
        raise ValueError("This experiment supports the included H.264 recording only.")
    hex_data = "".join(
        line.split(":", 1)[1].strip().split("  ")[0].replace(" ", "")
        for line in stream["extradata"].splitlines() if ":" in line
    )
    description = bytes.fromhex(hex_data)
    result = {
        "config": {"codec": "avc1." + description[1:4].hex(),
                   "codedWidth": stream["width"], "codedHeight": stream["height"],
                   "description": list(description)},
        "timeBase": stream["time_base"], "duration": float(stream["duration"]),
        "packets": [[p["pts"], p["duration"], int(p["pos"]), int(p["size"]),
                     "K" in p["flags"]] for p in packets]
    }
    Path(output).write_text(json.dumps(result))
    print(f"Extracted {len(packets)} H.264 packets to {output}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: prepare-sequential-profile.py VIDEO OUTPUT_JSON")
    prepare(sys.argv[1], sys.argv[2])
