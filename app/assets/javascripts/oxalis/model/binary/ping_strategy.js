/**
 * ping_strategy.js
 * @flow weak
 */

import _ from "lodash";
import Utils from "libs/utils";
import Cube from "oxalis/model/binary/cube";
import Dimensions from "../dimensions";

const MAX_ZOOM_STEP_DIFF = 1;

class PingStrategy {

  cube: Cube;
  velocityRangeStart: number;
  velocityRangeEnd: number;
  roundTripTimeRangeStart: number;
  roundTripTimeRangeEnd: number;
  contentTypes: Array<string>;
  name: string;
  u: number;
  v: number;
  static BaseStrategy: BaseStrategy;
  static Skeleton: Skeleton;
  static Volume: Volume;

  constructor(cube) {
    this.cube = cube;

    this.velocityRangeStart = 0;
    this.velocityRangeEnd = 0;
    this.roundTripTimeRangeStart = 0;
    this.roundTripTimeRangeEnd = 0;
    this.contentTypes = [];
    this.name = "ABSTRACT";
  }


  forContentType(contentType) {
    return _.isEmpty(this.contentTypes) || ~this.contentTypes.indexOf(contentType);
  }


  inVelocityRange(value: number) {
    return this.velocityRangeStart <= value && value <= this.velocityRangeEnd;
  }


  inRoundTripTimeRange(value: number) {
    return this.roundTripTimeRangeStart <= value && value <= this.roundTripTimeRangeEnd;
  }


  ping() {
    throw new Error("Needs to be implemented in subclass");
  }


  getBucketArray(center, width, height) {
    const buckets = [];
    const uOffset = Math.ceil(width / 2);
    const vOffset = Math.ceil(height / 2);

    for (const u of Utils.__range__(-uOffset, uOffset, true)) {
      for (const v of Utils.__range__(-vOffset, vOffset, true)) {
        const bucket = center.slice(0);
        bucket[this.u] += u;
        bucket[this.v] += v;
        buckets.push(_.min(bucket) >= 0 ? bucket : null);
      }
    }

    return buckets;
  }
}


class BaseStrategy extends PingStrategy {

  preloadingSlides: number;
  preloadingPriorityOffset: number;
  w: number;

  constructor(...args) {
    super(...args);
    this.velocityRangeStart = 0;
    this.velocityRangeEnd = Infinity;

    this.roundTripTimeRangeStart = 0;
    this.roundTripTimeRangeEnd = Infinity;

    this.preloadingSlides = 0;
    this.preloadingPriorityOffset = 0;
  }


  ping(position, direction, requestedZoomStep, areas, activePlane) {
    const zoomStep = Math.min(requestedZoomStep, this.cube.MAX_ZOOM_STEP);
    const zoomStepDiff = requestedZoomStep - zoomStep;
    const pullQueue = [];

    if (zoomStepDiff > MAX_ZOOM_STEP_DIFF) { return pullQueue; }

    for (let plane = 0; plane <= 2; plane++) {
      const indices = Dimensions.getIndices(plane);
      this.u = indices[0];
      this.v = indices[1];
      this.w = indices[2];

      // Converting area from voxels to buckets
      const bucketArea = [
        areas[plane][0] >> this.cube.BUCKET_SIZE_P,
        areas[plane][1] >> this.cube.BUCKET_SIZE_P,
        (areas[plane][2] - 1) >> this.cube.BUCKET_SIZE_P,
        (areas[plane][3] - 1) >> this.cube.BUCKET_SIZE_P,
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
}


export class Skeleton extends BaseStrategy {
  constructor(...args) {
    super(...args);
    this.contentTypes = ["skeletonTracing"];

    this.name = "SKELETON";
    this.preloadingSlides = 2;
  }
}


export class Volume extends BaseStrategy {
  constructor(...args) {
    super(...args);
    this.contentTypes = ["volumeTracing"];

    this.name = "VOLUME";
    this.preloadingSlides = 1;
    this.preloadingPriorityOffset = 80;
  }
}

export default PingStrategy;
