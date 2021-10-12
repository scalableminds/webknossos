// @flow

import _ from "lodash";
import constants, { type Vector3, type Vector4, type LabeledVoxelsMap } from "oxalis/constants";
import { map3 } from "libs/utils";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import { type Bucket } from "oxalis/model/bucket_data_handling/bucket";
import Store from "oxalis/store";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import {
  addBucketAddressesToSegmentAction,
  removeBucketAddressesFromSegmentsAction,
  setSomePositionOfSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import messages from "messages";
import type { DimensionMap } from "oxalis/model/dimensions";

function upsampleVoxelMap(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceResolution: Vector3,
  sourceZoomStep: number,
  targetResolution: Vector3,
  targetZoomStep: number,
  dimensionIndices: DimensionMap,
  thirdDimensionVoxelValue: number,
): LabeledVoxelsMap {
  // This method upsamples a given LabeledVoxelsMap. For each bucket in the LabeledVoxelsMap this function
  // iterates over the buckets in the higher resolution that are covered by the bucket.
  // For each covered bucket all labeled voxel entries are upsampled with a kernel and marked in an array for the covered bucket.
  // Therefore all covered buckets with their marked array build the upsampled version of the given LabeledVoxelsMap.
  if (sourceZoomStep <= targetZoomStep) {
    throw new Error("Trying to upsample a LabeledVoxelMap with the down sample function.");
  }
  const labeledVoxelMapInTargetResolution: LabeledVoxelsMap = new Map();
  const scaleToSource = map3((val, index) => val / sourceResolution[index], targetResolution);
  // This array serves multiple purposes. It has a name / variable for each purpose.
  const scaleToGoal = map3((val, index) => val / targetResolution[index], sourceResolution);
  const numberOfBucketWithinSourceBucket = scaleToGoal;
  const singleVoxelBoundsInTargetResolution = scaleToGoal;
  const boundsOfGoalBucketWithinSourceBucket = map3(
    value => Math.ceil(value * constants.BUCKET_WIDTH),
    scaleToSource,
  );
  // This is the buckets zoomed address part of the third dimension.
  const thirdDimensionBucketValue = Math.floor(
    thirdDimensionVoxelValue / targetResolution[dimensionIndices[2]] / constants.BUCKET_WIDTH,
  );
  const warnAboutCouldNotCreate = _.once(zoomedAddress => {
    console.warn(messages["sampling.could_not_get_or_create_bucket"](zoomedAddress));
  });
  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    const labeledBucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);
    if (labeledBucket.type === "null") {
      warnAboutCouldNotCreate(labeledBucketZoomedAddress);
      continue;
    }
    const goalBaseBucketAddress = map3(
      (value, index) => Math.floor(value * scaleToGoal[index]),
      labeledBucket.getAddress(),
    );
    goalBaseBucketAddress[dimensionIndices[2]] = thirdDimensionBucketValue;
    for (
      let firstDimBucketOffset = 0;
      firstDimBucketOffset < numberOfBucketWithinSourceBucket[dimensionIndices[0]];
      firstDimBucketOffset++
    ) {
      for (
        let secondDimBucketOffset = 0;
        secondDimBucketOffset < numberOfBucketWithinSourceBucket[dimensionIndices[1]];
        secondDimBucketOffset++
      ) {
        const currentGoalBucketAddress = [...goalBaseBucketAddress];
        currentGoalBucketAddress[dimensionIndices[0]] += firstDimBucketOffset;
        currentGoalBucketAddress[dimensionIndices[1]] += secondDimBucketOffset;
        // The inner bucket of whose the voxelMap will be created.
        let annotatedAtleastOneVoxel = false;
        const currentGoalBucket = dataCube.getOrCreateBucket([
          ...currentGoalBucketAddress,
          targetZoomStep,
        ]);
        if (currentGoalBucket.type === "null") {
          console.warn(warnAboutCouldNotCreate([...currentGoalBucketAddress, targetZoomStep]));
          continue;
        }
        const currentGoalVoxelMap = new Uint8Array(constants.BUCKET_WIDTH ** 2).fill(0);
        const firstDimVoxelOffset =
          boundsOfGoalBucketWithinSourceBucket[dimensionIndices[0]] * firstDimBucketOffset;
        const secondDimVoxelOffset =
          boundsOfGoalBucketWithinSourceBucket[dimensionIndices[1]] * secondDimBucketOffset;
        // Iterate over the part of voxelMap that covers the currentGoalBucket with an upscaling kernel.
        for (
          let kernelLeft = 0;
          kernelLeft < boundsOfGoalBucketWithinSourceBucket[dimensionIndices[0]];
          kernelLeft++
        ) {
          for (
            let kernelTop = 0;
            kernelTop < boundsOfGoalBucketWithinSourceBucket[dimensionIndices[1]];
            kernelTop++
          ) {
            if (
              voxelMap[
                (kernelLeft + firstDimVoxelOffset) * constants.BUCKET_WIDTH +
                  kernelTop +
                  secondDimVoxelOffset
              ] === 1
            ) {
              const kernelTopLeftVoxelInTargetResolution = [
                kernelLeft * singleVoxelBoundsInTargetResolution[dimensionIndices[0]],
                kernelTop * singleVoxelBoundsInTargetResolution[dimensionIndices[1]],
              ];
              // The labeled voxel is upscaled using a kernel.
              for (
                let firstKernelOffset = 0;
                firstKernelOffset < singleVoxelBoundsInTargetResolution[dimensionIndices[0]];
                firstKernelOffset++
              ) {
                for (
                  let secondKernelOffset = 0;
                  secondKernelOffset < singleVoxelBoundsInTargetResolution[dimensionIndices[1]];
                  secondKernelOffset++
                ) {
                  currentGoalVoxelMap[
                    (kernelTopLeftVoxelInTargetResolution[0] + firstKernelOffset) *
                      constants.BUCKET_WIDTH +
                      kernelTopLeftVoxelInTargetResolution[1] +
                      secondKernelOffset
                  ] = 1;
                }
              }
              annotatedAtleastOneVoxel = true;
            }
          }
        }
        if (annotatedAtleastOneVoxel) {
          labeledVoxelMapInTargetResolution.set(
            currentGoalBucket.zoomedAddress,
            currentGoalVoxelMap,
          );
        }
      }
    }
  }
  return labeledVoxelMapInTargetResolution;
}

