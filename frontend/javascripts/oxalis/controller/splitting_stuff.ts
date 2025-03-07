import type { Vector3 } from "oxalis/constants";
import * as THREE from "three";
import PCA from "pca-js";
import Delaunator from "delaunator";
import TPS3D from "libs/thin_plate_spline";
import _ from "lodash";

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

function traverseMST_DFS(mst: number[][], startIdx = 0): number[] {
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
    const order = traverseMST_DFS(mst, startIdx);
    const length = computePathLength(points, order);

    if (length < minLength) {
      minLength = length;
      bestOrder = order;
    }
  }

  return bestOrder.map((index) => points[index]);
}

export function enforceConsistentDirection(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length < 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  // Check if the curve follows top-left → bottom-right order
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const maxDelta = Math.abs(dx) > Math.abs(dy) ? dx : dy;

  if (maxDelta < 0) {
    // The curve is flipped (going bottom-right → top-left), so reverse it
    return points.reverse();
  }
  return points;
}

type EigenData = { eigenvalue: number; vector: number[] };

export function createPointCloud(points: Vector3[], color: string) {
  // Convert points to Three.js geometry
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(_.flatten(points));
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

  // Create point material and add to objects list
  const material = new THREE.PointsMaterial({ color, size: 5 });

  const pointCloud = new THREE.Points(geometry, material);
  return pointCloud;
}

const rows = 100;
const cols = 100;

export function computeBentSurfaceDelauny(points3D: Vector3[]): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  // Your precomputed 2D projection (same order as points3D)

  const { projectedLocalPoints } = projectPoints(points3D);

  // Compute Delaunay triangulation on the projected 2D points
  const delaunay = Delaunator.from(projectedLocalPoints.map((vec) => [vec.x, vec.y]));
  const indices = delaunay.triangles; // Triangle indices

  // Flatten 3D vertex positions for BufferGeometry
  const vertices = points3D.flat();

  // Create BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(Array.from(indices));
  geometry.computeVertexNormals(); // Compute normals for shading

  const material = new THREE.MeshLambertMaterial({
    color: "green",
    wireframe: false,
  });
  material.side = THREE.DoubleSide;
  // material.transparent = true;
  const surfaceMesh = new THREE.Mesh(geometry, material);
  objects.push(surfaceMesh);
  return objects;
}

export function projectPoints(points: Vector3[]) {
  const eigenData: EigenData[] = PCA.getEigenVectors(points);

  const adData = PCA.computeAdjustedData(points, eigenData[0], eigenData[1]);
  const compressed = adData.formattedAdjustedData;
  const uncompressed = PCA.computeOriginalData(compressed, adData.selectedVectors, adData.avgData);
  console.log("uncompressed", uncompressed);

  const projectedPoints: Vector3[] = uncompressed.originalData;

  // Align the plane with the principal components
  const normal = new THREE.Vector3(...eigenData[2].vector);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const quaternionInv = quaternion.clone().invert();

  // Transform projectedPoints into the plane’s local coordinate system
  const projectedLocalPoints = projectedPoints.map((p) => {
    const worldPoint = new THREE.Vector3(...p);
    return worldPoint.applyQuaternion(quaternionInv); // Move to local plane space
  });
  return { projectedPoints, projectedLocalPoints, eigenData };
}

export function computeBentSurfaceTPS(points: Vector3[]): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  const { projectedPoints, projectedLocalPoints, eigenData } = projectPoints(points);
  // objects.push(createPointCloud(points, "red"));
  // objects.push(createPointCloud(projectedPoints, "blue"));

  // todop: adapt scale
  const scale = [1, 1, 1] as Vector3;
  const tps = new TPS3D(projectedPoints, points, scale);

  // Align the plane with the principal components
  const normal = new THREE.Vector3(...eigenData[2].vector);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const quaternionInv = quaternion.clone().invert();

  const mean = points.reduce(
    (acc, p) => acc.add(new THREE.Vector3(...p).divideScalar(points.length)),
    new THREE.Vector3(0, 0, 0),
  );
  const projectedMean = mean.clone().applyQuaternion(quaternionInv);

  // Compute min/max bounds in local plane space
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minY = Number.POSITIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY;
  projectedLocalPoints.forEach((p) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });

  // Compute exact plane size based on bounds
  const planeSizeX = 2 * Math.max(maxX - projectedMean.x, projectedMean.x - minX);
  const planeSizeY = 2 * Math.max(maxY - projectedMean.y, projectedMean.y - minY);

  // Define the plane using the first two principal components
  // const planeSizeX = Math.sqrt(eigenData[0].eigenvalue) * 10;
  // const planeSizeY = Math.sqrt(eigenData[1].eigenvalue) * 10;

  const planeGeometry = new THREE.PlaneGeometry(planeSizeX, planeSizeY);
  const planeMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    side: THREE.DoubleSide,
    opacity: 0.5,
    transparent: true,
  });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);

  plane.setRotationFromQuaternion(quaternion);

  // const centerLocal = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0);
  // centerLocal.applyMatrix4(plane.matrixWorld);
  plane.position.copy(mean);

  plane.updateMatrixWorld();

  // objects.push(plane);

  const gridPoints = generatePlanePoints(plane);
  const bentSurfacePoints = gridPoints.map((point) => tps.transform(...point));

  // objects.push(createPointCloud(gridPoints, "purple"));
  // objects.push(createPointCloud(bentSurfacePoints, "orange"));

  const bentMesh = createBentSurfaceGeometry(bentSurfacePoints, rows, cols);
  objects.push(bentMesh);

  // const light = new THREE.DirectionalLight(0xffffff, 1);
  // light.position.set(100, 150, 100); // Above and slightly in front of the points
  // light.lookAt(60, 60, 75); // Aim at the center of the point set
  // light.updateMatrixWorld();

  // const lightHelper = new THREE.DirectionalLightHelper(light, 10, 0xff0000); // The size of the helper

  // const arrowHelper = new THREE.ArrowHelper(
  //   light.position
  //     .clone()
  //     .normalize(), // Direction
  //   new THREE.Vector3(60, 60, 75), // Start position (light target)
  //   20, // Arrow length
  //   0xff0000, // Color (red)
  // );

  // light.castShadow = true;

  // objects.push(light, lightHelper, arrowHelper);

  // createNormalsVisualization(bentMesh.geometry, objects);

  return objects;
}

