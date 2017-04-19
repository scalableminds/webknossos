/**
 * polygon_factory.js
 * @flow
 */
/* globals Generator:false */

import Utils from "libs/utils";
import DataCube from "oxalis/model/binary/data_cube";
import tlt from "oxalis/view/polygons/tlt";
import type { Vector3 } from "oxalis/constants";

export type PolygonResultType = {
  [cellId: number]: Vector3[][];
};

// This class is capable of turning voxel data into triangles
// Based on the marching cubes algorithm
class PolygonFactory {
  chunkSize: number = 1000;
  endX: number;
  endY: number;
  endZ: number;
  id: ?number;
  isCancelled: boolean;
  modelCube: DataCube;
  startX: number;
  startY: number;
  startZ: number;
  voxelsToSkip: number;

  constructor(modelCube: DataCube, resolution: number, min: Vector3, max: Vector3, id: ?number) {
    this.modelCube = modelCube;
    this.id = id;
    this.voxelsToSkip = Math.ceil((max[0] - min[0]) / resolution) || 1;

    const round = number => Math.floor(number / this.voxelsToSkip) * this.voxelsToSkip;

    this.startX = round(min[0]);
    this.endX = round(max[0]) + this.voxelsToSkip;
    this.startY = round(min[1]);
    this.endY = round(max[1]) + this.voxelsToSkip;
    this.startZ = round(min[2]);
    this.endZ = round(max[2]) + this.voxelsToSkip;
  }


  getTriangles(): Promise<PolygonResultType | null> {
    this.isCancelled = false;
    return this.calculateTrianglesAsync();
  }


  cancel() {
    this.isCancelled = true;
  }


  async calculateTrianglesAsync(): Promise<PolygonResultType | null> {
    const result: PolygonResultType = {};
    const positionGenerator = this.getPositionGenerator();
    let position = positionGenerator.next();
    let i = 0;
    while (!this.isCancelled && !position.done) {
      this.updateTriangles(result, position.value);
      position = positionGenerator.next();
      i++;
      // If chunk size is reached, pause execution
      if (i % this.chunkSize === 0 && !position.done) {
        await Utils.idleFrame(100);
      }
    }
    if (this.isCancelled) {
      return null;
    }
    return result;
  }


  isPositionInBoundingBox(position: Vector3): boolean {
    if (position != null) {
      const [x, y, z] = position;
      return (x >= this.startX && y >= this.startY && z >= this.startZ) &&
        (x <= this.endX && y <= this.endY && z <= this.endZ);
    }
    return false;
  }

  getPositionGenerator = function* (): Generator<Vector3, void, void> {
    // For z coordinate, always sample in maximal resolution
    for (let z = this.startZ; z < this.endZ; z += 1) {
      for (let y = this.startY; y < this.endY; y += this.voxelsToSkip) {
        for (let x = this.startX; x < this.endX; x += this.voxelsToSkip) {
          yield [x, y, z];
        }
      }
    }
  }

  updateTriangles(result: PolygonResultType, position: Vector3): void {
    const cubeIndices = this.getCubeIndices(position);

    for (const cellIdString of Object.keys(cubeIndices)) {
      const cellId = parseInt(cellIdString, 10);
      const cubeIndex = cubeIndices[cellId];
      if (result[cellId] == null) {
        result[cellId] = [];
      }
      if (cubeIndex !== 0 && cubeIndex !== 256) {
        result[cellId] = result[cellId].concat(this.getCellTriangles(cubeIndex, position));
      }
    }
  }

  getCubeIndices([x, y, z]: Vector3): { [cellId: number]: number } {
    const labels = [
      this.modelCube.getDataValue([x, y, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y, z + this.voxelsToSkip]),
      this.modelCube.getDataValue([x, y, z + this.voxelsToSkip]),
      this.modelCube.getDataValue([x, y + this.voxelsToSkip, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y + this.voxelsToSkip, z]),
      this.modelCube.getDataValue([x + this.voxelsToSkip, y + this.voxelsToSkip, z + this.voxelsToSkip]),
      this.modelCube.getDataValue([x, y + this.voxelsToSkip, z + this.voxelsToSkip]),
    ];
    const cellIds = new Set(labels.filter(label => label !== 0 && ((this.id == null) || this.id === label)));

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


  getCellTriangles(cubeIndex: number, [x, y, z]: Vector3): Vector3[][] {
    const triangleList = [];
    for (const triangle of tlt[cubeIndex]) {
      const vertices = [];

      for (const vertex of triangle) {
        vertices.push([
          (vertex[0] * this.voxelsToSkip) + x,
          (vertex[1] * this.voxelsToSkip) + y,
          (vertex[2] * this.voxelsToSkip) + z,
        ]);
      }

      triangleList.push(vertices);
    }
    return triangleList;
  }
}

export default PolygonFactory;
