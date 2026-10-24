#!/usr/bin/env python3
"""Generate S5's fixed fixture image.

M7 §4a chooses a fixed fixture over a live capture because "a live capture
varies by lighting and sensor warm-up, so it measures the camera rather than
COMPRESSION AND STAMPING, which is what SwR-086/SwR-102 bind".

So this image has one job: make the compression step do the work a real
photograph would, identically on every run and every device.

WHY THESE CHOICES, EACH THE AUTHOR'S AND EACH LABELLED
-----------------------------------------------------
* 4000x3000 (12 MP). SwR-086's Standard level is N-C4's 1600 px long edge, so
  the fixture must be MUCH larger or the resize does no work and S5 measures
  almost nothing. 12 MP is a plausible default for a mid-tier phone camera.
  Nothing in the corpus sets this; it is chosen to be representative.

* Photographic-ish content, deliberately neither flat nor pure noise.
  A flat or smoothly-graded image encodes far faster than a photograph and
  would flatter the figure; pure noise encodes far slower and would produce a
  file no camera ever emits. The content below mixes gradients, structure and
  mild grain so the DCT has real high-frequency work to do.

* Deterministic from a fixed seed, and COMMITTED as bytes rather than built.
  The point of a fixture is that every run compresses the same pixels; a
  fixture regenerated at build time would vary with the Pillow version and
  quietly change what S5 measures.

Run:  python scripts/make-s5-fixture.py
"""
import hashlib
import io
import math
import os
import random

WIDTH, HEIGHT = 4000, 3000
QUALITY = 88  # a typical phone-camera JPEG quality
SEED = 20261024
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "s5-fixture.jpg")


def build():
    from PIL import Image, ImageDraw, ImageFilter

    rnd = random.Random(SEED)
    img = Image.new("RGB", (WIDTH, HEIGHT))
    px = img.load()

    # A broad sky-to-ground gradient: the low-frequency base a photograph has.
    for y in range(HEIGHT):
        t = y / HEIGHT
        r = int(120 + 90 * (1 - t))
        g = int(140 + 70 * (1 - t) + 30 * t)
        b = int(190 * (1 - t) + 70 * t)
        for x in range(WIDTH):
            px[x, y] = (r, g, b)

    d = ImageDraw.Draw(img)

    # Mid-frequency structure: overlapping shapes standing in for a scene.
    for i in range(140):
        x0 = rnd.randint(-200, WIDTH)
        y0 = rnd.randint(HEIGHT // 3, HEIGHT)
        w = rnd.randint(150, 900)
        h = rnd.randint(100, 700)
        col = (rnd.randint(30, 200), rnd.randint(40, 180), rnd.randint(30, 160))
        if i % 3 == 0:
            d.ellipse([x0, y0, x0 + w, y0 + h], fill=col)
        else:
            d.rectangle([x0, y0, x0 + w, y0 + h], fill=col)

    # Fine detail: edges the encoder cannot spend nothing on.
    for _ in range(2200):
        x0 = rnd.randint(0, WIDTH)
        y0 = rnd.randint(0, HEIGHT)
        d.line(
            [x0, y0, x0 + rnd.randint(-120, 120), y0 + rnd.randint(-120, 120)],
            fill=(rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)),
            width=rnd.randint(1, 4),
        )

    # A light blur then grain, which is what a real sensor delivers: softened
    # optics plus per-pixel noise, rather than synthetic hard edges.
    img = img.filter(ImageFilter.GaussianBlur(radius=1.2))
    px = img.load()
    for y in range(0, HEIGHT, 2):
        for x in range(0, WIDTH, 2):
            n = rnd.randint(-14, 14)
            r, g, b = px[x, y]
            px[x, y] = (
                max(0, min(255, r + n)),
                max(0, min(255, g + n)),
                max(0, min(255, b + n)),
            )
    return img


def main():
    img = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=QUALITY, optimize=True)
    data = buf.getvalue()
    with open(OUT, "wb") as f:
        f.write(data)
    print("wrote %s" % os.path.normpath(OUT))
    print("  %d x %d, %.2f MB" % (WIDTH, HEIGHT, len(data) / 1048576))
    print("  sha256 %s" % hashlib.sha256(data).hexdigest())
    print("  ^ record this digest: it is what makes the fixture checkable")


if __name__ == "__main__":
    main()