export function computeBentSurfaceSplines(points: Vector3[]): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];

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
        adaptedZ -= 0.5;
      } else if (zValue === maxZ) {
        adaptedZ += 0.5;
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
        const distFlipped = currentCurvePoints.at(-1).distanceTo(prevCurvePoints[0]);

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
    objects.push(splineObject);
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

  window.bentGeometry = geometry;

  // Material and Mesh
  // const material = new THREE.MeshStandardMaterial({
  //   color: 0x0077ff, // A soft blue color
  //   metalness: 0.5, // Slight metallic effect
  //   roughness: 1, // Some surface roughness for a natural look
  //   side: THREE.DoubleSide, // Render both sides
  //   flatShading: false, // Ensures smooth shading with computed normals
  //   opacity: 0.8,
  //   transparent: true,
  //   wireframe: false,
  // });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      lightDirection1: { value: new THREE.Vector3(1, 1, 1).normalize() },
      lightDirection2: { value: new THREE.Vector3(-1, 1, 0).normalize() }, // Second light from the opposite side
      color: { value: new THREE.Color("#00c3ff") }, // Base color
    },
    vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: `
    uniform vec3 lightDirection1;
    uniform vec3 lightDirection2;
    uniform vec3 color;
    varying vec3 vNormal;

    void main() {
      vec3 normal = normalize(vNormal);

      // Half-Lambert shading for both lights
      float diff1 = max(dot(normal, normalize(lightDirection1)), 0.0);
      diff1 = diff1 * 0.5 + 0.5; // Shift and scale to avoid harsh shadows

      float diff2 = max(dot(normal, normalize(lightDirection2)), 0.0);
      diff2 = diff2 * 0.5 + 0.5; // Secondary light contribution

      // Combine both light contributions
      float diff = (diff1 + diff2) * 0.5; // Average both lights

      vec3 finalColor = color * diff;
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `,
  });

  material.side = THREE.DoubleSide; // Render both sides
  const surfaceMesh = new THREE.Mesh(geometry, material);
  window.bentMesh = surfaceMesh;

  objects.push(surfaceMesh);
  return objects;
}

// function createNormalsVisualization(geometry: THREE.BufferGeometry, objects: THREE.Object3D[]) {
//   const positions = geometry.attributes.position.array;
//   const normals = geometry.attributes.normal.array;
//   const normalLines: number[] = [];

//   for (let i = 0; i < positions.length; i += 3) {
//     const v = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
//     const n = new THREE.Vector3(normals[i], normals[i + 1], normals[i + 2]);

//     const vEnd = v.clone().add(n.multiplyScalar(5)); // Scale normals for visibility

//     normalLines.push(v.x, v.y, v.z, vEnd.x, vEnd.y, vEnd.z);
//   }

//   const normalGeometry = new THREE.BufferGeometry();
//   normalGeometry.setAttribute("position", new THREE.Float32BufferAttribute(normalLines, 3));

//   const normalMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 }); // Red for visibility
//   const normalLinesMesh = new THREE.LineSegments(normalGeometry, normalMaterial);

//   objects.push(normalLinesMesh); // Add to objects list instead of scene.add()
// }

export function generatePlanePoints(planeMesh: THREE.Mesh<THREE.PlaneGeometry, any>): Vector3[] {
  const points: THREE.Vector3[] = [];
  const width = planeMesh.geometry.parameters.width;
  const height = planeMesh.geometry.parameters.height;

  // Use the full transformation matrix of the plane
  const planeMatrix = planeMesh.matrixWorld.clone();

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const x = (i / (rows - 1) - 0.5) * width;
      const y = (j / (cols - 1) - 0.5) * height;
      let point = new THREE.Vector3(x, y, 0);

      point = point.applyMatrix4(planeMatrix);
      points.push(point);
    }
  }
  return points.map((vec) => [vec.x, vec.y, vec.z]);
}

export function createBentSurfaceGeometry(
  points: Vector3[],
  rows: number,
  cols: number,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();

  // Flattened position array
  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  });

  // Create indices for two triangles per quad
  const indices: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = i * cols + (j + 1);
      const c = (i + 1) * cols + j;
      const d = (i + 1) * cols + (j + 1);

      // Two triangles per quad
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  // Apply to geometry
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); // Generate normals for lighting

  const material = new THREE.MeshStandardMaterial({
    color: 0x0077ff, // A soft blue color
    metalness: 0.5, // Slight metallic effect
    roughness: 1, // Some surface roughness for a natural look
    side: THREE.DoubleSide, // Render both sides
    flatShading: false, // Ensures smooth shading with computed normals
  });

  // const material = new THREE.MeshLambertMaterial({
  //   color: "blue",
  //   emissive: "green",
  //   side: THREE.DoubleSide,
  //   transparent: true,
  // });

  // const material = new THREE.MeshPhysicalMaterial({
  //   color: 0x0077ff,
  //   metalness: 0.3,
  //   roughness: 0.5,
  //   clearcoat: 0.5, // Adds extra reflection
  //   side: THREE.DoubleSide,
  // });

  // const material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

  // material.transparent = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
