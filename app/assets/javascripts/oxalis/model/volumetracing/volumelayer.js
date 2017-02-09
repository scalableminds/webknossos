/**
 * volumelayer.js
 * @flow weak
 */

import Drawing from "libs/drawing";
import Utils from "libs/utils";
import Dimensions from "oxalis/model/dimensions";

import type { PlaneType, Vector3 } from "oxalis/constants";


class VolumeLayer {

  plane: PlaneType;
  thirdDimensionValue: number;
  contourList: Array<Vector3>;
  maxCoord: ?Vector3;
  minCoord: ?Vector3;

  constructor(plane, thirdDimensionValue) {
    this.plane = plane;
    this.thirdDimensionValue = thirdDimensionValue;
    this.contourList = [];
    this.maxCoord = null;
    this.minCoord = null;
  }


  addContour(pos) {
    this.contourList.push(pos);
    return this.updateArea(pos);
  }


  updateArea(pos: Vector3) {
    let [maxCoord, minCoord] = [this.maxCoord, this.minCoord];

    if (maxCoord == null || minCoord == null) {
      maxCoord = pos.slice();
      minCoord = pos.slice();
    }

    for (let i = 0; i <= 2; i++) {
      minCoord[i] = Math.min(minCoord[i], Math.floor(pos[i]) - 2);
      maxCoord[i] = Math.max(maxCoord[i], Math.ceil(pos[i]) + 2);
    }

    this.minCoord = minCoord;
    this.maxCoord = maxCoord;
  }


  getSmoothedContourList() {
    return Drawing.smoothLine(this.contourList, (pos => this.updateArea(pos)));
  }


  finish() {
    if (!this.isEmpty()) {
      this.addContour(this.contourList[0]);
    }
  }


  isEmpty() {
    return this.contourList.length === 0;
  }


  getVoxelIterator() {
    if (this.isEmpty()) {
      return { hasNext: false };
    }

    const minCoord2d = this.get2DCoordinate(this.minCoord);
    const maxCoord2d = this.get2DCoordinate(this.maxCoord);

    const width = (maxCoord2d[0] - minCoord2d[0]) + 1;
    const height = (maxCoord2d[1] - minCoord2d[1]) + 1;

    const map = new Array(width);
    for (const x of Utils.__range__(0, width, false)) {
      map[x] = new Array(height);
      for (const y of Utils.__range__(0, height, false)) {
        map[x][y] = true;
      }
    }

    const setMap = function (x, y, value = true) {
      x = Math.floor(x); y = Math.floor(y);
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

    const iterator = {
      hasNext: true,
      x: 0,
      y: 0,
      getNext() {
        const res = this.get3DCoordinate([this.x + minCoord2d[0], this.y + minCoord2d[1]]);
        let foundNext = false;
        while (!foundNext) {
          this.x = (this.x + 1) % width;
          if (this.x === 0) { this.y++; }
          if (map[this.x][this.y] || this.y === height) {
            this.hasNext = this.y !== height;
            foundNext = true;
          }
        }
        return res;
      },
      initialize() {
        if (!map[0][0]) {
          this.getNext();
        }
      },
      get3DCoordinate: arg => this.get3DCoordinate(arg),
    };
    iterator.initialize();

    return iterator;
  }


  drawOutlineVoxels(setMap) {
    let p1;
    let p2;
    for (let i = 0; i < this.contourList.length; i++) {
      p1 = this.get2DCoordinate(this.contourList[i]);
      p2 = this.get2DCoordinate(this.contourList[(i + 1) % this.contourList.length]);

      Drawing.drawLine2d(p1[0], p1[1], p2[0], p2[1], setMap);
    }
  }


  fillOutsideArea(map, width, height) {
    const setMap = (x, y) => { map[x][y] = false; };
    const isEmpty = (x, y) => map[x][y] === true;

    // Fill everything BUT the cell
    return Drawing.fillArea(0, 0, width, height, false, isEmpty, setMap);
  }


  get2DCoordinate(coord3d) {
    // Throw out 'thirdCoordinate' which is equal anyways

    const result = [];
    for (let i = 0; i <= 2; i++) {
      if (i !== Dimensions.thirdDimensionForPlane(this.plane)) {
        result.push(coord3d[i]);
      }
    }
    return result;
  }


  get3DCoordinate(coord2d) {
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


  getQuadrantWithRespectToPoint(vertex, point) {
    const xDiff = vertex[0] - point[0];
    const yDiff = vertex[1] - point[1];

    if (xDiff === 0 && yDiff === 0) {
      // Vertex and point have the same coordinates
      return 0;
    }

    switch (false) {
      case xDiff > 0 || yDiff <= 0: return 1;
      case xDiff > 0 || yDiff > 0: return 2;
      case xDiff <= 0 || yDiff > 0: return 3;
      case xDiff <= 0 || yDiff <= 0: return 4;
      default: return null; // Cannot happen
    }
  }


  calculateDistance(p1, p2) {
    const diff = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
    return Math.sqrt((diff[0] * diff[0]) + (diff[1] * diff[1]) + (diff[2] * diff[2]));
  }


  interpolatePositions(pos1, pos2, f) {
    const sPos1 = [pos1[0] * (1 - f), pos1[1] * (1 - f), pos1[2] * (1 - f)];
    const sPos2 = [pos2[0] * f, pos2[1] * f, pos2[2] * f];
    return [sPos1[0] + sPos2[0], sPos1[1] + sPos2[1], sPos1[2] + sPos2[2]];
  }


  getCentroid() {
    // Formula:
    // https://en.wikipedia.org/wiki/Centroid#Centroid_of_polygon

    let sumArea = 0;
    let sumCx = 0;
    let sumCy = 0;
    for (const i of Utils.__range__(0, (this.contourList.length - 1), false)) {
      const [x, y] = this.get2DCoordinate(this.contourList[i]);
      const [x1, y1] = this.get2DCoordinate(this.contourList[i + 1]);
      sumArea += (x * y1) - (x1 * y);
      sumCx += (x + x1) * ((x * y1) - (x1 * y));
      sumCy += (y + y1) * ((x * y1) - (x1 * y));
    }

    const area = sumArea / 2;
    const cx = sumCx / 6 / area;
    const cy = sumCy / 6 / area;

    return this.get3DCoordinate([cx, cy]);
  }
}

export default VolumeLayer;
