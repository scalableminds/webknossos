import { V3 } from "libs/mjs";
import { call, put } from "typed-redux-saga";
import type { BoundingBoxObject } from "types/bounding_box";
import Constants, {
  type ContourMode,
  ContourModeEnum,
  type LabeledVoxelsMap,
  type OrthoView,
  type OverwriteMode,
  OverwriteModeEnum,
  type Vector3,
} from "viewer/constants";
import {
  isConcurrentCollaborationMode,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import { getLayerByName } from "viewer/model/accessors/dataset_accessor";
import {
  getTransformedDatasetBoundingBox,
  getTransformsForLayer,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { enforceActiveVolumeTracing } from "viewer/model/accessors/volumetracing_accessor";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { createSendBucketInfo } from "viewer/model/bucket_data_handling/wkstore_adapter";
import Dimensions, { type DimensionMap } from "viewer/model/dimensions";
import type { MagInfo } from "viewer/model/helpers/mag_info";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { getHalfViewportExtentsInVx } from "viewer/model/sagas/saga_selectors";
import {
  type UpdateBucketPartialUpdateAction,
  updateBucketPartial,
} from "viewer/model/sagas/volume/update_actions";
import {
  type BucketDiff,
  encodeBucketDiffBase64,
  runAxisForPlane,
} from "viewer/model/volumetracing/core/bucket_diff";
import type { RunAxis } from "viewer/model/volumetracing/core/bucket_voxel_mask";
import { maskShapeFromVoxelBuffer2D } from "viewer/model/volumetracing/integration/fill_mask";
import { runMaskEdit } from "viewer/model/volumetracing/integration/mask_driver";
import type { SaveMode } from "viewer/model/volumetracing/integration/tool_driver_types";
import type SectionLabeler from "viewer/model/volumetracing/legacy/section_labeling";
import {
  TransformedSectionLabeler,
  type VoxelBuffer2D,
} from "viewer/model/volumetracing/legacy/section_labeling";
import sampleVoxelMapToMagnification, {
  applyVoxelMap,
} from "viewer/model/volumetracing/legacy/volume_annotation_sampling";
import { Model } from "viewer/singletons";
import type { VolumeTracing, WebknossosState } from "viewer/store";

function* pairwise<T>(arr: Array<T>): Generator<[T, T], any, any> {
  for (let i = 0; i < arr.length - 1; i++) {
    yield [arr[i], arr[i + 1]];
  }
}

export type BooleanBox = {
  value: boolean;
};

/**
 * In live collaboration, volume edits are saved as partial bucket updates, so that
 * they don't overwrite concurrent edits of the same buckets by others. Otherwise,
 * the touched buckets are saved whole, which keeps undo/redo possible.
 */
export function getVolumeSaveModeForState(state: WebknossosState): SaveMode {
  return isConcurrentCollaborationMode(state) ? "partialUpdates" : "fullBuckets";
}

export function* getVolumeSaveMode(): Saga<SaveMode> {
  return yield* select(getVolumeSaveModeForState);
}

/** The update actions that save an edit's committed bucket diffs as partial bucket updates. */
export function createPartialBucketUpdates(
  bucketDiffs: BucketDiff[],
  cube: DataCube,
  tracingId: string,
  runAxis: RunAxis,
): UpdateBucketPartialUpdateAction[] {
  // Diffs can address buckets the layer doesn't have: outside of its bounding box,
  // or in a mag that is missing between two existing ones (mag propagation passes
  // through it). Their writes were skipped, so they are not sent.
  // The core's BucketAddress is structurally the viewer's, additional
  // coordinates included, so it goes into createSendBucketInfo as-is.
  return bucketDiffs
    .filter((diff) => cube.isBucketWithinLayer(diff.address))
    .map((diff) =>
      updateBucketPartial(
        createSendBucketInfo(diff.address, cube.magInfo),
        encodeBucketDiffBase64(diff, runAxis),
        tracingId,
      ),
    );
}

/** Sends an edit's committed bucket diffs as partial bucket updates, if it is saved that way. */
export function* pushPartialBucketUpdates(
  saveMode: SaveMode,
  bucketDiffs: BucketDiff[],
  cube: DataCube,
  tracingId: string,
  runAxis: RunAxis,
): Saga<void> {
  if (saveMode !== "partialUpdates") return;
  const updates = createPartialBucketUpdates(bucketDiffs, cube, tracingId, runAxis);
  if (updates.length === 0) return;
  yield* put(pushSaveQueueTransaction(updates));
}

export function* getBoundingBoxForViewport(
  position: Vector3,
  currentViewport: OrthoView,
): Saga<BoundingBox> {
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtentsInVx,
    currentViewport,
  );

  const currentViewportBounding = {
    min: V3.sub(
      position,
      Dimensions.transDim([halfViewportExtentX, halfViewportExtentY, 0], currentViewport),
    ),
    max: V3.add(
      position,
      Dimensions.transDim([halfViewportExtentX, halfViewportExtentY, 1], currentViewport),
    ),
  };

  const datasetBoundingBox = yield* select((state) =>
    getTransformedDatasetBoundingBox(
      state.dataset,
      state.datasetConfiguration.nativelyRenderedLayerName,
    ),
  );
  return new BoundingBox(currentViewportBounding).intersectedWith(datasetBoundingBox);
}

export function getBoundingBoxInMag1(boudingBox: BoundingBoxObject, magOfBB: Vector3) {
  return {
    topLeft: [
      boudingBox.topLeft[0] * magOfBB[0],
      boudingBox.topLeft[1] * magOfBB[1],
      boudingBox.topLeft[2] * magOfBB[2],
    ] as Vector3,
    width: boudingBox.width * magOfBB[0],
    height: boudingBox.height * magOfBB[1],
    depth: boudingBox.depth * magOfBB[2],
  };
}

export function applyLabeledVoxelMapToAllMissingMags(
  inputLabeledVoxelMap: LabeledVoxelsMap,
  labeledZoomStep: number,
  dimensionIndices: DimensionMap,
  magInfo: MagInfo,
  segmentationCube: DataCube,
  segmentId: bigint,
  thirdDimensionOfSlice: number, // this value is specified in global (mag1) coords
  // If shouldOverwrite is false, a voxel is only overwritten if
  // its old value is equal to overwritableValue.
  shouldOverwrite: boolean,
  overwritableValue: bigint = 0n,
): void {
  const thirdDim = dimensionIndices[2];

  // This function creates a `get3DAddress` function which maps from
  // a 2D vector address to the corresponding 3D vector address.
  // The input address is local to a slice in the LabeledVoxelsMap (that's
  // why it's 2D). The output address is local to the corresponding bucket.
  const get3DAddressCreator = (targetMags: Vector3) => {
    const sampledThirdDimensionValue =
      Math.floor(thirdDimensionOfSlice / targetMags[thirdDim]) % Constants.BUCKET_WIDTH;
    return (x: number, y: number, out: Vector3 | Float32Array) => {
      out[dimensionIndices[0]] = x;
      out[dimensionIndices[1]] = y;
      out[dimensionIndices[2]] = sampledThirdDimensionValue;
    };
  };

  // Get all available magnifications and divide the list into two parts.
  // The pivotIndex is the index within allMagsWithIndices which refers to
  // the labeled mag.
  // `downsampleSequence` contains the current mag and all higher mags (to which
  // should be downsampled)
  // `upsampleSequence` contains the current mag and all lower mags (to which
  // should be upsampled)
  const labeledMag = magInfo.getMagByIndexOrThrow(labeledZoomStep);
  const allMagsWithIndices = magInfo.getMagsWithIndices();
  const pivotIndex = allMagsWithIndices.findIndex(([index]) => index === labeledZoomStep);
  const downsampleSequence = allMagsWithIndices.slice(pivotIndex);
  const upsampleSequence = allMagsWithIndices.slice(0, pivotIndex + 1).reverse();

  // Given a sequence of mags, the inputLabeledVoxelMap is applied
  // over all these mags.
  function processSamplingSequence(
    samplingSequence: Array<[number, Vector3]>,
    getNumberOfSlices: (arg0: Vector3) => number,
  ) {
    // On each sampling step, a new LabeledVoxelMap is acquired
    // which is used as the input for the next down-/upsampling
    let currentLabeledVoxelMap: LabeledVoxelsMap = inputLabeledVoxelMap;

    for (const [source, target] of pairwise(samplingSequence)) {
      const [sourceZoomStep, sourceMag] = source;
      const [targetZoomStep, targetMag] = target;
      currentLabeledVoxelMap = sampleVoxelMapToMagnification(
        currentLabeledVoxelMap,
        segmentationCube,
        sourceMag,
        sourceZoomStep,
        targetMag,
        targetZoomStep,
        dimensionIndices,
        thirdDimensionOfSlice,
      );
      const numberOfSlices = getNumberOfSlices(targetMag);
      applyVoxelMap(
        currentLabeledVoxelMap,
        segmentationCube,
        segmentId,
        get3DAddressCreator(targetMag),
        numberOfSlices,
        thirdDim,
        shouldOverwrite,
        overwritableValue,
      );
    }
  }

  // First upsample the voxel map and apply it to all better mags.
  // sourceZoomStep will be higher than targetZoomStep
  processSamplingSequence(upsampleSequence, (targetMag) =>
    Math.ceil(labeledMag[thirdDim] / targetMag[thirdDim]),
  );
  // Next we downsample the annotation and apply it.
  // sourceZoomStep will be lower than targetZoomStep
  processSamplingSequence(downsampleSequence, (_targetMag) => 1);
}

/**
 * Labels the voxels set in a 2D buffer in the plane of the given viewport with the
 * active segment, or erases them, as one transaction (see mask_driver.ts).
 */
export function* labelWithVoxelBuffer2D(
  voxelBuffer: VoxelBuffer2D,
  contourTracingMode: ContourMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
  viewport: OrthoView,
  wroteVoxelsBox?: BooleanBox,
): Saga<void> {
  const allowUpdate = yield* select(mayEditAnnotation);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  if (!allowUpdate) return;
  if (voxelBuffer.isEmpty()) return;
  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const { activeCellId } = volumeTracing;
  const { cube } = yield* call([Model, Model.getSegmentationTracingLayer], volumeTracing.tracingId);
  const isDeleting = contourTracingMode === ContourModeEnum.DELETE;
  const saveMode = yield* call(getVolumeSaveMode);
  const { voxels, bucketDiffs } = runMaskEdit(
    {
      cube,
      magIndex: labeledZoomStep,
      segmentId: isDeleting ? 0n : activeCellId,
      additionalCoordinates: additionalCoordinates ?? null,
      overwriteMode:
        overwriteMode === OverwriteModeEnum.OVERWRITE_EMPTY
          ? "overwrite-empty-only"
          : "overwrite-all",
      // Under overwrite-empty, painting only writes over background, and erasing
      // only removes the active segment.
      overwritableValue: isDeleting ? activeCellId : 0n,
      saveMode,
    },
    maskShapeFromVoxelBuffer2D(voxelBuffer, viewport),
    "voxelBuffer2D",
  );
  // In the run order in which the viewport's slice is contiguous.
  yield* call(
    pushPartialBucketUpdates,
    saveMode,
    bucketDiffs,
    cube,
    volumeTracing.tracingId,
    runAxisForPlane(viewport),
  );

  if (wroteVoxelsBox != null) {
    wroteVoxelsBox.value = voxels > 0 || wroteVoxelsBox.value;
  }
}

export function* createSectionLabeler(
  volumeTracing: VolumeTracing,
  planeId: OrthoView,
  labeledMags: Vector3,
  getThirdDimValue: (thirdDim: number) => number,
): Saga<SectionLabeler | TransformedSectionLabeler> {
  const dataset = yield* select((state) => state.dataset);
  const datasetConfiguration = yield* select((state) => state.datasetConfiguration);

  const { nativelyRenderedLayerName } = datasetConfiguration;
  const layer = getLayerByName(dataset, volumeTracing.tracingId);
  const segmentationTransforms = getTransformsForLayer(dataset, layer, nativelyRenderedLayerName);

  return new TransformedSectionLabeler(
    volumeTracing.tracingId,
    planeId,
    getThirdDimValue,
    labeledMags,
    segmentationTransforms,
  );
}
