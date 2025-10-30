import Drawing from "libs/drawing";
import { V2, V3 } from "libs/mjs";
import Toast from "libs/toast";
import _ from "lodash";
import messages from "messages";
import * as THREE from "three";
import { type Euler, Matrix3, Vector3 as ThreeVector3 } from "three";
import type { OrthoView, Vector2, Vector3 } from "viewer/constants";
import Constants, {
  OrthoViews,
  Vector3Indices,
  Vector2Indices,
  OrthoBaseRotations,
} from "viewer/constants";
import type { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { isBrushTool } from "viewer/model/accessors/tool_accessor";
import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import Dimensions from "viewer/model/dimensions";
import {
  scaleGlobalPositionWithMagnification,
  scaleGlobalPositionWithMagnificationFloat,
  zoomedPositionToGlobalPosition,
} from "viewer/model/helpers/position_converter";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import Store from "viewer/store";
import {
  type Transform,
  invertTransform,
  transformPointUnscaled,
} from "../helpers/transformation_helpers";

/*
  A VoxelBuffer2D instance holds a two dimensional slice
  of painted (binary) voxels. It is used by the
  VolumeLayer class to describe how volume operations
  should be applied.
 */
export class VoxelBuffer2D {
  readonly map: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly minCoord2d: Vector2;
  readonly getFast3DCoordinate: (arg0: number, arg1: number, arg2: Vector3 | Float32Array) => void;

  static empty(): VoxelBuffer2D {
    return new VoxelBuffer2D(new Uint8Array(0), 0, 0, [0, 0], () => {});
  }

  constructor(
    map: Uint8Array,
    width: number,
    height: number,
    minCoord2d: Vector2,
    getFast3DCoordinate: (arg0: number, arg1: number, arg2: Vector3 | Float32Array) => void,
  ) {
    this.map = map;
    this.width = width;
    this.height = height;
    this.minCoord2d = minCoord2d;
    this.getFast3DCoordinate = getFast3DCoordinate;

    if (!V2.equals(this.minCoord2d, V2.floor(this.minCoord2d))) {
      throw new Error("Minimum coordinate passed to VoxelBuffer2D is not an integer vector.");
    }
  }

  getTopLeft3DCoord = () => this.get3DCoordinateFromLocal2D([0, 0]);
  getBottomRight3DCoord = () => this.get3DCoordinateFromLocal2D([this.width, this.height]);

  private get3DCoordinateFromLocal2D = ([x, y]: Vector2) => {
    const outVar: Vector3 = [0, 0, 0];
    this.getFast3DCoordinate(x + this.minCoord2d[0], y + this.minCoord2d[1], outVar);
    return outVar;
  };

  linearizeIndex(x: number, y: number): number {
    return x * this.height + y;
  }

  setValue(x: number, y: number, value: number) {
    this.map[this.linearizeIndex(x, y)] = value;
  }

  isEmpty(): boolean {
    return this.width === 0 || this.height === 0;
  }
}
export class VoxelNeighborQueue3D {
  queue: Array<Vector3>;

  constructor(initialPosition: Vector3) {
    this.queue = [initialPosition];
  }

  pushVoxel(newVoxel: Vector3) {
    return this.queue.push(newVoxel);
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  getVoxelAndGetNeighbors(): { origin: Vector3; neighbors: Array<Vector3> } {
    if (this.isEmpty()) {
      return { origin: [0, 0, 0], neighbors: [] };
    }

    const currentVoxel = this.queue.shift();

    if (currentVoxel == null) {
      // Satisfy typescript
      throw new Error("Queue returned null even though queue was not empty?");
    }

    // 6-neighborhood in 3D
    return {
      origin: currentVoxel,
      neighbors: [
        [currentVoxel[0] + 1, currentVoxel[1], currentVoxel[2]],
        [currentVoxel[0] - 1, currentVoxel[1], currentVoxel[2]],
        [currentVoxel[0], currentVoxel[1] + 1, currentVoxel[2]],
        [currentVoxel[0], currentVoxel[1] - 1, currentVoxel[2]],
        [currentVoxel[0], currentVoxel[1], currentVoxel[2] + 1],
        [currentVoxel[0], currentVoxel[1], currentVoxel[2] - 1],
      ],
    };
  }
}
export class VoxelNeighborQueue2D extends VoxelNeighborQueue3D {
  getVoxelAndGetNeighbors(): { origin: Vector3; neighbors: Array<Vector3> } {
    if (this.isEmpty()) {
      return { origin: [0, 0, 0], neighbors: [] };
    }

    const currentVoxel = this.queue.shift();

    if (currentVoxel == null) {
      // Satisfy typescript
      throw new Error("Queue returned null even though queue was not empty?");
    }

    // 4-neighborhood in 2D
    return {
      origin: currentVoxel,
      neighbors: [
        [currentVoxel[0] + 1, currentVoxel[1], currentVoxel[2]],
        [currentVoxel[0] - 1, currentVoxel[1], currentVoxel[2]],
        [currentVoxel[0], currentVoxel[1] + 1, currentVoxel[2]],
        [currentVoxel[0], currentVoxel[1] - 1, currentVoxel[2]],
      ],
    };
  }
}

class SectionLabeler {
  /*
  From the outside, the SectionLabeler accepts only global positions. Internally,
  these are converted to the actual used mags (activeMag).
  Therefore, members of this class are in the mag space of
  `activeMag`.
  */
  readonly volumeTracingId: string;
  readonly plane: OrthoView;
  readonly thirdDimensionValue: number;

  // Stored in global (but mag-dependent) coordinates:
  minCoord: Vector3 | null | undefined;
  maxCoord: Vector3 | null | undefined;

  readonly activeMag: Vector3;

  fast3DCoordinateFunction: (coordX: number, coordY: number, out: Vector3 | Float32Array) => void;

  constructor(
    volumeTracingId: string,
    plane: OrthoView,
    thirdDimensionValue: number,
    activeMag: Vector3,
  ) {
    this.volumeTracingId = volumeTracingId;
    this.plane = plane;
    this.maxCoord = null;
    this.minCoord = null;
    this.activeMag = activeMag;
    const thirdDim = Dimensions.thirdDimensionForPlane(this.plane);
    this.thirdDimensionValue = Math.floor(thirdDimensionValue / this.activeMag[thirdDim]);

    this.fast3DCoordinateFunction = getFast3DCoordinateHelper(this.plane, this.thirdDimensionValue);
  }

  updateArea(globalPos: Vector3): void {
    /*
     * Adapts minCoord and maxCoord to the given position if necessary.
     */
    const pos = scaleGlobalPositionWithMagnification(globalPos, this.activeMag);
    let [maxCoord, minCoord] = [this.maxCoord, this.minCoord];

    if (maxCoord == null || minCoord == null) {
      maxCoord = _.clone(pos);
      minCoord = _.clone(pos);
    }

    for (const i of Vector3Indices) {
      minCoord[i] = Math.min(minCoord[i], Math.floor(pos[i]) - 2);
      maxCoord[i] = Math.max(maxCoord[i], Math.ceil(pos[i]) + 2);
    }

    this.minCoord = minCoord;
    this.maxCoord = maxCoord;
  }

  private getArea(): number {
    const [maxCoord, minCoord] = [this.maxCoord, this.minCoord];

    if (maxCoord == null || minCoord == null) {
      return 0;
    }

    const difference = V3.sub(maxCoord, minCoord);
    return difference[0] * difference[1] * difference[2];
  }

  private getContourList(useGlobalCoords: boolean = false) {
    const globalContourList = getVolumeTracingById(
      Store.getState().annotation,
      this.volumeTracingId,
    ).contourList;

    if (useGlobalCoords) {
      return globalContourList;
    }

    return globalContourList.map<Vector3>((point) =>
      scaleGlobalPositionWithMagnificationFloat(point, this.activeMag),
    );
  }

  isEmpty(): boolean {
    return this.getContourList(true).length === 0;
  }

  getFillingVoxelBuffer2D(mode: AnnotationTool): VoxelBuffer2D {
    if (this.isEmpty() || this.minCoord == null) {
      return VoxelBuffer2D.empty();
    }

    const minCoord2d = this.get2DCoordinate(this.minCoord);

    if (this.maxCoord == null) {
      return VoxelBuffer2D.empty();
    }

    const maxCoord2d = this.get2DCoordinate(this.maxCoord);

    if (isBrushTool(mode)) {
      // If the brush is used, only perform the "filling" operation
      // when start- and end coordinate are close enough to each other
      const globalContourList = this.getContourList(true);

      if (globalContourList.length < 2) {
        return VoxelBuffer2D.empty();
      }

      const startEndDist = V3.length(
        V3.sub(globalContourList[0], globalContourList[globalContourList.length - 1]),
      );
      const state = Store.getState();
      const { brushSize } = state.userConfiguration;
      const radius = Math.round(brushSize / 2);

      if (startEndDist > 2 * radius) {
        return VoxelBuffer2D.empty();
      }
    }

    // The maximum area is scaled by 3 as the min and maxCoord will always be three slices apart,
    // because in `updateArea` a value of 2 is subtracted / added when the values get updated.
    if (this.getArea() > Constants.AUTO_FILL_AREA_LIMIT * 3) {
      Toast.info(messages["tracing.area_to_fill_is_too_big"]);
      return VoxelBuffer2D.empty();
    }

    const width = maxCoord2d[0] - minCoord2d[0] + 1;
    const height = maxCoord2d[1] - minCoord2d[1] + 1;
    const buffer2D = this.createVoxelBuffer2D(minCoord2d, width, height, 1);

    const setMap = (x: number, y: number, value: number = 1) => {
      x = Math.floor(x);
      y = Math.floor(y);

      // Leave a 1px border in order for fillOutsideArea to work
      if (x > minCoord2d[0] && x < maxCoord2d[0] && y > minCoord2d[1] && y < maxCoord2d[1]) {
        buffer2D.map[(x - minCoord2d[0]) * height + (y - minCoord2d[1])] = value;
      }
    };

    // The approach is to initialize the map to true, then
    // draw the outline with false, then fill everything
    // outside the cell with false and then repaint the outline
    // with true.
    //
    // Reason:
    // Unless the shape is something like a ring, the area
    // outside the cell will be in one piece, unlike the inner
    // area if you consider narrow shapes.
    // Also, it will be very clear where to start the filling
    // algorithm.
    this.drawOutlineVoxels((x, y) => setMap(x, y, 0));
    this.fillOutsideArea(buffer2D.map, width, height);
    this.drawOutlineVoxels(setMap);
    return buffer2D;
  }

  private vector2PerpendicularVector(pos1: Vector2, pos2: Vector2): Vector2 {
    const dx = pos2[0] - pos1[0];

    if (dx === 0) {
      return [1, 0];
    } else {
      const gradient = (pos2[1] - pos1[1]) / dx;
      let perpendicularVector: Vector2 = [gradient, -1];
      const norm = this.vector2Norm(perpendicularVector);
      perpendicularVector = V2.scale(perpendicularVector, 1 / norm);
      return perpendicularVector;
    }
  }

  private vector2Norm(vector: Vector2): number {
    let norm = 0;

    for (const i of Vector2Indices) {
      norm += Math.pow(vector[i], 2);
    }

    return Math.sqrt(norm);
  }

  private vector2DistanceWithScale(pos1: Vector2, pos2: Vector2, scale: Vector2): number {
    let distance = 0;

    for (const i of Vector2Indices) {
      distance += Math.pow((pos2[i] - pos1[i]) / scale[i], 2);
    }

    return Math.sqrt(distance);
  }

  createVoxelBuffer2D(minCoord2d: Vector2, width: number, height: number, fillValue: number = 0) {
    const map = new Uint8Array(width * height);
    if (fillValue !== 0) {
      map.fill(fillValue);
    }

    return new VoxelBuffer2D(map, width, height, minCoord2d, this.fast3DCoordinateFunction);
  }

  private getRectangleBetweenCircles(
    centre1: Vector2,
    centre2: Vector2,
    radius: number,
    scale: Vector2,
  ): [number, number, number, number, number, number, number, number] {
    const normedPerpendicularVector = this.vector2PerpendicularVector(centre1, centre2);
    const shiftVector = V2.scale2(normedPerpendicularVector, V2.scale(scale, radius));
    const negShiftVector = V2.scale(shiftVector, -1);
    // calculate the rectangle's corners
    const [xa, ya] = V2.add(centre2, negShiftVector);
    const [xb, yb] = V2.add(centre2, shiftVector);
    const [xc, yc] = V2.add(centre1, shiftVector);
    const [xd, yd] = V2.add(centre1, negShiftVector);
    return [xa, ya, xb, yb, xc, yc, xd, yd];
  }

  getRectangleVoxelBuffer2D(
    lastUnzoomedPosition: Vector3,
    unzoomedPosition: Vector3,
  ): VoxelBuffer2D | null {
    const lastPosition = scaleGlobalPositionWithMagnification(lastUnzoomedPosition, this.activeMag);
    const position = scaleGlobalPositionWithMagnification(unzoomedPosition, this.activeMag);
    const state = Store.getState();
    const { brushSize } = state.userConfiguration;
    const radius = Math.round(brushSize / 2);
    // Use the baseVoxelFactors to scale the rectangle, otherwise it'll become deformed
    const scale = this.get2DCoordinate(
      scaleGlobalPositionWithMagnificationFloat(
        getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale),
        this.activeMag,
      ),
    );
    const floatingCoord2dLastPosition = this.get2DCoordinate(lastPosition);
    const floatingCoord2dPosition = this.get2DCoordinate(position);

    if (
      this.vector2DistanceWithScale(floatingCoord2dLastPosition, floatingCoord2dPosition, scale) <
      1.5 * radius
    ) {
      return null;
    }

    let [xa, ya, xb, yb, xc, yc, xd, yd] = this.getRectangleBetweenCircles(
      floatingCoord2dLastPosition,
      floatingCoord2dPosition,
      radius,
      scale,
    );
    const minCoord2d: Vector2 = [
      Math.floor(Math.min(xa, xb, xc, xd)),
      Math.floor(Math.min(ya, yb, yc, yd)),
    ];
    const maxCoord2d: Vector2 = [
      Math.ceil(Math.max(xa, xb, xc, xd)),
      Math.ceil(Math.max(ya, yb, yc, yd)),
    ];
    const [width, height] = V2.sub(maxCoord2d, minCoord2d);
    const voxelBuffer2D = this.createVoxelBuffer2D(minCoord2d, width, height);

    const setMap = (x: number, y: number) => {
      voxelBuffer2D.setValue(x, y, 1);
    };

    // translate the coordinates so the containing box originates in (0|0)
    const [diffX, diffY] = minCoord2d;
    xa -= diffX;
    ya -= diffY;
    xb -= diffX;
    yb -= diffY;
    xc -= diffX;
    yc -= diffY;
    xd -= diffX;
    yd -= diffY;
    Drawing.fillRectangle(xa, ya, xb, yb, xc, yc, xd, yd, setMap);
    return voxelBuffer2D;
  }

  globalCoordToMag2DFloat(position: Vector3): Vector2 {
    return this.get2DCoordinate(
      scaleGlobalPositionWithMagnificationFloat(position, this.activeMag),
    );
  }

  getCircleVoxelBuffer2D(position: Vector3): VoxelBuffer2D {
    const state = Store.getState();
    const { brushSize } = state.userConfiguration;
    const dimIndices = Dimensions.getIndices(this.plane);
    const unzoomedRadius = Math.round(brushSize / 2);
    const width = Math.floor((2 * unzoomedRadius) / this.activeMag[dimIndices[0]]);
    const height = Math.floor((2 * unzoomedRadius) / this.activeMag[dimIndices[1]]);
    const floatingCoord2d = this.globalCoordToMag2DFloat(position);

    const radiusOffset = Dimensions.transDim([unzoomedRadius, unzoomedRadius, 0], this.plane);
    const topLeft = V3.sub(position, radiusOffset);
    const bottomRight = V3.add(position, radiusOffset);

    this.updateArea(topLeft);
    this.updateArea(bottomRight);

    const minCoord2d: Vector2 = [
      Math.floor(floatingCoord2d[0] - width / 2),
      Math.floor(floatingCoord2d[1] - height / 2),
    ];
    const buffer2D = this.createVoxelBuffer2D(minCoord2d, width, height);
    // Use the baseVoxelFactors to scale the circle, otherwise it'll become an ellipse
    const [scaleX, scaleY] = this.get2DCoordinate(
      getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale),
    );

    const setMap = (x: number, y: number) => {
      buffer2D.setValue(x, y, 1);
    };

    Drawing.fillCircle(
      Math.floor(unzoomedRadius / this.activeMag[dimIndices[0]]),
      Math.floor(unzoomedRadius / this.activeMag[dimIndices[1]]), // the unzoomedRadius is adapted to the correct mag by the
      // following scale parameters
      unzoomedRadius,
      scaleX / this.activeMag[dimIndices[0]],
      scaleY / this.activeMag[dimIndices[1]],
      setMap,
    );
    return buffer2D;
  }

  private drawOutlineVoxels(setMap: (arg0: number, arg1: number) => void): void {
    const contourList = this.getContourList();
    let p1;
    let p2;

    for (let i = 0; i < contourList.length; i++) {
      p1 = this.get2DCoordinate(contourList[i]);
      p2 = this.get2DCoordinate(contourList[(i + 1) % contourList.length]);
      Drawing.drawLine2d(p1[0], p1[1], p2[0], p2[1], setMap);
    }
  }

  private fillOutsideArea(map: Uint8Array, width: number, height: number): void {
    const setMap = (x: number, y: number) => {
      map[x * height + y] = 0;
    };

    const isEmpty = (x: number, y: number) => map[x * height + y] === 1;

    // Fill everything BUT the cell
    Drawing.fillArea(0, 0, width, height, false, isEmpty, setMap);
  }

  private get2DCoordinate(coord3d: Vector3): Vector2 {
    // Throw out 'thirdCoordinate' which is always the same, anyway.
    const transposed = Dimensions.transDim(coord3d, this.plane);
    return [transposed[0], transposed[1]];
  }

  getUnzoomedCentroid(): Vector3 {
    /* Returns the centroid (in the global coordinate system).
     *
     * Formula:
     * https://en.wikipedia.org/wiki/Centroid#Centroid_of_polygon
     */

    let sumArea = 0;
    let sumCx = 0;
    let sumCy = 0;
    const contourList = this.getContourList();

    for (let i = 0; i < contourList.length - 1; i++) {
      const [x, y] = this.get2DCoordinate(contourList[i]);
      const [x1, y1] = this.get2DCoordinate(contourList[i + 1]);
      sumArea += x * y1 - x1 * y;
      sumCx += (x + x1) * (x * y1 - x1 * y);
      sumCy += (y + y1) * (x * y1 - x1 * y);
    }

    const area = sumArea / 2;
    if (area === 0) {
      return zoomedPositionToGlobalPosition(contourList[0], this.activeMag);
    }

    const cx = sumCx / 6 / area;
    const cy = sumCy / 6 / area;
    const outZoomedPosition: Vector3 = [0, 0, 0];
    this.fast3DCoordinateFunction(cx, cy, outZoomedPosition);
    const pos = zoomedPositionToGlobalPosition(outZoomedPosition, this.activeMag);
    return pos;
  }

  getPlane(): OrthoView {
    return this.plane;
  }
}

