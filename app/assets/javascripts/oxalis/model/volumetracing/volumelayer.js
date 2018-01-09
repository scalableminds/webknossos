/**
 * volumelayer.js
 * @flow
 */

import _ from "lodash";
import Drawing from "libs/drawing";
import Utils from "libs/utils";
import Dimensions from "oxalis/model/dimensions";
import { Vector3Indicies } from "oxalis/constants";
import Store from "oxalis/store";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import type { OrthoViewType, Vector2, Vector3 } from "oxalis/constants";

export class VoxelIterator {
  hasNext: boolean = true;
  map: boolean[][];
  x = 0;
  y = 0;
  width: number;
  height: number;
  minCoord2d: Vector2;
  get3DCoordinate: Vector2 => Vector3;

  static finished(): VoxelIterator {
    const iterator = new VoxelIterator([], 0, 0, [0, 0]);
    iterator.hasNext = false;
    return iterator;
  }

  constructor(
    map: boolean[][],
    width: number,
    height: number,
    minCoord2d: Vector2,
    get3DCoordinate: Vector2 => Vector3 = () => [0, 0, 0],
  ) {
    this.map = map;
    this.width = width;
    this.height = height;
    this.minCoord2d = minCoord2d;
    this.get3DCoordinate = get3DCoordinate;
    if (!this.map[0][0]) {
      this.getNext();
    }
  }

  getNext(): Vector3 {
    const res = this.get3DCoordinate([this.x + this.minCoord2d[0], this.y + this.minCoord2d[1]]);
    let foundNext = false;
    while (!foundNext) {
      this.x = (this.x + 1) % this.width;
      if (this.x === 0) {
        this.y++;
      }
      if (this.map[this.x][this.y] || this.y === this.height) {
        this.hasNext = this.y !== this.height;
        foundNext = true;
      }
    }
    return res;
  }
}

class VolumeLayer {
  plane: OrthoViewType;
  thirdDimensionValue: number;
  contourList: Array<Vector3>;
  maxCoord: ?Vector3;
  minCoord: ?Vector3;

  constructor(plane: OrthoViewType, thirdDimensionValue: number) {
    this.plane = plane;
    this.thirdDimensionValue = thirdDimensionValue;
    this.maxCoord = null;
    this.minCoord = null;
  }

  addContour(pos: Vector3): void {
    this.updateArea(pos);
  }

