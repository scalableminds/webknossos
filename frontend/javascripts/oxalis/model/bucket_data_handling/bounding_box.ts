import { V3 } from "libs/mjs";
import { map3, mod } from "libs/utils";
import _ from "lodash";
import type { BoundingBoxType, OrthoView, Vector2, Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import type { BoundingBoxObject } from "oxalis/store";
import Dimensions from "../dimensions";

class BoundingBox {
  // Min is including, max is excluding
  min: Vector3;
  max: Vector3;

  constructor(boundingBox: BoundingBoxType | null | undefined) {
    if (boundingBox == null) {
      this.min = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
      this.max = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    } else {
      this.min = boundingBox.min.slice() as Vector3;
      this.max = boundingBox.max.slice() as Vector3;
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

  static fromBucketAddress(address: Vector4, mag: Vector3): BoundingBox {
    return new BoundingBox(this.fromBucketAddressFast(address, mag));
  }

  static fromBucketAddressFast(
    [x, y, z, _zoomStep]: Vector4,
    mag: Vector3,
  ): { min: Vector3; max: Vector3 } {
    /*
     The fast variant does not allocate a Bounding Box instance which can be helpful for tight loops.
     */
    const bucketSize = constants.BUCKET_WIDTH;

    // Precompute scaled sizes once
    const sx = bucketSize * mag[0];
    const sy = bucketSize * mag[1];
    const sz = bucketSize * mag[2];

    // Bucket bounds in world space
    const bxMin = x * sx;
    const byMin = y * sy;
    const bzMin = z * sz;
    const bxMax = bxMin + sx;
    const byMax = byMin + sy;
    const bzMax = bzMin + sz;

    return { min: [bxMin, byMin, bzMin], max: [bxMax, byMax, bzMax] };
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
    return new BoundingBox(this.intersectedWithFast(other));
  }

  intersectedWithFast(other: { min: Vector3; max: Vector3 }): { min: Vector3; max: Vector3 } {
    /*
     The fast variant does not allocate a Bounding Box instance which can be helpful for tight loops.
     */
    const newMin = V3.max(this.min, other.min);
    const uncheckedMax = V3.min(this.max, other.max);

    // Ensure the bounding box does not get a negative
    // extent.
    const newMax = V3.max(newMin, uncheckedMax);

    return {
      min: newMin,
      max: newMax,
    };
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

  alignFromMag1ToMag(mag: Vector3, strategy: "shrink" | "grow" | "ceil" | "floor"): BoundingBox {
    return this.alignWithMag(mag, strategy).fromMag1ToMag(mag);
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
