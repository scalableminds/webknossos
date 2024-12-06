import { message } from "antd";
import { diffDiffableMaps } from "libs/diffable_map";
import { V3 } from "libs/mjs";
import createProgressCallback from "libs/progress_callback";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type {
  AnnotationTool,
  BoundingBoxType,
  ContourMode,
  LabeledVoxelsMap,
  OrthoView,
  OverwriteMode,
  Vector3,
} from "oxalis/constants";
import Constants, {
  AnnotationToolEnum,
  ContourModeEnum,
  FillModeEnum,
  OrthoViews,
  Unicode,
  OverwriteModeEnum,
} from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { CONTOUR_COLOR_DELETE, CONTOUR_COLOR_NORMAL } from "oxalis/geometries/helper_geometries";

import {
  getDatasetBoundingBox,
  getMaximumSegmentIdForLayer,
  getMagInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getPosition,
  getActiveMagIndexForLayer,
  getRotation,
} from "oxalis/model/accessors/flycam_accessor";
import {
  isBrushTool,
  isTraceTool,
  isVolumeDrawingTool,
} from "oxalis/model/accessors/tool_accessor";
import { calculateMaybeGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracing,
  getMaximumBrushSize,
  getRenderableMagForSegmentationTracing,
  getRequestedOrVisibleSegmentationLayer,
  getSegmentsForLayer,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import type { Action } from "oxalis/model/actions/actions";
import type {
  AddAdHocMeshAction,
  AddPrecomputedMeshAction,
} from "oxalis/model/actions/annotation_actions";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import {
  updateTemporarySettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { setBusyBlockingInfoAction, setToolAction } from "oxalis/model/actions/ui_actions";
import type {
  ClickSegmentAction,
  SetActiveCellAction,
  CreateCellAction,
  DeleteSegmentDataAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  finishAnnotationStrokeAction,
  registerLabelPointAction,
  setSelectedSegmentsOrGroupAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { markVolumeTransactionEnd } from "oxalis/model/bucket_data_handling/bucket";
import Dimensions from "oxalis/model/dimensions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select, take } from "oxalis/model/sagas/effect-generators";
import listenToMinCut from "oxalis/model/sagas/min_cut_saga";
import listenToQuickSelect from "oxalis/model/sagas/quick_select_saga";
import {
  requestBucketModificationInVolumeTracing,
  takeEveryUnlessBusy,
} from "oxalis/model/sagas/saga_helpers";
import {
  deleteSegmentDataVolumeAction,
  type UpdateAction,
  updateSegmentGroups,
} from "oxalis/model/sagas/update_actions";
import {
  createSegmentVolumeAction,
  deleteSegmentVolumeAction,
  removeFallbackLayer,
  updateSegmentVolumeAction,
  updateUserBoundingBoxes,
  updateVolumeTracing,
  updateMappingName,
} from "oxalis/model/sagas/update_actions";
import type VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import { Model, api } from "oxalis/singletons";
import type { Flycam, SegmentMap, VolumeTracing } from "oxalis/store";
import { actionChannel, call, fork, put, takeEvery, takeLatest } from "typed-redux-saga";
import {
  applyLabeledVoxelMapToAllMissingMags,
  createVolumeLayer,
  labelWithVoxelBuffer2D,
  type BooleanBox,
} from "./volume/helpers";
import maybeInterpolateSegmentationLayer from "./volume/volume_interpolation_saga";
import messages from "messages";
import { pushSaveQueueTransaction } from "../actions/save_actions";
import type { ActionPattern } from "redux-saga/effects";

const OVERWRITE_EMPTY_WARNING_KEY = "OVERWRITE-EMPTY-WARNING";

export function* watchVolumeTracingAsync(): Saga<void> {
  yield* take("WK_READY");
  yield* takeEveryUnlessBusy(
    "INTERPOLATE_SEGMENTATION_LAYER",
    maybeInterpolateSegmentationLayer,
    "Interpolating segment",
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

function* warnTooLargeSegmentId(): Saga<void> {
  yield* take("INITIALIZE_VOLUMETRACING");
  while (true) {
    const action = (yield* take(["SET_ACTIVE_CELL", "CREATE_CELL"]) as any) as
      | SetActiveCellAction
      | CreateCellAction;
    const newSegmentId = yield* select((state) => enforceActiveVolumeTracing(state).activeCellId);
    if (
      (action.type === "CREATE_CELL" && action.newSegmentId === newSegmentId) ||
      (action.type === "SET_ACTIVE_CELL" && action.segmentId === newSegmentId)
    ) {
      continue;
    }
    const dataset = yield* select((state) => state.dataset);
    const volumeTracing = yield* select(enforceActiveVolumeTracing);
    const segmentationLayer = yield* call(
      [Model, Model.getSegmentationTracingLayer],
      volumeTracing.tracingId,
    );
    const maxSegmentId = getMaximumSegmentIdForLayer(dataset, segmentationLayer.name);
    Toast.warning(messages["tracing.segment_id_out_of_bounds"]({ maxSegmentId }));
  }
}

export function* editVolumeLayerAsync(): Saga<any> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield* take("START_EDITING");
    const wroteVoxelsBox = { value: false };
    const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

    if (busyBlockingInfo.isBusy) {
      console.warn(`Ignoring brush request (reason: ${busyBlockingInfo.reason || "null"})`);
      continue;
    }

    if (startEditingAction.type !== "START_EDITING") {
      throw new Error("Unexpected action. Satisfy typescript.");
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

    const maybeLabeledMagWithZoomStep = yield* select((state) =>
      getRenderableMagForSegmentationTracing(state, volumeTracing),
    );

    if (!maybeLabeledMagWithZoomStep) {
      // Volume data is currently not rendered. Don't annotate anything.
      continue;
    }

    const activeCellId = yield* select((state) => enforceActiveVolumeTracing(state).activeCellId);
    // As changes to the volume layer will be applied, the potentially existing mapping should be locked to ensure a consistent state.
    const isModificationAllowed = yield* call(
      requestBucketModificationInVolumeTracing,
      volumeTracing,
    );
    if (!isModificationAllowed) {
      continue;
    }

    if (isDrawing && activeCellId === 0) {
      yield* call(
        [Toast, Toast.warning],
        "The current segment ID is 0. Please change the active segment ID via the status bar, by creating a new segment from the toolbar or by selecting an existing one via context menu.",
        { timeout: 10000 },
      );
      continue;
    }
    const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);

    yield* put(
      updateSegmentAction(
        activeCellId,
        {
          somePosition: startEditingAction.position,
          someAdditionalCoordinates: additionalCoordinates || undefined,
        },
        volumeTracing.tracingId,
      ),
    );
    const { zoomStep: labeledZoomStep, mag: labeledMag } = maybeLabeledMagWithZoomStep;
    const currentLayer = yield* call(
      createVolumeLayer,
      volumeTracing,
      startEditingAction.planeId,
      labeledMag,
    );
    const initialViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

    if (isBrushTool(activeTool)) {
      yield* call(
        labelWithVoxelBuffer2D,
        currentLayer.getCircleVoxelBuffer2D(startEditingAction.position),
        contourTracingMode,
        overwriteMode,
        labeledZoomStep,
        initialViewport,
        wroteVoxelsBox,
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
            activeViewport,
            wroteVoxelsBox,
          );
        }

        yield* call(
          labelWithVoxelBuffer2D,
          currentLayer.getCircleVoxelBuffer2D(addToLayerAction.position),
          contourTracingMode,
          overwriteMode,
          labeledZoomStep,
          activeViewport,
          wroteVoxelsBox,
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
      initialViewport,
      wroteVoxelsBox,
    );
    // Update the position of the current segment to the last position of the most recent annotation stroke.
    yield* put(
      updateSegmentAction(
        activeCellId,
        {
          somePosition: lastPosition,
          someAdditionalCoordinates: additionalCoordinates || undefined,
        },
        volumeTracing.tracingId,
      ),
    );

    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));

    if (!wroteVoxelsBox.value) {
      const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);
      if (overwriteMode === OverwriteModeEnum.OVERWRITE_EMPTY)
        yield* call(
          [Toast, Toast.warning],
          "No voxels were changed. You might want to change the overwrite-mode to “Overwrite everything” in the toolbar. Otherwise, only empty voxels will be changed.",
          { key: OVERWRITE_EMPTY_WARNING_KEY },
        );
    } else {
      yield* call([Toast, Toast.close], OVERWRITE_EMPTY_WARNING_KEY);
    }
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

  const datasetBoundingBox = yield* select((state) => getDatasetBoundingBox(state.dataset));
  const { min: clippedMin, max: clippedMax } = new BoundingBox(
    currentViewportBounding,
  ).intersectedWith(datasetBoundingBox);
  return {
    min: clippedMin,
    max: clippedMax,
  };
}

const FLOODFILL_PROGRESS_KEY = "FLOODFILL_PROGRESS_KEY";
export function* floodFill(): Saga<void> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const floodFillAction = yield* take("FLOOD_FILL");

    if (floodFillAction.type !== "FLOOD_FILL") {
      throw new Error("Unexpected action. Satisfy typescript.");
    }

    const { position: positionFloat, planeId } = floodFillAction;
    const volumeTracing = yield* select(enforceActiveVolumeTracing);
    if (volumeTracing.hasEditableMapping) {
      const message = "Volume modification is not allowed when an editable mapping is active.";
      Toast.error(message);
      console.error(message);
      continue;
    }
    const segmentationLayer = yield* call(
      [Model, Model.getSegmentationTracingLayer],
      volumeTracing.tracingId,
    );
    const { cube } = segmentationLayer;
    const seedPosition = Dimensions.roundCoordinate(positionFloat);
    const activeCellId = volumeTracing.activeCellId;
    const dimensionIndices = Dimensions.getIndices(planeId);
    const requestedZoomStep = yield* select((state) =>
      getActiveMagIndexForLayer(state, segmentationLayer.name),
    );
    const magInfo = yield* call(getMagInfo, segmentationLayer.mags);
    const labeledZoomStep = magInfo.getClosestExistingIndex(requestedZoomStep);
    const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
    const oldSegmentIdAtSeed = cube.getDataValue(
      seedPosition,
      additionalCoordinates,
      null,
      labeledZoomStep,
    );

    if (activeCellId === oldSegmentIdAtSeed) {
      Toast.warning("The clicked voxel's id is already equal to the active segment id.");
      continue;
    }

    const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

    if (busyBlockingInfo.isBusy) {
      console.warn(`Ignoring floodfill request (reason: ${busyBlockingInfo.reason || "unknown"})`);
      continue;
    }
    // As the flood fill will be applied to the volume layer,
    // the potentially existing mapping should be locked to ensure a consistent state.
    const isModificationAllowed = yield* call(
      requestBucketModificationInVolumeTracing,
      volumeTracing,
    );
    if (!isModificationAllowed) {
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
      additionalCoordinates,
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

    console.time("applyLabeledVoxelMapToAllMissingMags");

    for (const indexZ of indexSet) {
      const labeledVoxelMapFromFloodFill: LabeledVoxelsMap = new Map();

      for (const [bucketAddress, labelMaskByIndex] of labelMasksByBucketAndW.entries()) {
        const map = labelMaskByIndex.get(indexZ);

        if (map != null) {
          labeledVoxelMapFromFloodFill.set(bucketAddress, map);
        }
      }

      applyLabeledVoxelMapToAllMissingMags(
        labeledVoxelMapFromFloodFill,
        labeledZoomStep,
        dimensionIndices,
        magInfo,
        cube,
        activeCellId,
        indexZ,
        true,
      );
    }

    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
    yield* put(
      updateSegmentAction(
        volumeTracing.activeCellId,
        {
          somePosition: seedPosition,
          someAdditionalCoordinates: additionalCoordinates || undefined,
        },
        volumeTracing.tracingId,
      ),
    );

    console.timeEnd("applyLabeledVoxelMapToAllMissingMags");

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
          name: `Limits of flood-fill (source_id=${oldSegmentIdAtSeed}, target_id=${activeCellId}, seed=${seedPosition.join(
            ",",
          )}, timestamp=${new Date().getTime()})`,
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

export function* finishLayer(
  layer: VolumeLayer,
  activeTool: AnnotationTool,
  contourTracingMode: ContourMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
  activeViewport: OrthoView,
  wroteVoxelsBox: BooleanBox,
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
      activeViewport,
      wroteVoxelsBox,
    );
  }

  yield* put(registerLabelPointAction(layer.getUnzoomedCentroid()));
}

