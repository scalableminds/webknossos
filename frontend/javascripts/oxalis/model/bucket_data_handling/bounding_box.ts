import _ from "lodash";
import { V3 } from "libs/mjs";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { mod } from "libs/utils";
import Store from "oxalis/store";
import type { BoundingBoxType, Vector3, Vector4 } from "oxalis/constants";
import constants, { Vector3Indicies } from "oxalis/constants";

class BoundingBox {
  boundingBox: BoundingBoxType | null | undefined;
  min: Vector3;
  max: Vector3;

  // If maxRestriction is provided, the passed boundingBox is automatically
  // clipped to maxRestriction
  constructor(boundingBox: BoundingBoxType | null | undefined, maxRestriction?: Vector3) {
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

    return {
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
      min,
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
      max,
    };
  });

  containsBucket([x, y, z, zoomStep]: Vector4): boolean {
    const { min, max } = this.getBoxForZoomStep(zoomStep);
    return min[0] <= x && x < max[0] && min[1] <= y && y < max[1] && min[2] <= z && z < max[2];
  }

  containsPoint(vec3: Vector3) {
    const [x, y, z] = vec3;
    const { min, max } = this;
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
    return new BoundingBox({
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
      min: newMin,
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
      max: newMax,
    });
  }

  getSize(): Vector3 {
    const size = V3.sub(this.max, this.min);
    return size;
  }

  getVolume(): number {
    const size = this.getSize();
    return size[0] * size[1] * size[2];
  }

  chunkIntoBuckets() {
    const size = this.getSize();
    const start = [...this.min];
    const chunkSize: Vector3 = [32, 32, 32];
    const chunkBorderAlignments = [32, 32, 32];
    // Move the start to be aligned correctly. This doesn't actually change
    // the start of the first chunk, because we'll intersect with `self`,
    // but it'll lead to all chunk borders being aligned correctly.
    const startAdjust = [
      mod(start[0], chunkBorderAlignments[0]),
      mod(start[1], chunkBorderAlignments[1]),
      mod(start[2], chunkBorderAlignments[2]),
    ];
    const boxes = [];

    for (const x of _.range(start[0] - startAdjust[0], start[0] + size[0], chunkSize[0])) {
      for (const y of _.range(start[1] - startAdjust[1], start[1] + size[1], chunkSize[1])) {
        for (const z of _.range(start[2] - startAdjust[2], start[2] + size[2], chunkSize[2])) {
          const newMin: Vector3 = [x, y, z];
          boxes.push(
            this.intersectedWith(
              new BoundingBox({
                min: newMin,
                max: V3.add(newMin, chunkSize),
              }),
            ),
          );
        }
      }
    }

    return boxes;
  }

  fromMag1ToMag(mag: Vector3): BoundingBox {
    const min: Vector3 = [
      Math.floor(this.min[0] / mag[0]),
      Math.floor(this.min[1] / mag[1]),
      Math.floor(this.min[2] / mag[2]),
    ];
    const max: Vector3 = [
      Math.ceil(this.max[0] / mag[0]),
      Math.ceil(this.max[1] / mag[1]),
      Math.ceil(this.max[2] / mag[2]),
    ];
    return new BoundingBox({
      min,
      max,
    });
  }

  paddedWithMargins(marginsLeft: Vector3, marginsRight?: Vector3): BoundingBox {
    if (marginsRight == null) {
      marginsRight = marginsLeft;
    }

    return new BoundingBox({
      min: V3.sub(this.min, marginsLeft),
      max: V3.add(this.max, marginsRight),
    });
  }

  rounded(): BoundingBox {
    return new BoundingBox({
      min: V3.floor(this.min),
      max: V3.ceil(this.max),
    });
  }
}

export default BoundingBox;
