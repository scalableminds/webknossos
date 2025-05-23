import { V3 } from "libs/mjs";
import _ from "lodash";
import * as THREE from "three";
import type { AdditionalCoordinate } from "types/api_types";
import type { OrthoView, OrthoViewMap, Vector3, Vector4 } from "viewer/constants";
import constants, { OrthoViewValuesWithoutTDView } from "viewer/constants";
import type { Area } from "viewer/model/accessors/flycam_accessor";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { getPriorityWeightForPrefetch } from "viewer/model/bucket_data_handling/loading_strategy_logic";
import type { PullQueueItem } from "viewer/model/bucket_data_handling/pullqueue";
import Dimensions from "viewer/model/dimensions";
import { zoomedAddressToAnotherZoomStep } from "viewer/model/helpers/position_converter";
import type { MagInfo } from "../helpers/mag_info";

const { MAX_ZOOM_STEP_DIFF_PREFETCH } = constants;

export enum ContentTypes {
  SKELETON = "SKELETON",
  VOLUME = "VOLUME",
  READ_ONLY = "READ_ONLY",
}

type Vector3PositionPropertyName = "x" | "y" | "z";
const positionToVectorPropName: Record<number, Vector3PositionPropertyName> = {
  0: "x",
  1: "y",
  2: "z",
};

export class AbstractPrefetchStrategy {
  velocityRangeStart: number = 0;
  velocityRangeEnd: number = 0;
  roundTripTimeRangeStart: number = 0;
  roundTripTimeRangeEnd: number = 0;
  contentTypes: Array<ContentTypes> = [];
  name: string = "ABSTRACT";
  u: Vector3PositionPropertyName = "x";
  v: Vector3PositionPropertyName = "y";
  w: Vector3PositionPropertyName = "z";
  posVector: THREE.Vector3 = new THREE.Vector3();
  rotationMatrix: THREE.Matrix4 = new THREE.Matrix4();

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
        // First rotated the bucket in local plane space.
        this.posVector[this.u] = u;
        this.posVector[this.v] = v;
        this.posVector[this.w] = 0;
        this.posVector.applyMatrix4(this.rotationMatrix);
        // Then apply current flycam position offset to the bucket.
        const bucket = [
          Math.round(this.posVector.x + center[0]),
          Math.round(this.posVector.y + center[1]),
          Math.round(this.posVector.z + center[2]),
        ];

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

  prefetch(
    cube: DataCube,
    position: Vector3,
    rotation: Vector3,
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
      rotation,
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
        rotation,
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
    rotation: Vector3,
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

    this.rotationMatrix.makeRotationFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2]),
    );

    const centerBucket = cube.positionToZoomedAddress(position, additionalCoordinates, zoomStep);
    const centerBucket3: Vector3 = [centerBucket[0], centerBucket[1], centerBucket[2]];
    const fallbackPriorityWeight = isFallback ? 50 : 0;

    for (const plane of OrthoViewValuesWithoutTDView) {
      if (!areas[plane].isVisible) continue;
      const [u, v, w] = Dimensions.getIndices(plane);
      this.u = positionToVectorPropName[u];
      this.v = positionToVectorPropName[v];
      this.w = positionToVectorPropName[w];
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
      }

      // preload only for active plane
      if (plane === activePlane) {
        const getNewCenter = (offset: number): Vector3 => {
          const centerOffset = Dimensions.transDim([0, 0, offset], plane);
          const centerOffsetVector = new THREE.Vector3(...centerOffset);
          const rotatedCenterOffset = centerOffsetVector.applyMatrix4(this.rotationMatrix);
          return [
            Math.round(centerBucket3[0] + rotatedCenterOffset.x),
            Math.round(centerBucket3[1] + rotatedCenterOffset.y),
            Math.round(centerBucket3[2] + rotatedCenterOffset.z),
          ];
        };
        const directionFactor = direction[Dimensions.thirdDimensionForPlane(plane)] >= 0 ? 1 : -1;
        for (let slide = 0; slide < this.preloadingSlides; slide++) {
          let centerWithOffset = getNewCenter(slide * directionFactor);
          if (V3.equals(centerBucket3, centerWithOffset)) {
            centerWithOffset = getNewCenter((slide + 1) * directionFactor);
          }
          const sliceOffsettedBucketPositions = this.getBucketPositions(
            centerWithOffset,
            width,
            height,
          );
          for (const bucket of sliceOffsettedBucketPositions) {
            const priority =
              Math.abs(bucket[0] - centerBucket3[0]) +
              Math.abs(bucket[1] - centerBucket3[1]) +
              Math.abs(bucket[2] - centerBucket3[2]) +
              prefetchWeight +
              fallbackPriorityWeight;

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
