import Dimensions from "../dimensions";

class PingStrategy {
  static initClass() {

    // Constants
    this.prototype.TEXTURE_SIZE_P  = 0;
    this.prototype.MAX_ZOOM_STEP_DIFF  = 1;

    this.prototype.velocityRangeStart  = 0;
    this.prototype.velocityRangeEnd  = 0;

    this.prototype.roundTripTimeRangeStart  = 0;
    this.prototype.roundTripTimeRangeEnd  = 0;

    this.prototype.contentTypes  = [];

    this.prototype.cube  = null;

    this.prototype.name  = 'ABSTRACT';
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

    throw "Needs to be implemented in subclass";
    return {
      pullQueue : [ x0, y0, z0, zoomStep0, x1, y1, z1, zoomStep1 ],
      extent : { min_x, min_y, min_z, max_x, max_y, max_z }
    };
  }


  getBucketArray(center, width, height) {

    const buckets = [];
    const uOffset = Math.ceil(width / 2);
    const vOffset = Math.ceil(height / 2);

    for (let u of __range__(-uOffset, uOffset, true)) {
      for (let v of __range__(-vOffset, vOffset, true)) {
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

    this.prototype.velocityRangeStart  = 0;
    this.prototype.velocityRangeEnd  = Infinity;

    this.prototype.roundTripTimeRangeStart  = 0;
    this.prototype.roundTripTimeRangeEnd  = Infinity;

    this.prototype.preloadingSlides  = 0;
    this.prototype.preloadingPriorityOffset  = 0;
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
        areas[plane][0] >> this.cube.BUCKET_SIZE_P,
        areas[plane][1] >> this.cube.BUCKET_SIZE_P,
        (areas[plane][2] - 1) >> this.cube.BUCKET_SIZE_P,
        (areas[plane][3] - 1) >> this.cube.BUCKET_SIZE_P
      ];
      const width = (bucketArea[2] - bucketArea[0]) << zoomStepDiff;
      const height = (bucketArea[3] - bucketArea[1]) << zoomStepDiff;

      const centerBucket = this.cube.positionToZoomedAddress(position, zoomStep);
      const buckets = this.getBucketArray(centerBucket, width, height);

      for (let bucket of buckets) {
        if (bucket != null) {
          const priority = Math.abs(bucket[0] - centerBucket[0]) + Math.abs(bucket[1] - centerBucket[1]) + Math.abs(bucket[2] - centerBucket[2]);
          pullQueue.push({bucket: [bucket[0], bucket[1], bucket[2], zoomStep], priority});
          if (plane === activePlane) {
            // preload only for active plane
            for (let slide of __range__(0, this.preloadingSlides, false)) {
              if (direction[this.w] >= 0) { bucket[this.w]++; } else { bucket[this.w]--; }
              const preloadingPriority = (priority << (slide + 1)) + this.preloadingPriorityOffset;
              pullQueue.push({bucket: [bucket[0], bucket[1], bucket[2], zoomStep], priority: preloadingPriority});
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

    this.prototype.contentTypes  = ["skeletonTracing"];

    this.prototype.name  = 'SKELETON';
    this.prototype.preloadingSlides  = 2;
  }
};
PingStrategy.Skeleton.initClass();


PingStrategy.Volume = class Volume extends PingStrategy.BaseStrategy {
  static initClass() {

    this.prototype.contentTypes  = ["volumeTracing"];

    this.prototype.name  = 'VOLUME';
    this.prototype.preloadingSlides  = 1;
    this.prototype.preloadingPriorityOffset  = 80;
  }
};
PingStrategy.Volume.initClass();


export default PingStrategy;

function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
