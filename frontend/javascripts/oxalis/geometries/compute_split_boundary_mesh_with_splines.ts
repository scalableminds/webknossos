import { orderPointsWithMST } from "libs/order_points_with_mst";
import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
import * as THREE from "three";

export default function computeSplitBoundaryMeshWithSplines(points: Vector3[]): {
  splines: THREE.Object3D[];
  splitBoundaryMesh: THREE.Mesh;
} {
  /**
   * Generates a smooth, interpolated 3D boundary mesh and corresponding spline visualizations
   * from a set of unordered 3D points.
   *
   * This function processes a collection of 3D points that are assumed to lie on or near
   * horizontal slices (constant Z-values). It groups the points by their Z-coordinate,
   * constructs a spline for each slice using a minimum spanning tree (MST)
   * strategy to find a good continuous order, and interpolates intermediate slices if gaps in the Z-axis
   * are detected.
   *
   * The output consists of:
   * 1. A set of 3D spline objects that represent the ordered splines at each Z level.
   * 2. A triangulated boundary surface mesh constructed from these splines.
   *
   * The process includes:
   * - Grouping input points by their Z-coordinate, filtering out groups with fewer than 2 points.
   * - Creating smooth Catmull-Rom splines from the ordered boundary points for each slice.
   * - Ensuring geometric consistency by flipping curves when necessary to prevent twists.
   * - Interpolating curves for missing Z-levels to produce a continuous surface.
   * - Generating a structured grid of vertices from these curves and triangulating them
   *   to form a closed 3D mesh.
   * - Applying smoothing and basic material setup for visualization.
   *
   * If all points lie on a single Z-level, the function duplicates the layer at adjacent Z-values
   * to ensure a valid 3D surface can still be formed.
   *
   */
  const splines: THREE.Object3D[] = [];

  const unfilteredPointsByZ = _.groupBy(points, (p) => p[2]);
  const pointsByZ = _.omitBy(unfilteredPointsByZ, (value) => value.length < 2);

  const zValues = Object.keys(pointsByZ)
    .map((el) => Number(el))
    .sort();

  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);

  if (minZ === maxZ) {
    // All nodes are in the same section. Duplicate them to the next
    // and previous section to get a surface with a depth.
    return computeSplitBoundaryMeshWithSplines([
      ...points.map((p) => [p[0], p[1], p[2] - 1] as Vector3),
      ...points,
      ...points.map((p) => [p[0], p[1], p[2] + 1] as Vector3),
    ]);
  }

  const curvesByZ: Record<number, THREE.CatmullRomCurve3> = {};

  // Create curves for existing z-values
  const curves = _.compact(
    zValues.map((zValue, curveIdx) => {
      let adaptedZ = zValue;
      // We make the surface a bit larger by offsetting points in Z
      // if they are at the z-start or z-end. This avoids numerical
      // problems for the floodfill.
      if (zValue === minZ) {
        adaptedZ -= 0.1;
      } else if (zValue === maxZ) {
        adaptedZ += 0.1;
      }
      const points2D = orderPointsWithMST(
        pointsByZ[zValue].map((p) => new THREE.Vector3(p[0], p[1], adaptedZ)),
      );

      if (curveIdx > 0) {
        // Find out whether we should flip the order of points2D by checking
        // whether the first point of the last and the current curve is
        // close to each other.
        const currentCurvePoints = points2D;
        const prevCurvePoints = curvesByZ[zValues[curveIdx - 1]].points;

        const distActual = currentCurvePoints[0].distanceTo(prevCurvePoints[0]);
        const distFlipped = (currentCurvePoints.at(-1) as THREE.Vector3).distanceTo(
          prevCurvePoints[0],
        );

        const shouldFlip = distFlipped < distActual;
        if (shouldFlip) {
          points2D.reverse();
        }
      }

      const curve = new THREE.CatmullRomCurve3(points2D);
      curvesByZ[zValue] = curve;
      return curve;
    }),
  );

  // Number of points per curve
  const numPoints = 50;
  const numDivisions = numPoints - 1;

  // Sort z-values for interpolation
  const sortedZValues = Object.keys(curvesByZ)
    .map(Number)
    .sort((a, b) => a - b);

  // Interpolate missing z-values
  for (let z = minZ; z <= maxZ; z++) {
    if (curvesByZ[z]) continue; // Skip if curve already exists

    // Find nearest lower and upper z-values
    const lowerZ = Math.max(...sortedZValues.filter((v) => v < z));
    const upperZ = Math.min(...sortedZValues.filter((v) => v > z));

    if (lowerZ === Number.NEGATIVE_INFINITY || upperZ === Number.POSITIVE_INFINITY) continue;

    // Get the two adjacent curves and sample 50 points from each
    const lowerCurvePoints = curvesByZ[lowerZ].getPoints(numDivisions);
    const upperCurvePoints = curvesByZ[upperZ].getPoints(numDivisions);

    // Interpolate between corresponding points
    const interpolatedPoints = lowerCurvePoints.map((lowerPoint, i) => {
      const upperPoint = upperCurvePoints[i];
      const alpha = (z - lowerZ) / (upperZ - lowerZ); // Interpolation factor

      return new THREE.Vector3(
        THREE.MathUtils.lerp(lowerPoint.x, upperPoint.x, alpha),
        THREE.MathUtils.lerp(lowerPoint.y, upperPoint.y, alpha),
        z,
      );
    });

    // Create the interpolated curve
    const interpolatedCurve = new THREE.CatmullRomCurve3(interpolatedPoints);
    curvesByZ[z] = interpolatedCurve;
  }

  // Generate and display all curves
  Object.values(curvesByZ).forEach((curve) => {
    const curvePoints = curve.getPoints(numDivisions);
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const splineObject = new THREE.Line(geometry, material);
    splines.push(splineObject);
  });

  // Generate grid of points
  const gridPoints = curves.map((curve) => curve.getPoints(numDivisions));

  // Flatten into a single array of vertices
  const vertices: number[] = [];
  const indices = [];

  gridPoints.forEach((row) => {
    row.forEach((point) => {
      vertices.push(point.x, point.y, point.z); // Store as flat array for BufferGeometry
    });
  });

  // Connect vertices with triangles
  for (let i = 0; i < curves.length - 1; i++) {
    for (let j = 0; j < numPoints - 1; j++) {
      let current = i * numPoints + j;
      let next = (i + 1) * numPoints + j;

      // Two triangles per quad
      indices.push(current, next, current + 1);
      indices.push(next, next + 1, current + 1);
    }
  }

  // Convert to Three.js BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); // Smooth shading
  geometry.computeBoundsTree();

  // Material and Mesh
  const material = new THREE.MeshStandardMaterial({
    color: 0x0077ff, // A soft blue color
    metalness: 0.5, // Slight metallic effect
    roughness: 1, // Some surface roughness for a natural look
    side: THREE.DoubleSide, // Render both sides
    flatShading: false, // Ensures smooth shading with computed normals
    opacity: 0.8,
    transparent: true,
    wireframe: false,
  });
  const splitBoundaryMesh = new THREE.Mesh(geometry, material);
  return {
    splines,
    splitBoundaryMesh,
  };
}
