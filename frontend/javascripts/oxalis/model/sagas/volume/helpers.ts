import { V3 } from "libs/mjs";
import Constants, {
  type ContourMode,
  ContourModeEnum,
  type LabeledVoxelsMap,
  type OrthoView,
  type OverwriteMode,
  OverwriteModeEnum,
  type Vector2,
  type Vector3,
} from "oxalis/constants";
import { getDatasetBoundingBox, getMagInfo } from "oxalis/model/accessors/dataset_accessor";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { enforceActiveVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Dimensions, { type DimensionMap } from "oxalis/model/dimensions";
import type { MagInfo } from "oxalis/model/helpers/mag_info";
import { zoomedPositionToZoomedAddress } from "oxalis/model/helpers/position_converter";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { getHalfViewportExtentsInVx } from "oxalis/model/sagas/saga_selectors";
import sampleVoxelMapToMagnification, {
  applyVoxelMap,
} from "oxalis/model/volumetracing/volume_annotation_sampling";
import VolumeLayer, { type VoxelBuffer2D } from "oxalis/model/volumetracing/volumelayer";
import { Model } from "oxalis/singletons";
import type { BoundingBoxObject, VolumeTracing } from "oxalis/store";
import { call } from "typed-redux-saga";

function* pairwise<T>(arr: Array<T>): Generator<[T, T], any, any> {
  for (let i = 0; i < arr.length - 1; i++) {
    yield [arr[i], arr[i + 1]];
  }
}

export type BooleanBox = {
  value: boolean;
};

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

  const datasetBoundingBox = yield* select((state) => getDatasetBoundingBox(state.dataset));
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
  segmentId: number,
  thirdDimensionOfSlice: number, // this value is specified in global (mag1) coords
  // If shouldOverwrite is false, a voxel is only overwritten if
  // its old value is equal to overwritableValue.
  shouldOverwrite: boolean,
  overwritableValue: number = 0,
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

export function* labelWithVoxelBuffer2D(
  voxelBuffer: VoxelBuffer2D,
  contourTracingMode: ContourMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
  viewport: OrthoView,
  wroteVoxelsBox?: BooleanBox,
): Saga<void> {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  if (!allowUpdate) return;
  if (voxelBuffer.isEmpty()) return;
  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const activeCellId = volumeTracing.activeCellId;
  const segmentationLayer = yield* call(
    [Model, Model.getSegmentationTracingLayer],
    volumeTracing.tracingId,
  );
  const { cube } = segmentationLayer;
  const currentLabeledVoxelMap: LabeledVoxelsMap = new Map();
  const dimensionIndices = Dimensions.getIndices(viewport);
  const magInfo = yield* call(getMagInfo, segmentationLayer.mags);
  const labeledMag = magInfo.getMagByIndexOrThrow(labeledZoomStep);

  const get3DCoordinateFromLocal2D = ([x, y]: Vector2) =>
    voxelBuffer.get3DCoordinate([x + voxelBuffer.minCoord2d[0], y + voxelBuffer.minCoord2d[1]]);

  const topLeft3DCoord = get3DCoordinateFromLocal2D([0, 0]);
  const bottomRight3DCoord = get3DCoordinateFromLocal2D([voxelBuffer.width, voxelBuffer.height]);
  // Since the bottomRight3DCoord is exclusive for the described bounding box,
  // the third dimension has to be increased by one (otherwise, the volume of the bounding
  // box would be empty)
  bottomRight3DCoord[dimensionIndices[2]]++;
  const outerBoundingBox = new BoundingBox({
    min: topLeft3DCoord,
    max: bottomRight3DCoord,
  });
  for (const boundingBoxChunk of outerBoundingBox.chunkIntoBuckets()) {
    const { min, max } = boundingBoxChunk;
    const bucketZoomedAddress = zoomedPositionToZoomedAddress(
      min,
      labeledZoomStep,
      additionalCoordinates,
    );

    if (currentLabeledVoxelMap.get(bucketZoomedAddress)) {
      throw new Error("When iterating over the buckets, we shouldn't visit the same bucket twice");
    }

    const labelMapOfBucket = new Uint8Array(Constants.BUCKET_WIDTH ** 2);
    currentLabeledVoxelMap.set(bucketZoomedAddress, labelMapOfBucket);

    // globalA (first dim) and globalB (second dim) are global coordinates
    // which can be used to index into the 2D slice of the VoxelBuffer2D (when subtracting the minCoord2d)
    // and the LabeledVoxelMap
    for (let globalA = min[dimensionIndices[0]]; globalA < max[dimensionIndices[0]]; globalA++) {
      for (let globalB = min[dimensionIndices[1]]; globalB < max[dimensionIndices[1]]; globalB++) {
        if (
          voxelBuffer.map[
            voxelBuffer.linearizeIndex(
              globalA - voxelBuffer.minCoord2d[0],
              globalB - voxelBuffer.minCoord2d[1],
            )
          ]
        ) {
          labelMapOfBucket[
            (globalA % Constants.BUCKET_WIDTH) * Constants.BUCKET_WIDTH +
              (globalB % Constants.BUCKET_WIDTH)
          ] = 1;
        }
      }
    }
  }

  const shouldOverwrite = overwriteMode === OverwriteModeEnum.OVERWRITE_ALL;
  // Since the LabeledVoxelMap is created in the current magnification,
  // we only need to annotate one slice in this mag.
  // `applyLabeledVoxelMapToAllMissingMags` will take care of
  // annotating multiple slices
  const numberOfSlices = 1;
  const thirdDim = dimensionIndices[2];
  const isDeleting = contourTracingMode === ContourModeEnum.DELETE;
  const newCellIdValue = isDeleting ? 0 : activeCellId;
  const overwritableValue = isDeleting ? activeCellId : 0;
  const wroteVoxels = applyVoxelMap(
    currentLabeledVoxelMap,
    cube,
    newCellIdValue,
    voxelBuffer.getFast3DCoordinate,
    numberOfSlices,
    thirdDim,
    shouldOverwrite,
    overwritableValue,
  );

  if (wroteVoxels) {
    // thirdDimensionOfSlice needs to be provided in global coordinates
    const thirdDimensionOfSlice =
      topLeft3DCoord[dimensionIndices[2]] * labeledMag[dimensionIndices[2]];
    applyLabeledVoxelMapToAllMissingMags(
      currentLabeledVoxelMap,
      labeledZoomStep,
      dimensionIndices,
      magInfo,
      cube,
      newCellIdValue,
      thirdDimensionOfSlice,
      shouldOverwrite,
      overwritableValue,
    );
  }

  if (wroteVoxelsBox != null) {
    wroteVoxelsBox.value = wroteVoxels || wroteVoxelsBox.value;
  }
}

export function* createVolumeLayer(
  volumeTracing: VolumeTracing,
  planeId: OrthoView,
  labeledMags: Vector3,
  thirdDimValue?: number,
): Saga<VolumeLayer> {
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  thirdDimValue = thirdDimValue ?? position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(volumeTracing.tracingId, planeId, thirdDimValue, labeledMags);
}