function downsampleVoxelMap(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceResolution: Vector3,
  sourceZoomStep: number,
  targetResolution: Vector3,
  targetZoomStep: number,
  dimensionIndices: DimensionMap,
): LabeledVoxelsMap {
  // This method downsamples a LabeledVoxelsMap. For each bucket of the LabeledVoxelsMap
  // the matching bucket of the lower resolution is determined and all the labeledVoxels
  // are downsampled to the lower resolution bucket. The downsampling uses a kernel to skip
  // checking whether to label a downsampled voxel if already one labeled voxel matching the downsampled voxel is found.
  if (targetZoomStep <= sourceZoomStep) {
    throw new Error("Trying to upsample a LabeledVoxelMap with the downsample function.");
  }
  const labeledVoxelMapInTargetResolution: LabeledVoxelsMap = new Map();
  const scaleToSource = map3((val, index) => val / sourceResolution[index], targetResolution);
  const scaleToGoal = map3((val, index) => val / targetResolution[index], sourceResolution);

  const warnAboutCouldNotCreate = _.once(zoomedAddress => {
    console.warn(messages["sampling.could_not_get_or_create_bucket"](zoomedAddress));
  });

  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    const labeledBucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);
    if (labeledBucket.type === "null") {
      warnAboutCouldNotCreate(labeledBucketZoomedAddress);
      continue;
    }
    const goalBucketAddress = map3(
      (value, index) => Math.floor(value * scaleToGoal[index]),
      labeledBucket.getAddress(),
    );
    const goalBucket = dataCube.getOrCreateBucket([...goalBucketAddress, targetZoomStep]);
    if (goalBucket.type === "null") {
      warnAboutCouldNotCreate([...goalBucketAddress, targetZoomStep]);
      continue;
    }
    // Scale the bucket address back to the source scale to calculate the offset the source bucket has to the goalBucket.
    const goalBucketAddressUpscaled = map3(
      (value, index) => value * scaleToSource[index],
      goalBucketAddress,
    );
    const bucketOffset = map3(
      (value, index) => labeledBucket.zoomedAddress[index] - value,
      goalBucketAddressUpscaled,
    );
    // Calculate the offset in voxel the source bucket has to the goal bucket.
    const voxelOffset = map3(
      (value, index) => Math.floor(value * constants.BUCKET_WIDTH * scaleToGoal[index]),
      bucketOffset,
    );
    const goalVoxelMap =
      labeledVoxelMapInTargetResolution.get(goalBucket.zoomedAddress) ||
      new Uint8Array(constants.BUCKET_WIDTH ** 2).fill(0);
    // Iterate over the voxelMap in the goal resolution and search in each voxel for a labeled voxel (kernel-wise iteration).
    const kernelSize = map3(scaleValue => Math.ceil(scaleValue), scaleToSource);
    // The next two for loops move the kernel.
    for (
      let firstVoxelDim = 0;
      firstVoxelDim < constants.BUCKET_WIDTH;
      firstVoxelDim += kernelSize[dimensionIndices[0]]
    ) {
      for (
        let secondVoxelDim = 0;
        secondVoxelDim < constants.BUCKET_WIDTH;
        secondVoxelDim += kernelSize[dimensionIndices[1]]
      ) {
        // The next two for loops iterate within the kernel.
        let foundVoxel = false;
        for (
          let firstKernelDim = 0;
          firstKernelDim < kernelSize[dimensionIndices[0]] && !foundVoxel;
          firstKernelDim++
        ) {
          for (
            let secondKernelDim = 0;
            secondKernelDim < kernelSize[dimensionIndices[1]] && !foundVoxel;
            secondKernelDim++
          ) {
            const firstDim = firstVoxelDim + firstKernelDim;
            const secondDim = secondVoxelDim + secondKernelDim;
            if (voxelMap[firstDim * constants.BUCKET_WIDTH + secondDim] === 1) {
              const firstDimInGoalBucket =
                Math.floor(firstDim * scaleToGoal[dimensionIndices[0]]) +
                voxelOffset[dimensionIndices[0]];
              const secondDimInGoalBucket =
                Math.floor(secondDim * scaleToGoal[dimensionIndices[1]]) +
                voxelOffset[dimensionIndices[1]];
              goalVoxelMap[
                firstDimInGoalBucket * constants.BUCKET_WIDTH + secondDimInGoalBucket
              ] = 1;
              foundVoxel = true;
            }
          }
        }
      }
    }
    labeledVoxelMapInTargetResolution.set(goalBucket.zoomedAddress, goalVoxelMap);
  }
  return labeledVoxelMapInTargetResolution;
}

