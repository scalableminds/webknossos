import { message } from "antd";
import React from "react";
import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import { CONTOUR_COLOR_DELETE, CONTOUR_COLOR_NORMAL } from "oxalis/geometries/contourgeometry";
import api from "oxalis/api/internal_api";
import {
  ResolutionInfo,
  getBoundaries,
  getResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, takeLatest, call, fork, put, actionChannel } from "typed-redux-saga";
import { select, take } from "oxalis/model/sagas/effect-generators";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import {
  updateVolumeTracing,
  updateUserBoundingBoxes,
  createSegmentVolumeAction,
  updateSegmentVolumeAction,
  deleteSegmentVolumeAction,
  removeFallbackLayer,
} from "oxalis/model/sagas/update_actions";
import type { UpdateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import {
  updateTemporarySettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { V3 } from "libs/mjs";
import type { VolumeTracing, Flycam, SegmentMap } from "oxalis/store";
import type {
  AddAdHocIsosurfaceAction,
  AddPrecomputedIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { calculateMaybeGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { diffDiffableMaps } from "libs/diffable_map";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getMaximumBrushSize,
  getRenderableResolutionForSegmentationTracing,
  getRequestedOrVisibleSegmentationLayer,
  getSegmentsForLayer,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
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
import { markVolumeTransactionEnd } from "oxalis/model/bucket_data_handling/bucket";
import { setToolAction, setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import { takeEveryUnlessBusy } from "oxalis/model/sagas/saga_helpers";
import type {
  SetActiveCellAction,
  ClickSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  updateDirectionAction,
  updateSegmentAction,
  finishAnnotationStrokeAction,
} from "oxalis/model/actions/volumetracing_actions";
import { zoomedPositionToZoomedAddress } from "oxalis/model/helpers/position_converter";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type {
  BoundingBoxType,
  ContourMode,
  OverwriteMode,
  OrthoView,
  AnnotationTool,
  Vector3,
  LabeledVoxelsMap,
  Vector2,
} from "oxalis/constants";
import Constants, {
  OrthoViews,
  Unicode,
  ContourModeEnum,
  OverwriteModeEnum,
  AnnotationToolEnum,
  FillModeEnum,
} from "oxalis/constants";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import DataLayer from "oxalis/model/data_layer";
import type { DimensionMap } from "oxalis/model/dimensions";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import VolumeLayer, {
  getFast3DCoordinateHelper,
  VoxelBuffer2D,
} from "oxalis/model/volumetracing/volumelayer";
import createProgressCallback from "libs/progress_callback";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { getHalfViewportExtents } from "oxalis/model/sagas/saga_selectors";
import listenToMinCut from "oxalis/model/sagas/min_cut_saga";
import sampleVoxelMapToResolution, {
  applyVoxelMap,
} from "oxalis/model/volumetracing/volume_annotation_sampling";
export function* watchVolumeTracingAsync(): Saga<void> {
  yield* take("WK_READY");
  yield* takeEveryUnlessBusy(
    "COPY_SEGMENTATION_LAYER",
    copySegmentationLayer,
    "Copying from neighbor slice",
  );
  yield* fork(warnOfTooLowOpacity);
}

function* warnOfTooLowOpacity(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");

  if (yield* select((state) => state.tracing.volumes.length === 0)) {
    return;
  }

  const segmentationLayer = yield* call([Model, Model.getVisibleSegmentationLayer]);

  if (!segmentationLayer) {
    return;
  }

  const isOpacityTooLow = yield* select(
    (state) => state.datasetConfiguration.layers[segmentationLayer.name].alpha < 10,
  );

  if (isOpacityTooLow) {
    Toast.warning(
      'Your setting for "segmentation opacity" is set very low.<br />Increase it for better visibility while volume tracing.',
    );
  }
}

export function* editVolumeLayerAsync(): Saga<any> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield* take("START_EDITING");
    const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

    if (busyBlockingInfo.isBusy) {
      console.warn(`Ignoring brush request (reason: ${busyBlockingInfo.reason || "null"})`);
      continue;
    }

    if (startEditingAction.type !== "START_EDITING") {
      throw new Error("Unexpected action. Satisfy flow.");
    }

    const volumeTracing = yield* select(enforceActiveVolumeTracing);
    const contourTracingMode = volumeTracing.contourTracingMode;
    const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);
    const isDrawing = contourTracingMode === ContourModeEnum.DRAW;
    const activeTool = yield* select((state) => state.uiInformation.activeTool);
    // Depending on the tool, annotation in higher zoom steps might be disallowed.
    const isZoomStepTooHighForAnnotating = yield* select((state) =>
      isVolumeAnnotationDisallowedForZoom(activeTool, state),
    );

    if (isZoomStepTooHighForAnnotating) {
      continue;
    }

    if (activeTool === AnnotationToolEnum.MOVE) {
      // This warning can be helpful when debugging tests.
      console.warn("Volume actions are ignored since current tool is the move tool.");
      continue;
    }

    const maybeLabeledResolutionWithZoomStep = yield* select((state) =>
      getRenderableResolutionForSegmentationTracing(state, volumeTracing),
    );

    if (!maybeLabeledResolutionWithZoomStep) {
      // Volume data is currently not rendered. Don't annotate anything.
      continue;
    }

    const activeCellId = yield* select((state) => enforceActiveVolumeTracing(state).activeCellId);
    yield* put(
      updateSegmentAction(
        activeCellId,
        {
          somePosition: startEditingAction.position,
        },
        volumeTracing.tracingId,
      ),
    );
    const { zoomStep: labeledZoomStep, resolution: labeledResolution } =
      maybeLabeledResolutionWithZoomStep;
    const currentLayer = yield* call(
      createVolumeLayer,
      volumeTracing,
      startEditingAction.planeId,
      labeledResolution,
    );
    const initialViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

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
    const channel = yield* actionChannel(["ADD_TO_LAYER", "FINISH_EDITING"]);

    while (true) {
      const currentAction = yield* take(channel);
      const { addToLayerAction, finishEditingAction } = {
        addToLayerAction: currentAction.type === "ADD_TO_LAYER" ? currentAction : null,
        finishEditingAction: currentAction.type === "FINISH_EDITING" ? currentAction : null,
      };
      if (finishEditingAction) break;

      if (!addToLayerAction || addToLayerAction.type !== "ADD_TO_LAYER") {
        throw new Error("Unexpected action. Satisfy typescript.");
      }

      const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

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
      updateSegmentAction(
        activeCellId,
        {
          somePosition: lastPosition,
        },
        volumeTracing.tracingId,
      ),
    );

    const interpolateSegment = isBrushTool(activeTool) || isTraceTool(activeTool);
    if (interpolateSegment && isDrawing) {
      yield* call(interpolateSegmentationLayer, currentLayer);
    }

    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
  }
}

function* getBoundingBoxForFloodFill(
  position: Vector3,
  currentViewport: OrthoView,
): Saga<BoundingBoxType> {
  const fillMode = yield* select((state) => state.userConfiguration.fillMode);
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

  const { lowerBoundary, upperBoundary } = yield* select((state) => getBoundaries(state.dataset));
  const { min: clippedMin, max: clippedMax } = new BoundingBox(
    currentViewportBounding,
  ).intersectedWith(
    new BoundingBox({
      min: lowerBoundary,
      max: upperBoundary,
    }),
  );
  return {
    min: clippedMin,
    max: clippedMax,
  };
}

function* createVolumeLayer(
  volumeTracing: VolumeTracing,
  planeId: OrthoView,
  labeledResolution: Vector3,
  thirdDimValue?: number,
): Saga<VolumeLayer> {
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  thirdDimValue = thirdDimValue ?? position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(volumeTracing.tracingId, planeId, thirdDimValue, labeledResolution);
}

function* labelWithVoxelBuffer2D(
  voxelBuffer: VoxelBuffer2D,
  contourTracingMode: ContourMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
): Saga<void> {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;
  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const activeCellId = volumeTracing.activeCellId;
  const segmentationLayer = yield* call(
    [Model, Model.getSegmentationTracingLayer],
    volumeTracing.tracingId,
  );
  const { cube } = segmentationLayer;
  const currentLabeledVoxelMap: LabeledVoxelsMap = new Map();
  const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);
  const dimensionIndices = Dimensions.getIndices(activeViewport);
  const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);

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

function* getBoundingBoxForViewport(
  position: Vector3,
  currentViewport: OrthoView,
): Saga<BoundingBox> {
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    currentViewport,
  );

  const currentViewportBounding = {
    min: V3.sub(position, [halfViewportExtentX, halfViewportExtentY, 0]),
    max: V3.add(position, [halfViewportExtentX, halfViewportExtentY, 1]),
  };

  const { lowerBoundary, upperBoundary } = yield* select((state) => getBoundaries(state.dataset));
  return new BoundingBox(currentViewportBounding).intersectedWith(
    new BoundingBox({
      min: lowerBoundary,
      max: upperBoundary,
    }),
  );
}