  updateArea(pos: Vector3): void {
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

  getContourList() {
    const volumeTracing = Store.getState().tracing;
    if (volumeTracing.type !== "volume") {
      throw new Error("getContourList must only be called in a volume tracing!");
    } else {
      return volumeTracing.contourList;
    }
  }

  finish(): void {
    if (!this.isEmpty()) {
      this.addContour(this.getContourList()[0]);
    }
  }

  isEmpty(): boolean {
    return this.getContourList().length === 0;
  }

  getVoxelIterator(): VoxelIterator {
    if (this.isEmpty()) {
      return VoxelIterator.finished();
    }

    if (this.minCoord == null) {
      return VoxelIterator.finished();
    }
    const minCoord2d = this.get2DCoordinate(this.minCoord);

    if (this.maxCoord == null) {
      return VoxelIterator.finished();
    }
    const maxCoord2d = this.get2DCoordinate(this.maxCoord);

    const width = maxCoord2d[0] - minCoord2d[0] + 1;
    const height = maxCoord2d[1] - minCoord2d[1] + 1;

    const map = new Array(width);
    for (let x = 0; x < width; x++) {
      map[x] = new Array(height);
      for (let y = 0; y < height; y++) {
        map[x][y] = true;
      }
    }

    const setMap = function(x: number, y: number, value = true): void {
      x = Math.floor(x);
      y = Math.floor(y);
      map[x - minCoord2d[0]][y - minCoord2d[1]] = value;
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
    this.drawOutlineVoxels((x, y) => setMap(x, y, false));
    this.fillOutsideArea(map, width, height);
    this.drawOutlineVoxels(setMap);

    const iterator = new VoxelIterator(
      map,
      width,
      height,
      minCoord2d,
      this.get3DCoordinate.bind(this),
    );
    return iterator;
  }

  getCircleVoxelIterator(position: Vector3): VoxelIterator {
    const radius = Math.round(
      this.pixelsToVoxels(Store.getState().temporaryConfiguration.brushSize) / 2,
    );
    const width = 2 * radius + 1;
    const height = width;

    const map = new Array(width);
    for (let x = 0; x < width; x++) {
      map[x] = new Array(height);
      for (let y = 0; y < height; y++) {
        map[x][y] = false;
      }
    }
    const coord2d = this.get2DCoordinate(position);
    const minCoord2d = [Math.floor(coord2d[0] - radius), Math.floor(coord2d[1] - radius)];

    const setMap = function(x: number, y: number, value = true): void {
      x = Math.floor(x);
      y = Math.floor(y);
      map[x - minCoord2d[0]][y - minCoord2d[1]] = value;
    };

    // Use the baseVoxelFactors to scale the circle, otherwise it'll become an ellipse
    const baseVoxelFactors = this.get2DCoordinate(
      getBaseVoxelFactors(Store.getState().dataset.scale),
    );
    Drawing.fillCircle(coord2d[0], coord2d[1], radius, baseVoxelFactors, (x, y) =>
      setMap(x, y, true),
    );

    const iterator = new VoxelIterator(
      map,
      width,
      height,
      minCoord2d,
      this.get3DCoordinate.bind(this),
    );
    return iterator;
  }

  drawOutlineVoxels(setMap: (number, number) => void): void {
    let p1;
    let p2;
    for (let i = 0; i < this.getContourList().length; i++) {
      p1 = this.get2DCoordinate(this.getContourList()[i]);
      p2 = this.get2DCoordinate(this.getContourList()[(i + 1) % this.getContourList().length]);

      Drawing.drawLine2d(p1[0], p1[1], p2[0], p2[1], setMap);
    }
  }

  fillOutsideArea(map: boolean[][], width: number, height: number): void {
    const setMap = (x, y) => {
      map[x][y] = false;
    };
    const isEmpty = (x, y) => map[x][y] === true;

    // Fill everything BUT the cell
    Drawing.fillArea(0, 0, width, height, false, isEmpty, setMap);
  }

  get2DCoordinate(coord3d: Vector3): Vector2 {
    // Throw out 'thirdCoordinate' which is equal anyways
    const result = [];
    for (let i = 0; i <= 2; i++) {
      if (i !== Dimensions.thirdDimensionForPlane(this.plane)) {
        result.push(coord3d[i]);
      }
    }
    return [result[0], result[1]];
  }

  get3DCoordinate(coord2d: Vector2): Vector3 {
    // Put thirdCoordinate back in
    const index = Dimensions.thirdDimensionForPlane(this.plane);
    let index2d = 0;
    const res = [0, 0, 0];

    for (let i = 0; i <= 2; i++) {
      if (i !== index) {
        res[i] = coord2d[index2d++];
      } else {
        res[i] = this.thirdDimensionValue;
      }
    }

    return res;
  }

  getCentroid(): Vector3 {
    // Formula:
    // https://en.wikipedia.org/wiki/Centroid#Centroid_of_polygon

    let sumArea = 0;
    let sumCx = 0;
    let sumCy = 0;
    for (const i of Utils.__range__(0, this.getContourList().length - 1, false)) {
      const [x, y] = this.get2DCoordinate(this.getContourList()[i]);
      const [x1, y1] = this.get2DCoordinate(this.getContourList()[i + 1]);
      sumArea += x * y1 - x1 * y;
      sumCx += (x + x1) * (x * y1 - x1 * y);
      sumCy += (y + y1) * (x * y1 - x1 * y);
    }

    const area = sumArea / 2;
    const cx = sumCx / 6 / area;
    const cy = sumCy / 6 / area;

    return this.get3DCoordinate([cx, cy]);
  }

  pixelsToVoxels(pixels: number): number {
    const state = Store.getState();
    const zoomFactor = getPlaneScalingFactor(state.flycam);
    const viewportScale = state.userConfiguration.scale;
    return pixels / viewportScale * zoomFactor;
  }
}

export default VolumeLayer;
