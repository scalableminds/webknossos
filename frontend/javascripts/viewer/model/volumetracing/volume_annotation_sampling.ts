import { map3 } from "libs/utils";
import _ from "lodash";
import messages from "messages";
import type { BucketAddress, LabeledVoxelsMap, Vector3 } from "viewer/constants";
import constants from "viewer/constants";
import type { Bucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type { DimensionMap } from "viewer/model/dimensions";

function upsampleVoxelMap(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceMag: Vector3,
  sourceZoomStep: number,
  targetMag: Vector3,
  targetZoomStep: number,
  dimensionIndices: DimensionMap,
  thirdDimensionVoxelValue: number,
): LabeledVoxelsMap {
  // This method upsamples a given LabeledVoxelsMap. For each bucket in the LabeledVoxelsMap this function
  // iterates over the buckets in the higher mag that are covered by the bucket.
  // For each covered bucket all labeled voxel entries are upsampled with a kernel and marked in an array for the covered bucket.
  // Therefore all covered buckets with their marked array build the upsampled version of the given LabeledVoxelsMap.
  if (sourceZoomStep <= targetZoomStep) {
    throw new Error("Trying to upsample a LabeledVoxelMap with the down sample function.");
  }

  const labeledVoxelMapInTargetMag: LabeledVoxelsMap = new Map();
  const scaleToSource = map3((val, index) => val / sourceMag[index], targetMag);
  // This array serves multiple purposes. It has a name / variable for each purpose.
  const scaleToGoal = map3((val, index) => val / targetMag[index], sourceMag);
  const numberOfBucketWithinSourceBucket = scaleToGoal;
  const singleVoxelBoundsInTargetMag = scaleToGoal;
  const boundsOfGoalBucketWithinSourceBucket = map3(
    (value) => Math.ceil(value * constants.BUCKET_WIDTH),
    scaleToSource,
  );
  // This is the buckets zoomed address part of the third dimension.
  const thirdDimensionBucketValue = Math.floor(
    thirdDimensionVoxelValue / targetMag[dimensionIndices[2]] / constants.BUCKET_WIDTH,
  );

  const warnAboutCouldNotCreate = _.once((zoomedAddress) => {
    console.warn(messages["sampling.could_not_get_or_create_bucket"](zoomedAddress));
  });

  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    const labeledBucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);

    if (labeledBucket.type === "null") {
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
        const currentGoalBucketAddress: Vector3 = [...goalBaseBucketAddress];
        currentGoalBucketAddress[dimensionIndices[0]] += firstDimBucketOffset;
        currentGoalBucketAddress[dimensionIndices[1]] += secondDimBucketOffset;
        // The inner bucket of whose the voxelMap will be created.
        let annotatedAtleastOneVoxel = false;

        const currentGoalBucket = dataCube.getOrCreateBucket([
          ...currentGoalBucketAddress,
          targetZoomStep,
          labeledBucket.getAdditionalCoordinates() || [],
        ]);

        if (currentGoalBucket.type === "null") {
          warnAboutCouldNotCreate([...currentGoalBucketAddress, targetZoomStep]);
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
              const kernelTopLeftVoxelInTargetMag = [
                kernelLeft * singleVoxelBoundsInTargetMag[dimensionIndices[0]],
                kernelTop * singleVoxelBoundsInTargetMag[dimensionIndices[1]],
              ];

              // The labeled voxel is upscaled using a kernel.
              for (
                let firstKernelOffset = 0;
                firstKernelOffset < singleVoxelBoundsInTargetMag[dimensionIndices[0]];
                firstKernelOffset++
              ) {
                for (
                  let secondKernelOffset = 0;
                  secondKernelOffset < singleVoxelBoundsInTargetMag[dimensionIndices[1]];
                  secondKernelOffset++
                ) {
                  currentGoalVoxelMap[
                    (kernelTopLeftVoxelInTargetMag[0] + firstKernelOffset) *
                      constants.BUCKET_WIDTH +
                      kernelTopLeftVoxelInTargetMag[1] +
                      secondKernelOffset
                  ] = 1;
                }
              }

              annotatedAtleastOneVoxel = true;
            }
          }
        }

        if (annotatedAtleastOneVoxel) {
          labeledVoxelMapInTargetMag.set(currentGoalBucket.zoomedAddress, currentGoalVoxelMap);
        }
      }
    }
  }

  return labeledVoxelMapInTargetMag;
}

