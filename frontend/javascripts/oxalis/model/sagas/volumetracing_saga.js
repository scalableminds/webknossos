// @flow
import _ from "lodash";

import DataLayer from "oxalis/model/data_layer";
import {
  type CopySegmentationLayerAction,
  updateDirectionAction,
  setToolAction,
  finishAnnotationStrokeAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  type Saga,
  _take,
  _takeEvery,
  _takeLeading,
  call,
  fork,
  put,
  race,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import sampleVoxelMapToResolution, {
  applyVoxelMap,
} from "oxalis/model/volumetracing/volume_annotation_sampling";
import {
  type UpdateAction,
  updateVolumeTracing,
  updateUserBoundingBoxes,
  removeFallbackLayer,
} from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import type { VolumeTracing, Flycam } from "oxalis/store";
import {
  enforceVolumeTracing,
  isVolumeTraceToolDisallowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getPosition,
  getFlooredPosition,
  getRotation,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import {
  getResolutionInfoOfSegmentationLayer,
  ResolutionInfo,
  getRenderableResolutionForSegmentation,
} from "oxalis/model/accessors/dataset_accessor";
import Constants, {
  type BoundingBoxType,
  type ContourMode,
  type OverwriteMode,
  ContourModeEnum,
  OverwriteModeEnum,
  type OrthoView,
  type VolumeTool,
  type Vector2,
  type Vector3,
  VolumeToolEnum,
  type LabeledVoxelsMap,
} from "oxalis/constants";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import Dimensions, { type DimensionMap } from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Toast from "libs/toast";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import inferSegmentInViewport, {
  getHalfViewportExtents,
} from "oxalis/model/sagas/automatic_brush_saga";
import { zoomedPositionToZoomedAddress } from "oxalis/model/helpers/position_converter";

export function* watchVolumeTracingAsync(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("COPY_SEGMENTATION_LAYER", copySegmentationLayer);
  yield _takeLeading("INFER_SEGMENT_IN_VIEWPORT", inferSegmentInViewport);
  yield* fork(warnOfTooLowOpacity);
}

function* warnOfTooLowOpacity(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  if (yield* select(state => state.tracing.volume == null)) {
    return;
  }
  const segmentationLayerName = yield* call([Model, Model.getSegmentationLayerName]);
  if (!segmentationLayerName) {
    return;
  }
  const isOpacityTooLow = yield* select(
    state => state.datasetConfiguration.layers[segmentationLayerName].alpha < 10,
  );
  if (isOpacityTooLow) {
    Toast.warning(
      'Your setting for "segmentation opacity" is set very low.<br />Increase it for better visibility while volume tracing.',
    );
  }
}

export function* editVolumeLayerAsync(): Generator<any, any, any> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield* take("START_EDITING");
    if (startEditingAction.type !== "START_EDITING") {
      throw new Error("Unexpected action. Satisfy flow.");
    }
    const contourTracingMode = yield* select(
      state => enforceVolumeTracing(state.tracing).contourTracingMode,
    );
    const overwriteMode = yield* select(state => enforceVolumeTracing(state.tracing).overwriteMode);
    const isDrawing = contourTracingMode === ContourModeEnum.DRAW;

    const activeTool = yield* select(state => enforceVolumeTracing(state.tracing).activeTool);
    // The trace tool is not allowed for too high zoom steps.
    const isZoomStepTooHighForTraceTool = yield* select(isVolumeTraceToolDisallowed);
    if (isZoomStepTooHighForTraceTool && activeTool === VolumeToolEnum.TRACE) {
      continue;
    }

    const maybeLabeledResolutionWithZoomStep = yield* select(
      getRenderableResolutionForSegmentation,
    );
    if (!maybeLabeledResolutionWithZoomStep) {
      // Volume data is currently not rendered. Don't annotate anything.
      continue;
    }

    const {
      zoomStep: labeledZoomStep,
      resolution: labeledResolution,
    } = maybeLabeledResolutionWithZoomStep;
    const currentLayer = yield* call(
      createVolumeLayer,
      startEditingAction.planeId,
      labeledResolution,
    );

    const initialViewport = yield* select(state => state.viewModeData.plane.activeViewport);
    if (activeTool === VolumeToolEnum.BRUSH) {
      yield* call(
        labelWithVoxelBuffer2D,
        currentLayer.getCircleVoxelBuffer2D(startEditingAction.position),
        contourTracingMode,
        overwriteMode,
        labeledZoomStep,
      );
    }

    let lastPosition = startEditingAction.position;
    while (true) {
      const { addToLayerAction, finishEditingAction } = yield* race({
        addToLayerAction: _take("ADD_TO_LAYER"),
        finishEditingAction: _take("FINISH_EDITING"),
      });

      if (finishEditingAction) break;

      if (!addToLayerAction || addToLayerAction.type !== "ADD_TO_LAYER") {
        throw new Error("Unexpected action. Satisfy flow.");
      }
      const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
      if (initialViewport !== activeViewport) {
        // if the current viewport does not match the initial viewport -> dont draw
        continue;
      }
      if (
        activeTool === VolumeToolEnum.TRACE ||
        (activeTool === VolumeToolEnum.BRUSH && isDrawing)
      ) {
        currentLayer.addContour(addToLayerAction.position);
      }
      if (activeTool === VolumeToolEnum.BRUSH) {
        // Disable continuous drawing for performance reasons
        const rectangleVoxelBuffer2D = currentLayer.getRectangleVoxelBuffer2D(
          lastPosition,
          addToLayerAction.position,
        );
        if (rectangleVoxelBuffer2D) {
          yield* call(
            labelWithVoxelBuffer2D,
            rectangleVoxelBuffer2D,
            contourTracingMode,
            overwriteMode,
            labeledZoomStep,
          );
        }
        yield* call(
          labelWithVoxelBuffer2D,
          currentLayer.getCircleVoxelBuffer2D(addToLayerAction.position),
          contourTracingMode,
          overwriteMode,
          labeledZoomStep,
        );
      }
      lastPosition = addToLayerAction.position;
    }

    yield* call(
      finishLayer,
      currentLayer,
      activeTool,
      contourTracingMode,
      overwriteMode,
      labeledZoomStep,
    );
    yield* put(finishAnnotationStrokeAction());
  }
}

