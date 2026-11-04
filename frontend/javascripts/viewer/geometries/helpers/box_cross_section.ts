import { Euler, Vector3 as ThreeVector3 } from "three";
import type { OrthoViewWithoutTD, Vector3 } from "viewer/constants";
import dimensions from "viewer/model/dimensions";

// A box can be cut by a plane in at most 6 points (hexagon).
export const MAX_CROSS_SECTION_CORNERS = 6;

// Components of a unit normal below this threshold are treated as zero, so that
// rotations by multiples of 90° (which are affected by floating point noise) still
// take the exact axis-aligned path.
const AXIS_ALIGNMENT_EPSILON = 1e-9;
// Intersection points closer than this (in voxels) are considered identical.
const DEDUPLICATION_EPSILON = 1e-6;

const BOX_EDGES: Array<[number, number]> = [
  // Corner index bits: bit 0 -> x, bit 1 -> y, bit 2 -> z (0 = min, 1 = max).
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const _euler = new Euler();
const _normal = new ThreeVector3();

/*
 * Returns the normal of the (rotated) data plane of the given viewport in world space
 * (i.e., not yet scaled by the voxel size). This matches the orientation that
 * Plane.updateToFlycamRotation applies: the flycam rotation ("ZYX" Euler) applied to
 * the base orientation of the viewport (see OrthoBaseRotations). Since the base
 * rotations map the plane's local z axis onto the viewport's third dimension (up to
 * the sign, which is irrelevant for a plane), only the flycam rotation remains.
 */
export function getRotatedViewportNormal(
  planeId: OrthoViewWithoutTD,
  rotationInRadian: Vector3,
): Vector3 {
  const thirdDim = dimensions.thirdDimensionForPlane(planeId);
  _normal.set(0, 0, 0).setComponent(thirdDim, 1);
  _euler.set(rotationInRadian[0], rotationInRadian[1], rotationInRadian[2], "ZYX");
  _normal.applyEuler(_euler);
  return [_normal.x, _normal.y, _normal.z];
}

function getAlignedAxis(normal: Vector3): number | null {
  const nonZeroAxes = [0, 1, 2].filter((dim) => Math.abs(normal[dim]) > AXIS_ALIGNMENT_EPSILON);
  return nonZeroAxes.length === 1 ? nonZeroAxes[0] : null;
}

/*
 * Returns the axis-aligned rectangle in which the plane orthogonal to `axis` through
 * `position` cuts the half-open box [min, max), or null if the plane misses the box.
 */
function getAxisAlignedCrossSection(
  min: Vector3,
  max: Vector3,
  axis: number,
  position: Vector3,
): Vector3[] | null {
  if (position[axis] < min[axis] || position[axis] >= max[axis]) {
    return null;
  }
  // Since `max` itself should not be included in the rendered box, Number.EPSILON is subtracted.
  const inclusiveMax = max.map((value) => value - Number.EPSILON) as Vector3;
  const [dimA, dimB] = [0, 1, 2].filter((dim) => dim !== axis);
  const corner = (a: number, b: number): Vector3 => {
    const point: Vector3 = [0, 0, 0];
    point[dimA] = a;
    point[dimB] = b;
    point[axis] = position[axis];
    return point;
  };
  return [
    corner(min[dimA], min[dimB]),
    corner(min[dimA], inclusiveMax[dimB]),
    corner(inclusiveMax[dimA], inclusiveMax[dimB]),
    corner(inclusiveMax[dimA], min[dimB]),
  ];
}

/*
 * Intersects the box [min, max] with the plane through `pointOnPlane` with the given
 * `normal` (both in the coordinate space of the box). Returns the corners of the
 * resulting convex polygon (3 to 6 corners, ordered around the polygon, not closed),
 * or null if the plane does not cut the box in a polygon.
 */
export function intersectBoxWithPlane(
  min: Vector3,
  max: Vector3,
  pointOnPlane: Vector3,
  normal: Vector3,
): Vector3[] | null {
  const boxCorners: Vector3[] = [];
  for (let idx = 0; idx < 8; idx++) {
    boxCorners.push([
      idx & 1 ? max[0] : min[0],
      idx & 2 ? max[1] : min[1],
      idx & 4 ? max[2] : min[2],
    ]);
  }
  const signedDistances = boxCorners.map(
    (corner) =>
      normal[0] * (corner[0] - pointOnPlane[0]) +
      normal[1] * (corner[1] - pointOnPlane[1]) +
      normal[2] * (corner[2] - pointOnPlane[2]),
  );

  const points: Vector3[] = [];
  const addPoint = (point: Vector3) => {
    const isDuplicate = points.some(
      (other) =>
        Math.abs(other[0] - point[0]) < DEDUPLICATION_EPSILON &&
        Math.abs(other[1] - point[1]) < DEDUPLICATION_EPSILON &&
        Math.abs(other[2] - point[2]) < DEDUPLICATION_EPSILON,
    );
    if (!isDuplicate) {
      points.push(point);
    }
  };

  for (const [startIdx, endIdx] of BOX_EDGES) {
    const startDistance = signedDistances[startIdx];
    const endDistance = signedDistances[endIdx];
    if ((startDistance > 0 && endDistance > 0) || (startDistance < 0 && endDistance < 0)) {
      continue;
    }
    const start = boxCorners[startIdx];
    const end = boxCorners[endIdx];
    if (startDistance === endDistance) {
      // Both distances are zero, i.e., the edge lies within the plane.
      addPoint(start);
      addPoint(end);
      continue;
    }
    const t = startDistance / (startDistance - endDistance);
    addPoint([
      start[0] + t * (end[0] - start[0]),
      start[1] + t * (end[1] - start[1]),
      start[2] + t * (end[2] - start[2]),
    ]);
  }

  if (points.length < 3) {
    return null;
  }

  // Order the points by their angle around the centroid within the plane.
  const centroid = points
    .reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0])
    .map((value) => value / points.length) as Vector3;
  const normalVector = new ThreeVector3(...normal).normalize();
  // Any vector that is not parallel to the normal works as a helper to construct the basis.
  const helper =
    Math.abs(normalVector.x) < 0.9 ? new ThreeVector3(1, 0, 0) : new ThreeVector3(0, 1, 0);
  const u = new ThreeVector3().crossVectors(normalVector, helper).normalize();
  const v = new ThreeVector3().crossVectors(normalVector, u);
  const angleOf = (point: Vector3) => {
    const dx = point[0] - centroid[0];
    const dy = point[1] - centroid[1];
    const dz = point[2] - centroid[2];
    return Math.atan2(dx * v.x + dy * v.y + dz * v.z, dx * u.x + dy * u.y + dz * u.z);
  };
  return points
    .map((point) => ({ point, angle: angleOf(point) }))
    .sort((a, b) => a.angle - b.angle)
    .map(({ point }) => point);
}

