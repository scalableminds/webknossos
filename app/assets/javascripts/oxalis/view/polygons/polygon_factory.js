/**
 * polygon_factory.js
 * @flow weak
 */

import _ from "lodash";
import Cube from "../../model/binary/cube";
import tlt from "./tlt";
import Deferred from "../../../libs/deferred";

// This class is capable of turning voxel data into triangles
// Based on the marching cubes algorithm
class PolygonFactory {
  chunkSize: number;
  deferred: Deferred;
  endX: number;
  endY: number;
  endZ: number;
  id: number;
  isCancelled: boolean;
  modelCube: Cube;
  startX: number;
  startY: number;
  startZ: number;
  voxelsToSkip: number;

  constructor(modelCube, resolution, min, max, id) {
    this.modelCube = modelCube;
    this.id = id;
    this.voxelsToSkip = Math.ceil((max[0] - min[0]) / resolution) || 1;
    this.chunkSize = 10000;

    const round = number => Math.floor(number / this.voxelsToSkip) * this.voxelsToSkip;

    this.startX = round(min[0]);
    this.endX = round(max[0]) + this.voxelsToSkip;
    this.startY = round(min[1]);
    this.endY = round(max[1]) + this.voxelsToSkip;
    this.startZ = round(min[2]);
    this.endZ = round(max[2]) + this.voxelsToSkip;
  }


  getTriangles() {
    const result = {};
    this.deferred = new Deferred();
    this.isCancelled = false;

    _.defer(this.calculateTrianglesAsync, result);
    return this.deferred.promise();
  }


  cancel() {
    this.isCancelled = true;
  }


  calculateTrianglesAsync = (result, lastPosition) => {
    if (this.isCancelled) {
      return;
    }

    let i = 0;
    let position = this.getNextPosition(lastPosition);

    while (this.isPositionInBoundingBox(position)) {
      this.updateTriangles(result, position);

      // If chunk size is reached, pause execution
      if (i === this.chunkSize) {
        _.defer(this.calculateTrianglesAsync, result, position);
        return;
      }
      i++;

      position = this.getNextPosition(position);
    }

    this.deferred.resolve(result);
  }


  isPositionInBoundingBox(position) {
    if (position != null) {
      const [x, y, z] = position;
      return (x >= this.startX && y >= this.startY && z >= this.startZ) &&
        (x <= this.endX && y <= this.endY && z <= this.endZ);
    }
    return false;
  }


  getNextPosition(lastPosition) {
    if (lastPosition == null) {
      return [this.startX, this.startY, this.startZ];
    } else {
      const [oldX, oldY, oldZ] = lastPosition;

      if (oldX + this.voxelsToSkip < this.endX) {
        return [oldX + this.voxelsToSkip, oldY, oldZ];
      }
      if (oldY + this.voxelsToSkip < this.endY) {
        return [this.startX, oldY + this.voxelsToSkip, oldZ];
      } else {
        // For z coordinate, always sample in maximal resolution
        return [this.startX, this.startY, oldZ + 1];
      }
    }
  }


  updateTriangles(result, position) {
    const cubeIndices = this.getCubeIndices(position);

    for (const cellId of Object.keys(cubeIndices)) {
      const cubeIndex = cubeIndices[cellId];
      if (result[cellId] == null) {
        result[cellId] = [];
      }
      if (cubeIndex !== 0 && cubeIndex !== 256) {
        this.addNewTriangles(result[cellId], cubeIndex, position);
      }
    }
  }


  getCubeIndices([x, y, z]) {
    const labels = [
      this.modelCube.getDataValue([x, y, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y, z + this.voxelsToSkip]),
      this.modelCube.getDataValue([x, y, z + this.voxelsToSkip]),
      this.modelCube.getDataValue([x, y + this.voxelsToSkip, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y + this.voxelsToSkip, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y + this.voxelsToSkip, z + this.voxelsToSkip]),
      this.modelCube.getDataValue([x, y + this.voxelsToSkip, z + this.voxelsToSkip])];

    const cellIds = [];
    for (const label of labels) {
      if (!cellIds.includes(label) && label !== 0 && ((this.id == null) || this.id === label)) {
        cellIds.push(label);
      }
    }

    const result = {};
    for (const cellId of cellIds) {
      let cubeIndex = 0;

      for (let i = 0; i <= 7; i++) {
        const bit = cellId === labels[i] ? 1 : 0;
        cubeIndex |= bit << i;
      }

      result[cellId] = cubeIndex;
    }

    return result;
  }


  addNewTriangles(triangleList, cubeIndex, [x, y, z]) {
    for (const triangle of Array.from(tlt[cubeIndex])) {
      const vertices = [];

      for (const vertex of Array.from(triangle)) {
        vertices.push([
          (vertex[0] * this.voxelsToSkip) + x,
          (vertex[1] * this.voxelsToSkip) + y,
          (vertex[2] * this.voxelsToSkip) + z]);
      }

      triangleList.push(vertices);
    }
  }
}

export default PolygonFactory;