function* interpolateSegmentationLayer(layer: VolumeLayer): Saga<void> {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;
  const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

  if (activeViewport !== "PLANE_XY") {
    // Interpolation is only done in XY
    return;
  }

  // Disable copy-segmentation for the same zoom steps where the trace tool is forbidden, too,
  // to avoid large performance lags.
  const isResolutionTooLow = yield* select((state) =>
    isVolumeAnnotationDisallowedForZoom(AnnotationToolEnum.TRACE, state),
  );

  if (isResolutionTooLow) {
    Toast.warning(
      'The "interpolate segmentation"-feature is not supported at this zoom level. Please zoom in further.',
    );
    return;
  }

  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const segmentationLayer: DataLayer = yield* call(
    [Model, Model.getSegmentationTracingLayer],
    volumeTracing.tracingId,
  );
  const requestedZoomStep = yield* select((state) => getRequestLogZoomStep(state));
  const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
  // const dimensionIndices = Dimensions.getIndices(activeViewport);
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  const activeCellId = volumeTracing.activeCellId;

  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);
  // let direction = 1;
  // const useDynamicSpaceDirection = yield* select(
  //   (state) => state.userConfiguration.dynamicSpaceDirection,
  // );

  // if (useDynamicSpaceDirection) {
  //   const spaceDirectionOrtho = yield* select((state) => state.flycam.spaceDirectionOrtho);
  //   direction = spaceDirectionOrtho[thirdDim];
  // }

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  if (volumeTracingLayer == null) {
    return;
  }

  // Annotate only every n-th slice while the remaining ones are interpolated automatically.
  const INTERPOLATION_DEPTH = 3;

  const drawnBoundingBox = layer.getLabeledBoundingBox();
  if (drawnBoundingBox == null) {
    return;
  }
  console.time("Interpolate segmentation");
  const xyPadding = V3.scale3(drawnBoundingBox.getSize(), [1, 1, 0]);
  const viewportBoxMag1 = yield* call(getBoundingBoxForViewport, position, activeViewport);
  const relevantBoxMag1 = drawnBoundingBox
    // Increase the drawn region by a factor of 2 (use half the size as a padding on each size)
    .paddedWithMargins(V3.scale(xyPadding, 0.5))
    // Intersect with the viewport
    .intersectedWith(viewportBoxMag1)
    // Also consider the n previous slices
    .paddedWithMargins([0, 0, INTERPOLATION_DEPTH], [0, 0, 0])
    .rounded();

  console.time("Get Data");
  const inputData = yield* call(
    [api.data, api.data.getDataFor2DBoundingBox],
    volumeTracingLayer.name,
    relevantBoxMag1,
    requestedZoomStep,
  );
  console.timeEnd("Get Data");

  console.time("Iterate over data");

  const size = V3.sub(relevantBoxMag1.max, relevantBoxMag1.min);
  const ll = ([x, y, z]: Vector3): number => z * size[1] * size[0] + y * size[0] + x;

  const interpolationVoxelBuffers: Record<number, VoxelBuffer2D> = {};
  for (let targetOffsetZ = 1; targetOffsetZ < INTERPOLATION_DEPTH; targetOffsetZ++) {
    const interpolationLayer = yield* call(
      createVolumeLayer,
      volumeTracing,
      "PLANE_XY",
      labeledResolution,
      relevantBoxMag1.min[2] + targetOffsetZ,
    );
    interpolationVoxelBuffers[targetOffsetZ] = interpolationLayer.createVoxelBuffer2D(
      interpolationLayer.globalCoordToMag2D(V3.add(relevantBoxMag1.min, [0, 0, targetOffsetZ])),
      size[0],
      size[1],
    );
  }

  for (let x = 0; x < size[0]; x++) {
    for (let y = 0; y < size[1]; y++) {
      const startValue = inputData[ll([x, y, 0])];
      const endValue = inputData[ll([x, y, INTERPOLATION_DEPTH])];

      // Only copy voxels from the previous layer which belong to the current cell
      if (!(startValue === activeCellId && startValue === endValue)) {
        continue;
      }

      for (let targetOffsetZ = 1; targetOffsetZ < INTERPOLATION_DEPTH; targetOffsetZ++) {
        const voxelBuffer2D = interpolationVoxelBuffers[targetOffsetZ];
        voxelBuffer2D.setValue(x, y, 1);
      }
    }
  }
  console.timeEnd("Iterate over data");

  console.time("Apply VoxelBuffer2D");
  for (const voxelBuffer of Object.values(interpolationVoxelBuffers)) {
    yield* call(
      labelWithVoxelBuffer2D,
      voxelBuffer,
      ContourModeEnum.DRAW,
      OverwriteModeEnum.OVERWRITE_EMPTY,
      labeledZoomStep,
    );
  }
  console.timeEnd("Apply VoxelBuffer2D");

  console.timeEnd("Interpolate segmentation");
  console.log("");
}

