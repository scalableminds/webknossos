// @flow

import { message } from "antd";
import React from "react";
import _ from "lodash";

import { CONTOUR_COLOR_DELETE, CONTOUR_COLOR_NORMAL } from "oxalis/geometries/contourgeometry";
import {
  type CopySegmentationLayerAction,
  updateDirectionAction,
  updateSegmentAction,
  finishAnnotationStrokeAction,
  type SetActiveCellAction,
  type ClickSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  ResolutionInfo,
  getBoundaries,
  getResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  type Saga,
  _takeEvery,
  _takeLatest,
  _takeLeading,
  call,
  fork,
  put,
  select,
  take,
  _actionChannel,
} from "oxalis/model/sagas/effect-generators";
import {
  type UpdateAction,
  updateVolumeTracing,
  updateUserBoundingBoxes,
  createSegmentVolumeAction,
  updateSegmentVolumeAction,
  deleteSegmentVolumeAction,
  removeFallbackLayer,
} from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import type { VolumeTracing, Flycam, SegmentMap } from "oxalis/store";
import {
  addUserBoundingBoxAction,
  type AddIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
import { calculateMaybeGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { diffDiffableMaps } from "libs/diffable_map";
import { disableSavingAction } from "oxalis/model/actions/save_actions";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracing,
  getRenderableResolutionForSegmentationTracing,
  getRequestedOrVisibleSegmentationLayer,
  getSegmentsForLayer,
  isVolumeAnnotationDisallowedForZoom,
  getActiveSegmentationTracingLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import { getBBoxNameForPartialFloodfill } from "oxalis/view/right-border-tabs/bounding_box_tab";
import {
  getPosition,
  getFlooredPosition,
  getRotation,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import {
  isVolumeDrawingTool,
  isBrushTool,
  isTraceTool,
} from "oxalis/model/accessors/tool_accessor";
import { setToolAction, setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import {
  updateTemporarySettingAction,
  type UpdateTemporarySettingAction,
} from "oxalis/model/actions/settings_actions";
import { zoomedPositionToZoomedAddress } from "oxalis/model/helpers/position_converter";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import Constants, {
  OrthoViews,
  Unicode,
  type BoundingBoxType,
  type ContourMode,
  type OverwriteMode,
  ContourModeEnum,
  OverwriteModeEnum,
  type OrthoView,
  type AnnotationTool,
  type Vector3,
  AnnotationToolEnum,
  type LabeledVoxelsMap,
  FillModeEnum,
} from "oxalis/constants";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import DataLayer from "oxalis/model/data_layer";
import Dimensions, { type DimensionMap } from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import api from "oxalis/api/internal_api";
import createProgressCallback from "libs/progress_callback";
import getSceneController from "oxalis/controller/scene_controller_provider";
import inferSegmentInViewport, {
  getHalfViewportExtents,
} from "oxalis/model/sagas/automatic_brush_saga";
import sampleVoxelMapToResolution, {
  applyVoxelMap,
} from "oxalis/model/volumetracing/volume_annotation_sampling";

export function* watchVolumeTracingAsync(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("COPY_SEGMENTATION_LAYER", copySegmentationLayer);
  yield _takeLeading("INFER_SEGMENT_IN_VIEWPORT", inferSegmentInViewport);
  yield* fork(warnOfTooLowOpacity);
}

function* warnOfTooLowOpacity(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  if (yield* select(state => state.tracing.volumes.length === 0)) {
    return;
  }
  const segmentationLayer = yield* call([Model, Model.getVisibleSegmentationLayer]);
  if (!segmentationLayer) {
    return;
  }
  const isOpacityTooLow = yield* select(
    state => state.datasetConfiguration.layers[segmentationLayer.name].alpha < 10,
  );
  if (isOpacityTooLow) {
    Toast.warning(
      'Your setting for "segmentation opacity" is set very low.<br />Increase it for better visibility while volume tracing.',
    );
  }
}

export function* editVolumeLayerAsync(): Saga<any> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield* take("START_EDITING");
    if (startEditingAction.type !== "START_EDITING") {
      throw new Error("Unexpected action. Satisfy flow.");
    }
    const volumeTracing = yield* select(enforceActiveVolumeTracing);
    const contourTracingMode = volumeTracing.contourTracingMode;
    const overwriteMode = yield* select(state => state.userConfiguration.overwriteMode);
    const isDrawing = contourTracingMode === ContourModeEnum.DRAW;

    const activeTool = yield* select(state => state.uiInformation.activeTool);
    // Depending on the tool, annotation in higher zoom steps might be disallowed.
    const isZoomStepTooHighForAnnotating = yield* select(state =>
      isVolumeAnnotationDisallowedForZoom(activeTool, state),
    );
    if (isZoomStepTooHighForAnnotating) {
      continue;
    }

    const maybeLabeledResolutionWithZoomStep = yield* select(state =>
      getRenderableResolutionForSegmentationTracing(state, volumeTracing),
    );
    if (!maybeLabeledResolutionWithZoomStep) {
      // Volume data is currently not rendered. Don't annotate anything.
      continue;
    }
    const activeCellId = yield* select(state => enforceActiveVolumeTracing(state).activeCellId);
    yield* put(
      updateSegmentAction(
        activeCellId,
        { somePosition: startEditingAction.position },
        volumeTracing.tracingId,
      ),
    );

    const {
      zoomStep: labeledZoomStep,
      resolution: labeledResolution,
    } = maybeLabeledResolutionWithZoomStep;
    const currentLayer = yield* call(
      createVolumeLayer,
      volumeTracing,
      startEditingAction.planeId,
      labeledResolution,
    );

    const initialViewport = yield* select(state => state.viewModeData.plane.activeViewport);
    if (isBrushTool(activeTool)) {
      yield* call(
        labelWithVoxelBuffer2D,
        currentLayer.getCircleVoxelBuffer2D(startEditingAction.position),
        contourTracingMode,
        overwriteMode,
        labeledZoomStep,
      );
    }

    let lastPosition = startEditingAction.position;

    const actionChannel = yield _actionChannel(["ADD_TO_LAYER", "FINISH_EDITING"]);
    while (true) {
      const currentAction = yield* take(actionChannel);
      const { addToLayerAction, finishEditingAction } = {
        addToLayerAction: currentAction.type === "ADD_TO_LAYER" ? currentAction : null,
        finishEditingAction: currentAction.type === "FINISH_EDITING" ? currentAction : null,
      };

      if (finishEditingAction) break;

      if (!addToLayerAction || addToLayerAction.type !== "ADD_TO_LAYER") {
        throw new Error("Unexpected action. Satisfy flow.");
      }
      const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
      if (initialViewport !== activeViewport) {
        // if the current viewport does not match the initial viewport -> dont draw
        continue;
      }
      if (isTraceTool(activeTool) || (isBrushTool(activeTool) && isDrawing)) {
        // Close the polygon. When brushing, this causes an auto-fill which is why
        // it's only performed when drawing (not when erasing).
        currentLayer.addContour(addToLayerAction.position);
      }
      if (isBrushTool(activeTool)) {
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
    // Update the position of the current segment to the last position of the most recent annotation stroke.
    yield* put(
      updateSegmentAction(activeCellId, { somePosition: lastPosition }, volumeTracing.tracingId),
    );
    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
  }
}

function* getBoundingBoxForFloodFill(
  position: Vector3,
  currentViewport: OrthoView,
): Saga<BoundingBoxType> {
  const fillMode = yield* select(state => state.userConfiguration.fillMode);
  const halfBoundingBoxSizeUVW = V3.scale(Constants.FLOOD_FILL_EXTENTS[fillMode], 0.5);
  const currentViewportBounding = {
    min: V3.sub(position, halfBoundingBoxSizeUVW),
    max: V3.add(position, halfBoundingBoxSizeUVW),
  };

  if (fillMode === FillModeEnum._2D) {
    // Only use current plane
    const thirdDimension = Dimensions.thirdDimensionForPlane(currentViewport);
    const numberOfSlices = 1;
    currentViewportBounding.min[thirdDimension] = position[thirdDimension];
    currentViewportBounding.max[thirdDimension] = position[thirdDimension] + numberOfSlices;
  }

  const { lowerBoundary, upperBoundary } = yield* select(state => getBoundaries(state.dataset));
  const { min: clippedMin, max: clippedMax } = new BoundingBox(
    currentViewportBounding,
  ).intersectedWith(new BoundingBox({ min: lowerBoundary, max: upperBoundary }));

  return { min: clippedMin, max: clippedMax };
}

function* createVolumeLayer(
  volumeTracing: VolumeTracing,
  planeId: OrthoView,
  labeledResolution: Vector3,
): Saga<VolumeLayer> {
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];

  return new VolumeLayer(volumeTracing.tracingId, planeId, thirdDimValue, labeledResolution);
}

function* labelWithVoxelBuffer2D(
  voxelBuffer,
  contourTracingMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const activeCellId = volumeTracing.activeCellId;
  const segmentationLayer = yield* call(
    [Model, Model.getSegmentationTracingLayer],
    volumeTracing.tracingId,
  );
  const { cube } = segmentationLayer;

  const currentLabeledVoxelMap: LabeledVoxelsMap = new Map();

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  const dimensionIndices = Dimensions.getIndices(activeViewport);

  const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
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
  const isResolutionTooLow = yield* select(state =>
    isVolumeAnnotationDisallowedForZoom(AnnotationToolEnum.TRACE, state),
  );
  if (isResolutionTooLow) {
    Toast.warning(
      'The "copy segmentation"-feature is not supported at this zoom level. Please zoom in further.',
    );
    return;
  }

  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const segmentationLayer: DataLayer = yield* call(
    [Model, Model.getSegmentationTracingLayer],
    volumeTracing.tracingId,
  );
  const { cube } = segmentationLayer;
  const requestedZoomStep = yield* select(state => getRequestLogZoomStep(state));
  const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);

  const dimensionIndices = Dimensions.getIndices(activeViewport);
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    activeViewport,
  );

  const activeCellId = volumeTracing.activeCellId;
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
  yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
}

const FLOODFILL_PROGRESS_KEY = "FLOODFILL_PROGRESS_KEY";
export function* floodFill(): Saga<void> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const floodFillAction = yield* take("FLOOD_FILL");
    if (floodFillAction.type !== "FLOOD_FILL") {
      throw new Error("Unexpected action. Satisfy flow.");
    }

    const { position: positionFloat, planeId } = floodFillAction;
    const volumeTracing = yield* select(enforceActiveVolumeTracing);
    const segmentationLayer = yield* call(
      [Model, Model.getSegmentationTracingLayer],
      volumeTracing.tracingId,
    );
    const { cube } = segmentationLayer;
    const seedPosition = Dimensions.roundCoordinate(positionFloat);
    const activeCellId = volumeTracing.activeCellId;
    const dimensionIndices = Dimensions.getIndices(planeId);
    const requestedZoomStep = yield* select(state => getRequestLogZoomStep(state));
    const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
    const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
    const oldSegmentIdAtSeed = cube.getDataValue(seedPosition, null, labeledZoomStep);

    if (activeCellId === oldSegmentIdAtSeed) {
      Toast.warning("The clicked voxel's id is already equal to the active segment id.");
      continue;
    }

    const busyBlockingInfo = yield* select(state => state.uiInformation.busyBlockingInfo);
    if (busyBlockingInfo.isBusy) {
      console.warn(`Ignoring floodfill request (reason: ${busyBlockingInfo.reason || "unknown"})`);
      continue;
    }

    yield* put(setBusyBlockingInfoAction(true, "Floodfill is being computed."));

    const currentViewportBounding = yield* call(getBoundingBoxForFloodFill, seedPosition, planeId);

    const progressCallback = createProgressCallback({
      pauseDelay: 200,
      successMessageDelay: 2000,
      // Since only one floodfill operation can be active at any time,
      // a hardcoded key is sufficient.
      key: "FLOODFILL_PROGRESS_KEY",
    });
    yield* call(progressCallback, false, "Performing floodfill...");

    console.time("cube.floodFill");

    const fillMode = yield* select(state => state.userConfiguration.fillMode);
    const {
      bucketsWithLabeledVoxelsMap: labelMasksByBucketAndW,
      wasBoundingBoxExceeded,
      coveredBoundingBox,
    } = yield* call(
      [cube, cube.floodFill],
      seedPosition,
      activeCellId,
      dimensionIndices,
      currentViewportBounding,
      labeledZoomStep,
      progressCallback,
      fillMode === FillModeEnum._3D,
    );
    console.timeEnd("cube.floodFill");

    yield* call(progressCallback, false, "Finalizing floodfill...");

    const indexSet = new Set();
    for (const labelMaskByIndex of labelMasksByBucketAndW.values()) {
      for (const zIndex of labelMaskByIndex.keys()) {
        indexSet.add(zIndex);
      }
    }
    console.time("applyLabeledVoxelMapToAllMissingResolutions");
    for (const indexZ of indexSet) {
      const labeledVoxelMapFromFloodFill = new Map();
      for (const [bucketAddress, labelMaskByIndex] of labelMasksByBucketAndW.entries()) {
        const map = labelMaskByIndex.get(indexZ);
        if (map != null) {
          labeledVoxelMapFromFloodFill.set(bucketAddress, map);
        }
      }

      applyLabeledVoxelMapToAllMissingResolutions(
        labeledVoxelMapFromFloodFill,
        labeledZoomStep,
        dimensionIndices,
        resolutionInfo,
        cube,
        activeCellId,
        indexZ,
        true,
      );
    }
    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
    console.timeEnd("applyLabeledVoxelMapToAllMissingResolutions");

    if (wasBoundingBoxExceeded) {
      yield* call(
        progressCallback,
        true,
        <>
          Floodfill is done, but terminated since the labeled volume got too large. A bounding box
          <br />
          that represents the labeled volume was added.{Unicode.NonBreakingSpace}
          <a href="#" onClick={() => message.destroy(FLOODFILL_PROGRESS_KEY)}>
            Close
          </a>
        </>,
        {
          successMessageDelay: 10000,
        },
      );

      yield* put(
        addUserBoundingBoxAction({
          boundingBox: coveredBoundingBox,
          name: getBBoxNameForPartialFloodfill(oldSegmentIdAtSeed, activeCellId, seedPosition),
          color: Utils.getRandomColor(),
          isVisible: true,
        }),
      );
    } else {
      yield* call(progressCallback, true, "Floodfill done.");
    }

    cube.triggerPushQueue();
    yield* put(setBusyBlockingInfoAction(false));
    if (floodFillAction.callback != null) {
      floodFillAction.callback();
    }
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
  activeTool: AnnotationTool,
  contourTracingMode: ContourMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
): Saga<void> {
  if (layer == null || layer.isEmpty()) {
    return;
  }

  if (isVolumeDrawingTool(activeTool)) {
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

export function* ensureToolIsAllowedInResolution(): Saga<*> {
  yield* take("INITIALIZE_VOLUMETRACING");
  while (true) {
    yield* take(["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP"]);
    const isResolutionTooLow = yield* select(state => {
      const { activeTool } = state.uiInformation;
      return isVolumeAnnotationDisallowedForZoom(activeTool, state);
    });
    if (isResolutionTooLow) {
      yield* put(setToolAction(AnnotationToolEnum.MOVE));
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

export function* diffSegmentLists(
  prevSegments: SegmentMap,
  newSegments: SegmentMap,
): Generator<UpdateAction, void, void> {
  const {
    onlyA: deletedSegmentIds,
    onlyB: addedSegmentIds,
    changed: bothSegmentIds,
  } = diffDiffableMaps(prevSegments, newSegments);

  for (const segmentId of deletedSegmentIds) {
    yield deleteSegmentVolumeAction(segmentId);
  }
  for (const segmentId of addedSegmentIds) {
    const segment = newSegments.get(segmentId);
    yield createSegmentVolumeAction(segment.id, segment.somePosition, segment.name);
  }
  for (const segmentId of bothSegmentIds) {
    const segment = newSegments.get(segmentId);
    const prevSegment = prevSegments.get(segmentId);
    if (segment !== prevSegment) {
      yield updateSegmentVolumeAction(
        segment.id,
        segment.somePosition,
        segment.name,
        segment.creationTime,
      );
    }
  }
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

  if (prevVolumeTracing.segments !== volumeTracing.segments) {
    yield* diffSegmentLists(prevVolumeTracing.segments, volumeTracing.segments);
  }

  if (prevVolumeTracing.fallbackLayer != null && volumeTracing.fallbackLayer == null) {
    yield removeFallbackLayer();
  }
}

function* ensureSegmentExists(
  action:
    | AddIsosurfaceAction
    | SetActiveCellAction
    | UpdateTemporarySettingAction
    | ClickSegmentAction,
): Saga<void> {
  const layer = yield* select(store =>
    // $FlowIgnore[prop-missing] Yes, SetActiveCellAction does not have layerName, but getSegmentsForLayer accepts null
    getRequestedOrVisibleSegmentationLayer(store, action.layerName),
  );
  if (!layer) {
    return;
  }
  const layerName = layer.name;
  const segments = yield* select(store => getSegmentsForLayer(store, layerName));
  const cellId = action.type === "UPDATE_TEMPORARY_SETTING" ? action.value : action.cellId;
  if (cellId === 0 || cellId == null || segments == null || segments.getNullable(cellId) != null) {
    return;
  }

  if (action.type === "ADD_ISOSURFACE") {
    const { seedPosition } = action;
    yield* put(updateSegmentAction(cellId, { somePosition: seedPosition }, layerName));
  } else if (action.type === "SET_ACTIVE_CELL" || action.type === "CLICK_SEGMENT") {
    const { somePosition } = action;
    if (somePosition == null) {
      // Not all SetActiveCell provide a position (e.g., when simply setting the ID)
      // via the UI.
      return;
    }

    yield* put(updateSegmentAction(cellId, { somePosition }, layerName));
  } else if (action.type === "UPDATE_TEMPORARY_SETTING") {
    const globalMousePosition = yield* call(getGlobalMousePosition);
    if (globalMousePosition == null) {
      return;
    }
    yield* put(updateSegmentAction(cellId, { somePosition: globalMousePosition }, layerName));
  }
}

function* maintainSegmentsMap(): Saga<void> {
  yield _takeEvery(["ADD_ISOSURFACE", "SET_ACTIVE_CELL", "CLICK_SEGMENT"], ensureSegmentExists);
}

function* getGlobalMousePosition(): Saga<?Vector3> {
  return yield* select(state => {
    const mousePosition = state.temporaryConfiguration.mousePosition;
    if (mousePosition) {
      const [x, y] = mousePosition;
      return calculateMaybeGlobalPos(state, { x, y });
    }
    return undefined;
  });
}

function* updateHoveredSegmentId(): Saga<void> {
  const activeViewport = yield* select(store => store.viewModeData.plane.activeViewport);
  if (activeViewport === OrthoViews.TDView) {
    return;
  }

  const globalMousePosition = yield* call(getGlobalMousePosition);
  const hoveredCellInfo = yield* call([Model, Model.getHoveredCellId], globalMousePosition);
  const id = hoveredCellInfo != null ? hoveredCellInfo.id : 0;

  const oldHoveredSegmentId = yield* select(store => store.temporaryConfiguration.hoveredSegmentId);

  if (oldHoveredSegmentId !== id) {
    yield* put(updateTemporarySettingAction("hoveredSegmentId", id));
  }
}

export function* maintainHoveredSegmentId(): Saga<void> {
  yield _takeLatest("SET_MOUSE_POSITION", updateHoveredSegmentId);
}

//////////////////
const NEIGHBOR_LOOKUP = [[0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];

const neighborToIndex: Map<Array<number>, number> = new Map();

function buildNeighborToIndexMap() {
  let idx: number = 0;
  for (const neighbor of NEIGHBOR_LOOKUP) {
    neighborToIndex.set(neighbor, idx);

    idx++;
  }
}

buildNeighborToIndexMap();

const invertNeighborId = (neighborId: number) =>
  (neighborId + NEIGHBOR_LOOKUP.length / 2) % NEIGHBOR_LOOKUP.length;

function _getNeighborsFromBitMask(bitMask) {
  const neighbors = {
    ingoing: [],
    outgoing: [],
  };

  for (let neighborId = 0; neighborId < NEIGHBOR_LOOKUP.length; neighborId++) {
    if ((bitMask & (2 ** neighborId)) !== 0) {
      neighbors.outgoing.push(NEIGHBOR_LOOKUP[neighborId]);
    }
    if ((bitMask & (2 ** (neighborId + NEIGHBOR_LOOKUP.length))) !== 0) {
      neighbors.ingoing.push(NEIGHBOR_LOOKUP[neighborId]);
    }
  }

  return neighbors;
}

const getNeighborsFromBitMask = _.memoize(_getNeighborsFromBitMask);

function getNeighborId(neighbor) {
  const neighborId = neighborToIndex.get(neighbor);
  if (neighborId == null) {
    throw new Error("Could not look up neighbor");
  }
  return neighborId;
}

function addOutgoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] |= 2 ** neighborId;
}
function addIngoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] |= 2 ** (NEIGHBOR_LOOKUP.length + neighborId);
}
function removeIngoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] &= ~(2 ** (NEIGHBOR_LOOKUP.length + neighborId));
}
function removeOutgoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] &= ~(2 ** neighborId);
}

