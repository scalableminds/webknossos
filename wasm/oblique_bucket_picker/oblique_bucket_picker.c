// C/WASM(SIMD) port of the scan-line oblique bucket picker
// (frontend/javascripts/viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts
// + bucket_traversals.ts), for one zoomStepDiff (the equivalent of
// addNecessaryBucketsToPriorityQueuePlane). The outer zoomStepDiff loop stays in TypeScript
// (see oblique_bucket_picker_wasm.ts), which calls this function once per zoomStepDiff.
//
// Compiled freestanding (no libc/WASI) so the module has no imports at all -- see build.sh.
// Only compiler builtins (__builtin_floor / __builtin_fabs, which lower to native WASM
// f64.floor / f64.abs instructions) are used; fmod/isnan are hand-rolled below to match the
// exact semantics of JS's `%` operator and Number.isNaN, respectively.

#include <wasm_simd128.h>

typedef double Mat4[16];

// ---------------------------------------------------------------------------------------
// Math helpers (no libm)
// ---------------------------------------------------------------------------------------

static inline double d_fabs(double x) {
  return __builtin_fabs(x);
}

static inline double d_floor(double x) {
  return __builtin_floor(x);
}

static inline int d_isnan(double x) {
  return x != x;
}

// Matches JS's `%` operator (truncating remainder, sign follows the dividend), which is what
// libs/utils.ts's mod() is built on top of.
static inline double d_fmod(double x, double y) {
  double q = x / y;
  long long truncated = (long long)q;
  return x - (double)truncated * y;
}

