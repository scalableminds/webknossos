import _ from "lodash";
import Utils from "libs/utils";
import Dimensions from "../dimensions";
import { BUCKET_SIZE_P } from "./bucket";

class PingStrategy {
  static initClass() {
    // Constants
    this.prototype.TEXTURE_SIZE_P = 0;
    this.prototype.MAX_ZOOM_STEP_DIFF = 1;

    this.prototype.velocityRangeStart = 0;
    this.prototype.velocityRangeEnd = 0;

    this.prototype.roundTripTimeRangeStart = 0;
    this.prototype.roundTripTimeRangeEnd = 0;

    this.prototype.contentTypes = [];

    this.prototype.cube = null;

    this.prototype.name = "ABSTRACT";
  }


  constructor(cube, TEXTURE_SIZE_P) {
    this.cube = cube;
    this.TEXTURE_SIZE_P = TEXTURE_SIZE_P;
  }


  forContentType(contentType) {
    return _.isEmpty(this.contentTypes) || ~this.contentTypes.indexOf(contentType);
  }


  inVelocityRange(value) {
    return this.velocityRangeStart <= value && value <= this.velocityRangeEnd;
  }


  inRoundTripTimeRange(value) {
    return this.roundTripTimeRangeStart <= value && value <= this.roundTripTimeRangeEnd;
  }


  ping() {
    throw new Error("Needs to be implemented in subclass");
  }


  getBucketArray(center, width, height) {
    const buckets = [];
    const uOffset = Math.ceil(width / 2);
    const vOffset = Math.ceil(height / 2);

    for (let u = -uOffset; u <= uOffset; u++) {
      for (let v = -vOffset; v <= vOffset; v++) {
        const bucket = center.slice(0);
        bucket[this.u] += u;
        bucket[this.v] += v;
        buckets.push(_.min(bucket) >= 0 ? bucket : null);
      }
    }

    return buckets;
  }
}
PingStrategy.initClass();


PingStrategy.BaseStrategy = class BaseStrategy extends PingStrategy {
  static initClass() {
    this.prototype.velocityRangeStart = 0;
    this.prototype.velocityRangeEnd = Infinity;

    this.prototype.roundTripTimeRangeStart = 0;
    this.prototype.roundTripTimeRangeEnd = Infinity;

    this.prototype.preloadingSlides = 0;
    this.prototype.preloadingPriorityOffset = 0;
  }


  ping(position, direction, requestedZoomStep, areas, activePlane) {
    const zoomStep = Math.min(requestedZoomStep, this.cube.MAX_ZOOM_STEP);
    const zoomStepDiff = requestedZoomStep - zoomStep;
    const pullQueue = [];

    if (zoomStepDiff > this.MAX_ZOOM_STEP_DIFF) { return pullQueue; }

    for (let plane = 0; plane <= 2; plane++) {
      [this.u, this.v, this.w] = Dimensions.getIndices(plane);

      // Converting area from voxels to buckets
      const bucketArea = [
        areas[plane][0] >> BUCKET_SIZE_P,
        areas[plane][1] >> BUCKET_SIZE_P,
        (areas[plane][2] - 1) >> BUCKET_SIZE_P,
        (areas[plane][3] - 1) >> BUCKET_SIZE_P,
      ];
      const width = (bucketArea[2] - bucketArea[0]) << zoomStepDiff;
      const height = (bucketArea[3] - bucketArea[1]) << zoomStepDiff;

      const centerBucket = this.cube.positionToZoomedAddress(position, zoomStep);
      const buckets = this.getBucketArray(centerBucket, width, height);

      for (const bucket of buckets) {
        if (bucket != null) {
          const priority = Math.abs(bucket[0] - centerBucket[0]) + Math.abs(bucket[1] - centerBucket[1]) + Math.abs(bucket[2] - centerBucket[2]);
          pullQueue.push({ bucket: [bucket[0], bucket[1], bucket[2], zoomStep], priority });
          if (plane === activePlane) {
            // preload only for active plane
            for (const slide of Utils.__range__(0, this.preloadingSlides, false)) {
              if (direction[this.w] >= 0) { bucket[this.w]++; } else { bucket[this.w]--; }
              const preloadingPriority = (priority << (slide + 1)) + this.preloadingPriorityOffset;
              pullQueue.push({ bucket: [bucket[0], bucket[1], bucket[2], zoomStep], priority: preloadingPriority });
            }
          }
        }
      }
    }

    return pullQueue;
  }
};
PingStrategy.BaseStrategy.initClass();


PingStrategy.Skeleton = class Skeleton extends PingStrategy.BaseStrategy {
  static initClass() {
    this.prototype.contentTypes = ["skeletonTracing"];

    this.prototype.name = "SKELETON";
    this.prototype.preloadingSlides = 2;
  }
};
PingStrategy.Skeleton.initClass();


PingStrategy.Volume = class Volume extends PingStrategy.BaseStrategy {
  static initClass() {
    this.prototype.contentTypes = ["volumeTracing"];

    this.prototype.name = "VOLUME";
    this.prototype.preloadingSlides = 1;
    this.prototype.preloadingPriorityOffset = 80;
  }
};
PingStrategy.Volume.initClass();


export default PingStrategy;