export default function sampleVoxelMapToResolution(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceResolution: Vector3,
  sourceZoomStep: number,
  targetResolution: Vector3,
  targetZoomStep: number,
  dimensionIndices: DimensionMap,
  thirdDimensionVoxelValue: number,
): LabeledVoxelsMap {
  if (sourceZoomStep < targetZoomStep) {
    return downsampleVoxelMap(
      labeledVoxelMap,
      dataCube,
      sourceResolution,
      sourceZoomStep,
      targetResolution,
      targetZoomStep,
      dimensionIndices,
    );
  } else if (targetZoomStep < sourceZoomStep) {
    return upsampleVoxelMap(
      labeledVoxelMap,
      dataCube,
      sourceResolution,
      sourceZoomStep,
      targetResolution,
      targetZoomStep,
      dimensionIndices,
      thirdDimensionVoxelValue,
    );
  } else {
    return labeledVoxelMap;
  }
}

export function applyVoxelMap(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  cellId: number,
  get3DAddress: (number, number, Vector3 | Float32Array) => void,
  numberOfSlicesToApply: number,
  thirdDimensionIndex: 0 | 1 | 2,
  // if shouldOverwrite is false, a voxel is only overwritten if
  // its old value is equal to overwritableValue.
  shouldOverwrite: boolean = true,
  overwritableValue: number = 0,
) {
  function preprocessBucket(bucket: Bucket) {
    if (bucket.type === "null") {
      return;
    }
    bucket.markAndAddBucketForUndo();
  }

  function postprocessBucket(bucket: Bucket) {
    if (bucket.type === "null") {
      return;
    }
    dataCube.pushQueue.insert(bucket);
    bucket.trigger("bucketLabeled");
  }
  const lowestResolutionIndex = dataCube.resolutionInfo.getLowestResolutionIndex();
  const zoomedAddressesOfAnnotatedBuckets = [];
  const overwrittenBucketAddressesOfSegments = new Map();
  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    let bucket: Bucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);
    const isBucketInLowestResolution = labeledBucketZoomedAddress[3] === lowestResolutionIndex;
    if (bucket.type === "null") {
      continue;
    }
    preprocessBucket(bucket);
    const out = new Float32Array(3);
    get3DAddress(0, 0, out);
    const thirdDimensionValueInBucket = out[2];
    for (let sliceCount = 0; sliceCount < numberOfSlicesToApply; sliceCount++) {
      let annotatedBucket = false;
      const newThirdDimValue = thirdDimensionValueInBucket + sliceCount;
      if (sliceCount > 0 && newThirdDimValue % constants.BUCKET_WIDTH === 0) {
        // The current slice is in the next bucket in the third direction.
        const nextBucketZoomedAddress = [...labeledBucketZoomedAddress];
        nextBucketZoomedAddress[thirdDimensionIndex]++;

        postprocessBucket(bucket);
        bucket = dataCube.getOrCreateBucket(nextBucketZoomedAddress);
        preprocessBucket(bucket);

        if (bucket.type === "null") {
          continue;
        }
      }
      if (bucket.type === "null") {
        continue;
      }
      const { data } = bucket.getOrCreateData();
      // TODO: In case a segment part that already exists in the backend and the bucket is overdrawn,
      // but the bucket data isn't fetched until this step, we do not know that this segment part is overdrawn.
      // This breaks the housekeeping of the covered buckets by a segment.
      //
      // A possible solution would be that when the incoming backend data is merged with the frontend data,
      // the merging automatically updates the covered buckets. The merge operation could use the
      // manageRemovingBucketAddressesOfOverdrawnSegments-method to do that. Then it only needs to track which segments were overwritten.
      //
      // ^ This is already done in bucket.js - merge. Look there for more details
      for (let firstDim = 0; firstDim < constants.BUCKET_WIDTH; firstDim++) {
        for (let secondDim = 0; secondDim < constants.BUCKET_WIDTH; secondDim++) {
          if (voxelMap[firstDim * constants.BUCKET_WIDTH + secondDim] === 1) {
            annotatedBucket = isBucketInLowestResolution;
            get3DAddress(firstDim, secondDim, out);
            const voxelToLabel = out;
            voxelToLabel[thirdDimensionIndex] =
              (voxelToLabel[thirdDimensionIndex] + sliceCount) % constants.BUCKET_WIDTH;
            // The voxelToLabel is already within the bucket and in the correct resolution.
            const voxelAddress = dataCube.getVoxelIndexByVoxelOffset(voxelToLabel);
            const currentSegmentId = data[voxelAddress];
            if (shouldOverwrite || currentSegmentId === overwritableValue) {
              if (
                isBucketInLowestResolution &&
                currentSegmentId > 0 &&
                currentSegmentId !== cellId
              ) {
                // Track all overwritten segments-bucket address combinations to later check whether the bucket
                // no longer contains the segment id and thus must the bucket's address must be removed
                // from the segment in the segment list.
                if (!overwrittenBucketAddressesOfSegments.has(currentSegmentId)) {
                  overwrittenBucketAddressesOfSegments.set(currentSegmentId, new Set());
                }
                overwrittenBucketAddressesOfSegments
                  .get(currentSegmentId)
                  //  $FlowFixMe[incompatible-use] Flow does not know that at this point the entry must exist.
                  .add(bucket.zoomedAddress);
              }
              data[voxelAddress] = cellId;
            }
          }
        }
      }
      if (annotatedBucket) {
        zoomedAddressesOfAnnotatedBuckets.push(bucket.zoomedAddress);
      }
    }
    // Post-processing: add to pushQueue and notify about labeling
    postprocessBucket(bucket);
  }
  manageRemovingBucketAddressesOfOverdrawnSegments(
    dataCube,
    overwrittenBucketAddressesOfSegments,
    lowestResolutionIndex,
  );
  addAnnotatedBucketAddressesToCoveredBucketsOfSegment(cellId, zoomedAddressesOfAnnotatedBuckets);
}

