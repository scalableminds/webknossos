/**
 * volumelayer.js
 * @flow
 */

import _ from "lodash";

import { V2, V3 } from "libs/mjs";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { isBrushTool } from "oxalis/model/accessors/tool_accessor";
import {
  scaleGlobalPositionWithResolution,
  scaleGlobalPositionWithResolutionFloat,
  zoomedPositionToGlobalPosition,
} from "oxalis/model/helpers/position_converter";
import Constants, {
  OrthoViews,
  type OrthoView,
  type Vector2,
  type Vector3,
  Vector3Indicies,
  type AnnotationTool,
  Vector2Indicies,
} from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";
import Drawing from "libs/drawing";
import Store from "oxalis/store";
import Toast from "libs/toast";
import messages from "messages";

/*
  A VoxelBuffer2D instance holds a two dimensional slice
  of painted (binary) voxels. It is used by the
  VolumeLayer class to describe how volume operations
  should be applied.
 */
export class VoxelBuffer2D {
  map: Uint8Array;
  width: number;
  height: number;
  minCoord2d: Vector2;
  get3DCoordinate: Vector2 => Vector3;
  getFast3DCoordinate: (number, number, Vector3 | Float32Array) => void;

  static empty(): VoxelBuffer2D {
    return new VoxelBuffer2D(new Uint8Array(0), 0, 0, [0, 0], () => [0, 0, 0], () => {});
  }

  constructor(
    map: Uint8Array,
    width: number,
    height: number,
    minCoord2d: Vector2,
    get3DCoordinate: Vector2 => Vector3,
    getFast3DCoordinate: (number, number, Vector3 | Float32Array) => void,
  ) {
    this.map = map;
    this.width = width;
    this.height = height;
    this.minCoord2d = minCoord2d;
    this.get3DCoordinate = get3DCoordinate;
    this.getFast3DCoordinate = getFast3DCoordinate;
  }

  linearizeIndex(x: number, y: number): number {
    return x * this.height + y;
  }
}

export class VoxelNeighborQueue3D {
  stack: Array<Vector3>;

  constructor(initialPosition: Vector3) {
    this.stack = [initialPosition];
  }

  pushVoxel(newVoxel: Vector3) {
    return this.stack.push(newVoxel);
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }

  getVoxelAndGetNeighbors(): Array<Vector3> {
    if (this.isEmpty()) {
      return [];
    }
    const currentVoxel = this.stack.shift();
    // 6-neighborhood in 3D
    return [
      [currentVoxel[0] + 1, currentVoxel[1], currentVoxel[2]],
      [currentVoxel[0] - 1, currentVoxel[1], currentVoxel[2]],
      [currentVoxel[0], currentVoxel[1] + 1, currentVoxel[2]],
      [currentVoxel[0], currentVoxel[1] - 1, currentVoxel[2]],
      [currentVoxel[0], currentVoxel[1], currentVoxel[2] + 1],
      [currentVoxel[0], currentVoxel[1], currentVoxel[2] - 1],
    ];
  }
}

class VolumeLayer {
  /*
  From the outside, the VolumeLayer accepts only global positions. Internally,
  these are converted to the actual used resolution (activeResolution).
  Therefore, members of this class are in the resolution space of
  `activeResolution`.
  */

  plane: OrthoView;
  thirdDimensionValue: number;
  contourList: Array<Vector3>;
  maxCoord: ?Vector3;
  minCoord: ?Vector3;
  activeResolution: Vector3;

  constructor(plane: OrthoView, thirdDimensionValue: number, activeResolution: Vector3) {
    this.plane = plane;
    this.maxCoord = null;
    this.minCoord = null;
    this.activeResolution = activeResolution;

    const thirdDim = Dimensions.thirdDimensionForPlane(this.plane);
    this.thirdDimensionValue = Math.floor(thirdDimensionValue / this.activeResolution[thirdDim]);
  }

  addContour(globalPos: Vector3): void {
    this.updateArea(globalPos);
  }

  updateArea(globalPos: Vector3): void {
    const pos = scaleGlobalPositionWithResolution(globalPos, this.activeResolution);
    let [maxCoord, minCoord] = [this.maxCoord, this.minCoord];

    if (maxCoord == null || minCoord == null) {
      maxCoord = _.clone(pos);
      minCoord = _.clone(pos);
    }

    for (const i of Vector3Indicies) {
      minCoord[i] = Math.min(minCoord[i], Math.floor(pos[i]) - 2);
      maxCoord[i] = Math.max(maxCoord[i], Math.ceil(pos[i]) + 2);
    }

    this.minCoord = minCoord;
    this.maxCoord = maxCoord;
  }

