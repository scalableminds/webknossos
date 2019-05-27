/**
 * bounding_box.js
 * @flow
 */

import _ from "lodash";

import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Store from "oxalis/store";
import constants, {
  type BoundingBoxType,
  type Vector3,
  Vector3Indicies,
  type Vector4,
} from "oxalis/constants";

class BoundingBox {
  boundingBox: ?BoundingBoxType;
  cube: DataCube;
  min: Vector3;
  max: Vector3;

  constructor(boundingBox: ?BoundingBoxType, cube: DataCube) {
    this.boundingBox = boundingBox;
    this.cube = cube;
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

  getBoxForZoomStep = _.memoize(
    (zoomStep: number): BoundingBoxType => {
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
    },
  );

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
}

export default BoundingBox;