function addAnnotatedBucketAddressesToCoveredBucketsOfSegment(
  segmentId: number,
  newlyCoveredBucketAddresses: Array<Vector4>,
) {
  if (newlyCoveredBucketAddresses.length > 0) {
    Store.dispatch(addBucketAddressesToSegmentAction(segmentId, newlyCoveredBucketAddresses));
  }
}

function assignSegmentNewPositionFromIndexWithinBucket(
  segmentId: number,
  index: number,
  bucketAddress: Vector4,
  resolutions: Array<Vector3>,
  dataCube: DataCube,
) {
  // TODO: Test this manually. Looks like this is broken :/
  const globalPositionForSegment = dataCube.getGlobalPositionOfBucketIndex(
    index,
    bucketAddress,
    resolutions,
  );
  Store.dispatch(setSomePositionOfSegmentAction(segmentId, globalPositionForSegment));
}

async function findAndSetNewValidPositionForSegments(
  segmentsWithInvalidPosition: Array<number>,
  removeBucketsFromSegments: { [number]: Array<Vector4> },
  resolutions: Array<Vector3>,
  dataCube: DataCube,
) {
  // Looks for in the first bucket with that is still covered by the segment for a voxel
  // that has the segments id and set this as the new position fo the segment.
  const currentSegmentList = enforceVolumeTracing(Store.getState().tracing).segments;
  for (const currentSegmentId of segmentsWithInvalidPosition) {
    const currentSegmentIdString = `${currentSegmentId}`;
    const currentSegmentEntry = currentSegmentList.get(currentSegmentIdString);
    if (currentSegmentEntry == null) {
      continue;
    }
    const bucketAddressesWithDataOfCurrentSegment = [
      ...currentSegmentEntry.coveredBucketAddresses,
    ].filter(address => !removeBucketsFromSegments[currentSegmentId].includes(address));
    if (bucketAddressesWithDataOfCurrentSegment.length === 0) {
      // TODO: Mange this special case, where a segment was completely overdrawn / think about how this can be handled.
      // One way would be to remove that segment from the list.
      continue;
    }
    const firstBucketAddressWithDataOfCurrentSegment = bucketAddressesWithDataOfCurrentSegment[0];
    dataCube
      .getLoadedBucket(firstBucketAddressWithDataOfCurrentSegment)
      .then(bucketWithSegmentData => {
        if (bucketWithSegmentData.type === "null") {
          return;
        }
        const { data: bucketData } = bucketWithSegmentData.getOrCreateData();
        let firstPositionWithCurrentSegment = -1;
        for (let index = 0; index < bucketData.length; ++index) {
          if (bucketData[index] === currentSegmentId) {
            firstPositionWithCurrentSegment = index;
            break;
          }
        }
        if (firstPositionWithCurrentSegment !== -1) {
          assignSegmentNewPositionFromIndexWithinBucket(
            currentSegmentId,
            firstPositionWithCurrentSegment,
            firstBucketAddressWithDataOfCurrentSegment,
            resolutions,
            dataCube,
          );
        }
      });
  }
}

