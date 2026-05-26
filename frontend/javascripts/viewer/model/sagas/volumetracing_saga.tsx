import LinkButton from "components/link_button";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import messages from "messages";
import type { Channel } from "redux-saga";
import type { ActionPattern } from "redux-saga/effects";
import { actionChannel, call, fork, put, takeEvery, takeLatest } from "typed-redux-saga";
import type { BucketAddress, ContourMode, OverwriteMode, Vector3 } from "viewer/constants";
import Constants, { ContourModeEnum, OrthoViews, OverwriteModeEnum } from "viewer/constants";
import { getSegmentIdInfoForPosition } from "viewer/controller/combinations/volume_handlers";
import getSceneController from "viewer/controller/scene_controller_provider";
import { CONTOUR_COLOR_DELETE, CONTOUR_COLOR_NORMAL } from "viewer/geometries/helper_geometries";
import {
  getLayerByName,
  getMagInfo,
  getSupportedValueRangeOfLayer,
  isInSupportedValueRangeForLayer,
} from "viewer/model/accessors/dataset_accessor";
import { layerToGlobalTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  AnnotationTool,
  isBrushTool,
  isTraceTool,
  isVolumeDrawingTool,
} from "viewer/model/accessors/tool_accessor";
import { getGlobalMousePositionFloating } from "viewer/model/accessors/view_mode_accessor";
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
  setAdditionalCoordinatesAction,
  setPositionAction,
} from "viewer/model/actions/flycam_actions";
import {
  updateTemporarySettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { setBusyBlockingInfoAction, setToolAction } from "viewer/model/actions/ui_actions";
import type {
  ClickSegmentAction,
  CreateCellAction,
  DeleteSegmentDataAction,
  NavigateToSegmentAction,
  SetActiveCellAction,
} from "viewer/model/actions/volumetracing_actions";
import {
  finishAnnotationStrokeAction,
  registerLabelPointAction,
  removeSegmentAction,
  setSelectedSegmentsOrGroupAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { markVolumeTransactionEnd } from "viewer/model/bucket_data_handling/bucket";
import type { globalPositionToBucketPosition } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select, take } from "viewer/model/sagas/effect_generators";
import {
  requestBucketModificationInVolumeTracing,
  takeEveryUnlessBusy,
  takeWithBatchActionSupport,
} from "viewer/model/sagas/saga_helpers";
import listenToMinCut from "viewer/model/sagas/volume/min_cut_saga";
import listenToQuickSelect from "viewer/model/sagas/volume/quick_select/quick_select_saga";
import { deleteSegmentDataVolumeAction } from "viewer/model/sagas/volume/update_actions";
import type SectionLabeler from "viewer/model/volumetracing/section_labeling";
import type { TransformedSectionLabeler } from "viewer/model/volumetracing/section_labeling";
import { api, Model } from "viewer/singletons";
import Store from "viewer/store";
import { pushSaveQueueTransaction } from "../actions/save_actions";
import { ensureWkInitialized } from "./ready_sagas";
import { floodFill } from "./volume/floodfill_saga";
import { type BooleanBox, createSectionLabeler, labelWithVoxelBuffer2D } from "./volume/helpers";
import maybeInterpolateSegmentationLayer from "./volume/volume_interpolation_saga";

const OVERWRITE_EMPTY_WARNING_KEY = "OVERWRITE-EMPTY-WARNING";

function* watchVolumeTracingAsync(): Saga<void> {
  yield* call(ensureWkInitialized);
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

export function* editVolumeLayerAsync(): Saga<never> {
  // Waiting for the initialization is important. Otherwise, allowUpdate would be
  // false and the saga would terminate.
  yield* takeWithBatchActionSupport("INITIALIZE_VOLUMETRACING");

  while (true) {
    const startEditingAction = yield* take("START_EDITING");
    const allowUpdate = yield* select((state) => state.annotation.isUpdatingCurrentlyAllowed);
    if (!allowUpdate) {
      continue;
    }
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
          anchorPosition: startEditingAction.positionInLayerSpace,
          additionalCoordinates: additionalCoordinates || undefined,
        },
        volumeTracing.tracingId,
      ),
    );
    const { zoomStep: labeledZoomStep, mag: labeledMag } = maybeLabeledMagWithZoomStep;

    const currentSectionLabeler = yield* call(
      createSectionLabeler,
      volumeTracing,
      startEditingAction.planeId,
      labeledMag,
      (thirdDim) => startEditingAction.positionInLayerSpace[thirdDim],
    );
    const initialViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

    if (isBrushTool(activeTool)) {
      yield* call(
        labelWithVoxelBuffer2D,
        currentSectionLabeler.getCircleVoxelBuffer2D(startEditingAction.positionInLayerSpace),
        contourTracingMode,
        overwriteMode,
        labeledZoomStep,
        currentSectionLabeler.getPlane(),
        wroteVoxelsBox,
      );
    }

    let lastPosition = startEditingAction.positionInLayerSpace;
    const channel: Channel<Action> = yield* actionChannel([
      "ADD_TO_CONTOUR_LIST",
      "FINISH_EDITING",
    ]);

    while (true) {
      const currentAction = yield* take(channel);
      const { addToContourListAction, finishEditingAction } = {
        addToContourListAction: currentAction.type === "ADD_TO_CONTOUR_LIST" ? currentAction : null,
        finishEditingAction: currentAction.type === "FINISH_EDITING" ? currentAction : null,
      };
      if (finishEditingAction) break;

      if (!addToContourListAction || addToContourListAction.type !== "ADD_TO_CONTOUR_LIST") {
        throw new Error("Unexpected action. Satisfy typescript.");
      }

      const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

      if (initialViewport !== activeViewport) {
        // if the current viewport does not match the initial viewport -> dont draw
        continue;
      }

      if (V3.equals(lastPosition, addToContourListAction.positionInLayerSpace)) {
        // The voxel position did not change since the last action (the mouse moved
        // within a voxel). There is no need to do anything.
        continue;
      }

      if (isTraceTool(activeTool) || (isBrushTool(activeTool) && isDrawing)) {
        // Close the polygon. When brushing, this causes an auto-fill which is why
        // it's only performed when drawing (not when erasing).
        currentSectionLabeler.updateArea(addToContourListAction.positionInLayerSpace);
      }

      if (isBrushTool(activeTool)) {
        const rectangleVoxelBuffer2D = currentSectionLabeler.getRectangleVoxelBuffer2D(
          lastPosition,
          addToContourListAction.positionInLayerSpace,
        );

        if (rectangleVoxelBuffer2D) {
          yield* call(
            labelWithVoxelBuffer2D,
            rectangleVoxelBuffer2D,
            contourTracingMode,
            overwriteMode,
            labeledZoomStep,
            currentSectionLabeler.getPlane(),
            wroteVoxelsBox,
          );
        }

        yield* call(
          labelWithVoxelBuffer2D,
          currentSectionLabeler.getCircleVoxelBuffer2D(addToContourListAction.positionInLayerSpace),
          contourTracingMode,
          overwriteMode,
          labeledZoomStep,
          currentSectionLabeler.getPlane(),
          wroteVoxelsBox,
        );
      }

      lastPosition = addToContourListAction.positionInLayerSpace;
    }

    yield* call(
      finishSectionLabeler,
      currentSectionLabeler,
      activeTool,
      contourTracingMode,
      overwriteMode,
      labeledZoomStep,
      wroteVoxelsBox,
    );
    // Update the position of the current segment to the last position of the most recent annotation stroke.
    yield* put(
      updateSegmentAction(
        activeCellId,
        {
          anchorPosition: lastPosition,
          additionalCoordinates: additionalCoordinates || undefined,
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

export function* finishSectionLabeler(
  sectionLabeler: SectionLabeler | TransformedSectionLabeler,
  activeTool: AnnotationTool,
  contourTracingMode: ContourMode,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
  wroteVoxelsBox: BooleanBox,
): Saga<void> {
  if (sectionLabeler == null || sectionLabeler.isEmpty()) {
    return;
  }

  if (isVolumeDrawingTool(activeTool)) {
    yield* call(
      labelWithVoxelBuffer2D,
      sectionLabeler.getFillingVoxelBuffer2D(activeTool),
      contourTracingMode,
      overwriteMode,
      labeledZoomStep,
      sectionLabeler.getPlane(),
      wroteVoxelsBox,
    );
  }

  yield* put(registerLabelPointAction(sectionLabeler.getUnzoomedCentroid()));
}

function* ensureToolIsAllowedInMag(): Saga<void> {
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
          anchorPosition: seedPosition,
          additionalCoordinates: seedAdditionalCoordinates,
        },
        layerName,
      ),
    );
  } else if (action.type === "SET_ACTIVE_CELL" || action.type === "CLICK_SEGMENT") {
    // Update the position even if the cell is already registered with a position.
    // This way the most up-to-date position of a cell is used to jump to when a
    // segment is selected in the segment list. Also, the position of the active
    // cell is used in the proofreading mode.
    const { anchorPosition, additionalCoordinates } = action;

    if (anchorPosition == null) {
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
          anchorPosition,
          additionalCoordinates: additionalCoordinates,
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

const SEGMENT_ANCHOR_SEARCH_RADIUS = 150; // voxels in layer space
const SEGMENT_ANCHOR_MISMATCH_TOAST_KEY = "segment-anchor-mismatch";

/**
 * Returns all bucket addresses whose spatial extent overlaps the cubic bounding
 * box `[anchorPosition ± searchRadius]` at the given magnification level.
 *
 * Coordinates are in layer space (voxels at mag 1×1×1).  The returned
 * addresses can be passed directly to `DataCube.getLoadedBucket`.
 */
function getBucketAddressesInBoundingBox(
  anchorPosition: Vector3,
  searchRadius: number,
  magIndex: number,
  denseMags: Array<Vector3>,
  additionalCoords: Parameters<typeof globalPositionToBucketPosition>[3],
): BucketAddress[] {
  const mag = denseMags[magIndex] ?? ([1, 1, 1] as Vector3);
  const BW = Constants.BUCKET_WIDTH;
  const addresses: BucketAddress[] = [];

  for (let dim = 0; dim < 3; dim++) {
    if (anchorPosition[dim] < 0) return addresses; // degenerate anchor
  }
  const bucketScale: Vector3 = [BW * mag[0], BW * mag[1], BW * mag[2]];
  const searchRadiusVec: Vector3 = [searchRadius, searchRadius, searchRadius];
  const minBucket = V3.max(
    V3.floor(V3.divide3(V3.sub(anchorPosition, searchRadiusVec), bucketScale)),
    [0, 0, 0],
  );
  const maxBucket = V3.floor(V3.divide3(V3.add(anchorPosition, searchRadiusVec), bucketScale));

  for (let bucketX = minBucket[0]; bucketX <= maxBucket[0]; bucketX++) {
    for (let bucketY = minBucket[1]; bucketY <= maxBucket[1]; bucketY++) {
      for (let bucketZ = minBucket[2]; bucketZ <= maxBucket[2]; bucketZ++) {
        addresses.push([bucketX, bucketY, bucketZ, magIndex, additionalCoords || []]);
      }
    }
  }
  return addresses;
}

/**
 * Searches for a voxel with `segmentId` within a cubic bounding box of radius
 * `SEGMENT_ANCHOR_SEARCH_RADIUS` around `anchorPosition` in layer space.
 *
 * Iterates over the overlapping buckets at the finest available magnification.
 * Each bucket is loaded on-demand; buckets that do not contain the target value
 * are skipped via `bucket.containsValue` (O(1) Set lookup) before scanning the
 * raw voxel data.
 *
 * Returns the layer-space position of the first matching voxel, or `null` if
 * the segment is not found within the search radius.
 */
function* searchSegmentInBoundingBox(
  layerName: string,
  anchorPosition: Vector3,
  segmentId: number,
  additionalCoordinates: Parameters<typeof globalPositionToBucketPosition>[3],
): Saga<Vector3 | null> {
  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  const magInfo = getMagInfo(layerInfo.mags);
  const finestMagIndex = magInfo.getFinestMagIndex();
  const denseMags = magInfo.getDenseMags();
  const mag = denseMags[finestMagIndex] ?? ([1, 1, 1] as Vector3);
  const cube = Model.getCubeByLayerName(layerName);
  const BW = Constants.BUCKET_WIDTH;

  const bucketAddresses = getBucketAddressesInBoundingBox(
    anchorPosition,
    SEGMENT_ANCHOR_SEARCH_RADIUS,
    finestMagIndex,
    denseMags,
    additionalCoordinates,
  );

  for (const bucketAddress of bucketAddresses) {
    const bucket = yield* call([cube, cube.getLoadedBucket], bucketAddress);
    if (bucket.type === "null" || !bucket.hasData()) continue;
    if (!bucket.containsValue(segmentId)) continue;

    const data = bucket.getData();
    const [bucketX, bucketY, bucketZ] = bucketAddress;
    for (let i = 0; i < data.length; i++) {
      if (Number(data[i]) === segmentId) {
        const offsetX = i % BW;
        const offsetY = Math.floor(i / BW) % BW;
        const offsetZ = Math.floor(i / (BW * BW));
        return [
          (bucketX * BW + offsetX) * mag[0],
          (bucketY * BW + offsetY) * mag[1],
          (bucketZ * BW + offsetZ) * mag[2],
        ] as Vector3;
      }
    }
  }
  return null;
}

/**
 * Moves the viewport to the given `layerPosition` (layer space) by converting
 * it to global space via the layer's transform and dispatching the appropriate
 * flycam actions.  Also updates the additional coordinates when provided.
 */
function* navigateToLayerPosition(
  layerName: string,
  layerPosition: Vector3,
  additionalCoordinates: Parameters<typeof globalPositionToBucketPosition>[3],
): Saga<void> {
  const state = yield* select((s) => s);
  const globalPosition = layerToGlobalTransformedPosition(
    layerPosition,
    layerName,
    "segmentation",
    state,
  );
  yield* put(setPositionAction(globalPosition));
  if (additionalCoordinates != null && additionalCoordinates.length > 0) {
    yield* put(setAdditionalCoordinatesAction(additionalCoordinates));
  }
}

function* navigateToSegment(action: NavigateToSegmentAction): Saga<void> {
  const { segmentId, anchorPosition, additionalCoordinates, layerName } = action;

  // Check if the anchor position still contains this segment's ID.
  let anchorValue: number;
  try {
    anchorValue = yield* call(
      [api.data, api.data.getDataValue],
      layerName,
      anchorPosition,
      null,
      additionalCoordinates ?? null,
    );
  } catch (_e) {
    // Data unavailable — navigate anyway without validation.
    yield* call(navigateToLayerPosition, layerName, anchorPosition, additionalCoordinates);
    return;
  }

  if (anchorValue === segmentId) {
    yield* call(navigateToLayerPosition, layerName, anchorPosition, additionalCoordinates);
    return;
  }

  // Anchor is stale — search the surrounding bounding box.
  const foundPosition = yield* call(
    searchSegmentInBoundingBox,
    layerName,
    anchorPosition,
    segmentId,
    additionalCoordinates,
  );

  if (foundPosition != null) {
    yield* call(navigateToLayerPosition, layerName, foundPosition, additionalCoordinates);
    yield* put(updateSegmentAction(segmentId, { anchorPosition: foundPosition }, layerName));
    return;
  }

  // Segment not found — show an explanatory warning with a remove option.
  Toast.warning(
    <>
      The stored position of segment {segmentId} no longer contains this segment&apos;s ID and could
      not be found nearby — it was likely overwritten. To re-anchor it, activate segment {segmentId}{" "}
      and brush over the desired position.{" "}
      <LinkButton
        onClick={() => {
          Store.dispatch(removeSegmentAction(segmentId, layerName));
          Toast.close(SEGMENT_ANCHOR_MISMATCH_TOAST_KEY);
        }}
      >
        Remove segment
      </LinkButton>
    </>,
    { key: SEGMENT_ANCHOR_MISMATCH_TOAST_KEY, sticky: true },
  );
}

function* watchNavigateToSegment(): Saga<void> {
  yield* takeEvery("NAVIGATE_TO_SEGMENT", navigateToSegment);
}

function* updateHoveredSegmentId(): Saga<void> {
  const activeViewport = yield* select((store) => store.viewModeData.plane.activeViewport);

  if (activeViewport === OrthoViews.TDView) {
    return;
  }

  const globalMousePosition = yield* select(getGlobalMousePositionFloating);

  // Note that `id` can be an unmapped id even when
  // a mapping is active, if it is a HDF5 mapping that is partially loaded
  // and no entry exists yet for the input id.
  const { mapped: id, unmapped: unmappedId } =
    globalMousePosition != null
      ? getSegmentIdInfoForPosition(globalMousePosition)
      : { mapped: 0, unmapped: 0 };

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

function* updateClickedSegments(action: ClickSegmentAction | SetActiveCellAction): Saga<void> {
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

function* maintainHoveredSegmentId(): Saga<void> {
  yield* takeLatest("SET_MOUSE_POSITION", updateHoveredSegmentId);
}

function* maintainContourGeometry(): Saga<void> {
  yield* take("SCENE_CONTROLLER_INITIALIZED");
  const SceneController = yield* call(getSceneController);
  const { contour } = SceneController;

  while (true) {
    yield* take(["ADD_TO_CONTOUR_LIST", "RESET_CONTOUR"]);
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
    contourList.forEach((p) => {
      contour.addEdgePoint(p);
    });
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
      "WK_INITIALIZED",
      (action: Action) =>
        action.type === "UPDATE_LAYER_SETTING" && action.propertyName === "isDisabled",
    ] as ActionPattern<Action>,
    maybeClampBrushSize,
  );
}

function* handleDeleteSegmentData(): Saga<void> {
  yield* take("WK_INITIALIZED");
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
  watchNavigateToSegment,
];