function eulerToNormal(e: Euler): ThreeVector3 {
  const m = new Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
  const n = new ThreeVector3(0, 0, 1);
  n.applyMatrix3(m).normalize();
  return n;
}

function mapTransformedPlane(originalPlane: OrthoView, transform: Transform): OrthoView {
  const originalNormal = eulerToNormal(OrthoBaseRotations[originalPlane]);
  const transformedNormal = originalNormal
    .clone()
    .applyMatrix4(new THREE.Matrix4(...transform.affineMatrix))
    .normalize();

  const canonical: Record<OrthoView, ThreeVector3> = {
    [OrthoViews.PLANE_XY]: new ThreeVector3(0, 0, 1),
    [OrthoViews.PLANE_YZ]: new ThreeVector3(1, 0, 0),
    [OrthoViews.PLANE_XZ]: new ThreeVector3(0, 1, 0),
    [OrthoViews.TDView]: new ThreeVector3(1, 1, 1).normalize(),
  };
  let bestView = OrthoViews.PLANE_XY;
  let bestDot = Number.NEGATIVE_INFINITY;

  for (const [view, normal] of Object.entries(canonical)) {
    const dot = Math.abs(transformedNormal.dot(normal as ThreeVector3));
    if (dot > bestDot) {
      bestDot = dot;
      bestView = view as OrthoView;
    }
  }

  return bestView;
}

