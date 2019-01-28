// @flow
import PriorityQueue from "js-priority-queue";

import type { APIDataset } from "admin/api_flow_types";
import { type Area } from "oxalis/model/accessors/flycam_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { map2, map3 } from "libs/utils";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  type OrthoView,
  type OrthoViewExtents,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  OrthoViewValues,
  type Vector2,
  type Vector3,
  type Vector4,
  addressSpaceDimensions,
} from "oxalis/constants";

import { extraBucketPerEdge, extraBucketsPerDim } from "./orthogonal_bucket_picker_constants";

/*
  This bucket picker defines the functions calculateBucketCountPerDim and calculateTotalBucketCountForZoomLevel
  which describe how many buckets are necessary to render data given a specific zoom factor and a specific magnification
  index (resolution index).
  Using these functions, the flycam accessors can determine when to use which magnification (depending on current
  zoom level).
  The rest of wk typically doesn't need to use these functions.
*/

/*
  This function returns the amount of buckets (per dimension) which are necessary
  to render data in the provided magnification **with a specific zoom factor**.
  For example, the function would calculate how many buckets are necessary per dimension,
  if we want to render data with a zoom value of 3.5 in mag2.
  The function itself is not aware of fallback vs. non-fallback data rendering (however, the function
  can be used to calculate bucketCounts for fallback and non-fallback scenarios).

  Instead of this function, try to use getMaxBucketCountPerDim where possible, as that function
  will pick the appropriate zoomFactor automatically.
*/
function calculate2DBucketCount(
  dataSetScale: Vector3,
  resolution: Vector3,
  zoomFactor: number,
  viewportExtents: OrthoViewExtents,
  viewportID: OrthoView,
): Vector2 {
  const addExtraBuckets = vec => map2(el => el + extraBucketsPerDim, vec);

  const baseVoxelFactors = getBaseVoxelFactors(dataSetScale);
  const [u, v] = Dimensions.getIndices(viewportID);
  const [width, height] = viewportExtents[viewportID];
  const necessaryVoxelsPerDimUV = [width * baseVoxelFactors[u], height * baseVoxelFactors[v]];

  // As an example, even if the viewport width corresponds to exactly
  // 16 buckets, a slight offset can mean that we need one additional bucket,
  // from which we render only a small fraction. That's why 1 is added.
  // Math.ceil is important since a raw viewport width ~ 15.8 bucket should also
  // result in 17 buckets.
  const voxelsToBuckets = (v, dim) =>
    1 + Math.ceil((zoomFactor * v) / (resolution[dim] * constants.BUCKET_WIDTH));

  const bucketCountPerDim = [
    voxelsToBuckets(necessaryVoxelsPerDimUV[0], u),
    voxelsToBuckets(necessaryVoxelsPerDimUV[1], v),
  ];

  return addExtraBuckets(bucketCountPerDim);
}

function calculateBucketCountPerViewportEdge(
  dataSetScale: Vector3,
  resolution: Vector3,
  zoomFactor: number,
  viewportExtents: OrthoViewExtents,
): OrthoViewExtents {
  // Curry the arguments
  const _calculate2DBucketCount = viewport =>
    calculate2DBucketCount(dataSetScale, resolution, zoomFactor, viewportExtents, viewport);

  return {
    PLANE_XY: _calculate2DBucketCount("PLANE_XY"),
    PLANE_YZ: _calculate2DBucketCount("PLANE_YZ"),
    PLANE_XZ: _calculate2DBucketCount("PLANE_XZ"),
    TDView: [0, 0],
  };
}

