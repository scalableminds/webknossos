import app from "app";
import type Maybe from "data.maybe";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import window from "libs/window";
import _ from "lodash";

import type {
  BoundingBoxType,
  OrthoView,
  OrthoViewMap,
  OrthoViewWithoutTDMap,
  Vector3,
} from "oxalis/constants";
import constants, {
  OrthoViews,
  OrthoViewValuesWithoutTDView,
  TDViewDisplayModeEnum,
} from "oxalis/constants";
import { destroyRenderer, getRenderer } from "oxalis/controller/renderer";
import { setSceneController } from "oxalis/controller/scene_controller_provider";
import type ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import Cube from "oxalis/geometries/cube";
import {
  ContourGeometry,
  LineMeasurementGeometry,
  QuickSelectGeometry,
} from "oxalis/geometries/helper_geometries";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import {
  getDataLayers,
  getDatasetBoundingBox,
  getLayerBoundingBox,
  getLayerNameToIsDisabled,
} from "oxalis/model/accessors/dataset_accessor";
import { getTransformsForLayerOrNull } from "oxalis/model/accessors/dataset_layer_transformation_accessor";
import { getActiveMagIndicesForLayers, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { getPlaneScalingFactor } from "oxalis/model/accessors/view_mode_accessor";
import { sceneControllerReadyAction } from "oxalis/model/actions/actions";
import Dimensions from "oxalis/model/dimensions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { getVoxelPerUnit } from "oxalis/model/scaleinfo";
import { Model } from "oxalis/singletons";
import type { OxalisState, SkeletonTracing, UserBoundingBox } from "oxalis/store";
import Store from "oxalis/store";
import PCA from "pca-js";
import * as THREE from "three";
import SegmentMeshController from "./segment_mesh_controller";

const CUBE_COLOR = 0x999999;
const LAYER_CUBE_COLOR = 0xffff99;

import Delaunator from "delaunator";
import TPS3D from "libs/thin_plate_spline";
import { WkDevFlags } from "oxalis/api/wk_dev";
import { orderPointsMST } from "./splitting_stuff";

import {
  computeBoundsTree,
  disposeBoundsTree,
  computeBatchedBoundsTree,
  disposeBatchedBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";

// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;

type EigenData = { eigenvalue: number; vector: number[] };

function _createPointCloud(points: Vector3[], color: string) {
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

function computeBentSurfaceDelauny(points3D: Vector3[]): THREE.Object3D[] {
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

function projectPoints(points: Vector3[]) {
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

function computeBentSurfaceTPS(points: Vector3[]): THREE.Object3D[] {
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

function computeBentSurfaceSplines(points: Vector3[]): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  console.log("fresh!");

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

function generatePlanePoints(planeMesh: THREE.Mesh<THREE.PlaneGeometry, any>): Vector3[] {
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

function createBentSurfaceGeometry(points: Vector3[], rows: number, cols: number): THREE.Mesh {
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

function generateTPSMesh(points, scale, resolution = 20) {
  if (points.length < 3) {
    throw new Error("At least 3 points are needed to define a surface.");
  }

  const sourcePoints = points.map(projectToPlane);
  const targetPoints = points.map((p) => [p[0], p[1], p[2]]);

  // Step 3: Create the TPS transformation
  const tps = new TPS3D(sourcePoints, targetPoints, scale);

  // Step 4: Generate a grid of points in the base plane
  const minX = Math.min(...sourcePoints.map((p) => p[0]));
  const maxX = Math.max(...sourcePoints.map((p) => p[0]));
  const minY = Math.min(...sourcePoints.map((p) => p[1]));
  const maxY = Math.max(...sourcePoints.map((p) => p[1]));

  const gridPoints = [];
  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const x = minX + (i / resolution) * (maxX - minX);
      const y = minY + (j / resolution) * (maxY - minY);
      const transformed = tps.transform(x, y, 0);
      gridPoints.push(new THREE.Vector3(transformed[0], transformed[1], transformed[2]));
    }
  }

  // Step 5: Perform Delaunay triangulation to create faces
  const delaunay = Delaunator.from(gridPoints.map((p) => [p.x, p.y]));
  const indices = delaunay.triangles;

  // Step 6: Convert data into THREE.BufferGeometry
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(gridPoints.length * 3);

  gridPoints.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geometry.computeVertexNormals(); // Smooth shading

  return geometry;
}

class SceneController {
  skeletons: Record<number, Skeleton> = {};
  current: number;
  isPlaneVisible: OrthoViewMap<boolean>;
  planeShift: Vector3;
  datasetBoundingBox!: Cube;
  userBoundingBoxGroup!: THREE.Group;
  layerBoundingBoxGroup!: THREE.Group;
  userBoundingBoxes!: Array<Cube>;
  layerBoundingBoxes!: { [layerName: string]: Cube };
  annotationToolsGeometryGroup!: THREE.Group;
  highlightedBBoxId: number | null | undefined;
  taskBoundingBox: Cube | null | undefined;
  contour!: ContourGeometry;
  quickSelectGeometry!: QuickSelectGeometry;
  lineMeasurementGeometry!: LineMeasurementGeometry;
  areaMeasurementGeometry!: ContourGeometry;
  planes!: OrthoViewWithoutTDMap<Plane>;
  rootNode!: THREE.Object3D;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  rootGroup!: THREE.Object3D;
  // Group for all meshes including a light.
  // meshesRootGroup!: THREE.Object3D;
  segmentMeshController: SegmentMeshController;
  storePropertyUnsubscribers: Array<() => void>;

  // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
  // element depending on the provided flycam.
  constructor() {
    this.current = 0;
    this.isPlaneVisible = {
      [OrthoViews.PLANE_XY]: true,
      [OrthoViews.PLANE_YZ]: true,
      [OrthoViews.PLANE_XZ]: true,
      [OrthoViews.TDView]: true,
    };
    this.planeShift = [0, 0, 0];
    this.segmentMeshController = new SegmentMeshController();
    this.storePropertyUnsubscribers = [];
  }

  initialize() {
    // this.meshesRootGroup = new THREE.Group();
    this.renderer = getRenderer();
    this.createMeshes();
    this.bindToEvents();
    this.scene = new THREE.Scene();
    // Because the voxel coordinates do not have a cube shape but are distorted,
    // we need to distort the entire scene to provide an illustration that is
    // proportional to the actual size in nm.
    // For some reason, all objects have to be put into a group object. Changing
    // scene.scale does not have an effect.
    this.rootGroup = new THREE.Object3D();
    this.rootGroup.add(this.getRootNode());

    this.highlightedBBoxId = null;
    // The dimension(s) with the highest mag will not be distorted
    this.rootGroup.scale.copy(
      new THREE.Vector3(...Store.getState().dataset.dataSource.scale.factor),
    );
    // Add scene to the group, all Geometries are then added to group
    this.scene.add(this.rootGroup);
    this.scene.add(this.segmentMeshController.meshesLODRootGroup);
    // this.scene.add(this.meshesRootGroup);

    /* Scene
     * - rootGroup
     *   - DirectionalLight
     *   - surfaceGroup
     * - meshesLODRootGroup
     *   - DirectionalLight
     */

    const dir1 = new THREE.DirectionalLight(undefined, 3 * 0.25);
    dir1.position.set(1, 1, 1);
    // const dir2 = new THREE.DirectionalLight(undefined, 3 * 0.25);
    // dir2.position.set(-1, -1, -1);
    const dir3 = new THREE.AmbientLight(undefined, 3 * 0.25);

    this.rootGroup.add(dir1);
    // this.rootGroup.add(dir2);
    this.rootGroup.add(dir3);

    const dir4 = new THREE.DirectionalLight(undefined, 3 * 0.25);
    dir4.position.set(1, 1, 1);
    // const dir5 = new THREE.DirectionalLight(undefined, 10);
    // dir5.position.set(-1, -1, -1);
    const dir6 = new THREE.AmbientLight(undefined, 3 * 0.25);

    this.segmentMeshController.meshesLODRootGroup.add(dir4);
    // this.segmentMeshController.meshesLODRootGroup.add(dir5);
    this.segmentMeshController.meshesLODRootGroup.add(dir6);
    this.rootGroup.add(new THREE.AmbientLight(2105376, 3 * 10));
    this.setupDebuggingMethods();
  }

  setupDebuggingMethods() {
    // These methods are attached to window, since we would run into circular import errors
    // otherwise.
    // @ts-ignore
    window.addBucketMesh = (
      position: Vector3,
      zoomStep: number,
      mag: Vector3,
      optColor?: string,
    ) => {
      const bucketSize = [
        constants.BUCKET_WIDTH * mag[0],
        constants.BUCKET_WIDTH * mag[1],
        constants.BUCKET_WIDTH * mag[2],
      ];
      const boxGeometry = new THREE.BoxGeometry(...bucketSize);
      const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
      const material = new THREE.LineBasicMaterial({
        color: optColor || (zoomStep === 0 ? 0xff00ff : 0x00ffff),
        linewidth: 1,
      });
      const cube = new THREE.LineSegments(edgesGeometry, material);
      cube.position.x = position[0] + bucketSize[0] / 2;
      cube.position.y = position[1] + bucketSize[1] / 2;
      cube.position.z = position[2] + bucketSize[2] / 2;
      this.rootNode.add(cube);
      return cube;
    };

    // @ts-ignore
    window.addVoxelMesh = (position: Vector3, _cubeLength: Vector3, optColor?: string) => {
      // Shrink voxels a bit so that it's easier to identify individual voxels.
      const cubeLength = _cubeLength.map((el) => el * 0.9);

      const boxGeometry = new THREE.BoxGeometry(...cubeLength);
      const material = new THREE.MeshBasicMaterial({
        color: optColor || 0xff00ff,
        opacity: 0.5,
      });
      const cube = new THREE.Mesh(boxGeometry, material);
      cube.position.x = position[0] + cubeLength[0] / 2;
      cube.position.y = position[1] + cubeLength[1] / 2;
      cube.position.z = position[2] + cubeLength[2] / 2;
      this.rootNode.add(cube);
      return cube;
    };

    let renderedLines: THREE.Line[] = [];

    // Utility function for visual debugging
    // @ts-ignore
    window.addLine = (a: Vector3, b: Vector3) => {
      const material = new THREE.LineBasicMaterial({
        color: 0x0000ff,
      });
      const points = [];
      points.push(new THREE.Vector3(...a));
      points.push(new THREE.Vector3(...b));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, material);
      this.rootNode.add(line);
      renderedLines.push(line);
    };

    // Utility function for visual debugging
    // @ts-ignore
    window.removeLines = () => {
      for (const line of renderedLines) {
        this.rootNode.remove(line);
      }

      renderedLines = [];
    };

    // @ts-ignore
    window.removeBucketMesh = (mesh: THREE.LineSegments) => this.rootNode.remove(mesh);
  }

  createMeshes(): void {
    this.rootNode = new THREE.Object3D();
    this.userBoundingBoxGroup = new THREE.Group();
    this.layerBoundingBoxGroup = new THREE.Group();
    this.rootNode.add(this.userBoundingBoxGroup);
    this.rootNode.add(this.layerBoundingBoxGroup);
    this.annotationToolsGeometryGroup = new THREE.Group();
    this.rootNode.add(this.annotationToolsGeometryGroup);
    this.userBoundingBoxes = [];
    const state = Store.getState();
    // Cubes
    const { min, max } = getDatasetBoundingBox(state.dataset);
    this.datasetBoundingBox = new Cube({
      min,
      max,
      color: CUBE_COLOR,
      showCrossSections: true,
      isHighlighted: false,
    });
    this.datasetBoundingBox.getMeshes().forEach((mesh) => this.rootNode.add(mesh));
    const taskBoundingBox = getSomeTracing(state.annotation).boundingBox;
    this.buildTaskingBoundingBox(taskBoundingBox);

    this.contour = new ContourGeometry();
    this.contour.getMeshes().forEach((mesh) => this.annotationToolsGeometryGroup.add(mesh));

    this.quickSelectGeometry = new QuickSelectGeometry();
    this.annotationToolsGeometryGroup.add(this.quickSelectGeometry.getMeshGroup());

    this.lineMeasurementGeometry = new LineMeasurementGeometry();
    this.lineMeasurementGeometry
      .getMeshes()
      .forEach((mesh) => this.annotationToolsGeometryGroup.add(mesh));
    this.areaMeasurementGeometry = new ContourGeometry(true);
    this.areaMeasurementGeometry
      .getMeshes()
      .forEach((mesh) => this.annotationToolsGeometryGroup.add(mesh));

    if (state.annotation.skeleton != null) {
      this.addSkeleton((_state) => getSkeletonTracing(_state.annotation), true);
    }

    this.planes = {
      [OrthoViews.PLANE_XY]: new Plane(OrthoViews.PLANE_XY),
      [OrthoViews.PLANE_YZ]: new Plane(OrthoViews.PLANE_YZ),
      [OrthoViews.PLANE_XZ]: new Plane(OrthoViews.PLANE_XZ),
    };
    this.planes[OrthoViews.PLANE_XY].setRotation(new THREE.Euler(Math.PI, 0, 0));
    this.planes[OrthoViews.PLANE_YZ].setRotation(new THREE.Euler(Math.PI, (1 / 2) * Math.PI, 0));
    this.planes[OrthoViews.PLANE_XZ].setRotation(new THREE.Euler((-1 / 2) * Math.PI, 0, 0));

    for (const plane of _.values(this.planes)) {
      plane.getMeshes().forEach((mesh: THREE.Object3D) => this.rootNode.add(mesh));
    }

    // Hide all objects at first, they will be made visible later if needed
    this.stopPlaneMode();
  }

  addBentSurface(points: Vector3[]) {
    // const meshGeometry = generateTPSMesh(points, [1, 1, 1], 30);
    // // const material = new THREE.MeshStandardMaterial({ color: 0x88ccff, wireframe: true });
    // const material = new THREE.MeshLambertMaterial({
    //   color: "green",
    //   wireframe: true,
    // });
    // material.side = THREE.FrontSide;
    // // material.transparent = true;
    // const surfaceMesh = new THREE.Mesh(meshGeometry, material);
    // this.rootNode.add(surfaceMesh);

    if (points.length === 0) {
      return () => {};
    }

    let objs: THREE.Object3D[] = [];
    try {
      if (WkDevFlags.splittingStrategy === "tps") {
        objs = computeBentSurfaceTPS(points);
      } else if (WkDevFlags.splittingStrategy === "splines") {
        objs = computeBentSurfaceSplines(points);
      } else if (WkDevFlags.splittingStrategy === "delauny") {
        objs = computeBentSurfaceDelauny(points);
      } else {
        Toast.error("Unknown splitting strategy. Use tps or splines or delauny");
        return () => {};
      }
    } catch (exc) {
      console.error(exc);
      Toast.error("Could not compute surface");
      return () => {};
    }

    const surfaceGroup = new THREE.Group();
    for (const obj of objs) {
      surfaceGroup.add(obj);
    }

    this.rootGroup.add(surfaceGroup);
    // surfaceGroup.scale.copy(new THREE.Vector3(...Store.getState().dataset.dataSource.scale.factor));

    return () => {
      this.rootGroup.remove(surfaceGroup);
    };
  }

  addSkeleton(
    skeletonTracingSelector: (arg0: OxalisState) => Maybe<SkeletonTracing>,
    supportsPicking: boolean,
  ): number {
    const skeleton = new Skeleton(skeletonTracingSelector, supportsPicking);
    const skeletonGroup = skeleton.getRootGroup();
    this.skeletons[skeletonGroup.id] = skeleton;
    this.rootNode.add(skeletonGroup);
    return skeletonGroup.id;
  }

  removeSkeleton(skeletonId: number) {
    const skeleton = this.skeletons[skeletonId];
    const skeletonGroup = skeleton.getRootGroup();
    skeleton.destroy();
    delete this.skeletons[skeletonId];
    this.rootNode.remove(skeletonGroup);
  }

  buildTaskingBoundingBox(taskBoundingBox: BoundingBoxType | null | undefined): void {
    if (taskBoundingBox != null) {
      if (this.taskBoundingBox != null) {
        this.taskBoundingBox.getMeshes().forEach((mesh) => this.rootNode.remove(mesh));
      }

      const { viewMode } = Store.getState().temporaryConfiguration;
      this.taskBoundingBox = new Cube({
        min: taskBoundingBox.min,
        max: taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true,
        isHighlighted: false,
      });
      this.taskBoundingBox.getMeshes().forEach((mesh) => this.rootNode.add(mesh));

      if (constants.MODES_ARBITRARY.includes(viewMode)) {
        this.taskBoundingBox?.setVisibility(false);
      }
    }
  }

  updateSceneForCam = (id: OrthoView, hidePlanes: boolean = false): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.
    const { tdViewDisplayPlanes, tdViewDisplayDatasetBorders, tdViewDisplayLayerBorders } =
      Store.getState().userConfiguration;
    // Only set the visibility of the dataset bounding box for the TDView.
    // This has to happen before updateForCam is called as otherwise cross section visibility
    // might be changed unintentionally.
    this.datasetBoundingBox.setVisibility(id !== OrthoViews.TDView || tdViewDisplayDatasetBorders);
    this.datasetBoundingBox.updateForCam(id);
    this.userBoundingBoxes.forEach((bbCube) => bbCube.updateForCam(id));
    const layerNameToIsDisabled = getLayerNameToIsDisabled(Store.getState().datasetConfiguration);
    Object.keys(this.layerBoundingBoxes).forEach((layerName) => {
      const bbCube = this.layerBoundingBoxes[layerName];
      const visible =
        id === OrthoViews.TDView && tdViewDisplayLayerBorders && !layerNameToIsDisabled[layerName];
      bbCube.setVisibility(visible);
      bbCube.updateForCam(id);
    });

    this.taskBoundingBox?.updateForCam(id);

    this.segmentMeshController.meshesLODRootGroup.visible = id === OrthoViews.TDView;
    // todop
    if (window.bentMesh != null) {
      window.bentMesh.visible = id === OrthoViews.TDView;
    }
    // this.segmentMeshController.meshesLODRootGroup.visible = false;
    this.annotationToolsGeometryGroup.visible = id !== OrthoViews.TDView;
    this.lineMeasurementGeometry.updateForCam(id);

    const originalPosition = getPosition(Store.getState().flycam);
    if (id !== OrthoViews.TDView) {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(!hidePlanes);

          const pos = _.clone(originalPosition);

          const ind = Dimensions.getIndices(planeId);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] +=
            planeId === OrthoViews.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          this.planes[planeId].setPosition(pos, originalPosition);

          this.quickSelectGeometry.adaptVisibilityForRendering(originalPosition, ind[2]);
        } else {
          this.planes[planeId].setVisible(false);
        }
        this.planes[planeId].materialFactory.uniforms.is3DViewBeingRendered.value = false;
      }
    } else {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        this.planes[planeId].setPosition(originalPosition);
        this.planes[planeId].setGrayCrosshairColor();
        this.planes[planeId].setVisible(
          tdViewDisplayPlanes !== TDViewDisplayModeEnum.NONE,
          this.isPlaneVisible[planeId] && tdViewDisplayPlanes === TDViewDisplayModeEnum.DATA,
        );
        this.planes[planeId].materialFactory.uniforms.is3DViewBeingRendered.value = true;
      }
    }
  };

  update(optArbitraryPlane?: ArbitraryPlane): void {
    const state = Store.getState();
    const { flycam } = state;
    const globalPosition = getPosition(flycam);

    const magIndices = getActiveMagIndicesForLayers(Store.getState());
    for (const dataLayer of Model.getAllLayers()) {
      dataLayer.layerRenderingManager.updateDataTextures(
        globalPosition,
        magIndices[dataLayer.name],
      );
    }

    if (!optArbitraryPlane) {
      for (const currentPlane of _.values<Plane>(this.planes)) {
        const [scaleX, scaleY] = getPlaneScalingFactor(state, flycam, currentPlane.planeID);
        const isVisible = scaleX > 0 && scaleY > 0;

        if (isVisible) {
          this.isPlaneVisible[currentPlane.planeID] = true;
          currentPlane.setScale(scaleX, scaleY);
        } else {
          this.isPlaneVisible[currentPlane.planeID] = false;
          // Set the scale to non-zero values, since threejs will otherwise
          // complain about non-invertible matrices.
          currentPlane.setScale(1, 1);
        }
      }
    }
  }

  setDisplayCrosshair(value: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setDisplayCrosshair(value);
    }

    app.vent.emit("rerender");
  }

  setClippingDistance(value: number): void {
    // convert nm to voxel
    const voxelPerNMVector = getVoxelPerUnit(Store.getState().dataset.dataSource.scale);
    V3.scale(voxelPerNMVector, value, this.planeShift);
    app.vent.emit("rerender");
  }

  setInterpolation(value: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setLinearInterpolationEnabled(value);
    }

    app.vent.emit("rerender");
  }

  getRootNode(): THREE.Object3D {
    return this.rootNode;
  }

  setUserBoundingBoxes(bboxes: Array<UserBoundingBox>): void {
    const newUserBoundingBoxGroup = new THREE.Group();
    this.userBoundingBoxes = bboxes.map(({ boundingBox, isVisible, color, id }) => {
      const { min, max } = boundingBox;
      const bbColor: Vector3 = [color[0] * 255, color[1] * 255, color[2] * 255];
      const bbCube = new Cube({
        min,
        max,
        color: Utils.rgbToInt(bbColor),
        showCrossSections: true,
        id,
        isHighlighted: this.highlightedBBoxId === id,
      });
      bbCube.setVisibility(isVisible);
      bbCube.getMeshes().forEach((mesh) => newUserBoundingBoxGroup.add(mesh));
      return bbCube;
    });
    this.rootNode.remove(this.userBoundingBoxGroup);
    this.userBoundingBoxGroup = newUserBoundingBoxGroup;
    this.rootNode.add(this.userBoundingBoxGroup);
  }

  updateLayerBoundingBoxes(): void {
    const state = Store.getState();
    const dataset = state.dataset;
    const layers = getDataLayers(dataset);

    const newLayerBoundingBoxGroup = new THREE.Group();
    this.layerBoundingBoxes = Object.fromEntries(
      layers.map((layer) => {
        const boundingBox = getLayerBoundingBox(dataset, layer.name);
        const { min, max } = boundingBox;
        const bbCube = new Cube({
          min,
          max,
          color: LAYER_CUBE_COLOR,
          showCrossSections: false,
          isHighlighted: false,
        });
        bbCube.getMeshes().forEach((mesh) => {
          const transformMatrix = getTransformsForLayerOrNull(
            dataset,
            layer,
            state.datasetConfiguration.nativelyRenderedLayerName,
          )?.affineMatrix;
          if (transformMatrix) {
            const matrix = new THREE.Matrix4();
            // @ts-ignore
            matrix.set(...transformMatrix);
            mesh.applyMatrix4(matrix);
          }
          newLayerBoundingBoxGroup.add(mesh);
        });
        return [layer.name, bbCube];
      }),
    );
    this.rootNode.remove(this.layerBoundingBoxGroup);
    this.layerBoundingBoxGroup = newLayerBoundingBoxGroup;
    this.rootNode.add(this.layerBoundingBoxGroup);
  }

  highlightUserBoundingBox(bboxId: number | null | undefined): void {
    if (this.highlightedBBoxId === bboxId) {
      return;
    }

    const setIsHighlighted = (id: number, isHighlighted: boolean) => {
      const bboxToChangeHighlighting = this.userBoundingBoxes.find((bbCube) => bbCube.id === id);

      if (bboxToChangeHighlighting != null) {
        bboxToChangeHighlighting.setIsHighlighted(isHighlighted);
      }
    };

    if (this.highlightedBBoxId != null) {
      setIsHighlighted(this.highlightedBBoxId, false);
    }

    if (bboxId != null) {
      setIsHighlighted(bboxId, true);
    }

    this.highlightedBBoxId = bboxId;
  }

  setSkeletonGroupVisibility(isVisible: boolean) {
    Object.values(this.skeletons).forEach((skeleton: Skeleton) => {
      skeleton.getRootGroup().visible = isVisible;
    });
  }

  stopPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(false);
    }

    this.datasetBoundingBox.setVisibility(false);
    this.userBoundingBoxGroup.visible = false;

    this.taskBoundingBox?.setVisibility(false);

    if (this.segmentMeshController.meshesLODRootGroup != null) {
      this.segmentMeshController.meshesLODRootGroup.visible = false;
    }
  }

  startPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(true);
    }

    this.datasetBoundingBox.setVisibility(true);
    this.userBoundingBoxGroup.visible = true;

    this.taskBoundingBox?.setVisibility(true);
  }

  destroy() {
    // @ts-ignore
    window.addBucketMesh = undefined;
    // @ts-ignore
    window.addVoxelMesh = undefined;
    // @ts-ignore
    window.addLine = undefined;
    // @ts-ignore
    window.removeLines = undefined;
    // @ts-ignore
    window.removeBucketMesh = undefined;

    for (const skeletonId of Object.keys(this.skeletons)) {
      this.removeSkeleton(Number.parseInt(skeletonId, 10));
    }

    for (const fn of this.storePropertyUnsubscribers) {
      fn();
    }
    this.storePropertyUnsubscribers = [];

    destroyRenderer();
    // @ts-ignore
    this.renderer = null;

    this.datasetBoundingBox.destroy();
    this.userBoundingBoxes.forEach((cube) => cube.destroy());
    Object.values(this.layerBoundingBoxes).forEach((cube) => cube.destroy());
    this.taskBoundingBox?.destroy();

    for (const plane of _.values(this.planes)) {
      plane.destroy();
    }

    this.rootNode = new THREE.Object3D();
  }

  bindToEvents(): void {
    this.storePropertyUnsubscribers = [
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.clippingDistance,
        (clippingDistance) => this.setClippingDistance(clippingDistance),
      ),
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.displayCrosshair,
        (displayCrosshair) => this.setDisplayCrosshair(displayCrosshair),
      ),
      listenToStoreProperty(
        (storeState) => storeState.datasetConfiguration.interpolation,
        (interpolation) => this.setInterpolation(interpolation),
      ),
      listenToStoreProperty(
        (storeState) => getSomeTracing(storeState.annotation).userBoundingBoxes,
        (bboxes) => this.setUserBoundingBoxes(bboxes),
      ),
      listenToStoreProperty(
        (storeState) => getDataLayers(storeState.dataset),
        () => this.updateLayerBoundingBoxes(),
      ),
      listenToStoreProperty(
        (storeState) => storeState.datasetConfiguration.nativelyRenderedLayerName,
        () => this.updateLayerBoundingBoxes(),
      ),
      listenToStoreProperty(
        (storeState) => getSomeTracing(storeState.annotation).boundingBox,
        (bb) => this.buildTaskingBoundingBox(bb),
      ),
      listenToStoreProperty(
        (storeState) =>
          storeState.annotation.skeleton ? storeState.annotation.skeleton.showSkeletons : false,
        (showSkeletons) => this.setSkeletonGroupVisibility(showSkeletons),
        true,
      ),
    ];
  }
}

export type SceneControllerType = SceneController;
export function initializeSceneController() {
  const controller = new SceneController();
  setSceneController(controller);
  controller.initialize();
  Store.dispatch(sceneControllerReadyAction());
}

// Please use scene_controller_provider to get a reference to SceneController. This avoids
// problems with circular dependencies.
export default {};
