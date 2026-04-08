"""Convert LAZ to PLY with subsampling for web viewing."""
import laspy
import numpy as np
import struct
import sys
import os

INPUT = r"U:\bulk\RLV Interior Baza Sportiva Olanesti.laz"
OUTPUT = r"C:\dev\station-planner\public\models\baza-sportiva.ply"
SUBSAMPLE = 50  # keep every Nth point (50 = 2% of points, ~3.5M pts)

print(f"Reading {INPUT}...")
las = laspy.read(INPUT)
total = len(las.points)
print(f"Total points: {total:,}")

# Subsample
indices = np.arange(0, total, SUBSAMPLE)
n = len(indices)
print(f"After subsampling (1/{SUBSAMPLE}): {n:,} points")

# Extract XYZ
x = np.array(las.x[indices], dtype=np.float32)
y = np.array(las.y[indices], dtype=np.float32)
z = np.array(las.z[indices], dtype=np.float32)

# Center the point cloud
cx, cy, cz = x.mean(), y.mean(), z.mean()
x -= cx
y -= cy
z -= cz
print(f"Centered. Original center: ({cx:.2f}, {cy:.2f}, {cz:.2f})")
print(f"Bounds: X[{x.min():.2f}, {x.max():.2f}] Y[{y.min():.2f}, {y.max():.2f}] Z[{z.min():.2f}, {z.max():.2f}]")

# Extract colors if available
has_color = hasattr(las, 'red') and hasattr(las, 'green') and hasattr(las, 'blue')
if has_color:
    r = las.red[indices]
    g = las.green[indices]
    b = las.blue[indices]
    # Normalize to 0-255 (LAS colors are often 16-bit)
    if r.max() > 255:
        r = (r / 256).astype(np.uint8)
        g = (g / 256).astype(np.uint8)
        b = (b / 256).astype(np.uint8)
    else:
        r = r.astype(np.uint8)
        g = g.astype(np.uint8)
        b = b.astype(np.uint8)
    print(f"Colors: YES (RGB)")
else:
    # Use intensity as grayscale
    if hasattr(las, 'intensity'):
        intensity = las.intensity[indices]
        gray = (intensity / intensity.max() * 255).astype(np.uint8)
        r = g = b = gray
        has_color = True
        print(f"Colors: intensity-based grayscale")
    else:
        has_color = False
        print(f"Colors: NO")

# Write PLY
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
print(f"Writing PLY to {OUTPUT}...")

with open(OUTPUT, 'wb') as f:
    # Header
    header = f"ply\nformat binary_little_endian 1.0\nelement vertex {n}\n"
    header += "property float x\nproperty float y\nproperty float z\n"
    if has_color:
        header += "property uchar red\nproperty uchar green\nproperty uchar blue\n"
    header += "end_header\n"
    f.write(header.encode('ascii'))

    # Data
    for i in range(n):
        f.write(struct.pack('<fff', x[i], z[i], y[i]))  # Swap Y/Z for Three.js (Y-up)
        if has_color:
            f.write(struct.pack('BBB', r[i], g[i], b[i]))

size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
print(f"Done! Output: {size_mb:.1f} MB, {n:,} points")
