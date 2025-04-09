import _ from "lodash";
import * as THREE from "three";
import type { Vector3 } from "oxalis/constants";

export default function computeSplitBoundaryMeshWithSplines(points: Vector3[]): {
  splines: THREE.Object3D[];
  splitBoundaryMesh: THREE.Mesh;
} {
  const splines: THREE.Object3D[] = [];

  const unfilteredPointsByZ = _.groupBy(points, (p) => p[2]);
  const pointsByZ = _.omitBy(unfilteredPointsByZ, (value) => value.length < 2);

  const zValues = Object.keys(pointsByZ)
    .map((el) => Number(el))
    .sort();

  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);

  const curvesByZ: Record<number, THREE.CatmullRomCurve3> = {};

  // Create curves for existing z-values
  const curves = _.compact(
    zValues.map((zValue, curveIdx) => {
      let adaptedZ = zValue;
      if (zValue === minZ) {
        adaptedZ -= 0.1;
      } else if (zValue === maxZ) {
        adaptedZ += 0.1;
      }
      const points2D = orderPointsMST(
        pointsByZ[zValue].map((p) => new THREE.Vector3(p[0], p[1], adaptedZ)),
      );

      if (points2D.length < 2) {
        return null;
      }

      if (curveIdx > 0) {
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
    const lowerCurvePoints = curvesByZ[lowerZ].getPoints(numPoints);
    const upperCurvePoints = curvesByZ[upperZ].getPoints(numPoints);

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
    const curvePoints = curve.getPoints(50);
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const splineObject = new THREE.Line(geometry, material);
    splines.push(splineObject);
  });

  // Generate grid of points
  const gridPoints = curves.map((curve) => curve.getPoints(numPoints - 1));

  // Flatten into a single array of vertices
  const vertices: number[] = [];
  const indices = [];

  gridPoints.forEach((row) => {
    row.forEach((point) => {
      vertices.push(point.x, point.y, point.z); // Store as flat array for BufferGeometry
    });
  });

  // Connect vertices with triangles
  // console.group("Computing indices");
  for (let i = 0; i < curves.length - 1; i++) {
    // console.group("Curve i=" + i);
    for (let j = 0; j < numPoints - 1; j++) {
      // console.group("Point j=" + j);
      let current = i * numPoints + j;
      let next = (i + 1) * numPoints + j;

      // const printFace = (x, y, z) => {
      //   return [vertices[3 * x], vertices[3 * y], vertices[3 * z]];
      // };

      // console.log("Creating faces with", { current, next });
      // console.log("First face:", printFace(current, next, current + 1));
      // console.log("Second face:", printFace(next, next + 1, current + 1));
      // Two triangles per quad
      indices.push(current, next, current + 1);
      indices.push(next, next + 1, current + 1);
      // console.groupEnd();
    }
    // console.groupEnd();
  }
  // console.groupEnd();

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

class DisjointSet {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array(n).fill(0);
  }

  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }

  union(i: number, j: number): void {
    let rootI = this.find(i),
      rootJ = this.find(j);
    if (rootI !== rootJ) {
      if (this.rank[rootI] > this.rank[rootJ]) this.parent[rootJ] = rootI;
      else if (this.rank[rootI] < this.rank[rootJ]) this.parent[rootI] = rootJ;
      else {
        this.parent[rootJ] = rootI;
        this.rank[rootI]++;
      }
    }
  }
}

interface Edge {
  i: number;
  j: number;
  dist: number;
}

function computeMST(points: THREE.Vector3[]): number[][] {
  const edges: Edge[] = [];
  const numPoints = points.length;

  // Create all possible edges with distances
  for (let i = 0; i < numPoints; i++) {
    for (let j = i + 1; j < numPoints; j++) {
      const dist = points[i].distanceTo(points[j]);
      edges.push({ i, j, dist });
    }
  }

  // Sort edges by distance (Kruskal's Algorithm)
  edges.sort((a, b) => a.dist - b.dist);

  // Compute MST using Kruskal’s Algorithm
  const ds = new DisjointSet(numPoints);
  const mst: number[][] = Array.from({ length: numPoints }, () => []);

  for (const { i, j } of edges) {
    if (ds.find(i) !== ds.find(j)) {
      ds.union(i, j);
      mst[i].push(j);
      mst[j].push(i);
    }
  }

  return mst;
}

function traverseMstDfs(mst: number[][], startIdx = 0): number[] {
  const visited = new Set<number>();
  const orderedPoints: number[] = [];

  function dfs(node: number) {
    if (visited.has(node)) return;
    visited.add(node);
    orderedPoints.push(node);
    for (let neighbor of mst[node]) {
      dfs(neighbor);
    }
  }

  dfs(startIdx);
  return orderedPoints;
}

function computePathLength(points: THREE.Vector3[], order: number[]): number {
  let length = 0;
  for (let i = 0; i < order.length - 1; i++) {
    length += points[order[i]].distanceTo(points[order[i + 1]]);
  }
  return length;
}

export function orderPointsMST(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length === 0) return [];

  const mst = computeMST(points);
  let bestOrder: number[] = [];
  let minLength = Number.POSITIVE_INFINITY;

  for (let startIdx = 0; startIdx < points.length; startIdx++) {
    const order = traverseMstDfs(mst, startIdx);
    const length = computePathLength(points, order);

    if (length < minLength) {
      minLength = length;
      bestOrder = order;
    }
  }

  return bestOrder.map((index) => points[index]);
}