function* getBoundingsFromPosition(
  currentViewport: OrthoView,
  numberOfSlices: number,
): Saga<BoundingBoxType> {
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const halfViewportExtents = yield* call(getHalfViewportExtents, currentViewport);
  const halfViewportExtentsUVW = Dimensions.transDim([...halfViewportExtents, 0], currentViewport);
  const thirdDimension = Dimensions.thirdDimensionForPlane(currentViewport);
  const currentViewportBounding = {
    min: V3.sub(position, halfViewportExtentsUVW),
    max: V3.add(position, halfViewportExtentsUVW),
  };
  currentViewportBounding.max[thirdDimension] =
    currentViewportBounding.min[thirdDimension] + numberOfSlices;
  return currentViewportBounding;
}

function* createVolumeLayer(planeId: OrthoView, labeledResolution: Vector3): Saga<VolumeLayer> {
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];

  return new VolumeLayer(planeId, thirdDimValue, labeledResolution);
}

function* labelWithVoxelBuffer2D(
  voxelBuffer,
  contourTracingMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
  const segmentationLayer = yield* call([Model, Model.getSegmentationLayer]);
  const { cube } = segmentationLayer;

  const currentLabeledVoxelMap: LabeledVoxelsMap = new Map();

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  const dimensionIndices = Dimensions.getIndices(activeViewport);

  const resolutionInfo = yield* select(state =>
    getResolutionInfoOfSegmentationLayer(state.dataset),
  );
  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);

  const get3DCoordinateFromLocal2D = ([x, y]) =>
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

  const bucketBoundingBoxes = outerBoundingBox.chunkIntoBuckets();

  for (const boundingBoxChunk of bucketBoundingBoxes) {
    const { min, max } = boundingBoxChunk;
    const bucketZoomedAddress = zoomedPositionToZoomedAddress(min, labeledZoomStep);

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
  // `applyLabeledVoxelMapToAllMissingResolutions` will take care of
  // annotating multiple slices
  const numberOfSlices = 1;
  const thirdDim = dimensionIndices[2];

  const isDeleting = contourTracingMode === ContourModeEnum.DELETE;
  const newCellIdValue = isDeleting ? 0 : activeCellId;
  const overwritableValue = isDeleting ? activeCellId : 0;

  applyVoxelMap(
    currentLabeledVoxelMap,
    cube,
    newCellIdValue,
    voxelBuffer.getFast3DCoordinate,
    numberOfSlices,
    thirdDim,
    shouldOverwrite,
    overwritableValue,
  );

  // thirdDimensionOfSlice needs to be provided in global coordinates
  const thirdDimensionOfSlice =
    topLeft3DCoord[dimensionIndices[2]] * labeledResolution[dimensionIndices[2]];
  applyLabeledVoxelMapToAllMissingResolutions(
    currentLabeledVoxelMap,
    labeledZoomStep,
    dimensionIndices,
    resolutionInfo,
    cube,
    newCellIdValue,
    thirdDimensionOfSlice,
    shouldOverwrite,
    overwritableValue,
  );
}

