// C/WASM(SIMD) port of the flood-fill oblique bucket picker
// (frontend/javascripts/viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill.ts),
// for one zoomStepDiff (the equivalent of addNecessaryBucketsToPriorityQueuePlane). The outer
// zoomStepDiff loop stays in TypeScript (see oblique_bucket_picker_flood_fill_wasm.ts), which
// calls this function once per zoomStepDiff.
//
// Compiled freestanding (no libc/WASI), same conventions as
// wasm/oblique_bucket_picker/oblique_bucket_picker.c: no imports, math helpers hand-rolled or
// compiler builtins only.

#include <wasm_simd128.h>

typedef double Mat4[16];
typedef struct {
  double xx, xy, xz, xt;
  double yx, yy, yz, yt;
  double zx, zy, zz, zt;
  double radiusX, radiusY, radiusZ;
  double halfExtentX, halfExtentY;
} PlaneTest;

// ---------------------------------------------------------------------------------------
// Math helpers (no libm) -- see oblique_bucket_picker.c for why these are hand-rolled.
// ---------------------------------------------------------------------------------------

static inline double d_fabs(double x) {
  return __builtin_fabs(x);
}

// ---------------------------------------------------------------------------------------
// 4x4 matrix helpers (column-major, matching libs/mjs.ts: index = 4*col + row)
// ---------------------------------------------------------------------------------------

static void mat4_mul(const Mat4 a, const Mat4 b, Mat4 out) {
  Mat4 tmp;
  for (int col = 0; col < 4; col++) {
    for (int row = 0; row < 4; row++) {
      double sum = 0.0;
      for (int k = 0; k < 4; k++) {
        sum += a[4 * k + row] * b[4 * col + k];
      }
      tmp[4 * col + row] = sum;
    }
  }
  for (int i = 0; i < 16; i++) {
    out[i] = tmp[i];
  }
}

