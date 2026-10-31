"""Finds broken frames in rendered videos.

Now and then Chrome hands the renderer a frame of the wrong size and the video shows the whole
screen tiled for one frame: a flicker. Such a frame differs sharply from both neighbours while the
neighbours look alike, which a cut (the neighbours differ) or a planned flash (it fades over two
more frames) does not.

    python3 scripts/check.py out/pulse-*.mp4      prints the broken videos and frames, exit 1 if any
"""
import subprocess
import sys

import numpy as np

W, H = 54, 96  # a thumbnail is enough to see a tiled frame


def frames(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', '-'],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W).astype(np.float32)


def broken(path, jump=10.0):
    f = frames(path)
    bad = []
    for n in range(1, len(f) - 1):
        before = np.abs(f[n] - f[n - 1]).mean()
        after = np.abs(f[n] - f[n + 1]).mean()
        around = np.abs(f[n - 1] - f[n + 1]).mean()
        if before > jump and after > jump and around < jump / 3:
            bad.append(n)
    return bad


if __name__ == '__main__':
    found = 0
    for path in sys.argv[1:]:
        bad = broken(path)
        if bad:
            found += 1
            print(f'{path}: frames {bad}')
    print(f'{found} of {len(sys.argv) - 1} videos have broken frames')
    sys.exit(1 if found else 0)