export class TransformedSectionLabeler {
  private readonly base: SectionLabeler;
  private readonly transform: Transform;
  applyTransform: (pos: Vector3) => Vector3;
  applyInverseTransform: (pos: Vector3) => Vector3;
  mappedPlane: OrthoView;

  constructor(
    volumeTracingId: string,
    plane: OrthoView,
    getThirdDimValue: (thirdDim: number) => number,
    activeMag: Vector3,
    transform: Transform,
  ) {
    this.assertOrthogonalTransform(transform);
    this.transform = transform;
    this.mappedPlane = mapTransformedPlane(plane, transform);

    const thirdDimensionValue = getThirdDimValue(
      Dimensions.thirdDimensionForPlane(this.mappedPlane),
    );

    // the base SectionLabeler operates in the *transformed* plane
    this.base = new SectionLabeler(
      volumeTracingId,
      this.mappedPlane,
      thirdDimensionValue,
      activeMag,
    );

    this.applyTransform = transformPointUnscaled(this.transform);
    this.applyInverseTransform = transformPointUnscaled(invertTransform(this.transform));
  }

  // --- Core coordinate helpers ---

  // private applyTransformList(list: Vector3[]): Vector3[] {
  //   return list.map((v) => this.applyTransform(v));
  // }

  // private applyInverseTransformList(list: Vector3[]): Vector3[] {
  //   return list.map((v) => this.applyInverseTransform(v));
  // }

