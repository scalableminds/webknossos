/**
 * ping_strategy.js
 * @flow
 */

import _ from "lodash";
import DataCube from "oxalis/model/binary/data_cube";
import Dimensions from "oxalis/model/dimensions";
import { BUCKET_SIZE_P } from "oxalis/model/binary/bucket";
import type { PullQueueItemType } from "oxalis/model/binary/pullqueue";
import { OrthoViewValuesWithoutTDView } from "oxalis/constants";
import type { Vector3, Vector4, OrthoViewType, OrthoViewMapType } from "oxalis/constants";

const MAX_ZOOM_STEP_DIFF = 1;

export class AbstractPingStrategy {
  cube: DataCube;
  velocityRangeStart: number = 0;
  velocityRangeEnd: number = 0;
  roundTripTimeRangeStart: number = 0;
  roundTripTimeRangeEnd: number = 0;
  contentTypes: Array<string> = [];
  name: string = "ABSTRACT";
  u: number;
  v: number;

  constructor(cube: DataCube) {
    this.cube = cube;
  }

  forContentType(contentType: string): boolean {
    return _.isEmpty(this.contentTypes) || this.contentTypes.includes(contentType);
  }

  inVelocityRange(value: number): boolean {
    return this.velocityRangeStart <= value && value <= this.velocityRangeEnd;
  }

  inRoundTripTimeRange(value: number): boolean {
    return this.roundTripTimeRangeStart <= value && value <= this.roundTripTimeRangeEnd;
  }

  getBucketArray(center: Vector3, width: number, height: number) {
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


export class PingStrategy extends AbstractPingStrategy {

  velocityRangeStart = 0;
  velocityRangeEnd = Infinity;
  roundTripTimeRangeStart = 0;
  roundTripTimeRangeEnd = Infinity;
  preloadingSlides = 0;
  preloadingPriorityOffset = 0;
  w: number;

  ping(position: Vector3, direction: Vector3, requestedZoomStep: number,
    areas: OrthoViewMapType<Vector4>, activePlane: OrthoViewType): Array<PullQueueItemType> {
    const zoomStep = Math.min(requestedZoomStep, this.cube.MAX_ZOOM_STEP);
    const zoomStepDiff = requestedZoomStep - zoomStep;
    const pullQueue = [];

    if (zoomStepDiff > MAX_ZOOM_STEP_DIFF) { return pullQueue; }

    for (const plane of OrthoViewValuesWithoutTDView) {
      const indices = Dimensions.getIndices(plane);
      this.u = indices[0];
      this.v = indices[1];
      this.w = indices[2];

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
            for (let slide = 0; slide < this.preloadingSlides; slide++) {
              if (direction[this.w] >= 0) {
                bucket[this.w]++;
              } else {
                bucket[this.w]--;
              }
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

export class SkeletonPingStrategy extends PingStrategy {
  contentTypes = ["skeletonTracing"];
  name = "SKELETON";
  preloadingSlides = 2;
}

export class VolumePingStrategy extends PingStrategy {
  contentTypes = ["volumeTracing"];
  name = "VOLUME";
  preloadingSlides = 1;
  preloadingPriorityOffset = 80;
}
