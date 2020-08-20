/**
 * volumelayer.js
 * @flow
 */

import _ from "lodash";

import {
  type BoundingBoxType,
  type OrthoView,
  type Vector2,
  type Vector3,
  Vector3Indicies,
  VolumeToolEnum,
  type VolumeTool,
} from "oxalis/constants";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import Drawing from "libs/drawing";
import Store from "oxalis/store";

export class VoxelIterator {
  hasNext: boolean = true;
  map: boolean[][];
  x = 0;
  y = 0;
  width: number;
  height: number;
  minCoord2d: Vector2;
  get3DCoordinate: Vector2 => Vector3;
  boundingBox: ?BoundingBoxType;
  next: Vector3;

  static finished(): VoxelIterator {
    const iterator = new VoxelIterator([], 0, 0, [0, 0], () => [0, 0, 0]);
    iterator.hasNext = false;
    return iterator;
  }

  constructor(
    map: boolean[][],
    width: number,
    height: number,
    minCoord2d: Vector2,
    get3DCoordinate: Vector2 => Vector3,
    boundingBox?: ?BoundingBoxType,
  ) {
    this.map = map;
    this.width = width;
    this.height = height;
    this.minCoord2d = minCoord2d;
    this.get3DCoordinate = get3DCoordinate;
    this.boundingBox = boundingBox;
    if (!this.map || !this.map[0]) {
      this.hasNext = false;
    } else {
      const firstCoordinate = this.get3DCoordinate(this.minCoord2d);
      if (this.map[0][0] && this.isCoordinateInBounds(firstCoordinate)) {
        this.next = firstCoordinate;
      } else {
        this.getNext();
      }
    }
  }

  isCoordinateInBounds(coor: Vector3): boolean {
    if (!this.boundingBox) {
      return true;
    }
    return (
      coor[0] >= this.boundingBox.min[0] &&
      coor[0] <= this.boundingBox.max[0] &&
      coor[1] >= this.boundingBox.min[1] &&
      coor[1] <= this.boundingBox.max[1] &&
      coor[2] >= this.boundingBox.min[2] &&
      coor[2] <= this.boundingBox.max[2]
    );
  }

  getNext(): Vector3 {
    const res = this.next;
    let foundNext = false;
    while (!foundNext) {
      this.x = (this.x + 1) % this.width;
      if (this.x === 0) {
        this.y++;
      }
      if (this.y === this.height) {
        foundNext = true;
        this.hasNext = false;
      } else if (this.map[this.x][this.y]) {
        const currentCoordinate = this.get3DCoordinate([
          this.x + this.minCoord2d[0],
          this.y + this.minCoord2d[1],
        ]);
        // check position for beeing in bounds
        if (this.isCoordinateInBounds(currentCoordinate)) {
          this.next = currentCoordinate;
          foundNext = true;
        }
      }
    }
    return res;
  }
}

export class Dynamic2DVoxelIterator {
  stack: Array<Vector2>;

  constructor(initialPosition: Vector2) {
    this.stack = [initialPosition];
  }

  step() {
    this.stack.pop();
  }

  add(newVoxel: Vector2) {
    return this.stack.push(newVoxel);
  }

  notEmpty(): boolean {
    return this.stack.length > 0;
  }

  getNeighbors(): Array<Vector2> {
    const currentVoxel = this.getCurrentVoxel();
    return [
      [currentVoxel[0] + 1, currentVoxel[1]],
      [currentVoxel[0] - 1, currentVoxel[1]],
      [currentVoxel[0], currentVoxel[1] + 1],
      [currentVoxel[0], currentVoxel[1] - 1],
    ];
  }
}

class VolumeLayer {
  plane: OrthoView;
  thirdDimensionValue: number;
  contourList: Array<Vector3>;
  maxCoord: ?Vector3;
  minCoord: ?Vector3;

  constructor(plane: OrthoView, thirdDimensionValue: number) {
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
    const volumeTracing = enforceVolumeTracing(Store.getState().tracing);
    return volumeTracing.contourList;
  }

  isEmpty(): boolean {
    return this.getContourList().length === 0;
  }

  getVoxelIterator(mode: VolumeTool): VoxelIterator {
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

    const setMap = (x: number, y: number, value = true) => {
      x = Math.floor(x);
      y = Math.floor(y);
      // Leave a 1px border in order for fillOutsideArea to work
      if (x > minCoord2d[0] && x < maxCoord2d[0] && y > minCoord2d[1] && y < maxCoord2d[1]) {
        map[x - minCoord2d[0]][y - minCoord2d[1]] = value;
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
    this.drawOutlineVoxels((x, y) => setMap(x, y, false), mode);
    this.fillOutsideArea(map, width, height);
    this.drawOutlineVoxels(setMap, mode);

    const iterator = new VoxelIterator(
      map,
      width,
      height,
      minCoord2d,
      this.get3DCoordinate.bind(this),
    );
    return iterator;
  }

  getCircleVoxelIterator(position: Vector3, boundings?: ?BoundingBoxType): VoxelIterator {
    const state = Store.getState();
    const { brushSize } = state.userConfiguration;

    const radius = Math.round(brushSize / 2);
    const width = 2 * radius;
    const height = 2 * radius;

    const map = new Array(width);
    for (let x = 0; x < width; x++) {
      map[x] = new Array(height);
      for (let y = 0; y < height; y++) {
        map[x][y] = false;
      }
    }
    const floatingCoord2d = this.get2DCoordinate(position);
    const coord2d = [Math.floor(floatingCoord2d[0]), Math.floor(floatingCoord2d[1])];
    const minCoord2d = [coord2d[0] - radius, coord2d[1] - radius];

    // Use the baseVoxelFactors to scale the circle, otherwise it'll become an ellipse
    const [scaleX, scaleY] = this.get2DCoordinate(
      getBaseVoxelFactors(state.dataset.dataSource.scale),
    );

    const setMap = (x, y) => {
      map[x][y] = true;
    };
    Drawing.fillCircle(radius, radius, radius, scaleX, scaleY, setMap);

    const iterator = new VoxelIterator(
      map,
      width,
      height,
      minCoord2d,
      this.get3DCoordinate.bind(this),
      boundings,
    );
    return iterator;
  }

  drawOutlineVoxels(setMap: (number, number) => void, mode: VolumeTool): void {
    const contourList = this.getContourList();
    const state = Store.getState();
    const [scaleX, scaleY] = this.get2DCoordinate(
      getBaseVoxelFactors(state.dataset.dataSource.scale),
    );
    const { brushSize } = state.userConfiguration;
    const radius = Math.round(brushSize / 2);
    let p1;
    let p2;
    for (let i = 0; i < contourList.length; i++) {
      p1 = this.get2DCoordinate(contourList[i]);

      if (mode === VolumeToolEnum.TRACE) {
        p2 = this.get2DCoordinate(contourList[(i + 1) % contourList.length]);
        Drawing.drawLine2d(p1[0], p1[1], p2[0], p2[1], setMap);
      } else if (mode === VolumeToolEnum.BRUSH) {
        Drawing.fillCircle(p1[0], p1[1], radius, scaleX, scaleY, setMap);
      }
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
    for (let i = 0; i < this.getContourList().length - 1; i++) {
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
}

export default VolumeLayer;