  private assertOrthogonalTransform(_m: Transform): void {
    // todop
    // Quick check for orthogonal ±1 rotation/flip matrices
    // const shouldBeIdentity = Transform.multiply(m, Transform.transpose(m));
    // const isOrtho = Transform.isCloseToIdentity(shouldBeIdentity);
    // const hasValidEntries = m.flat().every((x) => Math.abs(x) === 0 || Math.abs(x) === 1);
    // if (!isOrtho || !hasValidEntries) {
    //   throw new Error("Transformation matrix must be an orthogonal ±1 rotation/flip/scale matrix");
    // }
  }

  // --- Delegated methods with coordinate adaptation ---

  createVoxelBuffer2D(minCoord2d: Vector2, width: number, height: number, fillValue: number = 0) {
    return this.base.createVoxelBuffer2D(minCoord2d, width, height, fillValue);
  }

  updateArea(globalPos: Vector3): void {
    this.base.updateArea(this.applyTransform(globalPos));
  }

  isEmpty(): boolean {
    return this.base.isEmpty();
  }

  getFillingVoxelBuffer2D(mode: AnnotationTool): VoxelBuffer2D {
    // Buffer orientation could be left unchanged unless 2D plane transforms are needed.
    return this.base.getFillingVoxelBuffer2D(mode);
  }