/*
  This function calculates how many buckets this bucket picker would need when rendering data in
  a specific magnification with a specific zoom factor.
  The returned value serves as an upper bound and influences which magnification is selected
  for a given zoom step.
*/
export const calculateTotalBucketCountForZoomLevel = (
  dataSetScale: Vector3,
  resolutionIndex: number,
  resolutions: Array<Vector3>,
  zoomFactor: number,
  viewportExtents: OrthoViewExtents,
) => {
  const calculateBucketCountForOrtho = (countsPerViewport: OrthoViewExtents) => {
    const calculateArea = (planeId: OrthoView): number => {
      const [x, y] = countsPerViewport[planeId];
      return x * y;
    };
    const calculateOverlap = (dim: number, planeIdA: OrthoView, planeIdB: OrthoView): number => {
      const [dimA, dimB] = [
        Dimensions.getIndices(planeIdA)[dim],
        Dimensions.getIndices(planeIdB)[dim],
      ];
      // $FlowFixMe dimA and dimB will always be 0 or 1
      const a = countsPerViewport[planeIdA][dimA];
      // $FlowFixMe dimA and dimB will always be 0 or 1
      const b = countsPerViewport[planeIdB][dimB];
      return Math.min(a, b);
    };

    // When adding the area for xz, the extent for x (dim = 0) is counted twice. Subtract the
    // surplus.
    // Similarly, adding the area
    const surplusX = calculateOverlap(0, "PLANE_XY", "PLANE_XZ");
    const surplusY = calculateOverlap(1, "PLANE_XY", "PLANE_YZ");
    const surplusZ = calculateOverlap(2, "PLANE_XZ", "PLANE_YZ");

    const xy = calculateArea("PLANE_XY");
    const xz = calculateArea("PLANE_XZ") - surplusX;
    const yz = calculateArea("PLANE_YZ") - (surplusY + surplusZ - 1);
    return xy + xz + yz;
  };
  const bucketCountPerViewportEdge = calculateBucketCountPerViewportEdge(
    dataSetScale,
    resolutions[resolutionIndex],
    zoomFactor,
    viewportExtents,
  );

  const fallbackBucketCountPerViewportEdge =
    resolutionIndex + 1 < resolutions.length
      ? calculateBucketCountPerViewportEdge(
          dataSetScale,
          resolutions[resolutionIndex + 1],
          zoomFactor,
          viewportExtents,
        )
      : {
          PLANE_XY: [0, 0],
          PLANE_YZ: [0, 0],
          PLANE_XZ: [0, 0],
          TDView: [0, 0],
        };

  const calculateAdditionalWSliceCount = ([x, y, z]) => {
    const xy = x * y - (x + y - 1);
    const xz = x * z - (2 * x + z - 2);
    const yz = y * z - (2 * y + 2 * z - 4);
    return xy + xz + yz;
  };

  const maxDims = [0, 0, 0];
  for (const planeID of OrthoViewValuesWithoutTDView) {
    const [u, v] = Dimensions.getIndices(planeID);
    const [width, height] = bucketCountPerViewportEdge[planeID];
    maxDims[u] = Math.max(width, maxDims[u]);
    maxDims[v] = Math.max(height, maxDims[v]);
  }

  if (
    maxDims[0] > addressSpaceDimensions.normal[0] ||
    maxDims[1] > addressSpaceDimensions.normal[1] ||
    maxDims[2] > addressSpaceDimensions.normal[2]
  ) {
    // Too large for address space. Avoid this zoom configuration by returning
    // a very high bucket capacity.
    return 100000;
  }

  // For non-fallback buckets, we load two slices per plane (see usage of subBucketLocality)
  const normalBucketCount = 1.9 * calculateBucketCountForOrtho(bucketCountPerViewportEdge);
  // + calculateAdditionalWSliceCount(bucketCountPerViewportEdge);
  const fallbackBucketCount = calculateBucketCountForOrtho(fallbackBucketCountPerViewportEdge);

  return normalBucketCount + fallbackBucketCount;
};

export const getAnchorPositionToCenterDistance = (bucketPerDim: number) =>
  // Example I:
  // - bucketPerDim is 17 (because the actual plane is 16 buckets wide and we need one extra bucket to render a "half bucket" on each side)
  // --> the bucket distance between anchorPoint and center bucket is 8
  // Example II:
  // - bucketPerDim is 16 (because the actual plane is 15 buckets wide...)
  // --> the bucket distance between anchorPoint and center bucket is 8
  Math.ceil((bucketPerDim - 1) / 2);

