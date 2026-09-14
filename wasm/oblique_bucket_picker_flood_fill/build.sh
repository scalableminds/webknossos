#!/usr/bin/env bash
# Builds oblique_bucket_picker_flood_fill.c into a freestanding WASM module with SIMD128
# enabled, and copies the result into frontend/assets/wasm/. See
# wasm/oblique_bucket_picker/build.sh for the Zig toolchain notes -- identical setup applies.
#
# Usage: wasm/oblique_bucket_picker_flood_fill/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$REPO_ROOT/frontend/assets/wasm"

if ! command -v zig &> /dev/null; then
  echo "error: zig not found on PATH. Install it from https://ziglang.org/download/" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

zig cc \
  -target wasm32-freestanding \
  -O3 \
  -msimd128 \
  -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=get_matrix_ptr \
  -Wl,--export=get_rect_width_ptr \
  -Wl,--export=get_rect_height_ptr \
  -Wl,--export=get_voxel_size_ptr \
  -Wl,--export=set_scalars \
  -Wl,--export=get_output_ptr \
  -Wl,--export=pick_buckets_for_plane \
  -o "$OUT_DIR/oblique_bucket_picker_flood_fill.wasm" \
  "$SCRIPT_DIR/oblique_bucket_picker_flood_fill.c"

echo "Built $OUT_DIR/oblique_bucket_picker_flood_fill.wasm"