// Based on the segment-bucket address combination of overwritten segments check whether a bucket's address needs to be removed from the
// segments entry in the segment list. Additionally check whether the position of a segment also needs to be updated an look for a new valid position.
export async function manageRemovingBucketAddressesOfOverdrawnSegments(
  dataCube: DataCube,
  overwrittenBucketAddressesOfSegments: Map<number, Set<Vector4>>,
  lowestResolutionIndex: number,
) {
  const removeBucketsFromSegments = {};
  const segmentsWithInvalidPosition = [];
  const promisesToWaitFor = [];
  const currentSegmentList = enforceVolumeTracing(Store.getState().tracing).segments;
  const resolutions: Array<Vector3> = (_.cloneDeep(dataCube.resolutionInfo.resolutions): any);

  const checkIfSegmentPositionIsNowInvalid = async (
    segmentId: number,
    segmentPosition: Vector3,
    bucketAddressSet: Set<Vector4>,
  ) => {
    const bucketAddressOfCurrentSegmentPosition = globalPositionToBucketPosition(
      segmentPosition,
      resolutions,
      lowestResolutionIndex,
    );
    let bucket = dataCube.getOrCreateBucket(bucketAddressOfCurrentSegmentPosition);
    if (bucket.type === "null") {
      return true;
    }
    if (bucketAddressSet.has(bucket.zoomedAddress)) {
      bucket = await dataCube.getLoadedBucket(bucketAddressOfCurrentSegmentPosition);
      if (bucket.type !== "null") {
        const { data: bucketData } = bucket.getOrCreateData();
        const indexInBucketData = dataCube.getVoxelIndex(segmentPosition);
        const isSegmentPositionFaulty = bucketData[indexInBucketData] !== segmentId;
        return isSegmentPositionFaulty;
      }
    }
    return false;
  };

  const checkBucketAddressSetForBucketsWithoutPartsOfSegment = async (
    bucketAddressSet: Set<Vector4>,
    segmentId: number,
    segmentIdString: string,
    isSegmentPositionFaulty: boolean,
  ) => {
    const bucketCheckPromises = [];
    let isSegmentPositionStillFaulty = isSegmentPositionFaulty;
    const lookForSegmentDataInBucket = (bucket: Bucket, bucketAddress: Vector4) => {
      if (bucket.type === "null") {
        return;
      }
      const { data: bucketData } = bucket.getOrCreateData();
      let isValueIncluded = false;
      for (let index = 0; index < bucketData.length && !isValueIncluded; ++index) {
        isValueIncluded = bucketData[index] === segmentId;
        if (isValueIncluded && isSegmentPositionFaulty) {
          assignSegmentNewPositionFromIndexWithinBucket(
            segmentId,
            index,
            bucketAddress,
            resolutions,
            dataCube,
          );
          isSegmentPositionStillFaulty = false;
        }
      }
      if (!isValueIncluded) {
        // If the value is not included, add the segment-bucket address combination to a object, that will be used
        // in the removeBucketAddressesFromSegmentsAction to remove the bucket address from the segments covered buckets list.
        if (removeBucketsFromSegments[segmentIdString]) {
          removeBucketsFromSegments[segmentIdString].push(bucketAddress);
        } else {
          removeBucketsFromSegments[segmentIdString] = [bucketAddress];
        }
      }
    };
    for (const bucketAddress of bucketAddressSet.values()) {
      // For each bucket in the "segments overwritten bucket addresses set" perform the check for looking for data.
      // Save these promises to wait for them
      bucketCheckPromises.push(
        dataCube
          .getLoadedBucket(bucketAddress)
          .then((bucket: Bucket) => lookForSegmentDataInBucket(bucket, bucketAddress)),
      );
    }
    await Promise.all(bucketCheckPromises);
    // If the position is still faulty, meaning in one of the bucket of bucketAddressSet no voxel with the current segment id could be found,
    // add this segment id to the array of segments with faulty positions to find a valid position later.
    if (isSegmentPositionStillFaulty) {
      segmentsWithInvalidPosition.push(segmentId);
    }
  };
  for (const [
    currentSegmentId,
    bucketAddressSet,
  ] of overwrittenBucketAddressesOfSegments.entries()) {
    // For each segment that got overwritten, identify whether a bucket needs to be removed from its
    // covered bucket addresses list or whether its position needs to be updated.
    const currentSegmentIdString = `${currentSegmentId}`;
    const currentSegmentEntry = currentSegmentList.get(currentSegmentIdString);
    if (currentSegmentEntry == null) {
      continue;
    }
    const currentSegmentPosition = currentSegmentEntry.somePosition;
    promisesToWaitFor.push(
      checkIfSegmentPositionIsNowInvalid(
        currentSegmentId,
        currentSegmentPosition,
        bucketAddressSet,
      ).then(async (isSegmentPositionFaulty: boolean) => {
        await checkBucketAddressSetForBucketsWithoutPartsOfSegment(
          bucketAddressSet,
          currentSegmentId,
          currentSegmentIdString,
          isSegmentPositionFaulty,
        );
      }),
    );
  }
  // Wait for all async checks
  await Promise.all(promisesToWaitFor);
  // Now all segments with invalid positions are know. Thus find new positions for them.
  findAndSetNewValidPositionForSegments(
    segmentsWithInvalidPosition,
    removeBucketsFromSegments,
    resolutions,
    dataCube,
  );

  if (Object.getOwnPropertyNames(removeBucketsFromSegments).length > 0) {
    Store.dispatch(removeBucketAddressesFromSegmentsAction(removeBucketsFromSegments));
  }
}