export default function determineBucketsForOrthogonal(
  dataset: APIDataset,
  cube: DataCube,
  bucketQueue: PriorityQueue,
  logZoomStep: number,
  fallbackZoomStep: number,
  isFallbackAvailable: boolean,
  anchorPoint: Vector4,
  fallbackAnchorPoint: Vector4,
  areas: OrthoViewMap<Area>,
  subBucketLocality: Vector3,
) {
  addNecessaryBucketsToPriorityQueueOrthogonal(
    dataset,
    cube,
    bucketQueue,
    logZoomStep,
    anchorPoint,
    false,
    areas,
    subBucketLocality,
  );

  if (isFallbackAvailable) {
    addNecessaryBucketsToPriorityQueueOrthogonal(
      dataset,
      cube,
      bucketQueue,
      logZoomStep + 1,
      fallbackAnchorPoint,
      true,
      areas,
      subBucketLocality,
    );
  }
}

function addNecessaryBucketsToPriorityQueueOrthogonal(
  dataset: APIDataset,
  cube: DataCube,
  bucketQueue: PriorityQueue,
  logZoomStep: number,
  zoomedAnchorPoint: Vector4,
  isFallback: boolean,
  areas: OrthoViewMap<Area>,
  subBucketLocality: Vector3,
): void {
  const resolutions = getResolutions(dataset);
  const datasetScale = dataset.dataSource.scale;

  for (const planeId of OrthoViewValuesWithoutTDView) {
    const [u, v, w] = Dimensions.getIndices(planeId);

    const topLeftVector = [0, 0, 0, 0];
    topLeftVector[v] = areas[planeId].top;
    topLeftVector[u] = areas[planeId].left;

    const bottomRightVector = [0, 0, 0, 0];
    bottomRightVector[v] = areas[planeId].bottom;
    bottomRightVector[u] = areas[planeId].right;

    const scaledTopLeftVector = zoomedAddressToAnotherZoomStep(
      topLeftVector,
      resolutions,
      logZoomStep,
    );
    const scaledBottomRightVector = zoomedAddressToAnotherZoomStep(
      bottomRightVector,
      resolutions,
      logZoomStep,
    );

    const bucketsPerDim = isFallback
      ? addressSpaceDimensions.fallback
      : addressSpaceDimensions.normal;

    const renderedBucketsPerDimension = bucketsPerDim[w];

    const topLeftBucket = zoomedAnchorPoint.slice();
    topLeftBucket[w] += getAnchorPositionToCenterDistance(renderedBucketsPerDimension);

    const centerBucketUV = [
      scaledTopLeftVector[u] + (scaledBottomRightVector[u] - scaledTopLeftVector[u]) / 2,
      scaledTopLeftVector[v] + (scaledBottomRightVector[v] - scaledTopLeftVector[v]) / 2,
    ];

    // Always use buckets in the current w slice, but also load either the previous or the next
    // slice (depending on locality within the current bucket).
    // Similar to `extraBucketPerEdge`, the PQ takes care of cases in which the additional slice
    // can't be loaded.
    const wSliceOffsets = isFallback ? [0] : [0, subBucketLocality[w]];
    // fallback buckets should have lower priority
    const additionalPriorityWeight = isFallback ? 1000 : 0;

    // Build up priority queue
    wSliceOffsets.forEach(wSliceOffset => {
      const extraYBucketStart = scaledTopLeftVector[v] - extraBucketPerEdge;
      const extraYBucketEnd = scaledBottomRightVector[v] + extraBucketPerEdge;
      const extraXBucketStart = scaledTopLeftVector[u] - extraBucketPerEdge;
      const extraXBucketEnd = scaledBottomRightVector[u] + extraBucketPerEdge;

      for (let y = extraYBucketStart; y <= extraYBucketEnd; y++) {
        for (let x = extraXBucketStart; x <= extraXBucketEnd; x++) {
          const bucketAddress = ((topLeftBucket.slice(): any): Vector4);
          bucketAddress[u] = x;
          bucketAddress[v] = y;
          bucketAddress[w] += wSliceOffset;

          const bucket = cube.getOrCreateBucket(bucketAddress);
          const isExtraBucket =
            y === extraYBucketStart ||
            y === extraYBucketEnd ||
            x === extraXBucketStart ||
            x === extraXBucketEnd;

          if (bucket.type !== "null") {
            const priority =
              Math.abs(x - centerBucketUV[0]) +
              Math.abs(y - centerBucketUV[1]) +
              Math.abs(100 * wSliceOffset) +
              additionalPriorityWeight +
              (isExtraBucket ? 100 : 0);
            bucketQueue.queue({
              priority,
              bucket,
            });
          }
        }
      }
    });
  }
}