/*
 * Returns the corners of the polygon in which the data plane of the given viewport cuts
 * the half-open box [min, max) (in voxel coordinates), or null if it does not cut it.
 * The corners are ordered around the polygon and the polygon is not closed (i.e., the
 * first corner is not repeated), so that it can also be used as a triangle fan.
 *
 * Without rotation, this is the axis-aligned rectangle at position[thirdDim], which is
 * computed without the general plane intersection.
 */
export function getBoxCrossSection(
  min: Vector3,
  max: Vector3,
  planeId: OrthoViewWithoutTD,
  position: Vector3,
  rotationInRadian: Vector3,
  voxelSize: Vector3,
): Vector3[] | null {
  if (rotationInRadian[0] === 0 && rotationInRadian[1] === 0 && rotationInRadian[2] === 0) {
    return getAxisAlignedCrossSection(
      min,
      max,
      dimensions.thirdDimensionForPlane(planeId),
      position,
    );
  }

  const worldNormal = getRotatedViewportNormal(planeId, rotationInRadian);
  const alignedAxis = getAlignedAxis(worldNormal);
  if (alignedAxis != null) {
    return getAxisAlignedCrossSection(min, max, alignedAxis, position);
  }

  // The box lives in voxel space, whereas the plane is rotated in world space. A plane
  // n · (p_world - q_world) = 0 with p_world = voxelSize ⊙ p_voxel has the normal
  // voxelSize ⊙ n in voxel space.
  const voxelNormal: Vector3 = [
    worldNormal[0] * voxelSize[0],
    worldNormal[1] * voxelSize[1],
    worldNormal[2] * voxelSize[2],
  ];
  const inclusiveMax = max.map((value) => value - Number.EPSILON) as Vector3;
  return intersectBoxWithPlane(min, inclusiveMax, position, voxelNormal);
}