function* performMinCut(): Saga<void> {
  yield* put(disableSavingAction());

  const skeleton = yield* select(store => store.tracing.skeleton);
  if (!skeleton) {
    console.log("no skeleton");
    return;
  }
  const activeTree = Utils.toNullable(getActiveTree(skeleton));

  if (!activeTree) {
    console.log("no active tree");
    return;
  }

  const boundingBoxes = skeleton.userBoundingBoxes;
  if (boundingBoxes.length === 0) {
    console.log("no bounding box defined for min-cut");
    return;
  }

  const boundingBoxObj = boundingBoxes[0].boundingBox;
  const boundingBox = new BoundingBox(boundingBoxObj);

  const nodes = Array.from(activeTree.nodes.values());

  if (nodes.length < 2) {
    console.log("not enough seeds");
    return;
  }

  const globalSeedA = Utils.floor3(nodes[0].position);
  const globalSeedB = Utils.floor3(nodes[1].position);

  const MIN_DIST_TO_SEED = 30;

  if (V3.length(V3.sub(globalSeedA, globalSeedB)) < 2 * MIN_DIST_TO_SEED) {
    console.warn(`Nodes are closer than ${MIN_DIST_TO_SEED} vx apart.`);
  }

  const seedA = V3.sub(globalSeedA, boundingBox.min);
  const seedB = V3.sub(globalSeedB, boundingBox.min);

  const volumeTracingLayer = yield* select(store => getActiveSegmentationTracingLayer(store));
  if (!volumeTracingLayer) {
    console.log("no volumeTracing");
    return;
  }
  const inputData = yield* call(
    [api.data, api.data.getDataFor2DBoundingBox],
    volumeTracingLayer.name,
    boundingBox,
  );

  const size = boundingBox.getSize();
  const l = (x, y, z) => z * size[1] * size[0] + y * size[0] + x;
  const ll = ([x, y, z]) => z * size[1] * size[0] + y * size[0] + x;
  const edgeBuffer = new Uint16Array(boundingBox.getVolume()); // .fill(2 ** 12 - 1);

  if (inputData[ll(seedA)] !== inputData[ll(seedB)]) {
    console.warn("Given seeds are not placed on same segment");
    return;
  }

  const segmentId = inputData[ll(seedA)];

  console.time("populate data");
  for (let x = 0; x < size[0]; x++) {
    for (let y = 0; y < size[1]; y++) {
      for (let z = 0; z < size[2]; z++) {
        // Traverse over all voxels

        const pos = [x, y, z];
        const linIndex = l(x, y, z);

        // Ignore voxel if it does not belong to seed segment
        if (inputData[linIndex] !== segmentId) {
          continue;
        }

        // Go over all neighbors
        for (let neighborId = 0; neighborId < NEIGHBOR_LOOKUP.length; neighborId++) {
          const neighbor = NEIGHBOR_LOOKUP[neighborId];
          const neighborPos = V3.add(pos, neighbor);

          if (
            neighborPos[0] < 0 ||
            neighborPos[1] < 0 ||
            neighborPos[2] < 0 ||
            neighborPos[0] >= size[0] ||
            neighborPos[1] >= size[1] ||
            neighborPos[2] >= size[2]
          ) {
            // neighbor is outside of volume
            continue;
          }

          const neighborLinIndex = ll(neighborPos);
          if (inputData[neighborLinIndex] === segmentId) {
            addOutgoingEdge(edgeBuffer, linIndex, neighborId);
            addIngoingEdge(edgeBuffer, neighborLinIndex, invertNeighborId(neighborId));
          }
        }
      }
    }
  }
  console.timeEnd("populate data");

  const originalEdgeBuffer = new Uint16Array(edgeBuffer); // .fill(2 ** 12 - 1);

  // for (let y = 0; y < 4; y++) {
  //   for (let x = 0; x < 4; x++) {
  //     const neighbors = getNeighborsFromBitMask(edgeBuffer[l(x, y, 0)]);
  //     console.log({ x, y, neighbors });
  //   }
  // }

  function populateDistanceField() {
    // Breadth-first search from seedA to seedB
    const distanceField = new Uint16Array(boundingBox.getVolume());
    const directionField = new Uint8Array(boundingBox.getVolume()).fill(255);
    const queue: Array<{ voxel: Array<number>, distance: number, usedEdgeIdx: number }> = [
      { voxel: seedA, distance: 1, usedEdgeIdx: 255 },
    ];
    let foundTarget = false;
    while (queue.length > 0) {
      const { voxel: currVoxel, distance, usedEdgeIdx } = queue.shift();

      const currVoxelIdx = ll(currVoxel);
      if (distanceField[currVoxelIdx] > 0) {
        continue;
      }
      distanceField[currVoxelIdx] = distance;
      directionField[currVoxelIdx] = usedEdgeIdx;

      if (currVoxel[0] === seedB[0] && currVoxel[1] === seedB[1] && currVoxel[2] === seedB[2]) {
        console.log("found target seed");
        foundTarget = true;
        break;
      }

      const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).outgoing;

      for (const neighbor of neighbors) {
        const neighborPos = V3.add(currVoxel, neighbor);

        const neighborId = getNeighborId(neighbor);

        queue.push({ voxel: neighborPos, distance: distance + 1, usedEdgeIdx: neighborId });
      }
    }

    return { distanceField, directionField, foundTarget };
  }

  function removeShortestPath(distanceField: Uint16Array, directionField: Uint8Array) {
    // Extract path from seedB to seedA
    // and remove edges which belong to that path
    const path = [];
    let i = 0;
    let foundSeed = false;
    const voxelStack = [seedB];
    const maxDistance = distanceField[ll(seedB)];

    while (voxelStack.length > 0) {
      const currentVoxel = voxelStack.pop();
      if (i > 1000) {
        console.warn("loopBusted!");
        break;
      }
      i++;

      const currentDistance = distanceField[ll(currentVoxel)];

      if (
        currentVoxel[0] === seedA[0] &&
        currentVoxel[1] === seedA[1] &&
        currentVoxel[2] === seedA[2]
      ) {
        console.log("found target seed");
        foundSeed = true;
        break;
      }

      // Go over all neighbors
      // const neighbors = getNeighborsFromBitMask(edgeBuffer[ll(currentVoxel)]).ingoing;

      // console.log("ingoing edges", neighbors);

      const originallyUsedEdgeId = directionField[ll(currentVoxel)];
      if (originallyUsedEdgeId >= NEIGHBOR_LOOKUP.length) {
        throw new Error("Could not look up used edge in directionField");
      }
      const edgeId = invertNeighborId(originallyUsedEdgeId);
      const neighbor = NEIGHBOR_LOOKUP[edgeId];

      const neighborPos = V3.add(currentVoxel, neighbor);
      const neighborId = neighborToIndex.get(neighbor);

      if (neighborId == null) {
        throw new Error("Could not look up neighbor");
      }

      if (
        neighborPos[0] < 0 ||
        neighborPos[1] < 0 ||
        neighborPos[2] < 0 ||
        neighborPos[0] >= size[0] ||
        neighborPos[1] >= size[1] ||
        neighborPos[2] >= size[2]
      ) {
        throw new Error("neighbor is outside of volume ?");
      }

      if (
        !(distanceField[ll(neighborPos)] < currentDistance && distanceField[ll(neighborPos)] > 0)
      ) {
        throw new Error("direction points towards a higher distance?");
      }

      const currDist = distanceField[ll(neighborPos)];
      const distToSeed = Math.min(currDist, maxDistance - currDist);

      const ingoingNeighborsOld = getNeighborsFromBitMask(edgeBuffer[ll(currentVoxel)]).ingoing;

      if (distToSeed > MIN_DIST_TO_SEED) {
        path.unshift(neighborPos);

        // Remove ingoing
        // console.log("Before removing edge", edgeBuffer[ll(currentVoxel)].toString(2));

        removeIngoingEdge(edgeBuffer, ll(currentVoxel), neighborId);

        // console.log("After removing edge", edgeBuffer[ll(currentVoxel)].toString(2));

        const ingoingNeighbors = getNeighborsFromBitMask(edgeBuffer[ll(currentVoxel)]).ingoing;
        if (ingoingNeighborsOld.length - ingoingNeighbors.length !== 1) {
          console.log("didn't remove edge successfully");
          debugger;
        }

        // Remove outgoing
        const invertedNeighborId = invertNeighborId(neighborId);
        // console.log("Before removing edge", edgeBuffer[ll(neighborPos)].toString(2));

        removeOutgoingEdge(edgeBuffer, ll(neighborPos), invertedNeighborId);

        // console.log("After removing edge", edgeBuffer[ll(neighborPos)].toString(2));
      }

      voxelStack.push(neighborPos);
    }

    return { path, foundSeed };
  }

  function traverseResidualsField() {
    // Breadth-first search from seedA to seedB
    const visitedField = new Uint16Array(boundingBox.getVolume());
    const queue: Array<{ voxel: Array<number> }> = [{ voxel: seedA }];
    while (queue.length > 0) {
      const { voxel: currVoxel } = queue.shift();

      const currVoxelIdx = ll(currVoxel);
      if (visitedField[currVoxelIdx] > 0) {
        continue;
      }
      visitedField[currVoxelIdx] = 1;
      const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).outgoing;

      for (const neighbor of neighbors) {
        const neighborPos = V3.add(currVoxel, neighbor);

        queue.push({ voxel: neighborPos });
      }
    }

    // queue.push({ voxel: seedB });
    // while (queue.length > 0) {
    //   const { voxel: currVoxel } = queue.shift();

    //   const currVoxelIdx = ll(currVoxel);
    //   if (visitedField[currVoxelIdx] > 0) {
    //     continue;
    //   }
    //   visitedField[currVoxelIdx] = 1;
    //   const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).ingoing;

    //   for (const neighbor of neighbors) {
    //     const neighborPos = V3.add(currVoxel, neighbor);

    //     queue.push({ voxel: neighborPos });
    //   }
    // }

    return { visitedField };
  }

  console.time("find & delete paths");
  for (let loopBuster = 0; loopBuster < 2000; loopBuster++) {
    console.log("populate distance field", loopBuster);
    const { foundTarget, distanceField, directionField } = populateDistanceField();
    if (foundTarget) {
      removeShortestPath(distanceField, directionField);
      // console.log({ path });

      // for (const el of path) {
      //   api.data.labelVoxels([V3.add(boundingBox.min, el)], 0);
      // }
    } else {
      console.log("segmentation is partitioned");
      break;
    }

    if (loopBuster === 2000 - 1) {
      console.warn("loop busted");
    }
  }
  console.timeEnd("find & delete paths");

  console.time("traverseResidualsField");

  const { visitedField } = traverseResidualsField();
  console.timeEnd("traverseResidualsField");

  function labelDeletedEdges() {
    for (let x = 0; x < size[0]; x++) {
      for (let y = 0; y < size[1]; y++) {
        for (let z = 0; z < size[2]; z++) {
          const idx = l(x, y, z);
          if (visitedField[idx] === 1) {
            const neighbors = getNeighborsFromBitMask(originalEdgeBuffer[idx]).outgoing;
            const currentPos = [x, y, z];
            // api.data.labelVoxels([V3.add(boundingBox.min, currentPos)], 2);

            for (const neighbor of neighbors) {
              const neighborPos = V3.add(currentPos, neighbor);

              if (visitedField[ll(neighborPos)] === 0) {
                api.data.labelVoxels([V3.add(boundingBox.min, neighborPos)], 0);
              }
            }
          }
        }
      }
    }
  }
  console.time("labelDeletedEdges");
  labelDeletedEdges();
  console.timeEnd("labelDeletedEdges");
  console.log({ seedA, seedB, boundingBox, inputData, edgeBuffer });
}

