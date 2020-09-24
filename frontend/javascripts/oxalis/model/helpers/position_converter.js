// @flow

import constants, { type Vector3, type Vector4 } from "oxalis/constants";
import { ResolutionInfo } from "oxalis/model/accessors/dataset_accessor";

export function globalPositionToBaseBucket(pos: Vector3): Vector4 {
  return globalPositionToBucketPosition(pos, [[1, 1, 1]], 0);
}

export function globalPositionToBucketPosition(
  [x, y, z]: Vector3,
  resolutions: Array<Vector3>,
  resolutionIndex: number,
): Vector4 {
  const resolution =
    resolutionIndex < resolutions.length
      ? resolutions[resolutionIndex]
      : upsampleResolution(resolutions, resolutionIndex);

  return [
    Math.floor(x / (constants.BUCKET_WIDTH * resolution[0])),
    Math.floor(y / (constants.BUCKET_WIDTH * resolution[1])),
    Math.floor(z / (constants.BUCKET_WIDTH * resolution[2])),
    resolutionIndex,
  ];
}

export function globalPositionToBucketPositionFloat(
  [x, y, z]: Vector3,
  resolutions: Array<Vector3>,
  resolutionIndex: number,
): Vector4 {
  const resolution =
    resolutionIndex < resolutions.length
      ? resolutions[resolutionIndex]
      : upsampleResolution(resolutions, resolutionIndex);

  return [
    x / (constants.BUCKET_WIDTH * resolution[0]),
    y / (constants.BUCKET_WIDTH * resolution[1]),
    z / (constants.BUCKET_WIDTH * resolution[2]),
    resolutionIndex,
  ];
}

export function upsampleResolution(resolutions: Array<Vector3>, resolutionIndex: number): Vector3 {
  const lastResolutionIndex = resolutions.length - 1;
  const lastResolution = resolutions[lastResolutionIndex];
  const multiplier = Math.pow(2, resolutionIndex - lastResolutionIndex);

  return [
    lastResolution[0] * multiplier,
    lastResolution[1] * multiplier,
    lastResolution[2] * multiplier,
  ];
}

export function bucketPositionToGlobalAddress(
  [x, y, z, resolutionIndex]: Vector4,
  resolutions: Array<Vector3>,
): Vector3 {
  const resolution = resolutions[resolutionIndex];
  return [
    x * constants.BUCKET_WIDTH * resolution[0],
    y * constants.BUCKET_WIDTH * resolution[1],
    z * constants.BUCKET_WIDTH * resolution[2],
  ];
}

export function getResolutionsFactors(resolutionA: Vector3, resolutionB: Vector3): Vector3 {
  return [
    resolutionA[0] / resolutionB[0],
    resolutionA[1] / resolutionB[1],
    resolutionA[2] / resolutionB[2],
  ];
}

// TODO (1): zoomedAddressToAnotherZoomStep usages should be converted to zoomedAddressToAnotherZoomStepWithInfo
export function zoomedAddressToAnotherZoomStep(
  [x, y, z, resolutionIndex]: Vector4,
  resolutions: Array<Vector3>,
  targetResolutionIndex: number,
): Vector4 {
  const currentResolution = resolutions[resolutionIndex];
  const targetResolution = resolutions[targetResolutionIndex];
  const factors = getResolutionsFactors(currentResolution, targetResolution);

  return [
    Math.floor(x * factors[0]),
    Math.floor(y * factors[1]),
    Math.floor(z * factors[2]),
    targetResolutionIndex,
  ];
}

export function zoomedAddressToAnotherZoomStepWithInfo(
  [x, y, z, resolutionIndex]: Vector4,
  resolutionInfo: ResolutionInfo,
  targetResolutionIndex: number,
): Vector4 {
  const currentResolution = resolutionInfo.getResolutionByIndexWithFallback(resolutionIndex);
  const targetResolution = resolutionInfo.getResolutionByIndexWithFallback(targetResolutionIndex);
  const factors = getResolutionsFactors(currentResolution, targetResolution);

  return [
    Math.floor(x * factors[0]),
    Math.floor(y * factors[1]),
    Math.floor(z * factors[2]),
    targetResolutionIndex,
  ];
}

export function getBucketExtent(resolutions: Vector3[], resolutionIndex: number): Vector3 {
  return bucketPositionToGlobalAddress([1, 1, 1, resolutionIndex], resolutions);
}

// This function returns all bucket addresses for which the fallback bucket
// is the provided bucket.
export function getBaseBucketsForFallbackBucket(
  fallbackBucketAddress: Vector4,
  zoomStepDifference: number,
  resolutions: Array<Vector3>,
): Array<Vector4> {
  const fallbackBucketZoomStep = fallbackBucketAddress[3];
  const betterZoomStep = fallbackBucketZoomStep - zoomStepDifference;
  const betterBucketAddress = zoomedAddressToAnotherZoomStep(
    fallbackBucketAddress,
    resolutions,
    betterZoomStep,
  );
  if (zoomStepDifference > 1) {
    // Due to the exponential complexity of calculating the "better bucket addresses",
    // we currently only support this function if zoomStepDifference === 1
    return [betterBucketAddress];
  }

  // resolutionFactors is a [x, y, z] tuple with x, y, z being 1 or 2 each (because
  // zoomStepDifference === 1). In the case of isotropic resolutions, it's simply [2, 2, 2]
  const resolutionFactors = getResolutionsFactors(
    resolutions[fallbackBucketZoomStep],
    resolutions[betterZoomStep],
  );

  const bucketAddresses = [];

  const [baseX, baseY, baseZ] = betterBucketAddress;
  for (let _x = 0; _x < resolutionFactors[0]; _x++) {
    for (let _y = 0; _y < resolutionFactors[1]; _y++) {
      for (let _z = 0; _z < resolutionFactors[2]; _z++) {
        const newAddress = [baseX + _x, baseY + _y, baseZ + _z, betterZoomStep];
        bucketAddresses.push(newAddress);
      }
    }
  }

  return bucketAddresses;
}
