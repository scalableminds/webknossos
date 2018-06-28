// @flow

import _ from "lodash";
import Dimensions from "oxalis/model/dimensions";
import { OrthoViewValuesWithoutTDView } from "oxalis/constants";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import type { PullQueueItemType } from "oxalis/model/bucket_data_handling/pullqueue";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type { Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { AreaType } from "oxalis/model/accessors/flycam_accessor";

const MAX_ZOOM_STEP_DIFF = 1;

export class AbstractPrefetchStrategy {
  velocityRangeStart: number = 0;
  velocityRangeEnd: number = 0;
  roundTripTimeRangeStart: number = 0;
  roundTripTimeRangeEnd: number = 0;
  contentTypes: Array<string> = [];
  name: string = "ABSTRACT";
  u: number;
  v: number;

  forContentType(contentType: string): boolean {
    return _.isEmpty(this.contentTypes) || this.contentTypes.includes(contentType);
  }

  inVelocityRange(value: number): boolean {
    return this.velocityRangeStart <= value && value <= this.velocityRangeEnd;
  }

  inRoundTripTimeRange(value: number): boolean {
    return this.roundTripTimeRangeStart <= value && value <= this.roundTripTimeRangeEnd;
  }

  getBucketPositions(center: Vector3, width: number, height: number): Array<Vector3> {
    const buckets = [];
    const uOffset = Math.ceil(width / 2);
    const vOffset = Math.ceil(height / 2);

    for (let u = -uOffset; u <= uOffset; u++) {
      for (let v = -vOffset; v <= vOffset; v++) {
        const bucket = center.slice();
        bucket[this.u] += u;
        bucket[this.v] += v;
        if (_.min(bucket) >= 0) {
          // $FlowFixMe Flow does not understand that bucket will always be of length 3
          buckets.push(bucket);
        }
      }
    }
    // $FlowFixMe flow does not understand that slicing a Vector3 returns another Vector3
    return buckets;
  }
}

export class PrefetchStrategy extends AbstractPrefetchStrategy {
  velocityRangeStart = 0;
  velocityRangeEnd = Infinity;
  roundTripTimeRangeStart = 0;
  roundTripTimeRangeEnd = Infinity;
  preloadingSlides = 0;
  preloadingPriorityOffset = 0;
  w: number;

  prefetch(
    cube: DataCube,
    position: Vector3,
    direction: Vector3,
    currentZoomStep: number,
    activePlane: OrthoViewType,
    areas: OrthoViewMapType<AreaType>,
    resolutions: Vector3[],
  ): Array<PullQueueItemType> {
    const zoomStep = Math.min(currentZoomStep, cube.MAX_UNSAMPLED_ZOOM_STEP);
    const zoomStepDiff = currentZoomStep - zoomStep;

    const queueItemsForCurrentZoomStep = this.prefetchImpl(
      cube,
      position,
      direction,
      zoomStep,
      zoomStepDiff,
      activePlane,
      areas,
      resolutions,
      false,
    );

    let queueItemsForFallbackZoomStep = [];
    const fallbackZoomStep = Math.min(cube.MAX_UNSAMPLED_ZOOM_STEP, currentZoomStep + 1);
    if (fallbackZoomStep > zoomStep) {
      queueItemsForFallbackZoomStep = this.prefetchImpl(
        cube,
        position,
        direction,
        fallbackZoomStep,
        zoomStepDiff - 1,
        activePlane,
        areas,
        resolutions,
        true,
      );
    }

    return queueItemsForCurrentZoomStep.concat(queueItemsForFallbackZoomStep);
  }

  prefetchImpl(
    cube: DataCube,
    position: Vector3,
    direction: Vector3,
    zoomStep: number,
    zoomStepDiff: number,
    activePlane: OrthoViewType,
    areas: OrthoViewMapType<AreaType>,
    resolutions: Vector3[],
    isFallback: boolean,
  ): Array<PullQueueItemType> {
    const pullQueue = [];

    if (zoomStepDiff > MAX_ZOOM_STEP_DIFF) {
      return pullQueue;
    }

    const centerBucket = cube.positionToZoomedAddress(position, zoomStep);
    const centerBucket3 = [centerBucket[0], centerBucket[1], centerBucket[2]];

    const fallbackPriorityWeight = isFallback ? 50 : 0;

    for (const plane of OrthoViewValuesWithoutTDView) {
      const [u, v, w] = Dimensions.getIndices(plane);
      this.u = u;
      this.v = v;
      this.w = w;

      // areas holds bucket indices for zoomStep = 0, which we want to
      // convert to the desired zoomStep
      const widthHeightVector = [0, 0, 0, 0];
      widthHeightVector[u] = areas[plane].right - areas[plane].left;
      widthHeightVector[v] = areas[plane].bottom - areas[plane].top;

      const scaledWidthHeightVector = zoomedAddressToAnotherZoomStep(
        widthHeightVector,
        resolutions,
        zoomStep,
      );

      const width = scaledWidthHeightVector[u];
      const height = scaledWidthHeightVector[v];

      const bucketPositions = this.getBucketPositions(centerBucket3, width, height);

      for (const bucket of bucketPositions) {
        const priority =
          Math.abs(bucket[0] - centerBucket3[0]) +
          Math.abs(bucket[1] - centerBucket3[1]) +
          Math.abs(bucket[2] - centerBucket3[2]) +
          fallbackPriorityWeight;
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
            pullQueue.push({
              bucket: [bucket[0], bucket[1], bucket[2], zoomStep],
              priority: preloadingPriority,
            });
          }
        }
      }
    }
    return pullQueue;
  }
}

export class PrefetchStrategySkeleton extends PrefetchStrategy {
  contentTypes = ["skeleton", "readonly"];
  name = "SKELETON";
  preloadingSlides = 2;
}

export class PrefetchStrategyVolume extends PrefetchStrategy {
  contentTypes = ["volume"];
  name = "VOLUME";
  preloadingSlides = 1;
  preloadingPriorityOffset = 80;
}