function* copySegmentationLayer(action: Action): Saga<void> {
  if (action.type !== "COPY_SEGMENTATION_LAYER") {
    throw new Error("Satisfy flow");
  }

  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;
  const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

  if (activeViewport === "TDView") {
    // Cannot copy labels from 3D view
    return;
  }

  // Disable copy-segmentation for the same zoom steps where the trace tool is forbidden, too,
  // to avoid large performance lags.
  const isResolutionTooLow = yield* select((state) =>
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
  const requestedZoomStep = yield* select((state) => getRequestLogZoomStep(state));
  const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
  const dimensionIndices = Dimensions.getIndices(activeViewport);
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    activeViewport,
  );
  const activeCellId = volumeTracing.activeCellId;
  const labeledVoxelMapOfCopiedVoxel: LabeledVoxelsMap = new Map();

  function copyVoxelLabel(voxelTemplateAddress: Vector3, voxelTargetAddress: Vector3) {
    const templateLabelValue = cube.getDataValue(voxelTemplateAddress, null, labeledZoomStep);

    // Only copy voxels from the previous layer which belong to the current cell
    if (templateLabelValue === activeCellId) {
      const currentLabelValue = cube.getDataValue(voxelTargetAddress, null, labeledZoomStep);

      // Do not overwrite already labeled voxels
      if (currentLabelValue === 0) {
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

  const thirdDim = dimensionIndices[2];
  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);
  const directionInverter = action.source === "nextLayer" ? 1 : -1;
  let direction = 1;
  const useDynamicSpaceDirection = yield* select(
    (state) => state.userConfiguration.dynamicSpaceDirection,
  );

  if (useDynamicSpaceDirection) {
    const spaceDirectionOrtho = yield* select((state) => state.flycam.spaceDirectionOrtho);
    direction = spaceDirectionOrtho[thirdDim];
  }

  const [tx, ty, tz] = Dimensions.transDim(position, activeViewport);
  const z = tz;
  // When using this tool in more coarse resolutions, the distance to the previous/next slice might be larger than 1
  const previousZ = z + direction * directionInverter * labeledResolution[thirdDim];
  for (let x = tx - halfViewportExtentX; x < tx + halfViewportExtentX; x++) {
    for (let y = ty - halfViewportExtentY; y < ty + halfViewportExtentY; y++) {
      copyVoxelLabel(
        Dimensions.transDim([x, y, previousZ], activeViewport),
        Dimensions.transDim([x, y, z], activeViewport),
      );
    }
  }

  if (labeledVoxelMapOfCopiedVoxel.size === 0) {
    const dimensionLabels = ["x", "y", "z"];
    Toast.warning(
      `Did not copy any voxels from slice ${dimensionLabels[thirdDim]}=${previousZ}.` +
        ` Either no voxels with cell id ${activeCellId} were found or all of the respective voxels were already labeled in the current slice.`,
    );
  }

  // applyVoxelMap assumes get3DAddress to be local to the corresponding bucket (so in the labeled resolution as well)
  const zInLabeledResolution =
    Math.floor(tz / labeledResolution[thirdDim]) % Constants.BUCKET_WIDTH;
  applyVoxelMap(
    labeledVoxelMapOfCopiedVoxel,
    cube,
    activeCellId,
    getFast3DCoordinateHelper(activeViewport, zInLabeledResolution),
    1,
    thirdDim,
    false,
    0,
  );
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
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);

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
    const requestedZoomStep = yield* select((state) => getRequestLogZoomStep(state));
    const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
    const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
    const oldSegmentIdAtSeed = cube.getDataValue(seedPosition, null, labeledZoomStep);

    if (activeCellId === oldSegmentIdAtSeed) {
      Toast.warning("The clicked voxel's id is already equal to the active segment id.");
      continue;
    }

    const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

    if (busyBlockingInfo.isBusy) {
      console.warn(`Ignoring floodfill request (reason: ${busyBlockingInfo.reason || "unknown"})`);
      continue;
    }

    yield* put(setBusyBlockingInfoAction(true, "Floodfill is being computed."));
    const boundingBoxForFloodFill = yield* call(getBoundingBoxForFloodFill, seedPosition, planeId);
    const progressCallback = createProgressCallback({
      pauseDelay: 200,
      successMessageDelay: 2000,
      // Since only one floodfill operation can be active at any time,
      // a hardcoded key is sufficient.
      key: "FLOODFILL_PROGRESS_KEY",
    });
    yield* call(progressCallback, false, "Performing floodfill...");
    console.time("cube.floodFill");
    const fillMode = yield* select((state) => state.userConfiguration.fillMode);
    const {
      bucketsWithLabeledVoxelsMap: labelMasksByBucketAndW,
      wasBoundingBoxExceeded,
      coveredBoundingBox,
    } = yield* call(
      { context: cube, fn: cube.floodFill },
      seedPosition,
      activeCellId,
      dimensionIndices,
      boundingBoxForFloodFill,
      labeledZoomStep,
      progressCallback,
      fillMode === FillModeEnum._3D,
    );
    console.timeEnd("cube.floodFill");
    yield* call(progressCallback, false, "Finalizing floodfill...");
    const indexSet: Set<number> = new Set();

    for (const labelMaskByIndex of labelMasksByBucketAndW.values()) {
      for (const zIndex of labelMaskByIndex.keys()) {
        indexSet.add(zIndex);
      }
    }

    console.time("applyLabeledVoxelMapToAllMissingResolutions");

    for (const indexZ of indexSet) {
      const labeledVoxelMapFromFloodFill: LabeledVoxelsMap = new Map();

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

function* pairwise<T>(arr: Array<T>): Generator<[T, T], any, any> {
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
  function processSamplingSequence(
    samplingSequence: Array<[number, Vector3]>,
    getNumberOfSlices: (arg0: Vector3) => number,
  ) {
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
  processSamplingSequence(upsampleSequence, (targetResolution) =>
    Math.ceil(labeledResolution[thirdDim] / targetResolution[thirdDim]),
  );
  // Next we downsample the annotation and apply it.
  // sourceZoomStep will be lower than targetZoomStep
  processSamplingSequence(downsampleSequence, (_targetResolution) => 1);
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
export function* ensureToolIsAllowedInResolution(): Saga<any> {
  yield* take("INITIALIZE_VOLUMETRACING");

  while (true) {
    yield* take(["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP"]);
    const isResolutionTooLow = yield* select((state) => {
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
    | AddAdHocIsosurfaceAction
    | AddPrecomputedIsosurfaceAction
    | SetActiveCellAction
    | UpdateTemporarySettingAction
    | ClickSegmentAction,
): Saga<void> {
  const layer = yield* select((store) =>
    getRequestedOrVisibleSegmentationLayer(store, "layerName" in action ? action.layerName : null),
  );

  if (!layer) {
    return;
  }

  const layerName = layer.name;
  const segments = yield* select((store) => getSegmentsForLayer(store, layerName));
  const cellId = action.type === "UPDATE_TEMPORARY_SETTING" ? action.value : action.cellId;

  if (cellId === 0 || cellId == null || segments == null || segments.getNullable(cellId) != null) {
    return;
  }

  if (action.type === "ADD_AD_HOC_ISOSURFACE" || action.type === "ADD_PRECOMPUTED_ISOSURFACE") {
    const { seedPosition } = action;
    yield* put(
      updateSegmentAction(
        cellId,
        {
          somePosition: seedPosition,
        },
        layerName,
      ),
    );
  } else if (action.type === "SET_ACTIVE_CELL" || action.type === "CLICK_SEGMENT") {
    const { somePosition } = action;

    if (somePosition == null) {
      // Not all SetActiveCell provide a position (e.g., when simply setting the ID)
      // via the UI.
      return;
    }

    yield* put(
      updateSegmentAction(
        cellId,
        {
          somePosition,
        },
        layerName,
      ),
    );
  } else if (action.type === "UPDATE_TEMPORARY_SETTING") {
    const globalMousePosition = yield* call(getGlobalMousePosition);

    if (globalMousePosition == null) {
      return;
    }

    yield* put(
      updateSegmentAction(
        cellId,
        {
          somePosition: globalMousePosition,
        },
        layerName,
      ),
    );
  }
}

function* maintainSegmentsMap(): Saga<void> {
  yield* takeEvery(
    ["ADD_AD_HOC_ISOSURFACE", "ADD_PRECOMPUTED_ISOSURFACE", "SET_ACTIVE_CELL", "CLICK_SEGMENT"],
    ensureSegmentExists,
  );
}

function* getGlobalMousePosition(): Saga<Vector3 | null | undefined> {
  return yield* select((state) => {
    const mousePosition = state.temporaryConfiguration.mousePosition;

    if (mousePosition) {
      const [x, y] = mousePosition;
      return calculateMaybeGlobalPos(state, {
        x,
        y,
      });
    }

    return undefined;
  });
}

function* updateHoveredSegmentId(): Saga<void> {
  const activeViewport = yield* select((store) => store.viewModeData.plane.activeViewport);

  if (activeViewport === OrthoViews.TDView) {
    return;
  }

  const globalMousePosition = yield* call(getGlobalMousePosition);
  const hoveredCellInfo = yield* call(
    { context: Model, fn: Model.getHoveredCellId },
    globalMousePosition,
  );
  const id = hoveredCellInfo != null ? hoveredCellInfo.id : 0;
  const oldHoveredSegmentId = yield* select(
    (store) => store.temporaryConfiguration.hoveredSegmentId,
  );

  if (oldHoveredSegmentId !== id) {
    yield* put(updateTemporarySettingAction("hoveredSegmentId", id));
  }
}

export function* maintainHoveredSegmentId(): Saga<void> {
  yield* takeLatest("SET_MOUSE_POSITION", updateHoveredSegmentId);
}

function* maintainContourGeometry(): Saga<void> {
  yield* take("SCENE_CONTROLLER_READY");
  const SceneController = yield* call(getSceneController);
  const { contour } = SceneController;

  while (true) {
    yield* take(["ADD_TO_LAYER", "RESET_CONTOUR"]);
    const isTraceToolActive = yield* select((state) => isTraceTool(state.uiInformation.activeTool));
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
    contourList.forEach((p) => contour.addEdgePoint(p));
  }
}

function* maintainVolumeTransactionEnds(): Saga<void> {
  // When FINISH_ANNOTATION_STROKE is dispatched, the current volume
  // transaction has ended. All following UI actions which
  // mutate buckets should operate on a fresh `bucketsAlreadyInUndoState` set.
  // Therefore, `markVolumeTransactionEnd` should be called immediately
  // when FINISH_ANNOTATION_STROKE is dispatched. There should be no waiting
  // on other operations (such as pending compressions) as it has been the case
  // before. Otherwise, different undo states would "bleed" into each other.
  yield* takeEvery("FINISH_ANNOTATION_STROKE", markVolumeTransactionEnd);
}

function* ensureValidBrushSize(): Saga<void> {
  // A valid brush size needs to be ensured in certain events,
  // since the maximum brush size depends on the available magnifications
  // of the active volume layer.
  // Currently, these events are:
  // - when webKnossos is loaded
  // - when a layer's visibility is toggled
  function* maybeClampBrushSize(): Saga<void> {
    const currentBrushSize = yield* select((state) => state.userConfiguration.brushSize);
    const maximumBrushSize = yield* select((state) => getMaximumBrushSize(state));

    if (currentBrushSize > maximumBrushSize) {
      yield* put(updateUserSettingAction("brushSize", maximumBrushSize));
    }
  }

  yield* takeLatest(
    [
      "WK_READY",
      (action: Action) =>
        action.type === "UPDATE_LAYER_SETTING" && action.propertyName === "isDisabled",
    ],
    maybeClampBrushSize,
  );
}

export default [
  editVolumeLayerAsync,
  ensureToolIsAllowedInResolution,
  floodFill,
  watchVolumeTracingAsync,
  maintainSegmentsMap,
  maintainHoveredSegmentId,
  listenToMinCut,
  maintainContourGeometry,
  maintainVolumeTransactionEnds,
  ensureValidBrushSize,
];