  getRectangleVoxelBuffer2D(
    lastUnzoomedPosition: Vector3,
    unzoomedPosition: Vector3,
  ): VoxelBuffer2D | null {
    const p1 = this.applyTransform(lastUnzoomedPosition);
    const p2 = this.applyTransform(unzoomedPosition);
    return this.base.getRectangleVoxelBuffer2D(p1, p2);
  }

  globalCoordToMag2DFloat(position: Vector3): Vector2 {
    return this.base.globalCoordToMag2DFloat(position);
  }

  getCircleVoxelBuffer2D(position: Vector3): VoxelBuffer2D {
    // const p = this.applyTransform(position);
    return this.base.getCircleVoxelBuffer2D(position);
  }

  getUnzoomedCentroid(): Vector3 {
    const centroid = this.base.getUnzoomedCentroid();
    return this.applyInverseTransform(centroid);
  }

  getPlane(): OrthoView {
    return this.mappedPlane;
  }
}

function getFast3DCoordinateHelper(
  plane: OrthoView,
  thirdDimensionValue: number,
): (coordX: number, coordY: number, out: Vector3 | Float32Array) => void {
  switch (plane) {
    case OrthoViews.PLANE_XY:
      return (coordX, coordY, out) => {
        out[0] = coordX;
        out[1] = coordY;
        out[2] = thirdDimensionValue;
      };

    case OrthoViews.PLANE_YZ:
      return (coordX, coordY, out) => {
        out[0] = thirdDimensionValue;
        out[1] = coordY;
        out[2] = coordX;
      };

    case OrthoViews.PLANE_XZ:
      return (coordX, coordY, out) => {
        out[0] = coordX;
        out[1] = thirdDimensionValue;
        out[2] = coordY;
      };

    default: {
      throw new Error("Unknown plane id");
    }
  }
}
export default SectionLabeler;
