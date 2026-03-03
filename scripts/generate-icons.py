#!/usr/bin/env python3
"""Generate PNG icons for Save Research extension. No external dependencies."""
import struct
import zlib
import os
import math


def make_png(width, height, pixels):
    """Create a valid PNG from raw RGBA pixel bytes."""
    def chunk(ctype, data):
        c = ctype + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + c + crc

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))

    raw = b''
    stride = width * 4
    for y in range(height):
        raw += b'\x00'
        raw += pixels[y * stride:(y + 1) * stride]

    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def in_rounded_rect(x, y, w, h, pad, r):
    """Check if (x,y) is inside a rounded rectangle with padding."""
    x0, y0 = pad, pad
    x1, y1 = w - pad - 1, h - pad - 1
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    # Corner checks
    corners = [
        (x0 + r, y0 + r, x < x0 + r and y < y0 + r),
        (x1 - r, y0 + r, x > x1 - r and y < y0 + r),
        (x0 + r, y1 - r, x < x0 + r and y > y1 - r),
        (x1 - r, y1 - r, x > x1 - r and y > y1 - r),
    ]
    for cx, cy, in_corner in corners:
        if in_corner:
            return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return True


def create_icon(size):
    """Create a teal rounded-square icon with a white bookmark shape."""
    pixels = bytearray()

    transparent = (0, 0, 0, 0)
    teal = (13, 148, 136, 255)       # #0D9488
    white = (255, 255, 255, 255)

    pad = max(0, int(size * 0.04))
    corner_r = max(2, int(size * 0.22))

    # Bookmark shape bounds (relative to size)
    bm_l = size * 0.30
    bm_r = size * 0.70
    bm_t = size * 0.16
    bm_b = size * 0.84
    notch_h = size * 0.16

    for y in range(size):
        for x in range(size):
            if not in_rounded_rect(x, y, size, size, pad, corner_r):
                pixels.extend(transparent)
                continue

            # Check bookmark shape
            in_bm = False
            if bm_l <= x < bm_r and bm_t <= y:
                if y < bm_b - notch_h:
                    in_bm = True
                elif y < bm_b:
                    mid = (bm_l + bm_r) / 2
                    progress = (y - (bm_b - notch_h)) / notch_h
                    if x < mid:
                        in_bm = (x - bm_l) >= progress * (mid - bm_l)
                    else:
                        in_bm = (bm_r - x) > progress * (bm_r - mid)

            pixels.extend(white if in_bm else teal)

    return make_png(size, size, bytes(pixels))


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, '..', 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        data = create_icon(size)
        path = os.path.join(icons_dir, f'icon{size}.png')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'Created {path} ({len(data)} bytes)')


if __name__ == '__main__':
    main()