function* copySegmentationLayer(action: CopySegmentationLayerAction): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  if (activeViewport === "TDView") {
    // Cannot copy labels from 3D view
    return;
  }

  // Disable copy-segmentation for the same zoom steps where the trace tool is forbidden, too,
  // to avoid large performance lags.
  // This restriction should be soften'ed when https://github.com/scalableminds/webknossos/issues/4639
  // is solved.
  const isResolutionTooLow = yield* select(state => isVolumeTraceToolDisallowed(state));
  if (isResolutionTooLow) {
    Toast.warning(
      'The "copy segmentation"-feature is not supported at this zoom level. Please zoom in further.',
    );
    return;
  }

  const segmentationLayer: DataLayer = yield* call([Model, Model.getSegmentationLayer]);
  const { cube } = segmentationLayer;
  const requestedZoomStep = yield* select(state => getRequestLogZoomStep(state));
  const resolutionInfo = yield* select(state =>
    getResolutionInfoOfSegmentationLayer(state.dataset),
  );
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);

  const dimensionIndices = Dimensions.getIndices(activeViewport);
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    activeViewport,
  );

  const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
  const labeledVoxelMapOfCopiedVoxel: LabeledVoxelsMap = new Map();

  function copyVoxelLabel(voxelTemplateAddress, voxelTargetAddress) {
    const templateLabelValue = cube.getDataValue(voxelTemplateAddress, null, labeledZoomStep);

    // Only copy voxels from the previous layer which belong to the current cell
    if (templateLabelValue === activeCellId) {
      const currentLabelValue = cube.getDataValue(voxelTargetAddress, null, labeledZoomStep);

      // Do not overwrite already labelled voxels
      if (currentLabelValue === 0) {
        cube.labelVoxelInResolution(voxelTargetAddress, templateLabelValue, labeledZoomStep);
        const bucket = cube.getOrCreateBucket(
          cube.positionToZoomedAddress(voxelTargetAddress, labeledZoomStep),
        );
        if (bucket.type === "null") {
          return;
        }
        const labeledVoxelInBucket = cube.getVoxelOffset(voxelTargetAddress, labeledZoomStep);
        const labelMapOfBucket =
          labeledVoxelMapOfCopiedVoxel.get(bucket.zoomedAddress) ||
          new Uint8Array(Constants.BUCKET_WIDTH ** 2).fill(0);
        const labeledVoxel2D = [
          labeledVoxelInBucket[dimensionIndices[0]],
          labeledVoxelInBucket[dimensionIndices[1]],
        ];
        labelMapOfBucket[labeledVoxel2D[0] * Constants.BUCKET_WIDTH + labeledVoxel2D[1]] = 1;
        labeledVoxelMapOfCopiedVoxel.set(bucket.zoomedAddress, labelMapOfBucket);
      }
    }
  }

  const directionInverter = action.source === "nextLayer" ? 1 : -1;
  let direction = 1;
  const useDynamicSpaceDirection = yield* select(
    state => state.userConfiguration.dynamicSpaceDirection,
  );
  if (useDynamicSpaceDirection) {
    const spaceDirectionOrtho = yield* select(state => state.flycam.spaceDirectionOrtho);
    direction = spaceDirectionOrtho[dimensionIndices[2]];
  }

  const [tx, ty, tz] = Dimensions.transDim(position, activeViewport);
  const z = tz;
  for (let x = tx - halfViewportExtentX; x < tx + halfViewportExtentX; x++) {
    for (let y = ty - halfViewportExtentY; y < ty + halfViewportExtentY; y++) {
      copyVoxelLabel(
        Dimensions.transDim([x, y, tz + direction * directionInverter], activeViewport),
        Dimensions.transDim([x, y, z], activeViewport),
      );
    }
  }
  applyLabeledVoxelMapToAllMissingResolutions(
    labeledVoxelMapOfCopiedVoxel,
    labeledZoomStep,
    dimensionIndices,
    resolutionInfo,
    cube,
    activeCellId,
    z,
    false,
  );
  yield* put(finishAnnotationStrokeAction());
}

