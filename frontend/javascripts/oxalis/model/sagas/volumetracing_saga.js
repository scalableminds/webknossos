// @flow
import _ from "lodash";

import DataLayer from "oxalis/model/data_layer";
import {
  type CopySegmentationLayerAction,
  resetContourAction,
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
  getNumberOfSlicesForResolution,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getPosition,
  getFlooredPosition,
  getRotation,
  getCurrentResolution,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import {
  getResolutionInfoOfSegmentationLayer,
  ResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import Constants, {
  type BoundingBoxType,
  type ContourMode,
  ContourModeEnum,
  type OrthoView,
  type VolumeTool,
  type Vector2,
  type Vector3,
  VolumeToolEnum,
  type LabeledVoxelsMap,
} from "oxalis/constants";
import Dimensions, { type DimensionMap } from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Toast from "libs/toast";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import inferSegmentInViewport, {
  getHalfViewportExtents,
} from "oxalis/model/sagas/automatic_brush_saga";

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
    const isDrawing =
      contourTracingMode === ContourModeEnum.DRAW_OVERWRITE ||
      contourTracingMode === ContourModeEnum.DRAW;

    const activeTool = yield* select(state => enforceVolumeTracing(state.tracing).activeTool);
    // The trace tool is not allowed for too high zoom steps.
    const isZoomStepTooHighForTraceTool = yield* select(isVolumeTraceToolDisallowed);
    if (isZoomStepTooHighForTraceTool && activeTool === VolumeToolEnum.TRACE) {
      continue;
    }
    const currentLayer = yield* call(createVolumeLayer, startEditingAction.planeId);

    const initialViewport = yield* select(state => state.viewModeData.plane.activeViewport);
    let activeResolution = yield* select(state => getCurrentResolution(state));
    let numberOfSlices = getNumberOfSlicesForResolution(activeResolution, initialViewport);
    const activeViewportBounding = yield* call(
      getBoundingsFromPosition,
      initialViewport,
      numberOfSlices,
    );
    if (activeTool === VolumeToolEnum.BRUSH) {
      yield* call(
        labelWithIterator,
        currentLayer.getCircleVoxelIterator(
          startEditingAction.position,
          activeResolution,
          activeViewportBounding,
        ),
        contourTracingMode,
      );
    }

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
        activeResolution = yield* select(state => getCurrentResolution(state));
        numberOfSlices = getNumberOfSlicesForResolution(activeResolution, initialViewport);
        const currentViewportBounding = yield* call(
          getBoundingsFromPosition,
          activeViewport,
          numberOfSlices,
        );
        yield* call(
          labelWithIterator,
          currentLayer.getCircleVoxelIterator(
            addToLayerAction.position,
            activeResolution,
            currentViewportBounding,
          ),
          contourTracingMode,
        );
      }
    }

    yield* call(finishLayer, currentLayer, activeTool, contourTracingMode);
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

function* createVolumeLayer(planeId: OrthoView): Saga<VolumeLayer> {
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(planeId, thirdDimValue);
}

function* labelWithIterator(iterator, contourTracingMode): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
  const segmentationLayer = yield* call([Model, Model.getSegmentationLayer]);
  const { cube } = segmentationLayer;
  switch (contourTracingMode) {
    case ContourModeEnum.DRAW_OVERWRITE:
      yield* call([cube, cube.labelVoxelsInAllResolutions], iterator, activeCellId);
      break;
    case ContourModeEnum.DRAW:
      yield* call([cube, cube.labelVoxelsInAllResolutions], iterator, activeCellId, 0);
      break;
    case ContourModeEnum.DELETE_FROM_ACTIVE_CELL:
      yield* call([cube, cube.labelVoxelsInAllResolutions], iterator, 0, activeCellId);
      break;
    case ContourModeEnum.DELETE_FROM_ANY_CELL:
      yield* call([cube, cube.labelVoxelsInAllResolutions], iterator, 0);
      break;
    default:
      throw new Error("Invalid volume tracing mode.");
  }
}

function* copySegmentationLayer(action: CopySegmentationLayerAction): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  if (activeViewport === "TDView") {
    // Cannot copy labels from 3D view
    return;
  }

  const segmentationLayer: DataLayer = yield* call([Model, Model.getSegmentationLayer]);
  const { cube } = segmentationLayer;
  const activeZoomStep = yield* select(state => getRequestLogZoomStep(state));
  const resolutionInfo = yield* select(state =>
    getResolutionInfoOfSegmentationLayer(state.dataset),
  );
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(activeZoomStep);

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
        const bucket = cube.getBucket(
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
    const activeZoomStep = yield* select(state => getRequestLogZoomStep(state));
    const resolutionInfo = yield* select(state =>
      getResolutionInfoOfSegmentationLayer(state.dataset),
    );
    const labeledZoomStep = resolutionInfo.getClosestExistingIndex(activeZoomStep);

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
  shouldOverwrite: boolean,
): void {
  const thirdDim = dimensionIndices[2];

  // This function creates a `get3DAddress` function which maps from
  // a 2D vector address to the corresponding 3D vector address.
  // The input address is local to a slice in the LabeledVoxelsMap (that's
  // why it's 2D). The output address is local to the corresponding bucket.
  const get3DAddressCreator = (targetResolution: Vector3) => {
    const sampledThirdDimensionValue =
      Math.floor(thirdDimensionOfSlice / targetResolution[thirdDim]) % Constants.BUCKET_WIDTH;

    return (voxel: Vector2) => {
      const unorderedVoxelWithThirdDimension = [voxel[0], voxel[1], sampledThirdDimensionValue];
      const orderedVoxelWithThirdDimension = Dimensions.transDimWithIndices(
        unorderedVoxelWithThirdDimension,
        dimensionIndices,
      );
      return orderedVoxelWithThirdDimension;
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
): Saga<void> {
  if (layer == null || layer.isEmpty()) {
    return;
  }

  if (activeTool === VolumeToolEnum.TRACE || activeTool === VolumeToolEnum.BRUSH) {
    const currentResolution = yield* select(state => getCurrentResolution(state));
    yield* call(
      labelWithIterator,
      layer.getVoxelIterator(activeTool, currentResolution),
      contourTracingMode,
    );
  }

  yield* put(updateDirectionAction(layer.getCentroid()));
  yield* put(resetContourAction());
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
