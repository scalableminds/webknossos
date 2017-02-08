/**
 * bounding_box.js
 * @flow weak
 */

import _ from "lodash";
import DataCube from "oxalis/model/binary/data_cube";
import type { BoundingBoxType } from "oxalis/model";
import type { Vector3, Vector4 } from "oxalis/constants";
import { BUCKET_SIZE_P } from "oxalis/model/binary/bucket";

class BoundingBox {
  boundingBox: BoundingBoxType;
  cube: DataCube;
  BYTE_OFFSET: number;
  min: Vector3;
  max: Vector3;

  constructor(boundingBox: BoundingBoxType, cube: DataCube) {
    this.boundingBox = boundingBox;
    this.cube = cube;
    this.BYTE_OFFSET = this.cube.BYTE_OFFSET;
    // Min is including
    this.min = [0, 0, 0];
    // Max is excluding
    this.max = this.cube.upperBoundary.slice();

    if (this.boundingBox != null) {
      for (let i = 0; i <= 2; i++) {
        this.min[i] = Math.max(this.min[i], this.boundingBox.min[i]);
        this.max[i] = Math.min(this.max[i], this.boundingBox.max[i]);
      }
    }
  }


  getBoxForZoomStep(zoomStep: number): BoundingBoxType {
    return {
      min: _.map(this.min, e => e >> (BUCKET_SIZE_P + zoomStep)),
      max: _.map(this.max, (e) => {
        const shift = BUCKET_SIZE_P + zoomStep;
        let res = e >> shift;

        // Computing ceil(e / 2^shift)
        const remainder = e & ((1 << shift) - 1);
        if (remainder !== 0) {
          res += 1;
        }

        return res;
      }),
    };
  }


  containsBucket([x, y, z, zoomStep]: Vector4): boolean {
    const { min, max } = this.getBoxForZoomStep(zoomStep);

    return (
      min[0] <= x && x < max[0] &&
      min[1] <= y && y < max[1] &&
      min[2] <= z && z < max[2]
    );
  }


  containsFullBucket([x, y, z, zoomStep]: Vector4): boolean {
    const { min, max } = this.getBoxForZoomStep(zoomStep);

    return (
      min[0] < x && x < max[0] - 1 &&
      min[1] < y && y < max[1] - 1 &&
      min[2] < z && z < max[2] - 1
    );
  }


  removeOutsideArea(bucket: Vector4, bucketData: Uint8Array): void {
    if (this.containsFullBucket(bucket)) { return; }

    const baseVoxel = bucket.slice(0, 3)
      .map(e => e << (BUCKET_SIZE_P + bucket[3]));

    for (let dx = 0; dx < (1 << BUCKET_SIZE_P); dx++) {
      for (let dy = 0; dy < (1 << BUCKET_SIZE_P); dy++) {
        for (let dz = 0; dz < (1 << BUCKET_SIZE_P); dz++) {
          const x = baseVoxel[0] + (dx << bucket[3]);
          const y = baseVoxel[1] + (dy << bucket[3]);
          const z = baseVoxel[2] + (dz << bucket[3]);

          if (
            this.min[0] <= x && x < this.max[0] &&
            this.min[1] <= y && y < this.max[1] &&
            this.min[2] <= z && z < this.max[2]
          ) {
            continue;
          }

          const index = this.cube.getVoxelIndexByVoxelOffset([dx, dy, dz]);
          for (let b = 0; b < this.BYTE_OFFSET; b++) {
            bucketData[index + b] = 0;
          }
        }
      }
    }
  }
}

export default BoundingBox;
