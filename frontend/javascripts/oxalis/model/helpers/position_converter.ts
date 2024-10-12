import type { Vector3, Vector4, BucketAddress } from "oxalis/constants";
import constants from "oxalis/constants";
import type { AdditionalCoordinate } from "types/api_flow_types";
import type { MagInfo } from "./mag_info";

export function globalPositionToBucketPosition(
  [x, y, z]: Vector3,
  mags: Array<Vector3>,
  magIndex: number,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
): BucketAddress {
  const resolution = magIndex < mags.length ? mags[magIndex] : upsampleMag(mags, magIndex);
  return [
    Math.floor(x / (constants.BUCKET_WIDTH * resolution[0])),
    Math.floor(y / (constants.BUCKET_WIDTH * resolution[1])),
    Math.floor(z / (constants.BUCKET_WIDTH * resolution[2])),
    magIndex,
    additionalCoordinates || [],
  ];
}
export function scaleGlobalPositionWithMagnification(
  [x, y, z]: Vector3,
  mag: Vector3,
  ceil: boolean = false,
): Vector3 {
  const round = ceil ? Math.ceil : Math.floor;
  return [round(x / mag[0]), round(y / mag[1]), round(z / mag[2])];
}
export function zoomedPositionToGlobalPosition(
  [x, y, z]: Vector3,
  currentResolution: Vector3,
): Vector3 {
  return [x * currentResolution[0], y * currentResolution[1], z * currentResolution[2]];
}
export function scaleGlobalPositionWithMagnificationFloat(
  [x, y, z]: Vector3,
  mag: Vector3,
): Vector3 {
  return [x / mag[0], y / mag[1], z / mag[2]];
}
export function globalPositionToBucketPositionFloat(
  [x, y, z]: Vector3,
  mags: Array<Vector3>,
  magIndex: number,
): Vector4 {
  const resolution = magIndex < mags.length ? mags[magIndex] : upsampleMag(mags, magIndex);
  return [
    x / (constants.BUCKET_WIDTH * resolution[0]),
    y / (constants.BUCKET_WIDTH * resolution[1]),
    z / (constants.BUCKET_WIDTH * resolution[2]),
    magIndex,
  ];
}
export function upsampleMag(resolutions: Array<Vector3>, resolutionIndex: number): Vector3 {
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
  bucketPosition: BucketAddress,
  resolutionInfo: MagInfo,
): Vector3 {
  const [x, y, z, resolutionIndex, _additionalCoordinates] = bucketPosition;
  const resolution = resolutionInfo.getMagByIndexOrThrow(resolutionIndex);
  return [
    x * constants.BUCKET_WIDTH * resolution[0],
    y * constants.BUCKET_WIDTH * resolution[1],
    z * constants.BUCKET_WIDTH * resolution[2],
  ];
}
export function getMagFactors(magA: Vector3, magB: Vector3): Vector3 {
  return [magA[0] / magB[0], magA[1] / magB[1], magA[2] / magB[2]];
}
export function zoomedPositionToZoomedAddress(
  [x, y, z]: Vector3,
  magIndex: number,
  additionalCoordinates: AdditionalCoordinate[] | null,
): BucketAddress {
  return [
    Math.floor(x / constants.BUCKET_WIDTH),
    Math.floor(y / constants.BUCKET_WIDTH),
    Math.floor(z / constants.BUCKET_WIDTH),
    magIndex,
    additionalCoordinates || [],
  ];
}
export function zoomedAddressToZoomedPosition([x, y, z, _]: BucketAddress): Vector3 {
  return [x * constants.BUCKET_WIDTH, y * constants.BUCKET_WIDTH, z * constants.BUCKET_WIDTH];
}
// TODO: zoomedAddressToAnotherZoomStep usages should be converted to zoomedAddressToAnotherZoomStepWithInfo
// Note that this is not trivial since zoomedAddressToAnotherZoomStepWithInfo will throw on not existing
// mag indices (in contrast to zoomedAddressToAnotherZoomStep).
// See: https://github.com/scalableminds/webknossos/issues/4838
export function zoomedAddressToAnotherZoomStep(
  [x, y, z, magIndex]: Vector4,
  mags: Array<Vector3>,
  targetMagIndex: number,
): Vector4 {
  const currentResolution = mags[magIndex];
  const targetResolution = mags[targetMagIndex];
  const factors = getMagFactors(currentResolution, targetResolution);
  return [
    Math.floor(x * factors[0]),
    Math.floor(y * factors[1]),
    Math.floor(z * factors[2]),
    targetMagIndex,
  ];
}

/*
  Please note that this function will fail if the passed magIndex or
  targetMagIndex don't exist in the magInfo.
 */
export function zoomedAddressToAnotherZoomStepWithInfo(
  [x, y, z, magIndex]: Vector4,
  magInfo: MagInfo,
  targetMagIndex: number,
): Vector4 {
  const currentResolution = magInfo.getMagByIndexWithFallback(magIndex, null);
  const targetResolution = magInfo.getMagByIndexWithFallback(targetMagIndex, null);
  const factors = getMagFactors(currentResolution, targetResolution);
  return [
    Math.floor(x * factors[0]),
    Math.floor(y * factors[1]),
    Math.floor(z * factors[2]),
    targetMagIndex,
  ];
}
export function getBucketExtent(mag: Vector3): Vector3 {
  return [
    constants.BUCKET_WIDTH * mag[0],
    constants.BUCKET_WIDTH * mag[1],
    constants.BUCKET_WIDTH * mag[2],
  ];
}
// This function returns all bucket addresses for which the fallback bucket
// is the provided bucket.
export function getBaseBucketsForFallbackBucket(
  fallbackBucketAddress: Vector4,
  zoomStepDifference: number,
  mags: Array<Vector3>,
): Array<Vector4> {
  const fallbackBucketZoomStep = fallbackBucketAddress[3];
  const betterZoomStep = fallbackBucketZoomStep - zoomStepDifference;
  const betterBucketAddress = zoomedAddressToAnotherZoomStep(
    fallbackBucketAddress,
    mags,
    betterZoomStep,
  );
  // resolutionFactors is a [x, y, z] tuple with x, y, z being 1 or 2 each (because
  // zoomStepDifference === 1). In the case of isotropic resolutions, it's simply [2, 2, 2]
  const resolutionFactors = getMagFactors(mags[fallbackBucketZoomStep], mags[betterZoomStep]);
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

  // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[][]' is not assignable to type 'Vecto... Remove this comment to see the full error message
  return bucketAddresses;
}