export function* listenToMinCut(): Saga<void> {
  yield _takeEvery("PERFORM_MIN_CUT", performMinCut);
}

function* maintainContourGeometry(): Saga<void> {
  yield* take("SCENE_CONTROLLER_READY");
  const SceneController = yield* call(getSceneController);
  const { contour } = SceneController;

  while (true) {
    yield* take(["ADD_TO_LAYER", "RESET_CONTOUR"]);
    const isTraceToolActive = yield* select(state => isTraceTool(state.uiInformation.activeTool));
    const volumeTracing = yield* select(getActiveSegmentationTracing);
    if (!volumeTracing || !isTraceToolActive) {
      continue;
    }

    const contourList = volumeTracing.contourList;

    // Update meshes according to the new contourList
    contour.reset();
    contour.color =
      volumeTracing.contourTracingMode === ContourModeEnum.DELETE
        ? CONTOUR_COLOR_DELETE
        : CONTOUR_COLOR_NORMAL;
    contourList.forEach(p => contour.addEdgePoint(p));
  }
}
/////////

export default [
  editVolumeLayerAsync,
  ensureToolIsAllowedInResolution,
  floodFill,
  watchVolumeTracingAsync,
  maintainSegmentsMap,
  maintainHoveredSegmentId,
  listenToMinCut,
  maintainContourGeometry,
];