// Direct port of M4x4.inverse in libs/mjs.ts (general 4x4 inverse via 2x2 sub-determinants).
static void mat4_inverse(const Mat4 mat, Mat4 dest) {
  double a00 = mat[0], a01 = mat[1], a02 = mat[2], a03 = mat[3];
  double a10 = mat[4], a11 = mat[5], a12 = mat[6], a13 = mat[7];
  double a20 = mat[8], a21 = mat[9], a22 = mat[10], a23 = mat[11];
  double a30 = mat[12], a31 = mat[13], a32 = mat[14], a33 = mat[15];

  double b00 = a00 * a11 - a01 * a10;
  double b01 = a00 * a12 - a02 * a10;
  double b02 = a00 * a13 - a03 * a10;
  double b03 = a01 * a12 - a02 * a11;
  double b04 = a01 * a13 - a03 * a11;
  double b05 = a02 * a13 - a03 * a12;
  double b06 = a20 * a31 - a21 * a30;
  double b07 = a20 * a32 - a22 * a30;
  double b08 = a20 * a33 - a23 * a30;
  double b09 = a21 * a32 - a22 * a31;
  double b10 = a21 * a33 - a23 * a31;
  double b11 = a22 * a33 - a23 * a32;

  double invDet = 1.0 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);

  dest[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
  dest[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet;
  dest[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
  dest[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet;
  dest[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet;
  dest[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
  dest[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet;
  dest[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
  dest[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
  dest[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet;
  dest[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
  dest[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet;
  dest[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet;
  dest[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
  dest[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet;
  dest[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
}

// biome-ignore format: don't format array (mirrors oblique_bucket_picker_flood_fill.ts's ROTATIONS)
#define COS_HALF_PI 6.123233995736766e-17
#define SIN_HALF_PI 1.0

static const Mat4 ROTATION_YZ = {
  COS_HALF_PI, 0, SIN_HALF_PI, 0,
  0, 1, 0, 0,
  -SIN_HALF_PI, 0, COS_HALF_PI, 0,
  0, 0, 0, 1,
};
static const Mat4 ROTATION_XZ = {
  1, 0, 0, 0,
  0, COS_HALF_PI, SIN_HALF_PI, 0,
  0, -SIN_HALF_PI, COS_HALF_PI, 0,
  0, 0, 0, 1,
};

// ---------------------------------------------------------------------------------------
// Fixed-capacity, no-heap storage.
// ---------------------------------------------------------------------------------------

// When g_prefetchAlongViewAxis is set, buckets are additionally picked up to this many units
// (same units as bucket/voxel sizes) in front of and behind the plane, simulating the user
// having moved the flycam along its view axis. Matches PREFETCH_Z_DIFF in
// oblique_bucket_picker_flood_fill.ts and zDiff / PREFETCH_Z_DIFF in
// wasm/oblique_bucket_picker/oblique_bucket_picker.c.
#define PREFETCH_Z_DIFF 10.0

#define MAX_OUTPUT 65536
#define HASH_CAPACITY 262144u // power of two, ~4x MAX_OUTPUT to keep load factor low
#define HASH_MASK (HASH_CAPACITY - 1u)
#define HASH_EMPTY 0xFFFFFFFFFFFFFFFFULL

static Mat4 g_matrix;
static double g_rectWidth[3];
static double g_rectHeight[3];
static double g_voxelSize[3];
static double g_bucketHalfSize[3];
static int g_centerAddress[3];
static int g_additionalPriorityWeight;
static int g_logZoomStep;
static int g_abortLimit; // < 0 means "no limit"
static int g_prefetchAlongViewAxis; // 0/1; see PREFETCH_Z_DIFF below

static int g_output[MAX_OUTPUT * 5];
static int g_outputCount;

// Tracks every bucket ever visited (accepted or rejected), matching the `visited` Set in
// oblique_bucket_picker_flood_fill.ts -- abortLimit is checked against its size, not against
// the (smaller) output/accepted count.
static unsigned long long g_visitedSlots[HASH_CAPACITY];
static int g_visitedCount;

// BFS queue of accepted bucket coordinates still to be expanded (3 ints per entry). Bounded
// by MAX_OUTPUT since every queued bucket is also an output bucket (1:1, see tryNeighbor).
static int g_queue[MAX_OUTPUT * 3];
static int g_queueLength;

__attribute__((export_name("get_matrix_ptr")))
double* get_matrix_ptr(void) { return g_matrix; }
__attribute__((export_name("get_rect_width_ptr")))
double* get_rect_width_ptr(void) { return g_rectWidth; }
__attribute__((export_name("get_rect_height_ptr")))
double* get_rect_height_ptr(void) { return g_rectHeight; }
__attribute__((export_name("get_voxel_size_ptr")))
double* get_voxel_size_ptr(void) { return g_voxelSize; }
__attribute__((export_name("get_output_ptr")))
int* get_output_ptr(void) { return g_output; }

__attribute__((export_name("set_scalars")))
void set_scalars(
    int centerX, int centerY, int centerZ,
    int additionalPriorityWeight, int logZoomStep, int abortLimit,
    int prefetchAlongViewAxis) {
  g_centerAddress[0] = centerX;
  g_centerAddress[1] = centerY;
  g_centerAddress[2] = centerZ;
  g_additionalPriorityWeight = additionalPriorityWeight;
  g_logZoomStep = logZoomStep;
  g_abortLimit = abortLimit;
  g_prefetchAlongViewAxis = prefetchAlongViewAxis;
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

static inline unsigned long long hash_position(int x, int y, int z) {
  return (unsigned long long)(4294967296.0 * (double)x + 65536.0 * (double)y + (double)z);
}

// hash_position's value is later masked down to HASH_CAPACITY (currently 2^18) slots. Since
// 2^32 is itself a multiple of 2^18, `hash & HASH_MASK` alone would discard x's contribution
// entirely (and keep only y mod 4 from y) -- every bucket sharing (y mod 4, z) would collide
// into the same slot regardless of x, which is catastrophic for a flood fill that walks wide
// x-ranges. This finalizer (splitmix64) mixes all bits of the hash together before masking,
// so the slot depends on x, y and z alike. The unmixed hash is still what's stored/compared
// for equality (see visited_insert) -- only the slot index goes through this.
static inline unsigned long long mix64(unsigned long long z) {
  z += 0x9E3779B97F4A7C15ULL;
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
  return z ^ (z >> 31);
}

// Returns 1 if newly inserted, 0 if already present.
static inline int visited_insert(unsigned long long hash) {
  unsigned int slot = (unsigned int)(mix64(hash) & HASH_MASK);
  for (;;) {
    unsigned long long existing = g_visitedSlots[slot];
    if (existing == hash) {
      return 0;
    }
    if (existing == HASH_EMPTY) {
      g_visitedSlots[slot] = hash;
      g_visitedCount++;
      return 1;
    }
    slot = (slot + 1u) & HASH_MASK;
  }
}

static void build_plane_test(int planeId, PlaneTest* test) {
  Mat4 queryMatrix;
  if (planeId == 1) { // PLANE_XZ
    mat4_mul(g_matrix, ROTATION_XZ, queryMatrix);
  } else if (planeId == 2) { // PLANE_YZ
    mat4_mul(g_matrix, ROTATION_YZ, queryMatrix);
  } else {
    for (int i = 0; i < 16; i++) queryMatrix[i] = g_matrix[i];
  }

  Mat4 inv;
  mat4_inverse(queryMatrix, inv);

  test->xx = inv[0]; test->xy = inv[4]; test->xz = inv[8]; test->xt = inv[12];
  test->yx = inv[1]; test->yy = inv[5]; test->yz = inv[9]; test->yt = inv[13];
  test->zx = inv[2]; test->zy = inv[6]; test->zz = inv[10]; test->zt = inv[14];

  test->radiusX =
      g_bucketHalfSize[0] * d_fabs(test->xx) +
      g_bucketHalfSize[1] * d_fabs(test->xy) +
      g_bucketHalfSize[2] * d_fabs(test->xz);
  test->radiusY =
      g_bucketHalfSize[0] * d_fabs(test->yx) +
      g_bucketHalfSize[1] * d_fabs(test->yy) +
      g_bucketHalfSize[2] * d_fabs(test->yz);
  test->radiusZ =
      g_bucketHalfSize[0] * d_fabs(test->zx) +
      g_bucketHalfSize[1] * d_fabs(test->zy) +
      g_bucketHalfSize[2] * d_fabs(test->zz) +
      (g_prefetchAlongViewAxis ? PREFETCH_Z_DIFF : 0.0);

  test->halfExtentX = __builtin_ceil(g_rectWidth[planeId] / 2.0);
  test->halfExtentY = __builtin_ceil(g_rectHeight[planeId] / 2.0);
}

static inline int intersects_plane(const PlaneTest* test, double wx, double wy, double wz) {
  double localZ = test->zx * wx + test->zy * wy + test->zz * wz + test->zt;
  if (d_fabs(localZ) > test->radiusZ) {
    return 0;
  }
  double localX = test->xx * wx + test->xy * wy + test->xz * wz + test->xt;
  if (d_fabs(localX) > test->halfExtentX + test->radiusX) {
    return 0;
  }
  double localY = test->yx * wx + test->yy * wy + test->yz * wz + test->yt;
  return d_fabs(localY) <= test->halfExtentY + test->radiusY;
}

static inline int intersects_any_plane(const PlaneTest* tests, double wx, double wy, double wz) {
  return intersects_plane(&tests[0], wx, wy, wz) ||
         intersects_plane(&tests[1], wx, wy, wz) ||
         intersects_plane(&tests[2], wx, wy, wz);
}

// Pushes an accepted bucket onto the BFS queue (to be emitted, and expanded for its own
// neighbours, once popped in the main loop below -- see the TS version's `queue.push(...)`,
// which only enqueues; the corresponding `enqueueFunction` call happens later, at pop time,
// in the main `for (let head = ...)` loop). Queue capacity mirrors MAX_OUTPUT, since every
// queued bucket is eventually emitted exactly once.
static inline void enqueue(int x, int y, int z) {
  if (g_queueLength >= MAX_OUTPUT) {
    return; // fixed buffer exhausted; the main loop's output-capacity check will stop first
  }
  int qbase = g_queueLength * 3;
  g_queue[qbase + 0] = x;
  g_queue[qbase + 1] = y;
  g_queue[qbase + 2] = z;
  g_queueLength++;
}

// Tries a single face neighbour of (x,y,z). Dedupes against g_visitedSlots (counted whether
// accepted or rejected, matching the `visited` Set in the TS version), then -- if new and
// accepted by intersects_any_plane -- enqueues it for later emission/expansion.
static inline void try_neighbor(const PlaneTest* tests, int x, int y, int z) {
  unsigned long long hash = hash_position(x, y, z);
  if (!visited_insert(hash)) {
    return;
  }

  double wx = (double)x * g_voxelSize[0] + g_bucketHalfSize[0];
  double wy = (double)y * g_voxelSize[1] + g_bucketHalfSize[1];
  double wz = (double)z * g_voxelSize[2] + g_bucketHalfSize[2];

  if (intersects_any_plane(tests, wx, wy, wz)) {
    enqueue(x, y, z);
  }
}

// ---------------------------------------------------------------------------------------
// Main entry point: one zoomStepDiff, all 3 orthogonal planes tested together via a single
// flood fill. Equivalent to addNecessaryBucketsToPriorityQueuePlane in
// oblique_bucket_picker_flood_fill.ts.
// ---------------------------------------------------------------------------------------

__attribute__((export_name("pick_buckets_for_plane")))
int pick_buckets_for_plane(void) {
  g_outputCount = 0;
  g_queueLength = 0;
  g_visitedCount = 0;
  for (unsigned int i = 0; i < HASH_CAPACITY; i++) {
    g_visitedSlots[i] = HASH_EMPTY;
  }

  g_bucketHalfSize[0] = g_voxelSize[0] / 2.0;
  g_bucketHalfSize[1] = g_voxelSize[1] / 2.0;
  g_bucketHalfSize[2] = g_voxelSize[2] / 2.0;

  PlaneTest tests[3];
  build_plane_test(0, &tests[0]);
  build_plane_test(1, &tests[1]);
  build_plane_test(2, &tests[2]);

  // The seed bucket (camera position) is trusted unconditionally; only its neighbours are
  // filtered by intersects_any_plane.
  int sx = g_centerAddress[0], sy = g_centerAddress[1], sz = g_centerAddress[2];
  visited_insert(hash_position(sx, sy, sz));
  enqueue(sx, sy, sz);

  for (int head = 0; head < g_queueLength; head++) {
    int cx = g_queue[head * 3 + 0];
    int cy = g_queue[head * 3 + 1];
    int cz = g_queue[head * 3 + 2];

    // Emitted here (at pop time), matching the TS version's enqueueFunction call inside its
    // `for (let head = ...)` loop -- not at push/accept time, so that the abortLimit check
    // right below only ever sees buckets that were actually emitted.
    if (g_outputCount < MAX_OUTPUT) {
      int priority =
          (cx > g_centerAddress[0] ? cx - g_centerAddress[0] : g_centerAddress[0] - cx) +
          (cy > g_centerAddress[1] ? cy - g_centerAddress[1] : g_centerAddress[1] - cy) +
          (cz > g_centerAddress[2] ? cz - g_centerAddress[2] : g_centerAddress[2] - cz) +
          g_additionalPriorityWeight;
      int base = g_outputCount * 5;
      g_output[base + 0] = cx;
      g_output[base + 1] = cy;
      g_output[base + 2] = cz;
      g_output[base + 3] = g_logZoomStep;
      g_output[base + 4] = priority;
      g_outputCount++;
    }

    if (g_abortLimit >= 0 && g_visitedCount > g_abortLimit) {
      return g_outputCount;
    }

    // The 6 face (Manhattan) neighbours of this bucket -- see the module comment in
    // oblique_bucket_picker_flood_fill.ts for why 6-connectivity is safe here (the union of
    // all three orthogonal plane sheets patches any single sheet's diagonal-only gaps).
    try_neighbor(tests, cx + 1, cy, cz);
    try_neighbor(tests, cx - 1, cy, cz);
    try_neighbor(tests, cx, cy + 1, cz);
    try_neighbor(tests, cx, cy - 1, cz);
    try_neighbor(tests, cx, cy, cz + 1);
    try_neighbor(tests, cx, cy, cz - 1);

    // g_queueLength may have grown during the neighbour checks above; re-reading it via the
    // loop condition (head < g_queueLength) picks up newly-queued buckets, exactly like the
    // TS version's `for (let head = 0; head < queue.length; head++)` over a growing array.
  }

  return g_outputCount;
}