function downsampleVoxelMap(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceMag: Vector3,
  sourceZoomStep: number,
  targetMag: Vector3,
  targetZoomStep: number,
  dimensionIndices: DimensionMap,
): LabeledVoxelsMap {
  // This method downsamples a LabeledVoxelsMap. For each bucket of the LabeledVoxelsMap
  // the matching bucket of the lower magnification is determined and all the labeledVoxels
  // are downsampled to the lower mag bucket. The downsampling uses a kernel to skip
  // checking whether to label a downsampled voxel if already one labeled voxel matching the downsampled voxel is found.
  if (targetZoomStep <= sourceZoomStep) {
    throw new Error("Trying to upsample a LabeledVoxelMap with the downsample function.");
  }

  const labeledVoxelMapInTargetMag: LabeledVoxelsMap = new Map();
  const scaleToSource = map3((val, index) => val / sourceMag[index], targetMag);
  const scaleToGoal = map3((val, index) => val / targetMag[index], sourceMag);

  const warnAboutCouldNotCreate = _.once((zoomedAddress) => {
    console.warn(messages["sampling.could_not_get_or_create_bucket"](zoomedAddress));
  });

  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    const labeledBucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);

    if (labeledBucket.type === "null") {
      continue;
    }

    const goalBucketAddress = map3(
      (value, index) => Math.floor(value * scaleToGoal[index]),
      labeledBucket.getAddress(),
    );

    const goalBucket = dataCube.getOrCreateBucket([
      ...goalBucketAddress,
      targetZoomStep,
      labeledBucket.getAdditionalCoordinates() || [],
    ]);

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
      labeledVoxelMapInTargetMag.get(goalBucket.zoomedAddress) ||
      new Uint8Array(constants.BUCKET_WIDTH ** 2).fill(0);
    // Iterate over the voxelMap in the goal mag and search in each voxel for a labeled voxel (kernel-wise iteration).
    const kernelSize = map3((scaleValue) => Math.ceil(scaleValue), scaleToSource);

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
              goalVoxelMap[firstDimInGoalBucket * constants.BUCKET_WIDTH + secondDimInGoalBucket] =
                1;
              foundVoxel = true;
            }
          }
        }
      }
    }

    labeledVoxelMapInTargetMag.set(goalBucket.zoomedAddress, goalVoxelMap);
  }

  return labeledVoxelMapInTargetMag;
}

export default function sampleVoxelMapToMagnification(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceMag: Vector3,
  sourceZoomStep: number,
  targetMag: Vector3,
  targetZoomStep: number,
  dimensionIndices: DimensionMap,
  thirdDimensionVoxelValue: number,
): LabeledVoxelsMap {
  if (sourceZoomStep < targetZoomStep) {
    return downsampleVoxelMap(
      labeledVoxelMap,
      dataCube,
      sourceMag,
      sourceZoomStep,
      targetMag,
      targetZoomStep,
      dimensionIndices,
    );
  } else if (targetZoomStep < sourceZoomStep) {
    return upsampleVoxelMap(
      labeledVoxelMap,
      dataCube,
      sourceMag,
      sourceZoomStep,
      targetMag,
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
  segmentId: number,
  get3DAddress: (arg0: number, arg1: number, arg2: Vector3 | Float32Array) => void,
  numberOfSlicesToApply: number,
  thirdDimensionIndex: 0 | 1 | 2, // If shouldOverwrite is false, a voxel is only overwritten if
  // its old value is equal to overwritableValue.
  shouldOverwrite: boolean = true,
  overwritableValue: number = 0,
): boolean {
  function preprocessBucket(bucket: Bucket) {
    if (bucket.type === "null") {
      return;
    }

    bucket.startDataMutation();
  }

  function postprocessBucket(bucket: Bucket) {
    if (bucket.type === "null") {
      return;
    }

    bucket.endDataMutation();
  }

  let wroteVoxels = false;
  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    let bucket: Bucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);

    if (bucket.type === "null") {
      continue;
    }

    preprocessBucket(bucket);
    const out = new Float32Array(3);
    get3DAddress(0, 0, out);
    const thirdDimensionValueInBucket = out[2];

    for (let sliceCount = 0; sliceCount < numberOfSlicesToApply; sliceCount++) {
      const newThirdDimValue = thirdDimensionValueInBucket + sliceCount;

      if (sliceCount > 0 && newThirdDimValue % constants.BUCKET_WIDTH === 0) {
        // The current slice is in the next bucket in the third direction.
        const nextBucketZoomedAddress: BucketAddress = [...labeledBucketZoomedAddress];
        nextBucketZoomedAddress[thirdDimensionIndex]++;
        postprocessBucket(bucket);
        bucket = dataCube.getOrCreateBucket(nextBucketZoomedAddress);
        preprocessBucket(bucket);
      }

      if (bucket.type === "null") {
        continue;
      }

      wroteVoxels =
        bucket.applyVoxelMap(
          voxelMap,
          segmentId,
          get3DAddress,
          sliceCount,
          thirdDimensionIndex,
          shouldOverwrite,
          overwritableValue,
        ) || wroteVoxels;
    }

    // Post-processing: add to pushQueue and notify about labeling
    postprocessBucket(bucket);
  }
  return wroteVoxels;
}