// Matches libs/utils.ts: mod(x, n) = ((x % n) + n) % n
static inline double d_mod(double x, double n) {
  return d_fmod(d_fmod(x, n) + n, n);
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

static inline void transform_point_affine(
    const Mat4 m, double x, double y, double z, double* ox, double* oy, double* oz) {
  *ox = m[0] * x + m[4] * y + m[8] * z + m[12];
  *oy = m[1] * x + m[5] * y + m[9] * z + m[13];
  *oz = m[2] * x + m[6] * y + m[10] * z + m[14];
}

// Transforms the two endpoints of one scan line (fixed y, z; x = -halfX and x = +halfX)
// simultaneously via 2-wide SIMD lanes. The y/z contribution is identical for both
// endpoints, so it's computed once (scalar) and only the x-dependent term is vectorized.
static inline void transform_scanline_endpoints(
    const Mat4 m,
    double halfX,
    double y,
    double z,
    double* ax, double* ay, double* az,
    double* bx, double* by, double* bz) {
  double sharedX = m[4] * y + m[8] * z + m[12];
  double sharedY = m[5] * y + m[9] * z + m[13];
  double sharedZ = m[6] * y + m[10] * z + m[14];

  v128_t xLanes = wasm_f64x2_make(-halfX, halfX);
  v128_t oxLanes = wasm_f64x2_add(wasm_f64x2_mul(wasm_f64x2_splat(m[0]), xLanes), wasm_f64x2_splat(sharedX));
  v128_t oyLanes = wasm_f64x2_add(wasm_f64x2_mul(wasm_f64x2_splat(m[1]), xLanes), wasm_f64x2_splat(sharedY));
  v128_t ozLanes = wasm_f64x2_add(wasm_f64x2_mul(wasm_f64x2_splat(m[2]), xLanes), wasm_f64x2_splat(sharedZ));

  *ax = wasm_f64x2_extract_lane(oxLanes, 0);
  *bx = wasm_f64x2_extract_lane(oxLanes, 1);
  *ay = wasm_f64x2_extract_lane(oyLanes, 0);
  *by = wasm_f64x2_extract_lane(oyLanes, 1);
  *az = wasm_f64x2_extract_lane(ozLanes, 0);
  *bz = wasm_f64x2_extract_lane(ozLanes, 1);
}

// biome-ignore format: don't format array (mirrors oblique_bucket_picker.ts's ROTATIONS)
// cos(PI/2) and sin(PI/2) as computed by JS's Math.cos/Math.sin, hardcoded since ALPHA is
// always exactly PI/2 here (avoids needing a libm sin/cos in this freestanding build).
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
// Fixed-capacity, no-heap storage. Sized generously relative to realistic viewport/zoom
// combinations; see pick_buckets_for_plane for the overflow/abort behaviour.
// ---------------------------------------------------------------------------------------

#define MAX_OUTPUT 65536
#define HASH_CAPACITY 262144u // power of two, ~4x MAX_OUTPUT to keep load factor low
#define HASH_MASK (HASH_CAPACITY - 1u)
#define HASH_EMPTY 0xFFFFFFFFFFFFFFFFULL

// Inputs, written by JS before calling pick_buckets_for_plane.
static Mat4 g_matrix;
static double g_rectWidth[3]; // indexed by planeId: 0=PLANE_XY, 1=PLANE_XZ, 2=PLANE_YZ
static double g_rectHeight[3];
static double g_voxelSize[3];
static int g_centerAddress[3];
static int g_additionalPriorityWeight;
static int g_logZoomStep;
static int g_abortLimit; // < 0 means "no limit"

// Output: packed as 5 int32 per bucket: [x, y, z, zoomStep, priority].
static int g_output[MAX_OUTPUT * 5];
static int g_outputCount;

// Dedup set for this call (cleared at the start of pick_buckets_for_plane). Stores the same
// hash as hashPosition() in the TS pickers (2**32*x + 2**16*y + z), or HASH_EMPTY if unused.
static unsigned long long g_hashSlots[HASH_CAPACITY];

__attribute__((export_name("get_matrix_ptr")))
double* get_matrix_ptr(void) { return g_matrix; }
__attribute__((export_name("get_rect_width_ptr")))
double* get_rect_width_ptr(void) { return g_rectWidth; }
__attribute__((export_name("get_rect_height_ptr")))
double* get_rect_height_ptr(void) { return g_rectHeight; }
__attribute__((export_name("get_voxel_size_ptr")))
double* get_voxel_size_ptr(void) { return g_voxelSize; }
__attribute__((export_name("get_center_address_ptr")))
int* get_center_address_ptr(void) { return g_centerAddress; }
__attribute__((export_name("get_output_ptr")))
int* get_output_ptr(void) { return g_output; }

__attribute__((export_name("set_scalars")))
void set_scalars(
    int centerX, int centerY, int centerZ,
    int additionalPriorityWeight, int logZoomStep, int abortLimit) {
  g_centerAddress[0] = centerX;
  g_centerAddress[1] = centerY;
  g_centerAddress[2] = centerZ;
  g_additionalPriorityWeight = additionalPriorityWeight;
  g_logZoomStep = logZoomStep;
  g_abortLimit = abortLimit;
}

// ---------------------------------------------------------------------------------------
// Bucket traversal (port of bucket_traversals.ts's traverse()), with an emit-or-count mode.
// ---------------------------------------------------------------------------------------

// Emits one bucket: dedups against g_hashSlots, then (if new) writes it to g_output with its
// priority. Returns 1 if the caller should stop everything immediately (abortLimit reached
// or the fixed output buffer is full), 0 otherwise. Mirrors the dedup/abort placement in
// oblique_bucket_picker.ts's addNecessaryBucketsToPriorityQueuePlane (checked once per
// *newly seen* bucket, not per traversal step).
// hash_position's value is later masked down to HASH_CAPACITY (currently 2^18) slots. Since
// 2^32 is itself a multiple of 2^18, `hash & HASH_MASK` alone would discard x's contribution
// entirely (and keep only y mod 4 from y) -- every bucket sharing (y mod 4, z) would collide
// into the same slot regardless of x. This finalizer (splitmix64) mixes all bits of the hash
// together before masking, so the slot depends on x, y and z alike. The unmixed hash is still
// what's stored/compared for equality below -- only the slot index goes through this.
static inline unsigned long long mix64(unsigned long long z) {
  z += 0x9E3779B97F4A7C15ULL;
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
  return z ^ (z >> 31);
}

static int emit_bucket(int x, int y, int z) {
  // Matches hashPosition()'s `2**32*x + 2**16*y + z` (computed the same way, via doubles, so
  // negative coordinates are handled identically to the JS version).
  unsigned long long hash =
      (unsigned long long)(4294967296.0 * (double)x + 65536.0 * (double)y + (double)z);

  unsigned int slot = (unsigned int)(mix64(hash) & HASH_MASK);
  for (;;) {
    unsigned long long existing = g_hashSlots[slot];
    if (existing == hash) {
      return 0; // already seen; not an abort
    }
    if (existing == HASH_EMPTY) {
      g_hashSlots[slot] = hash;
      break;
    }
    slot = (slot + 1u) & HASH_MASK;
  }

  if (g_outputCount >= MAX_OUTPUT) {
    return 1; // fixed buffer exhausted; stop rather than overflow
  }

  int priority =
      (x > g_centerAddress[0] ? x - g_centerAddress[0] : g_centerAddress[0] - x) +
      (y > g_centerAddress[1] ? y - g_centerAddress[1] : g_centerAddress[1] - y) +
      (z > g_centerAddress[2] ? z - g_centerAddress[2] : g_centerAddress[2] - z) +
      g_additionalPriorityWeight;

  int base = g_outputCount * 5;
  g_output[base + 0] = x;
  g_output[base + 1] = y;
  g_output[base + 2] = z;
  g_output[base + 3] = g_logZoomStep;
  g_output[base + 4] = priority;
  g_outputCount++;

  if (g_abortLimit >= 0 && g_outputCount > g_abortLimit) {
    return 1;
  }
  return 0;
}

// Ports traverse()'s DDA loop exactly, including the multi-bucket emits on ties (see
// visitNextXY / visitNextXZ / visitNextYZ / visitNextXYZ in bucket_traversals.ts -- each tie
// emits the two axis-aligned intermediate buckets *and* the diagonal corner bucket, using the
// pre-tie coordinates for the intermediates, exactly like the JS closures do by reading the
// not-yet-reassigned outer X/Y/Z).
//
// If countOnly is non-zero, buckets are neither deduped nor written to the output -- only
// *countOut is incremented -- matching how oblique_bucket_picker.ts uses the raw length of
// traverse()'s result (stepRateBuckets.length) purely to size the scan-line step count.
// Returns 1 if the caller should stop immediately (only possible when countOnly == 0).
static int traverse_line(
    double startX, double startY, double startZ,
    double endX, double endY, double endZ,
    int countOnly, int* countOut) {
  double vx = endX - startX;
  double vy = endY - startY;
  double vz = endZ - startZ;

  int X = (int)d_floor(startX / g_voxelSize[0]);
  int Y = (int)d_floor(startY / g_voxelSize[1]);
  int Z = (int)d_floor(startZ / g_voxelSize[2]);
  int lastX = (int)d_floor(endX / g_voxelSize[0]);
  int lastY = (int)d_floor(endY / g_voxelSize[1]);
  int lastZ = (int)d_floor(endZ / g_voxelSize[2]);

  int stepX = (vx > 0) - (vx < 0);
  int stepY = (vy > 0) - (vy < 0);
  int stepZ = (vz > 0) - (vz < 0);

  double posRestX = d_mod(startX, g_voxelSize[0]);
  double posRestY = d_mod(startY, g_voxelSize[1]);
  double posRestZ = d_mod(startZ, g_voxelSize[2]);
  double negRestX = g_voxelSize[0] - posRestX;
  double negRestY = g_voxelSize[1] - posRestY;
  double negRestZ = g_voxelSize[2] - posRestZ;

  double tMaxX = d_fabs((stepX > 0 ? negRestX : posRestX) / vx);
  double tMaxY = d_fabs((stepY > 0 ? negRestY : posRestY) / vy);
  double tMaxZ = d_fabs((stepZ > 0 ? negRestZ : posRestZ) / vz);
  if (d_isnan(tMaxX)) tMaxX = __builtin_inf();
  if (d_isnan(tMaxY)) tMaxY = __builtin_inf();
  if (d_isnan(tMaxZ)) tMaxZ = __builtin_inf();

  double tDeltaX = d_fabs(g_voxelSize[0] / vx);
  double tDeltaY = d_fabs(g_voxelSize[1] / vy);
  double tDeltaZ = d_fabs(g_voxelSize[2] / vz);

  int count = 1;
  if (countOnly) {
    // no-op, just counted above
  } else if (emit_bucket(X, Y, Z)) {
    return 1;
  }

  int loopProtection = 0;
  const int maxIterations = 50000;

  while (loopProtection++ < maxIterations) {
    if (X == lastX && Y == lastY && Z == lastZ) {
      if (countOnly) *countOut = count;
      return 0;
    }

    if ((stepX < 0 && X < lastX) || (stepX > 0 && X > lastX) ||
        (stepY < 0 && Y < lastY) || (stepY > 0 && Y > lastY) ||
        (stepZ < 0 && Z < lastZ) || (stepZ > 0 && Z > lastZ)) {
      if (countOnly) *countOut = count;
      return 0;
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        X += stepX; tMaxX += tDeltaX;
        count++;
        if (!countOnly && emit_bucket(X, Y, Z)) return 1;
      } else if (tMaxX > tMaxZ) {
        Z += stepZ; tMaxZ += tDeltaZ;
        count++;
        if (!countOnly && emit_bucket(X, Y, Z)) return 1;
      } else {
        int oldX = X, oldZ = Z;
        int newX = X + stepX, newZ = Z + stepZ;
        double newTMaxX = tMaxX + tDeltaX, newTMaxZ = tMaxZ + tDeltaZ;
        count += 3;
        if (!countOnly) {
          if (emit_bucket(newX, Y, oldZ)) return 1;
          if (emit_bucket(oldX, Y, newZ)) return 1;
          if (emit_bucket(newX, Y, newZ)) return 1;
        }
        X = newX; tMaxX = newTMaxX;
        Z = newZ; tMaxZ = newTMaxZ;
      }
    } else if (tMaxX > tMaxY) {
      if (tMaxY < tMaxZ) {
        Y += stepY; tMaxY += tDeltaY;
        count++;
        if (!countOnly && emit_bucket(X, Y, Z)) return 1;
      } else if (tMaxY > tMaxZ) {
        Z += stepZ; tMaxZ += tDeltaZ;
        count++;
        if (!countOnly && emit_bucket(X, Y, Z)) return 1;
      } else {
        int oldY = Y, oldZ = Z;
        int newY = Y + stepY, newZ = Z + stepZ;
        double newTMaxY = tMaxY + tDeltaY, newTMaxZ = tMaxZ + tDeltaZ;
        count += 3;
        if (!countOnly) {
          if (emit_bucket(X, newY, oldZ)) return 1;
          if (emit_bucket(X, oldY, newZ)) return 1;
          if (emit_bucket(X, newY, newZ)) return 1;
        }
        Y = newY; tMaxY = newTMaxY;
        Z = newZ; tMaxZ = newTMaxZ;
      }
    } else {
      if (tMaxZ < tMaxX) {
        Z += stepZ; tMaxZ += tDeltaZ;
        count++;
        if (!countOnly && emit_bucket(X, Y, Z)) return 1;
      } else if (tMaxZ > tMaxX) {
        int oldX = X, oldY = Y;
        int newX = X + stepX, newY = Y + stepY;
        double newTMaxX = tMaxX + tDeltaX, newTMaxY = tMaxY + tDeltaY;
        count += 3;
        if (!countOnly) {
          if (emit_bucket(newX, oldY, Z)) return 1;
          if (emit_bucket(oldX, newY, Z)) return 1;
          if (emit_bucket(newX, newY, Z)) return 1;
        }
        X = newX; tMaxX = newTMaxX;
        Y = newY; tMaxY = newTMaxY;
      } else {
        int oldX = X, oldY = Y, oldZ = Z;
        int newX = X + stepX, newY = Y + stepY, newZ = Z + stepZ;
        double newTMaxX = tMaxX + tDeltaX, newTMaxY = tMaxY + tDeltaY, newTMaxZ = tMaxZ + tDeltaZ;
        count += 4;
        if (!countOnly) {
          if (emit_bucket(newX, oldY, oldZ)) return 1;
          if (emit_bucket(oldX, newY, oldZ)) return 1;
          if (emit_bucket(oldX, oldY, newZ)) return 1;
          if (emit_bucket(newX, newY, newZ)) return 1;
        }
        X = newX; tMaxX = newTMaxX;
        Y = newY; tMaxY = newTMaxY;
        Z = newZ; tMaxZ = newTMaxZ;
      }
    }
  }

  if (countOnly) *countOut = count;
  return 0;
}

