// Collects all buckets whose box [x, x+1] × [y, y+1] × [z, z+1] (in bucket coordinates)
// overlaps a convex polyhedron with positive volume (buckets that only touch it are skipped),
// using a flood fill from the bucket containing the polyhedron's centroid. The polyhedron is
// given as flat vertex coordinates and pairs of edge indices (offsets into the vertex array),
// see getSquareFrustum.
//
// The overlap test is an exact separating-axis test. For two convex polyhedra, it suffices
// to test the face normals of both and the cross products of their edge directions. The face
// normals of the polyhedron are cross products of its own edges, so all candidate axes can be
// derived from the edges plus the three bucket axes.

// Reused across calls. visitedStamps stores the call in which a cell was last visited, so the
// grid doesn't need to be cleared between calls.
let visitedStamps = new Uint32Array(0);
let currentStamp = 0;
let queue = new Int32Array(0);

export default function collectBucketsInConvexPolyhedron(
  vertices: ArrayLike<number>,
  edgeIndices: ArrayLike<number>,
): Int32Array {
  const overlaps = buildOverlapTest(vertices, edgeIndices);
  const vertexCount = vertices.length / 3;

  // All overlapping buckets lie within the polyhedron's bounding box, so a dense grid can serve
  // as the visited set.
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const centroid = [0, 0, 0];
  for (let v = 0; v < vertexCount; v++) {
    for (let d = 0; d < 3; d++) {
      const value = vertices[3 * v + d];
      min[d] = Math.min(min[d], value);
      max[d] = Math.max(max[d], value);
      centroid[d] += value / vertexCount;
    }
  }
  // One cell of margin on each side. Margin cells lie outside the bounding box, so they're never
  // accepted, and the flood fill never steps beyond them. That's why no bounds checks are needed.
  const minX = Math.floor(min[0]) - 1;
  const minY = Math.floor(min[1]) - 1;
  const minZ = Math.floor(min[2]) - 1;
  const sizeX = Math.floor(max[0]) - minX + 2;
  const sizeY = Math.floor(max[1]) - minY + 2;
  const sizeZ = Math.floor(max[2]) - minZ + 2;
  const strideY = sizeX;
  const strideZ = sizeX * sizeY;
  const cellCount = strideZ * sizeZ;

  if (visitedStamps.length < cellCount) {
    visitedStamps = new Uint32Array(cellCount);
    queue = new Int32Array(cellCount);
    currentStamp = 0;
  }
  currentStamp++;
  if (currentStamp === 0xffffffff) {
    visitedStamps.fill(0);
    currentStamp = 1;
  }
  const stamp = currentStamp;
  const visited = visitedStamps;

  const seedIndex =
    Math.floor(centroid[0]) -
    minX +
    strideY * (Math.floor(centroid[1]) - minY) +
    strideZ * (Math.floor(centroid[2]) - minZ);
  visited[seedIndex] = stamp;
  queue[0] = seedIndex;
  let queueLength = 1;

  // The queue holds grid indices of accepted cells, in BFS order.
  for (let head = 0; head < queueLength; head++) {
    const index = queue[head];
    const x = (index % sizeX) + minX;
    const y = (Math.floor(index / strideY) % sizeY) + minY;
    const z = Math.floor(index / strideZ) + minZ;

    let neighbor = index + 1;
    if (visited[neighbor] !== stamp) {
      visited[neighbor] = stamp;
      if (overlaps(x + 1, y, z)) queue[queueLength++] = neighbor;
    }
    neighbor = index - 1;
    if (visited[neighbor] !== stamp) {
      visited[neighbor] = stamp;
      if (overlaps(x - 1, y, z)) queue[queueLength++] = neighbor;
    }
    neighbor = index + strideY;
    if (visited[neighbor] !== stamp) {
      visited[neighbor] = stamp;
      if (overlaps(x, y + 1, z)) queue[queueLength++] = neighbor;
    }
    neighbor = index - strideY;
    if (visited[neighbor] !== stamp) {
      visited[neighbor] = stamp;
      if (overlaps(x, y - 1, z)) queue[queueLength++] = neighbor;
    }
    neighbor = index + strideZ;
    if (visited[neighbor] !== stamp) {
      visited[neighbor] = stamp;
      if (overlaps(x, y, z + 1)) queue[queueLength++] = neighbor;
    }
    neighbor = index - strideZ;
    if (visited[neighbor] !== stamp) {
      visited[neighbor] = stamp;
      if (overlaps(x, y, z - 1)) queue[queueLength++] = neighbor;
    }
  }

  const output = new Int32Array(3 * queueLength);
  for (let i = 0; i < queueLength; i++) {
    const index = queue[i];
    output[3 * i] = (index % sizeX) + minX;
    output[3 * i + 1] = (Math.floor(index / strideY) % sizeY) + minY;
    output[3 * i + 2] = Math.floor(index / strideZ) + minZ;
  }
  return output;
}

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

let rowOutput = new Int32Array(0);

