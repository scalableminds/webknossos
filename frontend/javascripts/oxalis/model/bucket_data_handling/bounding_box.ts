import { V3 } from "libs/mjs";
import { map3, mod } from "libs/utils";
import _ from "lodash";
import type { BoundingBoxType, OrthoView, Vector2, Vector3, Vector4 } from "oxalis/constants";
import constants, { Vector3Indicies } from "oxalis/constants";
import type { BoundingBoxObject } from "oxalis/store";
import Dimensions from "../dimensions";
import type { MagInfo } from "../helpers/mag_info";

class BoundingBox {
  min: Vector3;
  max: Vector3;

  constructor(boundingBox: BoundingBoxType | null | undefined) {
    // Min is including
    this.min = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    // Max is excluding
    this.max = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];

    if (boundingBox != null) {
      for (const i of Vector3Indicies) {
        this.min[i] = Math.max(this.min[i], boundingBox.min[i]);
        this.max[i] = Math.min(this.max[i], boundingBox.max[i]);
      }
    }
  }

  static fromBoundBoxObject(boundingBox: BoundingBoxObject): BoundingBox {
    return new BoundingBox({
      min: boundingBox.topLeft,
      max: V3.add(boundingBox.topLeft, [boundingBox.width, boundingBox.height, boundingBox.depth]),
    });
  }

  getMinUV(activeViewport: OrthoView): Vector2 {
    const [u, v, _w] = Dimensions.transDim(this.min, activeViewport);
    return [u, v];
  }

  getMaxUV(activeViewport: OrthoView): Vector2 {
    const [u, v, _w] = Dimensions.transDim(this.max, activeViewport);
    return [u, v];
  }

  getBoxForZoomStep = _.memoize((mag: Vector3): BoundingBoxType => {
    // No `map` for performance reasons
    const min = [0, 0, 0] as Vector3;
    const max = [0, 0, 0] as Vector3;

    for (let i = 0; i < 3; i++) {
      const divisor = constants.BUCKET_WIDTH * mag[i];
      min[i] = Math.floor(this.min[i] / divisor);
      max[i] = Math.ceil(this.max[i] / divisor);
    }

    return {
      min,
      max,
    };
  });

  containsBucket([x, y, z, zoomStep]: Vector4, magInfo: MagInfo): boolean {
    /* Checks whether a bucket is contained in the active bounding box.
     * If the passed magInfo does not contain the passed zoomStep, this method
     * returns false.
     */
    const magIndex = magInfo.getMagByIndex(zoomStep);
    if (magIndex == null) {
      return false;
    }
    const { min, max } = this.getBoxForZoomStep(magIndex);
    return min[0] <= x && x < max[0] && min[1] <= y && y < max[1] && min[2] <= z && z < max[2];
  }

  containsPoint(vec3: Vector3) {
    const [x, y, z] = vec3;
    const { min, max } = this;
    return min[0] <= x && x < max[0] && min[1] <= y && y < max[1] && min[2] <= z && z < max[2];
  }

  containsBoundingBox(other: BoundingBox) {
    return other.equals(this.intersectedWith(other));
  }

  equals(other: BoundingBox) {
    return V3.equals(this.min, other.min) && V3.equals(this.max, other.max);
  }

  intersectedWith(other: BoundingBox): BoundingBox {
    const newMin = V3.max(this.min, other.min);
    const uncheckedMax = V3.min(this.max, other.max);

    // Ensure the bounding box does not get a negative
    // extent.
    const newMax = V3.max(newMin, uncheckedMax);

    return new BoundingBox({
      min: newMin,
      max: newMax,
    });
  }

  extend(other: BoundingBox): BoundingBox {
    const newMin = V3.min(this.min, other.min);
    const newMax = V3.max(this.max, other.max);
    return new BoundingBox({
      min: newMin,
      max: newMax,
    });
  }

  getCenter(): Vector3 {
    return V3.floor(V3.add(this.min, V3.scale(this.getSize(), 0.5)));
  }

  getSize(): Vector3 {
    const size = V3.sub(this.max, this.min);
    return size;
  }

  getVolume(): number {
    const size = this.getSize();
    return size[0] * size[1] * size[2];
  }

  *chunkIntoBuckets(): Generator<BoundingBox, void, void> {
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

    for (const x of _.range(start[0] - startAdjust[0], start[0] + size[0], chunkSize[0])) {
      for (const y of _.range(start[1] - startAdjust[1], start[1] + size[1], chunkSize[1])) {
        for (const z of _.range(start[2] - startAdjust[2], start[2] + size[2], chunkSize[2])) {
          const newMin: Vector3 = [x, y, z];
          yield this.intersectedWith(
            new BoundingBox({
              min: newMin,
              max: V3.add(newMin, chunkSize),
            }),
          );
        }
      }
    }
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

  fromMagToMag1(mag: Vector3): BoundingBox {
    const min: Vector3 = [
      Math.floor(this.min[0] * mag[0]),
      Math.floor(this.min[1] * mag[1]),
      Math.floor(this.min[2] * mag[2]),
    ];
    const max: Vector3 = [
      Math.ceil(this.max[0] * mag[0]),
      Math.ceil(this.max[1] * mag[1]),
      Math.ceil(this.max[2] * mag[2]),
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

  alignWithMag(mag: Vector3, strategy: "shrink" | "grow" | "ceil" | "floor"): BoundingBox {
    /*
     * Rounds the bounding box, so that both min and max are divisible by mag.
     * The strategy parameter controls how the coordinates are rounded:
     * - shrink: ceils `min` and floors `max`
     * - grow: floors `min` and ceils `max`
     * - ceil: ceils `min` and `max`
     * - floor: floors `min` and `max`
     */
    const align = (point: Vector3, round_fn: (vec: Vector3) => Vector3) =>
      V3.scale3(round_fn(V3.divide3(point, mag)), mag);

    const min = align(this.min, strategy === "ceil" || strategy === "shrink" ? V3.ceil : V3.floor);
    const max = align(this.max, strategy === "floor" || strategy === "shrink" ? V3.floor : V3.ceil);
    return new BoundingBox({ min, max });
  }

  /*
   * Each component of margins is used as
   *   - a left margin IF the value is negative (the absolute value will be
   *     used then).
   *   - a right margin IF the value is positive
   * For example:
   *   The expression
   *     boundingBox.paddedWithSignedMargins([10, 0, -20])
   *   will rightpad in X with 10 and leftpad in Z with 20.
   */
  paddedWithSignedMargins(margins: Vector3): BoundingBox {
    const marginsLeft = map3((el) => (el < 0 ? -el : 0), margins);
    const marginsRight = map3((el) => (el > 0 ? el : 0), margins);

    return this.paddedWithMargins(marginsLeft, marginsRight);
  }

  rounded(): BoundingBox {
    return new BoundingBox({
      min: V3.floor(this.min),
      max: V3.ceil(this.max),
    });
  }

  asServerBoundingBox() {
    const size = this.getSize();
    return { topLeft: this.min, width: size[0], height: size[1], depth: size[2] };
  }

  toBoundingBoxType(): BoundingBoxType {
    return {
      min: this.min,
      max: this.max,
    };
  }

  offset(offset: Vector3): BoundingBox {
    return new BoundingBox({
      min: V3.add(this.min, offset),
      max: V3.add(this.max, offset),
    });
  }
}

export default BoundingBox;
