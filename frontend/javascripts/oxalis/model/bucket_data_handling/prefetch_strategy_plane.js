// @flow

import _ from "lodash";

import type { Area } from "oxalis/model/accessors/flycam_accessor";
import type { PullQueueItem } from "oxalis/model/bucket_data_handling/pullqueue";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Dimensions, { type DimensionIndices } from "oxalis/model/dimensions";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  type Vector3,
} from "oxalis/constants";
import { getPriorityWeightForPrefetch } from "oxalis/model/bucket_data_handling/loading_strategy_logic";

const { MAX_ZOOM_STEP_DIFF_PREFETCH } = constants;

export class AbstractPrefetchStrategy {
  velocityRangeStart: number = 0;
  velocityRangeEnd: number = 0;
  roundTripTimeRangeStart: number = 0;
  roundTripTimeRangeEnd: number = 0;
  contentTypes: Array<string> = [];
  name: string = "ABSTRACT";
  u: DimensionIndices;
  v: DimensionIndices;

  forContentType(givenContentTypes: {
    skeleton: boolean,
    volume: boolean,
    readOnly: boolean,
  }): boolean {
    if (this.contentTypes.length === 0) {
      return true;
    }
    return this.contentTypes.some(contentType => givenContentTypes[contentType]);
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
          buckets.push(bucket);
        }
      }
    }
    // $FlowIssue[invalid-tuple-arity] flow does not understand that slicing a Vector3 returns another Vector3
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
  w: DimensionIndices;

  prefetch(
    cube: DataCube,
    position: Vector3,
    direction: Vector3,
    currentZoomStep: number,
    activePlane: OrthoView,
    areas: OrthoViewMap<Area>,
    resolutions: Vector3[],
  ): Array<PullQueueItem> {
    const zoomStep = Math.min(currentZoomStep, cube.MAX_ZOOM_STEP);
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
    const fallbackZoomStep = Math.min(cube.MAX_ZOOM_STEP, currentZoomStep + 1);
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
    activePlane: OrthoView,
    areas: OrthoViewMap<Area>,
    resolutions: Vector3[],
    isFallback: boolean,
  ): Array<PullQueueItem> {
    const pullQueue = [];

    if (zoomStepDiff > MAX_ZOOM_STEP_DIFF_PREFETCH) {
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
      const prefetchWeight = getPriorityWeightForPrefetch();

      for (const bucket of bucketPositions) {
        const priority =
          Math.abs(bucket[0] - centerBucket3[0]) +
          Math.abs(bucket[1] - centerBucket3[1]) +
          Math.abs(bucket[2] - centerBucket3[2]) +
          prefetchWeight +
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
  contentTypes = ["skeleton", "readOnly"];
  name = "SKELETON";
  preloadingSlides = 2;
}

export class PrefetchStrategyVolume extends PrefetchStrategy {
  contentTypes = ["volume"];
  name = "VOLUME";
  preloadingSlides = 1;
  preloadingPriorityOffset = 80;
}