export function* ensureToolIsAllowedInMag(): Saga<any> {
  yield* take("INITIALIZE_VOLUMETRACING");

  while (true) {
    yield* take(["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP"]);
    const isMagTooLow = yield* select((state) => {
      const { activeTool } = state.uiInformation;
      return isVolumeAnnotationDisallowedForZoom(activeTool, state);
    });

    if (isMagTooLow) {
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
    prevVolumeTracing.largestSegmentId !== volumeTracing.largestSegmentId ||
    prevFlycam !== flycam
  );
}

export const cachedDiffSegmentLists = memoizeOne(
  (prevSegments: SegmentMap, newSegments: SegmentMap) =>
    Array.from(uncachedDiffSegmentLists(prevSegments, newSegments)),
);

function* uncachedDiffSegmentLists(
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
    const segment = newSegments.getOrThrow(segmentId);
    yield createSegmentVolumeAction(
      segment.id,
      segment.somePosition,
      segment.name,
      segment.color,
      segment.groupId,
      segment.metadata,
    );
  }

  for (const segmentId of bothSegmentIds) {
    const segment = newSegments.getOrThrow(segmentId);
    const prevSegment = prevSegments.getOrThrow(segmentId);

    if (segment !== prevSegment) {
      yield updateSegmentVolumeAction(
        segment.id,
        segment.somePosition,
        segment.someAdditionalCoordinates,
        segment.name,
        segment.color,
        segment.groupId,
        segment.metadata,
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
      flycam.additionalCoordinates,
      getRotation(flycam),
      flycam.zoomStep,
    );
  }

  if (!_.isEqual(prevVolumeTracing.userBoundingBoxes, volumeTracing.userBoundingBoxes)) {
    yield updateUserBoundingBoxes(volumeTracing.userBoundingBoxes);
  }

  if (prevVolumeTracing !== volumeTracing) {
    if (prevVolumeTracing.segments !== volumeTracing.segments) {
      for (const action of cachedDiffSegmentLists(
        prevVolumeTracing.segments,
        volumeTracing.segments,
      )) {
        yield action;
      }
    }

    if (prevVolumeTracing.segmentGroups !== volumeTracing.segmentGroups) {
      yield updateSegmentGroups(volumeTracing.segmentGroups);
    }

    if (prevVolumeTracing.fallbackLayer != null && volumeTracing.fallbackLayer == null) {
      yield removeFallbackLayer();
    }

    if (
      prevVolumeTracing.mappingName !== volumeTracing.mappingName ||
      prevVolumeTracing.mappingIsLocked !== volumeTracing.mappingIsLocked
    ) {
      // Once the first volume action is performed on a volume layer, the mapping state is locked.
      // In case no mapping is active, this is denoted by setting the mapping name to null.
      const action = updateMappingName(
        volumeTracing.mappingName || null,
        volumeTracing.hasEditableMapping || null,
        volumeTracing.mappingIsLocked,
      );
      yield action;
    }
  }
}

function* ensureSegmentExists(
  action: AddAdHocMeshAction | AddPrecomputedMeshAction | SetActiveCellAction | ClickSegmentAction,
): Saga<void> {
  const layer = yield* select((store) =>
    getRequestedOrVisibleSegmentationLayer(store, "layerName" in action ? action.layerName : null),
  );

  if (!layer) {
    return;
  }

  const layerName = layer.name;
  const segmentId = action.segmentId;

  if (segmentId === 0 || segmentId == null) {
    return;
  }

  if (action.type === "ADD_AD_HOC_MESH" || action.type === "ADD_PRECOMPUTED_MESH") {
    const { seedPosition, seedAdditionalCoordinates } = action;
    yield* put(
      updateSegmentAction(
        segmentId,
        {
          somePosition: seedPosition,
          someAdditionalCoordinates: seedAdditionalCoordinates,
        },
        layerName,
      ),
    );
  } else if (action.type === "SET_ACTIVE_CELL" || action.type === "CLICK_SEGMENT") {
    // Update the position even if the cell is already registered with a position.
    // This way the most up-to-date position of a cell is used to jump to when a
    // segment is selected in the segment list. Also, the position of the active
    // cell is used in the proofreading mode.
    const { somePosition, someAdditionalCoordinates } = action;

    if (somePosition == null) {
      // Not all SetActiveCell actions provide a position (e.g., when simply setting the ID)
      // via the UI.
      return;
    }

    const doesSegmentExist = yield* select((state) =>
      getSegmentsForLayer(state, layerName).has(segmentId),
    );

    yield* put(
      updateSegmentAction(
        segmentId,
        {
          somePosition,
          someAdditionalCoordinates: someAdditionalCoordinates,
        },
        layerName,
        undefined,
        !doesSegmentExist,
      ),
    );

    yield* call(updateClickedSegments, action);
  }
}

function* maintainSegmentsMap(): Saga<void> {
  yield* takeEvery(
    ["ADD_AD_HOC_MESH", "ADD_PRECOMPUTED_MESH", "SET_ACTIVE_CELL", "CLICK_SEGMENT"],
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
  const hoveredSegmentInfo = yield* call(
    { context: Model, fn: Model.getHoveredCellId },
    globalMousePosition,
  );
  // Note that hoveredSegmentInfo.id can be an unmapped id even when
  // a mapping is active, if it is a HDF5 mapping that is partially loaded
  // and no entry exists yet for the input id.
  const id = hoveredSegmentInfo != null ? hoveredSegmentInfo.id : 0;
  const unmappedId = hoveredSegmentInfo != null ? hoveredSegmentInfo.unmappedId : 0;
  const oldHoveredSegmentId = yield* select(
    (store) => store.temporaryConfiguration.hoveredSegmentId,
  );
  const oldHoveredUnmappedSegmentId = yield* select(
    (store) => store.temporaryConfiguration.hoveredUnmappedSegmentId,
  );

  if (oldHoveredSegmentId !== id) {
    yield* put(updateTemporarySettingAction("hoveredSegmentId", id));
  }
  if (oldHoveredUnmappedSegmentId !== unmappedId) {
    yield* put(updateTemporarySettingAction("hoveredUnmappedSegmentId", unmappedId));
  }
}

export function* updateClickedSegments(
  action: ClickSegmentAction | SetActiveCellAction,
): Saga<void> {
  // If one or zero segments are selected, update selected segments in store
  // Otherwise, the multiselection is kept.
  const { segmentId } = action;
  const segmentationLayer = yield* call([Model, Model.getVisibleSegmentationLayer]);
  const layerName = segmentationLayer?.name;
  if (layerName == null) return;
  const clickedSegmentId = segmentId;
  const selectedSegmentsOrGroup = yield* select(
    (state) => state.localSegmentationData[layerName]?.selectedIds,
  );
  const numberOfSelectedSegments = selectedSegmentsOrGroup.segments.length;
  if (numberOfSelectedSegments < 2) {
    yield* put(setSelectedSegmentsOrGroupAction([clickedSegmentId], null, layerName));
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
    ] as ActionPattern<Action>,
    maybeClampBrushSize,
  );
}

function* handleDeleteSegmentData(): Saga<void> {
  yield* take("WK_READY");
  while (true) {
    const action = (yield* take("DELETE_SEGMENT_DATA")) as DeleteSegmentDataAction;

    yield* put(setBusyBlockingInfoAction(true, "Segment is being deleted."));
    yield* put(
      pushSaveQueueTransaction(
        [deleteSegmentDataVolumeAction(action.segmentId)],
        "volume",
        action.layerName,
      ),
    );
    yield* call([Model, Model.ensureSavedState]);

    yield* call([api.data, api.data.reloadBuckets], action.layerName, (bucket) =>
      bucket.containsValue(action.segmentId),
    );

    yield* put(setBusyBlockingInfoAction(false));
    if (action.callback) {
      action.callback();
    }
  }
}

export default [
  editVolumeLayerAsync,
  handleDeleteSegmentData,
  ensureToolIsAllowedInMag,
  floodFill,
  watchVolumeTracingAsync,
  maintainSegmentsMap,
  maintainHoveredSegmentId,
  listenToMinCut,
  listenToQuickSelect,
  maintainContourGeometry,
  maintainVolumeTransactionEnds,
  ensureValidBrushSize,
  warnTooLargeSegmentId,
];