export function* floodFill(): Saga<void> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const floodFillAction = yield* take("FLOOD_FILL");
    if (floodFillAction.type !== "FLOOD_FILL") {
      throw new Error("Unexpected action. Satisfy flow.");
    }
    const { position, planeId } = floodFillAction;
    const segmentationLayer = Model.getSegmentationLayer();
    const { cube } = segmentationLayer;
    const seedVoxel = Dimensions.roundCoordinate(position);
    const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
    const dimensionIndices = Dimensions.getIndices(planeId);
    const requestedZoomStep = yield* select(state => getRequestLogZoomStep(state));
    const resolutionInfo = yield* select(state =>
      getResolutionInfoOfSegmentationLayer(state.dataset),
    );
    const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);

    const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);
    // The floodfill and applyVoxelMap methods iterate within the bucket.
    // Thus thirdDimensionValue must also be within the initial bucket in the correct resolution.
    const thirdDimensionValue =
      Math.floor(seedVoxel[dimensionIndices[2]] / labeledResolution[dimensionIndices[2]]) %
      Constants.BUCKET_WIDTH;
    const get3DAddress = (voxel: Vector2) => {
      const unorderedVoxelWithThirdDimension = [voxel[0], voxel[1], thirdDimensionValue];
      const orderedVoxelWithThirdDimension = [
        unorderedVoxelWithThirdDimension[dimensionIndices[0]],
        unorderedVoxelWithThirdDimension[dimensionIndices[1]],
        unorderedVoxelWithThirdDimension[dimensionIndices[2]],
      ];
      return orderedVoxelWithThirdDimension;
    };
    const get2DAddress = (voxel: Vector3): Vector2 => [
      voxel[dimensionIndices[0]],
      voxel[dimensionIndices[1]],
    ];
    const currentViewportBounding = yield* call(getBoundingsFromPosition, planeId, 1);
    const labeledVoxelMapFromFloodFill = cube.floodFill(
      seedVoxel,
      activeCellId,
      get3DAddress,
      get2DAddress,
      dimensionIndices,
      currentViewportBounding,
      labeledZoomStep,
    );
    if (labeledVoxelMapFromFloodFill == null) {
      continue;
    }
    applyLabeledVoxelMapToAllMissingResolutions(
      labeledVoxelMapFromFloodFill,
      labeledZoomStep,
      dimensionIndices,
      resolutionInfo,
      cube,
      activeCellId,
      seedVoxel[dimensionIndices[2]],
      true,
    );
    yield* put(finishAnnotationStrokeAction());
    cube.triggerPushQueue();
  }
}

function* pairwise<T>(arr: Array<T>): Generator<[T, T], *, *> {
  for (let i = 0; i < arr.length - 1; i++) {
    yield [arr[i], arr[i + 1]];
  }
}

