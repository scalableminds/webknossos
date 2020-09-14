// @flow
import _ from "lodash";

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
  getRotation,
  getCurrentResolution,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
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
import api from "oxalis/api/internal_api";
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
      const currentResolution = yield* select(state => getCurrentResolution(state));
      yield* call(
        labelWithIterator,
        currentLayer.getCircleVoxelIterator(
          startEditingAction.position,
          currentResolution,
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
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
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
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
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

  const segmentationLayer = yield* call([Model, Model.getSegmentationLayer]);
  const { cube } = segmentationLayer;
  const activeZoomStep = yield* select(state => getRequestLogZoomStep(state));
  const allResolutions = yield* select(state => getResolutions(state.dataset));
  const dimensionIndices = Dimensions.getIndices(activeViewport);
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    activeViewport,
  );

  const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
  const labeledVoxelMapOfCopiedVoxel: LabeledVoxelsMap = new Map();

  function copyVoxelLabel(voxelTemplateAddress, voxelTargetAddress) {
    const templateLabelValue = segmentationLayer.cube.getDataValue(voxelTemplateAddress);

    // Only copy voxels from the previous layer which belong to the current cell
    if (templateLabelValue === activeCellId) {
      const currentLabelValue = segmentationLayer.cube.getDataValue(voxelTargetAddress);

      // Do not overwrite already labelled voxels
      if (currentLabelValue === 0) {
        console.log(
          `labeling at ${voxelTargetAddress.toString()} with ${templateLabelValue} in zoomStep ${activeZoomStep}`,
        );
        api.data.labelVoxels([voxelTargetAddress], templateLabelValue, activeZoomStep);
        const bucket = cube.getBucket(
          cube.positionToZoomedAddress(voxelTargetAddress, activeZoomStep),
        );
        if (bucket.type === "null") {
          return;
        }
        const labeledVoxelInBucket = cube.getVoxelOffset(voxelTargetAddress, activeZoomStep);
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
    activeZoomStep,
    dimensionIndices,
    allResolutions,
    cube,
    activeCellId,
    z,
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
    const allResolutions = yield* select(state => getResolutions(state.dataset));
    const activeResolution = allResolutions[activeZoomStep];
    // The floodfill and applyVoxelMap methods of iterates within the bucket.
    // Thus thirdDimensionValue must also be within the initial bucket in the correct resolution.
    const thirdDimensionValue =
      Math.floor(seedVoxel[dimensionIndices[2]] / activeResolution[dimensionIndices[2]]) %
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
      activeZoomStep,
    );
    if (labeledVoxelMapFromFloodFill == null) {
      continue;
    }
    applyLabeledVoxelMapToAllMissingResolutions(
      labeledVoxelMapFromFloodFill,
      activeZoomStep,
      dimensionIndices,
      allResolutions,
      cube,
      activeCellId,
      seedVoxel[dimensionIndices[2]],
    );
    yield* put(finishAnnotationStrokeAction());
    cube.triggerPushQueue();
  }
}

function applyLabeledVoxelMapToAllMissingResolutions(
  labeledVoxelMapToApply: LabeledVoxelsMap,
  activeZoomStep: number,
  dimensionIndices: DimensionMap,
  allResolutions: Array<Vector3>,
  segmentationCube: DataCube,
  cellId: number,
  thirdDimensionOfSlice: number,
): void {
  let currentLabeledVoxelMap: LabeledVoxelsMap = labeledVoxelMapToApply;
  let thirdDimensionValue = thirdDimensionOfSlice;
  const get3DAddress = (voxel: Vector2) => {
    const unorderedVoxelWithThirdDimension = [voxel[0], voxel[1], thirdDimensionValue];
    const orderedVoxelWithThirdDimension = [
      unorderedVoxelWithThirdDimension[dimensionIndices[0]],
      unorderedVoxelWithThirdDimension[dimensionIndices[1]],
      unorderedVoxelWithThirdDimension[dimensionIndices[2]],
    ];
    return orderedVoxelWithThirdDimension;
  };
  // debugger;
  // First upscale the voxel map and apply it to all higher resolutions.
  for (let zoomStep = activeZoomStep - 1; zoomStep >= 0; zoomStep--) {
    const goalResolution = allResolutions[zoomStep];
    const sourceResolution = allResolutions[zoomStep + 1];
    currentLabeledVoxelMap = sampleVoxelMapToResolution(
      currentLabeledVoxelMap,
      segmentationCube,
      sourceResolution,
      zoomStep + 1,
      goalResolution,
      zoomStep,
      dimensionIndices,
      thirdDimensionOfSlice,
    );
    // Adjust thirdDimensionValue so get3DAddress returns the third dimension value
    // in the goal resolution to apply the voxelMap correctly.
    thirdDimensionValue =
      Math.floor(thirdDimensionOfSlice / goalResolution[dimensionIndices[2]]) %
      Constants.BUCKET_WIDTH;
    applyVoxelMap(currentLabeledVoxelMap, segmentationCube, cellId, get3DAddress);
  }
  currentLabeledVoxelMap = labeledVoxelMapToApply;
  // Next we downscale the annotation and apply it.
  for (let zoomStep = activeZoomStep + 1; zoomStep < allResolutions.length; zoomStep++) {
    const goalResolution = allResolutions[zoomStep];
    const sourceResolution = allResolutions[zoomStep - 1];
    currentLabeledVoxelMap = sampleVoxelMapToResolution(
      currentLabeledVoxelMap,
      segmentationCube,
      sourceResolution,
      zoomStep - 1,
      goalResolution,
      zoomStep,
      dimensionIndices,
      thirdDimensionOfSlice,
    );
    // Adjust thirdDimensionValue so get3DAddress returns the third dimension value
    // in the goal resolution to apply the voxelMap correctly.
    thirdDimensionValue =
      Math.floor(thirdDimensionOfSlice / goalResolution[dimensionIndices[2]]) %
      Constants.BUCKET_WIDTH;
    applyVoxelMap(currentLabeledVoxelMap, segmentationCube, cellId, get3DAddress);
  }
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
    const isResolutionToLowForTraceTool = yield* select(state =>
      isVolumeTraceToolDisallowed(state),
    );
    const isTraceToolActive = yield* select(
      state => enforceVolumeTracing(state.tracing).activeTool === VolumeToolEnum.TRACE,
    );
    if (isResolutionToLowForTraceTool && isTraceToolActive) {
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
