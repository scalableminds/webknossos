import _ from "lodash";
import type { Area } from "oxalis/model/accessors/flycam_accessor";
import type { PullQueueItem } from "oxalis/model/bucket_data_handling/pullqueue";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type { DimensionIndices } from "oxalis/model/dimensions";
import Dimensions from "oxalis/model/dimensions";
import type { OrthoView, OrthoViewMap, Vector3, Vector4 } from "oxalis/constants";
import constants, { OrthoViewValuesWithoutTDView } from "oxalis/constants";
import { getPriorityWeightForPrefetch } from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import type { MagInfo } from "../helpers/mag_info";
import type { AdditionalCoordinate } from "types/api_flow_types";

const { MAX_ZOOM_STEP_DIFF_PREFETCH } = constants;

export enum ContentTypes {
  SKELETON = "SKELETON",
  VOLUME = "VOLUME",
  READ_ONLY = "READ_ONLY",
}

export class AbstractPrefetchStrategy {
  velocityRangeStart: number = 0;
  velocityRangeEnd: number = 0;
  roundTripTimeRangeStart: number = 0;
  roundTripTimeRangeEnd: number = 0;
  contentTypes: Array<ContentTypes> = [];
  name: string = "ABSTRACT";
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'u' has no initializer and is not definite... Remove this comment to see the full error message
  u: DimensionIndices;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'v' has no initializer and is not definite... Remove this comment to see the full error message
  v: DimensionIndices;

  forContentType(givenContentTypes: Record<ContentTypes, boolean>): boolean {
    if (this.contentTypes.length === 0) {
      return true;
    }

    return this.contentTypes.some((contentType) => givenContentTypes[contentType]);
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

        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        if (_.min(bucket) >= 0) {
          buckets.push(bucket);
        }
      }
    }

    // Typescript does not understand that slicing a Vector3 returns another Vector3
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[][]' is not assignable to type 'Vecto... Remove this comment to see the full error message
    return buckets;
  }
}
export class PrefetchStrategy extends AbstractPrefetchStrategy {
  velocityRangeStart = 0;
  velocityRangeEnd = Number.POSITIVE_INFINITY;
  roundTripTimeRangeStart = 0;
  roundTripTimeRangeEnd = Number.POSITIVE_INFINITY;
  preloadingSlides = 0;
  preloadingPriorityOffset = 0;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'w' has no initializer and is not definite... Remove this comment to see the full error message
  w: DimensionIndices;

  prefetch(
    cube: DataCube,
    position: Vector3,
    direction: Vector3,
    currentZoomStep: number,
    activePlane: OrthoView,
    areas: OrthoViewMap<Area>,
    mags: Vector3[],
    magInfo: MagInfo,
    additionalCoordinates: AdditionalCoordinate[] | null,
  ): Array<PullQueueItem> {
    const zoomStep = magInfo.getIndexOrClosestHigherIndex(currentZoomStep);

    if (zoomStep == null) {
      // The layer cannot be rendered at this zoom step, as necessary magnifications
      // are missing. Don't prefetch anything.
      return [];
    }

    const maxZoomStep = magInfo.getCoarsestMagIndex();
    const zoomStepDiff = currentZoomStep - zoomStep;
    const queueItemsForCurrentZoomStep = this.prefetchImpl(
      cube,
      position,
      direction,
      zoomStep,
      zoomStepDiff,
      activePlane,
      areas,
      mags,
      false,
      additionalCoordinates,
    );
    let queueItemsForFallbackZoomStep: Array<PullQueueItem> = [];
    const fallbackZoomStep = Math.min(maxZoomStep, currentZoomStep + 1);

    if (fallbackZoomStep > zoomStep) {
      queueItemsForFallbackZoomStep = this.prefetchImpl(
        cube,
        position,
        direction,
        fallbackZoomStep,
        zoomStepDiff - 1,
        activePlane,
        areas,
        mags,
        true,
        additionalCoordinates,
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
    mags: Vector3[],
    isFallback: boolean,
    additionalCoordinates: AdditionalCoordinate[] | null,
  ): Array<PullQueueItem> {
    const pullQueue: Array<PullQueueItem> = [];

    if (zoomStepDiff > MAX_ZOOM_STEP_DIFF_PREFETCH) {
      return pullQueue;
    }

    const centerBucket = cube.positionToZoomedAddress(position, additionalCoordinates, zoomStep);
    const centerBucket3: Vector3 = [centerBucket[0], centerBucket[1], centerBucket[2]];
    const fallbackPriorityWeight = isFallback ? 50 : 0;

    for (const plane of OrthoViewValuesWithoutTDView) {
      if (!areas[plane].isVisible) continue;
      const [u, v, w] = Dimensions.getIndices(plane);
      this.u = u;
      this.v = v;
      this.w = w;
      // areas holds bucket indices for zoomStep = 0, which we want to
      // convert to the desired zoomStep
      const widthHeightVector: Vector4 = [0, 0, 0, 0];
      widthHeightVector[u] = areas[plane].right - areas[plane].left;
      widthHeightVector[v] = areas[plane].bottom - areas[plane].top;
      const scaledWidthHeightVector = zoomedAddressToAnotherZoomStep(
        widthHeightVector,
        mags,
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

        pullQueue.push({
          bucket: [bucket[0], bucket[1], bucket[2], zoomStep, additionalCoordinates ?? []],
          priority,
        });

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
              bucket: [bucket[0], bucket[1], bucket[2], zoomStep, additionalCoordinates ?? []],
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
  contentTypes = [ContentTypes.SKELETON, ContentTypes.READ_ONLY];
  name = "SKELETON";
  preloadingSlides = 2;
}
export class PrefetchStrategyVolume extends PrefetchStrategy {
  contentTypes = [ContentTypes.VOLUME];
  name = "VOLUME";
  preloadingSlides = 1;
  preloadingPriorityOffset = 80;
}
