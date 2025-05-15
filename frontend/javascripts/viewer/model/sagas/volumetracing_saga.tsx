import { diffDiffableMaps } from "libs/diffable_map";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import memoizeOne from "memoize-one";
import type { ContourMode, OrthoView, OverwriteMode, Vector3 } from "viewer/constants";
import { ContourModeEnum, OrthoViews, OverwriteModeEnum } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { CONTOUR_COLOR_DELETE, CONTOUR_COLOR_NORMAL } from "viewer/geometries/helper_geometries";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";

import messages from "messages";
import type { ActionPattern } from "redux-saga/effects";
import { actionChannel, call, fork, put, takeEvery, takeLatest } from "typed-redux-saga";
import {
  getSupportedValueRangeOfLayer,
  isInSupportedValueRangeForLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  isBrushTool,
  isTraceTool,
  isVolumeDrawingTool,
} from "viewer/model/accessors/tool_accessor";
import { calculateMaybeGlobalPos } from "viewer/model/accessors/view_mode_accessor";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracing,
  getMaximumBrushSize,
  getRenderableMagForSegmentationTracing,
  getRequestedOrVisibleSegmentationLayer,
  getSegmentsForLayer,
  isVolumeAnnotationDisallowedForZoom,
} from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import type {
  AddAdHocMeshAction,
  AddPrecomputedMeshAction,
} from "viewer/model/actions/annotation_actions";
import {
  updateTemporarySettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { setBusyBlockingInfoAction, setToolAction } from "viewer/model/actions/ui_actions";
import type {
  ClickSegmentAction,
  CreateCellAction,
  DeleteSegmentDataAction,
  SetActiveCellAction,
} from "viewer/model/actions/volumetracing_actions";
import {
  finishAnnotationStrokeAction,
  registerLabelPointAction,
  setSelectedSegmentsOrGroupAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { markVolumeTransactionEnd } from "viewer/model/bucket_data_handling/bucket";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select, take } from "viewer/model/sagas/effect-generators";
import listenToMinCut from "viewer/model/sagas/min_cut_saga";
import listenToQuickSelect from "viewer/model/sagas/quick_select_saga";
import {
  requestBucketModificationInVolumeTracing,
  takeEveryUnlessBusy,
  takeWithBatchActionSupport,
} from "viewer/model/sagas/saga_helpers";
import {
  type UpdateActionWithoutIsolationRequirement,
  createSegmentVolumeAction,
  deleteSegmentDataVolumeAction,
  deleteSegmentVolumeAction,
  removeFallbackLayer,
  updateActiveSegmentId,
  updateLargestSegmentId,
  updateMappingName,
  updateSegmentGroups,
  updateSegmentGroupsExpandedState,
  updateSegmentVolumeAction,
  updateUserBoundingBoxVisibilityInVolumeTracing,
  updateUserBoundingBoxesInVolumeTracing,
} from "viewer/model/sagas/update_actions";
import type VolumeLayer from "viewer/model/volumetracing/volumelayer";
import { Model, api } from "viewer/singletons";
import type { SegmentMap, VolumeTracing } from "viewer/store";
import { pushSaveQueueTransaction } from "../actions/save_actions";
import { diffGroups, diffUserBoundingBoxes } from "../helpers/diff_helpers";
import { ensureWkReady } from "./ready_sagas";
import { floodFill } from "./volume/floodfill_saga";
import { type BooleanBox, createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import maybeInterpolateSegmentationLayer from "./volume/volume_interpolation_saga";

const OVERWRITE_EMPTY_WARNING_KEY = "OVERWRITE-EMPTY-WARNING";

export function* watchVolumeTracingAsync(): Saga<void> {
  yield* call(ensureWkReady);
  yield* takeEveryUnlessBusy(
    "INTERPOLATE_SEGMENTATION_LAYER",
    maybeInterpolateSegmentationLayer,
    "Interpolating segment",
  );
  yield* fork(warnOfTooLowOpacity);
}

function* warnOfTooLowOpacity(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");

  if (yield* select((state) => state.annotation.volumes.length === 0)) {
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

function* warnAboutInvalidSegmentId(): Saga<void> {
  yield* takeWithBatchActionSupport("INITIALIZE_VOLUMETRACING");
  while (true) {
    const action = (yield* take(["SET_ACTIVE_CELL", "CREATE_CELL"]) as any) as
      | SetActiveCellAction
      | CreateCellAction;
    const currentSegmentId = yield* select(
      (state) => enforceActiveVolumeTracing(state).activeCellId,
    );
    const requestedSegmentId =
      action.type === "CREATE_CELL" ? action.newSegmentId : action.segmentId;

    if (requestedSegmentId === currentSegmentId) {
      continue;
    }

    const dataset = yield* select((state) => state.dataset);
    const volumeTracing = yield* select(enforceActiveVolumeTracing);
    const segmentationLayer = yield* call(
      [Model, Model.getSegmentationTracingLayer],
      volumeTracing.tracingId,
    );
    if (!isInSupportedValueRangeForLayer(dataset, segmentationLayer.name, requestedSegmentId)) {
      const validRange = getSupportedValueRangeOfLayer(dataset, segmentationLayer.name);
      Toast.warning(messages["tracing.segment_id_out_of_bounds"](requestedSegmentId, validRange));
    }
  }
}

export function* editVolumeLayerAsync(): Saga<any> {
  // Waiting for the initialization is important. Otherwise, allowUpdate would be
  // false and the saga would terminate.
  yield* takeWithBatchActionSupport("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);

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

    if (activeTool === AnnotationTool.MOVE) {
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

      if (V3.equals(lastPosition, addToLayerAction.position)) {
        // The voxel position did not change since the last action (the mouse moved
        // within a voxel). There is no need to do anything.
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

export function* ensureToolIsAllowedInMag(): Saga<void> {
  yield* takeWithBatchActionSupport("INITIALIZE_VOLUMETRACING");

  while (true) {
    yield* take(["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP"]);
    const isMagTooLow = yield* select((state) => {
      const { activeTool } = state.uiInformation;
      return isVolumeAnnotationDisallowedForZoom(activeTool, state);
    });

    if (isMagTooLow) {
      yield* put(setToolAction(AnnotationTool.MOVE));
    }
  }
}

export const cachedDiffSegmentLists = memoizeOne(
  (tracingId: string, prevSegments: SegmentMap, newSegments: SegmentMap) =>
    Array.from(uncachedDiffSegmentLists(tracingId, prevSegments, newSegments)),
);

function* uncachedDiffSegmentLists(
  tracingId: string,
  prevSegments: SegmentMap,
  newSegments: SegmentMap,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  const {
    onlyA: deletedSegmentIds,
    onlyB: addedSegmentIds,
    changed: bothSegmentIds,
  } = diffDiffableMaps(prevSegments, newSegments);

  for (const segmentId of deletedSegmentIds) {
    yield deleteSegmentVolumeAction(segmentId, tracingId);
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
      tracingId,
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
        tracingId,
        segment.creationTime,
      );
    }
  }
}

export function* diffVolumeTracing(
  prevVolumeTracing: VolumeTracing,
  volumeTracing: VolumeTracing,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevVolumeTracing === volumeTracing) {
    return;
  }
  if (prevVolumeTracing.activeCellId !== volumeTracing.activeCellId) {
    yield updateActiveSegmentId(volumeTracing.activeCellId, volumeTracing.tracingId);
  }
  if (prevVolumeTracing.largestSegmentId !== volumeTracing.largestSegmentId) {
    yield updateLargestSegmentId(volumeTracing.largestSegmentId, volumeTracing.tracingId);
  }

  const boxDiff = diffUserBoundingBoxes(
    prevVolumeTracing.userBoundingBoxes,
    volumeTracing.userBoundingBoxes,
  );
  if (boxDiff.didContentChange) {
    yield updateUserBoundingBoxesInVolumeTracing(
      volumeTracing.userBoundingBoxes,
      volumeTracing.tracingId,
    );
  }

  for (const id of boxDiff.newlyVisibleIds) {
    yield updateUserBoundingBoxVisibilityInVolumeTracing(id, true, volumeTracing.tracingId);
  }

  for (const id of boxDiff.newlyInvisibleIds) {
    yield updateUserBoundingBoxVisibilityInVolumeTracing(id, false, volumeTracing.tracingId);
  }

  if (prevVolumeTracing.segments !== volumeTracing.segments) {
    for (const action of cachedDiffSegmentLists(
      volumeTracing.tracingId,
      prevVolumeTracing.segments,
      volumeTracing.segments,
    )) {
      yield action;
    }
  }

  const groupDiff = diffGroups(prevVolumeTracing.segmentGroups, volumeTracing.segmentGroups);

  if (groupDiff.didContentChange) {
    // The groups (without isExpanded) actually changed. Save them to the server.
    yield updateSegmentGroups(volumeTracing.segmentGroups, volumeTracing.tracingId);
  }

  if (groupDiff.newlyExpandedIds.length > 0) {
    yield updateSegmentGroupsExpandedState(
      groupDiff.newlyExpandedIds,
      true,
      volumeTracing.tracingId,
    );
  }
  if (groupDiff.newlyNotExpandedIds.length > 0) {
    yield updateSegmentGroupsExpandedState(
      groupDiff.newlyNotExpandedIds,
      false,
      volumeTracing.tracingId,
    );
  }

  if (prevVolumeTracing.fallbackLayer != null && volumeTracing.fallbackLayer == null) {
    yield removeFallbackLayer(volumeTracing.tracingId);
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
      volumeTracing.tracingId,
    );
    yield action;
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
      pushSaveQueueTransaction([deleteSegmentDataVolumeAction(action.segmentId, action.layerName)]),
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
  warnAboutInvalidSegmentId,
];
