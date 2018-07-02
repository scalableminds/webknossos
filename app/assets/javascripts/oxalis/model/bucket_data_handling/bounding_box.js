/**
 * bounding_box.js
 * @flow
 */

import _ from "lodash";
import constants, { Vector3Indicies } from "oxalis/constants";
import type { Vector3, Vector4, BoundingBoxType } from "oxalis/constants";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type { Bucket } from "oxalis/model/bucket_data_handling/bucket";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import Store from "oxalis/store";

class BoundingBox {
  boundingBox: ?BoundingBoxType;
  cube: DataCube;
  BYTE_OFFSET: number;
  min: Vector3;
  max: Vector3;

  constructor(boundingBox: ?BoundingBoxType, cube: DataCube) {
    this.boundingBox = boundingBox;
    this.cube = cube;
    this.BYTE_OFFSET = this.cube.BYTE_OFFSET;
    // Min is including
    this.min = [0, 0, 0];
    // Max is excluding
    this.max = _.clone(this.cube.upperBoundary);

    if (boundingBox != null) {
      for (const i of Vector3Indicies) {
        this.min[i] = Math.max(this.min[i], boundingBox.min[i]);
        this.max[i] = Math.min(this.max[i], boundingBox.max[i]);
      }
    }
  }

  getBoxForZoomStep = _.memoize((zoomStep: number): BoundingBoxType => {
    const resolution = getResolutions(Store.getState().dataset)[zoomStep];
    // No `map` for performance reasons
    const min = [0, 0, 0];
    const max = [0, 0, 0];

    for (let i = 0; i < 3; i++) {
      const divisor = constants.BUCKET_WIDTH * resolution[i];
      min[i] = Math.floor(this.min[i] / divisor);
      max[i] = Math.ceil(this.max[i] / divisor);
    }

    return { min, max };
  });

  containsBucket([x, y, z, zoomStep]: Vector4): boolean {
    const { min, max } = this.getBoxForZoomStep(zoomStep);
    return min[0] <= x && x < max[0] && min[1] <= y && y < max[1] && min[2] <= z && z < max[2];
  }

  containsFullBucket([x, y, z, zoomStep]: Vector4): boolean {
    const { min, max } = this.getBoxForZoomStep(zoomStep);

    return (
      min[0] < x && x < max[0] - 1 && min[1] < y && y < max[1] - 1 && min[2] < z && z < max[2] - 1
    );
  }

  removeOutsideArea(bucket: Bucket, bucketAddress: Vector4, bucketData: Uint8Array): void {
    if (this.containsFullBucket(bucketAddress)) {
      return;
    }
    if (bucket.type === "data") {
      bucket.isPartlyOutsideBoundingBox = true;
    }

    const zoomStep = bucketAddress[3];
    const resolution = getResolutions(Store.getState().dataset)[zoomStep];

    const baseVoxel = bucketAddress
      .slice(0, 3)
      .map((e, idx) => e * resolution[idx] * constants.BUCKET_WIDTH);

    for (let dx = 0; dx < constants.BUCKET_WIDTH; dx++) {
      for (let dy = 0; dy < constants.BUCKET_WIDTH; dy++) {
        for (let dz = 0; dz < constants.BUCKET_WIDTH; dz++) {
          const x = baseVoxel[0] + dx * resolution[0];
          const y = baseVoxel[1] + dy * resolution[1];
          const z = baseVoxel[2] + dz * resolution[2];

          if (
            this.min[0] <= x &&
            x < this.max[0] &&
            this.min[1] <= y &&
            y < this.max[1] &&
            this.min[2] <= z &&
            z < this.max[2]
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