// ---------------------------------------------------------------------------------------
// Main entry point: one zoomStepDiff, all 3 orthogonal planes. Equivalent to
// addNecessaryBucketsToPriorityQueuePlane in oblique_bucket_picker.ts.
// ---------------------------------------------------------------------------------------

__attribute__((export_name("pick_buckets_for_plane")))
int pick_buckets_for_plane(void) {
  g_outputCount = 0;
  for (unsigned int i = 0; i < HASH_CAPACITY; i++) {
    g_hashSlots[i] = HASH_EMPTY;
  }

  for (int planeId = 0; planeId < 3; planeId++) {
    double halfX = __builtin_ceil(g_rectWidth[planeId] / 2.0);
    double halfY = __builtin_ceil(g_rectHeight[planeId] / 2.0);
    double extentY = halfY * 2.0;

    Mat4 queryMatrix;
    if (planeId == 1) { // PLANE_XZ
      mat4_mul(g_matrix, ROTATION_XZ, queryMatrix);
    } else if (planeId == 2) { // PLANE_YZ
      mat4_mul(g_matrix, ROTATION_YZ, queryMatrix);
    } else {
      for (int i = 0; i < 16; i++) queryMatrix[i] = g_matrix[i];
    }

    // Cast one vertical sample line and use the number of buckets it touches to decide how
    // many horizontal scan lines are needed (see the "Cast a vertical scan line" comment in
    // oblique_bucket_picker.ts -- ported here as-is, including its known limitation with
    // steep oblique rotations, for a like-for-like comparison). This sample line runs along
    // local y at fixed local x = -halfX, so its endpoints are built directly rather than via
    // the (x-varying) transform_scanline_endpoints helper used for the real scan lines below.
    double sampleAX, sampleAY, sampleAZ, sampleBX, sampleBY, sampleBZ;
    transform_point_affine(queryMatrix, -halfX, -halfY, 0.0, &sampleAX, &sampleAY, &sampleAZ);
    transform_point_affine(queryMatrix, -halfX, halfY, 0.0, &sampleBX, &sampleBY, &sampleBZ);

    int stepRateBucketCount = 0;
    traverse_line(sampleAX, sampleAY, sampleAZ, sampleBX, sampleBY, sampleBZ, 1, &stepRateBucketCount);
    int steps = stepRateBucketCount + 1;
    double stepSize = extentY / (double)steps;

    for (int idx = 0; idx <= steps; idx++) {
      double y = -halfY + (double)idx * stepSize;
      double ax, ay, az, bx, by, bz;
      transform_scanline_endpoints(queryMatrix, halfX, y, 0.0, &ax, &ay, &az, &bx, &by, &bz);
      if (traverse_line(ax, ay, az, bx, by, bz, 0, 0)) {
        return g_outputCount;
      }
    }
  }

  return g_outputCount;
}
