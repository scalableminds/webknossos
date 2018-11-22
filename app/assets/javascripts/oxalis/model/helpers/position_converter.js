// @flow

import constants, { type Vector3, type Vector4 } from "oxalis/constants";

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

export function getBucketExtent(resolutions: Vector3[], resolutionIndex: number): Vector3 {
  return bucketPositionToGlobalAddress([1, 1, 1, resolutionIndex], resolutions);
}
