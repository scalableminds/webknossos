/**
 * bounding_box.js
 * @flow
 */

import _ from "lodash";

import { V3 } from "libs/mjs";
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
  min: Vector3;
  max: Vector3;

  // If maxRestriction is provided, the passed boundingBox is automatically
  // clipped to maxRestriction
  constructor(boundingBox: ?BoundingBoxType, maxRestriction?: Vector3) {
    this.boundingBox = boundingBox;
    // Min is including
    this.min = [0, 0, 0];
    // Max is excluding
    this.max = maxRestriction != null ? _.clone(maxRestriction) : [Infinity, Infinity, Infinity];

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

  intersectedWith(other: BoundingBox): BoundingBox {
    const newMin = [
      Math.max(this.min[0], other.min[0]),
      Math.max(this.min[1], other.min[1]),
      Math.max(this.min[2], other.min[2]),
    ];
    const newMax = [
      Math.min(this.max[0], other.max[0]),
      Math.min(this.max[1], other.max[1]),
      Math.min(this.max[2], other.max[2]),
    ];

    return new BoundingBox({ min: newMin, max: newMax });
  }

  chunkIntoBuckets() {
    const size = V3.sub(this.max, this.min);
    const start = [...this.min];
    const chunk_size = [32, 32, 32];
    const chunk_border_alignments = [32, 32, 32];

    // Move the start to be aligned correctly. This doesn't actually change
    // the start of the first chunk, because we'll intersect with `self`,
    // but it'll lead to all chunk borders being aligned correctly.
    const start_adjust = [
      start[0] % chunk_border_alignments[0],
      start[1] % chunk_border_alignments[1],
      start[2] % chunk_border_alignments[2],
    ];

    const boxes = [];

    for (const x of _.range(start[0] - start_adjust[0], start[0] + size[0], chunk_size[0])) {
      for (const y of _.range(start[1] - start_adjust[1], start[1] + size[1], chunk_size[1])) {
        for (const z of _.range(start[2] - start_adjust[2], start[2] + size[2], chunk_size[2])) {
          const newMin = [x, y, z];
          boxes.push(
            this.intersectedWith(
              new BoundingBox({
                min: newMin,
                max: V3.add(newMin, chunk_size),
              }),
            ),
          );
        }
      }
    }

    return boxes;
  }
}

export default BoundingBox;