  getArea(): number {
    const [maxCoord, minCoord] = [this.maxCoord, this.minCoord];
    if (maxCoord == null || minCoord == null) {
      return 0;
    }
    const difference = V3.sub(maxCoord, minCoord);
    return difference[0] * difference[1] * difference[2];
  }

  getContourList(useGlobalCoords: boolean = false) {
    const volumeTracing = enforceVolumeTracing(Store.getState().tracing);
    const globalContourList = volumeTracing.contourList;

    if (useGlobalCoords) {
      return globalContourList;
    }

    return globalContourList.map<Vector3>(point =>
      scaleGlobalPositionWithResolutionFloat(point, this.activeResolution),
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

    const map = this.createMap(width, height, 1);

    const setMap = (x: number, y: number, value: number = 1) => {
      x = Math.floor(x);
      y = Math.floor(y);
      // Leave a 1px border in order for fillOutsideArea to work
      if (x > minCoord2d[0] && x < maxCoord2d[0] && y > minCoord2d[1] && y < maxCoord2d[1]) {
        map[(x - minCoord2d[0]) * height + (y - minCoord2d[1])] = value;
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
    this.fillOutsideArea(map, width, height);
    this.drawOutlineVoxels(setMap);

    const buffer2D = new VoxelBuffer2D(
      map,
      width,
      height,
      minCoord2d,
      this.get3DCoordinate.bind(this),
      this.getFast3DCoordinateFunction(),
    );
    return buffer2D;
  }

  vector2PerpendicularVector(pos1: Vector2, pos2: Vector2): Vector2 {
    const dx = pos2[0] - pos1[0];
    let perpendicularVector;
    if (dx === 0) {
      perpendicularVector = [1, 0];
    } else {
      const gradient = (pos2[1] - pos1[1]) / dx;
      perpendicularVector = [gradient, -1];
      const norm = this.vector2Norm(perpendicularVector);
      perpendicularVector = V2.scale(perpendicularVector, 1 / norm);
    }
    return perpendicularVector;
  }

  vector2Norm(vector: Vector2): number {
    let norm = 0;
    for (const i of Vector2Indicies) {
      norm += Math.pow(vector[i], 2);
    }
    return Math.sqrt(norm);
  }

  vector2DistanceWithScale(pos1: Vector2, pos2: Vector2, scale: Vector2): number {
    let distance = 0;
    for (const i of Vector2Indicies) {
      distance += Math.pow((pos2[i] - pos1[i]) / scale[i], 2);
    }
    return Math.sqrt(distance);
  }

  createMap(width: number, height: number, fillValue: number = 0): Uint8Array {
    const map = new Uint8Array(width * height);
    if (fillValue !== 0) {
      map.fill(fillValue);
    }
    return map;
  }

  getRectangleBetweenCircles(
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
  ): ?VoxelBuffer2D {
    const lastPosition = scaleGlobalPositionWithResolution(
      lastUnzoomedPosition,
      this.activeResolution,
    );
    const position = scaleGlobalPositionWithResolution(unzoomedPosition, this.activeResolution);
    const state = Store.getState();
    const { brushSize } = state.userConfiguration;

    const radius = Math.round(brushSize / 2);
    // Use the baseVoxelFactors to scale the rectangle, otherwise it'll become deformed
    const scale = this.get2DCoordinate(
      scaleGlobalPositionWithResolutionFloat(
        getBaseVoxelFactors(state.dataset.dataSource.scale),
        this.activeResolution,
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
    const minCoord2d = [Math.floor(Math.min(xa, xb, xc, xd)), Math.floor(Math.min(ya, yb, yc, yd))];
    const maxCoord2d = [Math.ceil(Math.max(xa, xb, xc, xd)), Math.ceil(Math.max(ya, yb, yc, yd))];
    const [width, height] = V3.sub(maxCoord2d, minCoord2d);
    const map = this.createMap(width, height);

    const setMap = (x, y) => {
      map[x * height + y] = 1;
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

    const voxelBuffer2D = new VoxelBuffer2D(
      map,
      width,
      height,
      minCoord2d,
      this.get3DCoordinate.bind(this),
      this.getFast3DCoordinateFunction(),
    );
    return voxelBuffer2D;
  }

  getCircleVoxelBuffer2D(position: Vector3): VoxelBuffer2D {
    const state = Store.getState();
    const { brushSize } = state.userConfiguration;
    const dimIndices = Dimensions.getIndices(this.plane);

    const unzoomedRadius = Math.round(brushSize / 2);
    const width = Math.floor((2 * unzoomedRadius) / this.activeResolution[dimIndices[0]]);
    const height = Math.floor((2 * unzoomedRadius) / this.activeResolution[dimIndices[1]]);

    const map = this.createMap(width, height);

    const floatingCoord2d = this.get2DCoordinate(
      scaleGlobalPositionWithResolutionFloat(position, this.activeResolution),
    );
    const minCoord2d = [
      Math.floor(floatingCoord2d[0] - width / 2),
      Math.floor(floatingCoord2d[1] - height / 2),
    ];

    // Use the baseVoxelFactors to scale the circle, otherwise it'll become an ellipse
    const [scaleX, scaleY] = this.get2DCoordinate(
      getBaseVoxelFactors(state.dataset.dataSource.scale),
    );

    const setMap = (x, y) => {
      map[x * height + y] = 1;
    };
    Drawing.fillCircle(
      Math.floor(unzoomedRadius / this.activeResolution[dimIndices[0]]),
      Math.floor(unzoomedRadius / this.activeResolution[dimIndices[1]]),
      // the unzoomedRadius is adapted to the correct resolution by the
      // following scale parameters
      unzoomedRadius,
      scaleX / this.activeResolution[dimIndices[0]],
      scaleY / this.activeResolution[dimIndices[1]],
      setMap,
    );

    const buffer2D = new VoxelBuffer2D(
      map,
      width,
      height,
      minCoord2d,
      this.get3DCoordinate.bind(this),
      this.getFast3DCoordinateFunction(),
    );
    return buffer2D;
  }

  drawOutlineVoxels(setMap: (number, number) => void): void {
    const contourList = this.getContourList();
    let p1;
    let p2;
    for (let i = 0; i < contourList.length; i++) {
      p1 = this.get2DCoordinate(contourList[i]);
      p2 = this.get2DCoordinate(contourList[(i + 1) % contourList.length]);

      Drawing.drawLine2d(p1[0], p1[1], p2[0], p2[1], setMap);
    }
  }

  fillOutsideArea(map: Uint8Array, width: number, height: number): void {
    const setMap = (x, y) => {
      map[x * height + y] = 0;
    };
    const isEmpty = (x, y) => map[x * height + y] === 1;

    // Fill everything BUT the cell
    Drawing.fillArea(0, 0, width, height, false, isEmpty, setMap);
  }

  get2DCoordinate(coord3d: Vector3): Vector2 {
    // Throw out 'thirdCoordinate' which is equal anyways
    const transposed = Dimensions.transDim(coord3d, this.plane);
    return [transposed[0], transposed[1]];
  }

  get3DCoordinate(coord2d: Vector2): Vector3 {
    return Dimensions.transDim([coord2d[0], coord2d[1], this.thirdDimensionValue], this.plane);
  }

  getFast3DCoordinateFunction(): (
    coordX: number,
    coordY: number,
    out: Vector3 | Float32Array,
  ) => void {
    switch (this.plane) {
      case OrthoViews.PLANE_XY:
        return (coordX, coordY, out) => {
          out[0] = coordX;
          out[1] = coordY;
          out[2] = this.thirdDimensionValue;
        };
      case OrthoViews.PLANE_YZ:
        return (coordX, coordY, out) => {
          out[0] = this.thirdDimensionValue;
          out[1] = coordY;
          out[2] = coordX;
        };
      case OrthoViews.PLANE_XZ:
        return (coordX, coordY, out) => {
          out[0] = coordX;
          out[1] = this.thirdDimensionValue;
          out[2] = coordY;
        };
      default: {
        throw new Error("Unknown plane id");
      }
    }
  }

  getUnzoomedCentroid(): Vector3 {
    // Formula:
    // https://en.wikipedia.org/wiki/Centroid#Centroid_of_polygon

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
    const cx = sumCx / 6 / area;
    const cy = sumCy / 6 / area;

    const zoomedPosition = this.get3DCoordinate([cx, cy]);
    const pos = zoomedPositionToGlobalPosition(zoomedPosition, this.activeResolution);
    return pos;
  }
}

export default VolumeLayer;