// Returns the same buckets as collectBucketsInConvexPolyhedron, but enumerates them row by row
// instead of with a flood fill. For a fixed row (y, z), every condition of the overlap test is
// linear in x, so the overlapping buckets of a row form one contiguous interval whose ends can be
// computed per row. To be robust against rounding and to treat ties exactly like the overlap
// test, the computed ends are only used as a starting point and corrected with the exact test.
export function collectBucketsInConvexPolyhedronByRows(
  vertices: ArrayLike<number>,
  edgeIndices: ArrayLike<number>,
): Int32Array {
  const bounds = buildAxisBounds(vertices, edgeIndices);
  const { axisCount, axisX, axisY, axisZ, lower, upper } = bounds;
  const overlaps = buildOverlapTestFromBounds(bounds);
  const vertexCount = vertices.length / 3;

  // Axes perpendicular to x constrain whole rows; the others constrain x within a row.
  const rowAxes: number[] = [];
  const xAxes: number[] = [];
  for (let k = 0; k < axisCount; k++) {
    if (axisX[k] === 0) rowAxes.push(k);
    else xAxes.push(k);
  }
  const inverseAxisX = new Float64Array(axisCount);
  for (const k of xAxes) {
    inverseAxisX[k] = 1 / axisX[k];
  }

  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let v = 0; v < vertexCount; v++) {
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], vertices[3 * v + d]);
      max[d] = Math.max(max[d], vertices[3 * v + d]);
    }
  }
  // Only buckets within these ranges can overlap the polyhedron.
  const minX = Math.floor(min[0]);
  const maxX = Math.floor(max[0]);
  const minY = Math.floor(min[1]);
  const maxY = Math.floor(max[1]);
  const minZ = Math.floor(min[2]);
  const maxZ = Math.floor(max[2]);

  const maxOutputLength = 3 * (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  if (rowOutput.length < maxOutputLength) {
    rowOutput = new Int32Array(maxOutputLength);
  }
  const output = rowOutput;
  let outputLength = 0;

  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      let isRowEmpty = false;
      for (let i = 0; i < rowAxes.length; i++) {
        const k = rowAxes[i];
        const projection = axisY[k] * y + axisZ[k] * z;
        if (projection <= lower[k] || projection >= upper[k]) {
          isRowEmpty = true;
          break;
        }
      }
      if (isRowEmpty) {
        continue;
      }

      // Overlapping buckets satisfy lowerX < x < upperX (up to rounding).
      let lowerX = Number.NEGATIVE_INFINITY;
      let upperX = Number.POSITIVE_INFINITY;
      for (let i = 0; i < xAxes.length; i++) {
        const k = xAxes[i];
        const rest = axisY[k] * y + axisZ[k] * z;
        const a = (lower[k] - rest) * inverseAxisX[k];
        const b = (upper[k] - rest) * inverseAxisX[k];
        if (a < b) {
          lowerX = Math.max(lowerX, a);
          upperX = Math.min(upperX, b);
        } else {
          lowerX = Math.max(lowerX, b);
          upperX = Math.min(upperX, a);
        }
      }
      const firstCandidate = Math.max(minX, Math.floor(lowerX));
      const lastCandidate = Math.min(maxX, Math.ceil(upperX));
      if (firstCandidate > lastCandidate) {
        continue;
      }

      // Correct the ends with the exact test. The accepted buckets of a row are contiguous.
      let first = firstCandidate;
      while (first <= lastCandidate && !overlaps(first, y, z)) {
        first++;
      }
      if (first > lastCandidate) {
        continue;
      }
      if (first === firstCandidate) {
        while (first > minX && overlaps(first - 1, y, z)) first--;
      }
      let last = lastCandidate;
      while (!overlaps(last, y, z)) {
        last--;
      }
      if (last === lastCandidate) {
        while (last < maxX && overlaps(last + 1, y, z)) last++;
      }

      for (let x = first; x <= last; x++) {
        output[outputLength++] = x;
        output[outputLength++] = y;
        output[outputLength++] = z;
      }
    }
  }
  return output.slice(0, outputLength);
}

// Returns whether the bucket with min corner (x, y, z) overlaps the polyhedron with positive
// volume. Only exported for testing.
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

// A frustum around the z axis whose faces at nearZ and farZ are rectangles of the given widths,
// in the format the functions above expect.
export function getSquareFrustum(
  nearWidthX: number,
  nearWidthY: number,
  nearZ: number,
  farWidthX: number,
  farWidthY: number,
  farZ: number,
): { vertices: Array<number>; edgeIndices: Array<number> } {
  const vertices: Array<number> = [];
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      vertices.push((signX * nearWidthX) / 2, (signY * nearWidthY) / 2, nearZ);
      vertices.push((signX * farWidthX) / 2, (signY * farWidthY) / 2, farZ);
    }
  }
  // Vertex i has the offset 3 * i. Bit 0 of i selects the far face, bit 1 the y sign and bit 2
  // the x sign, so two vertices are connected iff their indices differ in exactly one bit.
  const edgeIndices: Array<number> = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if ((i & bit) === 0) {
        edgeIndices.push(3 * i, 3 * (i | bit));
      }
    }
  }
  return { vertices, edgeIndices };
}