function applyLabeledVoxelMapToAllMissingResolutions(
  inputLabeledVoxelMap: LabeledVoxelsMap,
  labeledZoomStep: number,
  dimensionIndices: DimensionMap,
  resolutionInfo: ResolutionInfo,
  segmentationCube: DataCube,
  cellId: number,
  thirdDimensionOfSlice: number, // this value is specified in global (mag1) coords
  // if shouldOverwrite is false, a voxel is only overwritten if
  // its old value is equal to overwritableValue.
  shouldOverwrite: boolean,
  overwritableValue: number = 0,
): void {
  const thirdDim = dimensionIndices[2];

  // This function creates a `get3DAddress` function which maps from
  // a 2D vector address to the corresponding 3D vector address.
  // The input address is local to a slice in the LabeledVoxelsMap (that's
  // why it's 2D). The output address is local to the corresponding bucket.
  const get3DAddressCreator = (targetResolution: Vector3) => {
    const sampledThirdDimensionValue =
      Math.floor(thirdDimensionOfSlice / targetResolution[thirdDim]) % Constants.BUCKET_WIDTH;

    return (x: number, y: number, out: Vector3 | Float32Array) => {
      out[dimensionIndices[0]] = x;
      out[dimensionIndices[1]] = y;
      out[dimensionIndices[2]] = sampledThirdDimensionValue;
    };
  };

  // Get all available resolutions and divide the list into two parts.
  // The pivotIndex is the index within allResolutionsWithIndices which refers to
  // the labeled resolution.
  // `downsampleSequence` contains the current mag and all higher mags (to which
  // should be downsampled)
  // `upsampleSequence` contains the current mag and all lower mags (to which
  // should be upsampled)
  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);
  const allResolutionsWithIndices = resolutionInfo.getResolutionsWithIndices();
  const pivotIndex = allResolutionsWithIndices.findIndex(([index]) => index === labeledZoomStep);
  const downsampleSequence = allResolutionsWithIndices.slice(pivotIndex);
  const upsampleSequence = allResolutionsWithIndices.slice(0, pivotIndex + 1).reverse();

  // Given a sequence of resolutions, the inputLabeledVoxelMap is applied
  // over all these resolutions.
  function processSamplingSequence(samplingSequence, getNumberOfSlices) {
    // On each sampling step, a new LabeledVoxelMap is acquired
    // which is used as the input for the next down-/upsampling
    let currentLabeledVoxelMap: LabeledVoxelsMap = inputLabeledVoxelMap;

    for (const [source, target] of pairwise(samplingSequence)) {
      const [sourceZoomStep, sourceResolution] = source;
      const [targetZoomStep, targetResolution] = target;

      currentLabeledVoxelMap = sampleVoxelMapToResolution(
        currentLabeledVoxelMap,
        segmentationCube,
        sourceResolution,
        sourceZoomStep,
        targetResolution,
        targetZoomStep,
        dimensionIndices,
        thirdDimensionOfSlice,
      );

      const numberOfSlices = getNumberOfSlices(targetResolution);
      applyVoxelMap(
        currentLabeledVoxelMap,
        segmentationCube,
        cellId,
        get3DAddressCreator(targetResolution),
        numberOfSlices,
        thirdDim,
        shouldOverwrite,
        overwritableValue,
      );
    }
  }

  // First upsample the voxel map and apply it to all better resolutions.
  // sourceZoomStep will be higher than targetZoomStep
  processSamplingSequence(upsampleSequence, targetResolution =>
    Math.ceil(labeledResolution[thirdDim] / targetResolution[thirdDim]),
  );

  // Next we downsample the annotation and apply it.
  // sourceZoomStep will be lower than targetZoomStep
  processSamplingSequence(downsampleSequence, _targetResolution => 1);
}

export function* finishLayer(
  layer: VolumeLayer,
  activeTool: VolumeTool,
  contourTracingMode: ContourMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
): Saga<void> {
  if (layer == null || layer.isEmpty()) {
    return;
  }

  if (activeTool === VolumeToolEnum.TRACE || activeTool === VolumeToolEnum.BRUSH) {
    yield* call(
      labelWithVoxelBuffer2D,
      layer.getFillingVoxelBuffer2D(activeTool),
      contourTracingMode,
      overwriteMode,
      labeledZoomStep,
    );
  }

  yield* put(updateDirectionAction(layer.getUnzoomedCentroid()));
}

export function* ensureNoTraceToolInLowResolutions(): Saga<*> {
  yield* take("INITIALIZE_VOLUMETRACING");
  while (true) {
    yield* take(["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP"]);
    const isResolutionTooLowForTraceTool = yield* select(state =>
      isVolumeTraceToolDisallowed(state),
    );
    const isTraceToolActive = yield* select(
      state => enforceVolumeTracing(state.tracing).activeTool === VolumeToolEnum.TRACE,
    );
    if (isResolutionTooLowForTraceTool && isTraceToolActive) {
      yield* put(setToolAction(VolumeToolEnum.MOVE));
    }
  }
}

function updateTracingPredicate(
  prevVolumeTracing: VolumeTracing,
  volumeTracing: VolumeTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): boolean {
  return (
    prevVolumeTracing.activeCellId !== volumeTracing.activeCellId ||
    prevVolumeTracing.maxCellId !== volumeTracing.maxCellId ||
    prevFlycam !== flycam
  );
}

export function* diffVolumeTracing(
  prevVolumeTracing: VolumeTracing,
  volumeTracing: VolumeTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): Generator<UpdateAction, void, void> {
  if (updateTracingPredicate(prevVolumeTracing, volumeTracing, prevFlycam, flycam)) {
    yield updateVolumeTracing(
      volumeTracing,
      V3.floor(getPosition(flycam)),
      getRotation(flycam),
      flycam.zoomStep,
    );
  }
  if (!_.isEqual(prevVolumeTracing.userBoundingBoxes, volumeTracing.userBoundingBoxes)) {
    yield updateUserBoundingBoxes(volumeTracing.userBoundingBoxes);
  }
  if (prevVolumeTracing.fallbackLayer != null && volumeTracing.fallbackLayer == null) {
    yield removeFallbackLayer();
  }
}
