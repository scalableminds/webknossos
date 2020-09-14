// @flow

import constants, { type Vector3, type LabeledVoxelsMap } from "oxalis/constants";
import { map3 } from "libs/utils";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import messages from "messages";
import type { DimensionMap } from "oxalis/model/dimensions";

function upsampleVoxelMap(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceResolution: Vector3,
  sourceZoomStep: number,
  goalResolution: Vector3,
  goalZoomStep: number,
  dimensionIndices: DimensionMap,
): LabeledVoxelsMap {
  // TODO: Add comment
  if (sourceZoomStep <= goalZoomStep) {
    throw new Error("Trying to upsample a LabeledVoxelMap with the down sample function.");
  }
  const labeledVoxelMapInGoalResolution: LabeledVoxelsMap = new Map();
  const scaleToSource = map3((val, index) => val / sourceResolution[index], goalResolution);
  // This array serves multiple purposes. It has a name / variable for each purpose.
  const scaleToGoal = map3((val, index) => val / goalResolution[index], sourceResolution);
  const numberOfBucketWithSourceBucket = scaleToGoal;
  const singleVoxelBoundsInGoalResolution = scaleToGoal;
  const boundsOfGoalBucketWithinSourceBucket = map3(
    value => Math.ceil(value * constants.BUCKET_WIDTH),
    scaleToSource,
  );
  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    const labeledBucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);
    if (labeledBucket.type === "null") {
      console.warn(messages["sampling.could_not_get_or_create_bucket"](labeledBucketZoomedAddress));
      continue;
    }
    const goalBaseBucketAddress = map3(
      (value, index) => Math.floor(value * scaleToGoal[index]),
      labeledBucket.getAddress(),
    );
    for (
      let firstDimBucketOffset = 0;
      firstDimBucketOffset < numberOfBucketWithSourceBucket[dimensionIndices[0]];
      firstDimBucketOffset++
    ) {
      for (
        let secondDimBucketOffset = 0;
        secondDimBucketOffset < numberOfBucketWithSourceBucket[dimensionIndices[1]];
        secondDimBucketOffset++
      ) {
        const currentGoalBucketAddress = [...goalBaseBucketAddress];
        currentGoalBucketAddress[dimensionIndices[0]] += firstDimBucketOffset;
        currentGoalBucketAddress[dimensionIndices[1]] += secondDimBucketOffset;
        // The inner bucket of whose the voxelMap will be created.
        let annotatedAtleastOneVoxel = false;
        const currentGoalBucket = dataCube.getOrCreateBucket([
          ...currentGoalBucketAddress,
          goalZoomStep,
        ]);
        if (currentGoalBucket.type === "null") {
          console.warn(
            messages["sampling.could_not_get_or_create_bucket"]([
              ...currentGoalBucketAddress,
              goalZoomStep,
            ]),
          );
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
              const kernelTopLeftVoxelInGoalResolution = [
                kernelLeft * singleVoxelBoundsInGoalResolution[dimensionIndices[0]],
                kernelTop * singleVoxelBoundsInGoalResolution[dimensionIndices[1]],
              ];
              // The labeled voxel is upscaled.
              for (
                let firstKernelOffset = 0;
                firstKernelOffset < singleVoxelBoundsInGoalResolution[dimensionIndices[0]];
                firstKernelOffset++
              ) {
                for (
                  let secondKernelOffset = 0;
                  secondKernelOffset < singleVoxelBoundsInGoalResolution[dimensionIndices[1]];
                  secondKernelOffset++
                ) {
                  currentGoalVoxelMap[
                    (kernelTopLeftVoxelInGoalResolution[0] + firstKernelOffset) *
                      constants.BUCKET_WIDTH +
                      kernelTopLeftVoxelInGoalResolution[1] +
                      secondKernelOffset
                  ] = 1;
                }
              }
              annotatedAtleastOneVoxel = true;
            }
          }
        }
        if (annotatedAtleastOneVoxel) {
          labeledVoxelMapInGoalResolution.set(currentGoalBucket.zoomedAddress, currentGoalVoxelMap);
        }
      }
    }
  }
  return labeledVoxelMapInGoalResolution;
}

function downsampleVoxelMap(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceResolution: Vector3,
  sourceZoomStep: number,
  goalResolution: Vector3,
  goalZoomStep: number,
  dimensionIndices: DimensionMap,
): LabeledVoxelsMap {
  if (goalZoomStep <= sourceZoomStep) {
    throw new Error("Trying to upsample a LabeledVoxelMap with the down sample function.");
  }
  const labeledVoxelMapInGoalResolution: LabeledVoxelsMap = new Map();
  const scaleToSource = map3((val, index) => val / sourceResolution[index], goalResolution);
  const scaleToGoal = map3((val, index) => val / goalResolution[index], sourceResolution);
  for (const [labeledBucketZoomedAddress, voxelMap] of labeledVoxelMap) {
    const labeledBucket = dataCube.getOrCreateBucket(labeledBucketZoomedAddress);
    if (labeledBucket.type === "null") {
      console.warn(messages["sampling.could_not_get_or_create_bucket"](labeledBucketZoomedAddress));
      continue;
    }
    const goalBucketAddress = map3(
      (value, index) => Math.floor(value * scaleToGoal[index]),
      labeledBucket.getAddress(),
    );
    const goalBucket = dataCube.getOrCreateBucket([...goalBucketAddress, goalZoomStep]);
    if (goalBucket.type === "null") {
      console.warn(
        messages["sampling.could_not_get_or_create_bucket"]([...goalBucketAddress, goalZoomStep]),
      );
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
      labeledVoxelMapInGoalResolution.get(goalBucket.zoomedAddress) ||
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
    labeledVoxelMapInGoalResolution.set(goalBucket.zoomedAddress, goalVoxelMap);
  }
  return labeledVoxelMapInGoalResolution;
}

export default function sampleVoxelMapToResolution(
  labeledVoxelMap: LabeledVoxelsMap,
  dataCube: DataCube,
  sourceResolution: Vector3,
  sourceZoomStep: number,
  goalResolution: Vector3,
  goalZoomStep: number,
  dimensionIndices: DimensionMap,
): LabeledVoxelsMap {
  if (sourceZoomStep < goalZoomStep) {
    return downsampleVoxelMap(
      labeledVoxelMap,
      dataCube,
      sourceResolution,
      sourceZoomStep,
      goalResolution,
      goalZoomStep,
      dimensionIndices,
    );
  } else if (goalZoomStep < sourceZoomStep) {
    return upsampleVoxelMap(
      labeledVoxelMap,
      dataCube,
      sourceResolution,
      sourceZoomStep,
      goalResolution,
      goalZoomStep,
      dimensionIndices,
    );
  } else {
    return labeledVoxelMap;
  }
}
