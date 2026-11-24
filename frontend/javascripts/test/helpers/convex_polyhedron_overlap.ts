// A generic implementation of the exact test whether a bucket, i.e. the box
// [x, x+1] × [y, y+1] × [z, z+1] in bucket coordinates, overlaps a convex polyhedron with positive
// volume (buckets that only touch it don't overlap). The polyhedron is given as flat vertex
// coordinates and pairs of edge indices (offsets into the vertex array). It's independent of the
// box-specific implementation in oblique_bucket_picker.ts, so it can serve as a reference in tests.
//
// The overlap test is an exact separating-axis test. For two convex polyhedra, it suffices
// to test the face normals of both and the cross products of their edge directions. The face
// normals of the polyhedron are cross products of its own edges, so all candidate axes can be
// derived from the edges plus the three bucket axes.

type AxisBounds = {
  axisCount: number;
  axisX: Float64Array;
  axisY: Float64Array;
  axisZ: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
};

function buildAxisBounds(vertices: ArrayLike<number>, edgeIndices: ArrayLike<number>): AxisBounds {
  const axes = getSeparatingAxisCandidates(vertices, edgeIndices);
  const vertexCount = vertices.length / 3;

  // Per axis, a bucket with min corner (x, y, z) doesn't overlap the polyhedron iff
  // axis·(x, y, z) is outside (lower, upper). This folds the bucket's center offset and radius
  // into the bounds, so the per-bucket test is one dot product per axis.
  const axisCount = axes.length;
  const axisX = new Float64Array(axisCount);
  const axisY = new Float64Array(axisCount);
  const axisZ = new Float64Array(axisCount);
  const lower = new Float64Array(axisCount);
  const upper = new Float64Array(axisCount);
  for (let k = 0; k < axisCount; k++) {
    const [ax, ay, az] = axes[k];
    const [min, max] = projectVertices(vertices, vertexCount, axes[k]);
    const radius = 0.5 * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
    const centerOffset = 0.5 * (ax + ay + az);
    axisX[k] = ax;
    axisY[k] = ay;
    axisZ[k] = az;
    lower[k] = min - radius - centerOffset;
    upper[k] = max + radius - centerOffset;
  }
  return {
    axisCount,
    axisX,
    axisY,
    axisZ,
    lower,
    upper,
  };
}

// Returns whether the bucket with min corner (x, y, z) overlaps the polyhedron with positive
// volume.
export function buildOverlapTest(
  vertices: ArrayLike<number>,
  edgeIndices: ArrayLike<number>,
): (x: number, y: number, z: number) => boolean {
  return buildOverlapTestFromBounds(buildAxisBounds(vertices, edgeIndices));
}

function buildOverlapTestFromBounds(
  bounds: AxisBounds,
): (x: number, y: number, z: number) => boolean {
  const { axisCount, axisX, axisY, axisZ, lower, upper } = bounds;
  return (x: number, y: number, z: number): boolean => {
    for (let k = 0; k < axisCount; k++) {
      const projection = axisX[k] * x + axisY[k] * y + axisZ[k] * z;
      if (projection <= lower[k] || projection >= upper[k]) {
        return false;
      }
    }
    return true;
  };
}

// The axes that can separate a bucket from the polyhedron: the polyhedron's face normals, the
// bucket axes (the bucket's face normals) and the cross products of a bucket axis with a
// polyhedron edge direction. Face normals come first, since they reject most buckets.
function getSeparatingAxisCandidates(
  vertices: ArrayLike<number>,
  edgeIndices: ArrayLike<number>,
): Array<[number, number, number]> {
  const vertexCount = vertices.length / 3;
  const bucketAxes: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const edgeDirections: Array<[number, number, number]> = [];
  for (let i = 0; i < edgeIndices.length; i += 2) {
    const a = edgeIndices[i];
    const b = edgeIndices[i + 1];
    addDirection(edgeDirections, [
      vertices[b] - vertices[a],
      vertices[b + 1] - vertices[a + 1],
      vertices[b + 2] - vertices[a + 2],
    ]);
  }

  const axes: Array<[number, number, number]> = [];
  // A cross product of two edge directions is a face normal iff at least three vertices are
  // extreme along it. The other ones aren't needed for the separating-axis test.
  for (let i = 0; i < edgeDirections.length; i++) {
    for (let j = i + 1; j < edgeDirections.length; j++) {
      const normal = cross(edgeDirections[i], edgeDirections[j]);
      if (isFaceNormal(vertices, vertexCount, normal)) {
        addDirection(axes, normal);
      }
    }
  }
  for (const axis of bucketAxes) {
    addDirection(axes, axis);
  }
  for (const bucketAxis of bucketAxes) {
    for (const edgeDirection of edgeDirections) {
      addDirection(axes, cross(bucketAxis, edgeDirection));
    }
  }
  return axes;
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function projectVertices(
  vertices: ArrayLike<number>,
  vertexCount: number,
  axis: [number, number, number],
): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let v = 0; v < vertexCount; v++) {
    const projection =
      axis[0] * vertices[3 * v] + axis[1] * vertices[3 * v + 1] + axis[2] * vertices[3 * v + 2];
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return [min, max];
}

function isFaceNormal(
  vertices: ArrayLike<number>,
  vertexCount: number,
  normal: [number, number, number],
): boolean {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length < 1e-9) {
    return false;
  }
  const [min, max] = projectVertices(vertices, vertexCount, normal);
  const epsilon = 1e-9 * Math.max(1, Math.abs(min), Math.abs(max));
  let atMin = 0;
  let atMax = 0;
  for (let v = 0; v < vertexCount; v++) {
    const projection =
      normal[0] * vertices[3 * v] +
      normal[1] * vertices[3 * v + 1] +
      normal[2] * vertices[3 * v + 2];
    if (projection - min <= epsilon) atMin++;
    if (max - projection <= epsilon) atMax++;
  }
  return atMin >= 3 || atMax >= 3;
}

// Adds the direction (normalized) unless it's (anti-)parallel to one that's already there.
function addDirection(
  directions: Array<[number, number, number]>,
  direction: [number, number, number],
): void {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length < 1e-9) {
    return;
  }
  const normalized: [number, number, number] = [
    direction[0] / length,
    direction[1] / length,
    direction[2] / length,
  ];
  for (const existing of directions) {
    const c = cross(normalized, existing);
    if (Math.hypot(c[0], c[1], c[2]) < 1e-9) {
      return;
    }
  }
  directions.push(normalized);
}
