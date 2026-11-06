import { toBigInt } from "libs/bigint_helpers";
import type { AdditionalCoordinate } from "types/api_types";
import type { OrthoView, Point2, Vector3 } from "viewer/constants";
import { ContourModeEnum } from "viewer/constants";
import {
  getLayerByName,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getTransformsForLayer,
  globalToLayerTransformedPosition,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  calculateGlobalPos,
  type PositionWithRounding,
} from "viewer/model/accessors/view_mode_accessor";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  addToContourListAction,
  finishEditingAction,
  floodFillAction,
  resetContourAction,
  setActiveCellAction,
  setContourTracingModeAction,
  startEditingAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import {
  getMappedId,
  getMappedIdAsync,
  getRenderedSegmentId,
  type MappedIdResult,
} from "viewer/model/helpers/mapped_id_lookup";
import {
  invertTransform,
  transformPointUnscaled,
} from "viewer/model/helpers/transformation_helpers";
import { api, Model, Store } from "viewer/singletons";
import type { WebknossosState } from "viewer/store";

export function handleDrawStart(pos: Point2, plane: OrthoView) {
  const state = Store.getState();
  const { layerPos, floatingLayerPos } = getLayerPositions(state, pos);

  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DRAW));
  Store.dispatch(startEditingAction(layerPos, plane, floatingLayerPos));
  Store.dispatch(addToContourListAction(layerPos, floatingLayerPos));
}

function getLayerPositions(state: WebknossosState, pos: Point2) {
  const { rounded, floating } = calculateGlobalPos(state, pos);
  return {
    layerPos: getUntransformedSegmentationPosition(state, rounded),
    floatingLayerPos: getUntransformedSegmentationPosition(state, floating),
  };
}

function getUntransformedSegmentationPosition(state: WebknossosState, globalPos: Vector3) {
  /*
   * Converts the given position from world space to layer space.
   */
  const { nativelyRenderedLayerName } = state.datasetConfiguration;
  const maybeLayer = Model.getVisibleSegmentationLayer();
  if (maybeLayer == null) {
    throw new Error("Segmentation layer does not exist");
  }

  const layer = getLayerByName(state.dataset, maybeLayer.name);
  const segmentationTransforms = getTransformsForLayer(
    state.dataset,
    layer,
    nativelyRenderedLayerName,
  );
  const layerPos = transformPointUnscaled(invertTransform(segmentationTransforms))(globalPos);
  return layerPos;
}

export function handleEraseStart(pos: Point2, plane: OrthoView) {
  const state = Store.getState();
  const { layerPos, floatingLayerPos } = getLayerPositions(state, pos);

  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(startEditingAction(layerPos, plane, floatingLayerPos));
  Store.dispatch(addToContourListAction(layerPos, floatingLayerPos));
}

export function handleMoveForDrawOrErase(pos: Point2) {
  const state = Store.getState();
  const { layerPos, floatingLayerPos } = getLayerPositions(state, pos);
  Store.dispatch(addToContourListAction(layerPos, floatingLayerPos));
}

export function handleEndForDrawOrErase() {
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}

export function handlePickCell(pos: Point2) {
  const state = Store.getState();
  const globalPos = calculateGlobalPos(state, pos);

  return handlePickCellFromGlobalPosition(globalPos, state.flycam.additionalCoordinates || []);
}

function getUnmappedSegmentIdForPositionInLayer(
  layerName: string,
  posInLayerSpace: Vector3,
  zoomStep: number,
): bigint {
  return toBigInt(
    Model.getCubeByLayerName(layerName).getDataValue(
      posInLayerSpace,
      Store.getState().flycam.additionalCoordinates,
      null,
      zoomStep,
    ),
  );
}

function getSegmentIdInfoForPositionSync(
  globalPos: Vector3,
): { mapped: bigint | null; unmapped: bigint } | null {
  // This function will return the currently loaded segment ID for a given position.
  // If the corresponding bucket is not loaded at the moment, the unmapped id will be 0.
  // `mapped` is null if the local mapping doesn't know the unmapped id (yet).
  // See getRenderedSegmentIdForPositionAsync if the loading should be awaited.
  const layer = Model.getVisibleSegmentationLayer();
  if (!layer) {
    return null;
  }
  const state = Store.getState();
  const posInLayerSpace = globalToLayerTransformedPosition(
    globalPos,
    layer.name,
    "segmentation",
    state,
  );
  const renderedZoomStepForCameraPosition = api.data.getRenderedZoomStepAtPosition(
    layer.name,
    posInLayerSpace,
  );
  const unmapped = getUnmappedSegmentIdForPositionInLayer(
    layer.name,
    posInLayerSpace,
    renderedZoomStepForCameraPosition,
  );
  const mapped = getRenderedSegmentId(
    state,
    layer.name,
    unmapped,
    getMappedId(state, layer.name, unmapped),
  );
  return { mapped, unmapped };
}

// This must not be memoized: the mapped segment id at a given position can change
// even when the position stays the same e.g. due to a foreign proofreading action.
// Returns 0 if the local mapping doesn't know the segment id at the position (yet),
// so that it is treated like a position without a segment.
export const getSegmentIdForPosition = (globalPos: Vector3): bigint =>
  getSegmentIdInfoForPositionSync(globalPos)?.mapped ?? 0n;

// This must not be memoized on the position either: the looked-up value still depends on live
// state that is read inside the function (visible segmentation layer, additional coordinates,
// rendered zoom step) and can change while the queried position stays the same.
export const getUnmappedSegmentIdForPosition = (globalPos: Vector3): bigint =>
  getSegmentIdInfoForPositionSync(globalPos)?.unmapped ?? 0n;

// Not memoized for the same reasons as above: the returned mapped id can change due to foreign
// proofreading actions and the lookup depends on live state, so caching on the position can go stale.
// As in getSegmentIdForPosition, the mapped id is 0 if the local mapping doesn't know it (yet).
export const getSegmentIdInfoForPosition = (globalPos: Vector3) => {
  const info = getSegmentIdInfoForPositionSync(globalPos);
  return { mapped: info?.mapped ?? 0n, unmapped: info?.unmapped ?? 0n };
};

export async function getSegmentIdInfoForPositionAsync(
  layerName: string,
  globalPos: Vector3,
  fetchIfUnknown: boolean,
): Promise<{ unmappedId: bigint; mappedId: MappedIdResult }> {
  // Awaits the loading of the bucket at the given position. If fetchIfUnknown is true and the
  // local mapping doesn't know the unmapped id, the mapped id is fetched from the server.
  const posInLayerSpace = globalToLayerTransformedPosition(
    globalPos,
    layerName,
    "segmentation",
    Store.getState(),
  );
  const renderedZoomStepForCameraPosition = await api.data.getUltimatelyRenderedZoomStepAtPosition(
    layerName,
    posInLayerSpace,
  );
  // Make sure the corresponding bucket is loaded
  await api.data.getDataValue(
    layerName,
    posInLayerSpace,
    renderedZoomStepForCameraPosition,
    Store.getState().flycam.additionalCoordinates,
  );
  const unmappedId = getUnmappedSegmentIdForPositionInLayer(
    layerName,
    posInLayerSpace,
    renderedZoomStepForCameraPosition,
  );
  const mappedId = fetchIfUnknown
    ? await getMappedIdAsync(layerName, unmappedId)
    : getMappedId(Store.getState(), layerName, unmappedId);
  return { unmappedId, mappedId };
}

export async function getRenderedSegmentIdForPositionAsync(
  layerName: string,
  globalPos: Vector3,
): Promise<bigint | null> {
  // Returns the id with which the segment at the given position is rendered, awaiting the
  // loading of the bucket and fetching the mapped id from the server if necessary.
  // Returns null if the id can't be determined.
  // See getSegmentIdForPosition if the loading should not be awaited.
  const { unmappedId, mappedId } = await getSegmentIdInfoForPositionAsync(
    layerName,
    globalPos,
    true,
  );
  return getRenderedSegmentId(Store.getState(), layerName, unmappedId, mappedId);
}

function handlePickCellFromGlobalPosition(
  globalPos: PositionWithRounding,
  additionalCoordinates: AdditionalCoordinate[],
) {
  const segmentId = getSegmentIdInfoForPositionSync(globalPos.rounded)?.mapped;

  // Don't pick an id that the local mapping doesn't know (yet).
  if (segmentId == null || segmentId < 0n) {
    return;
  }
  const visibleSegmentationLayer = getVisibleSegmentationLayer(Store.getState());
  if (visibleSegmentationLayer == null) {
    return;
  }
  const state = Store.getState();
  const layerPos = getUntransformedSegmentationPosition(state, globalPos.floating);
  Store.dispatch(setActiveCellAction(segmentId, layerPos, additionalCoordinates));

  Store.dispatch(
    updateSegmentAction(
      segmentId,
      {
        isVisible: true,
      },
      visibleSegmentationLayer.name,
      undefined,
      true,
    ),
  );
}

export function handleFloodFill(state: WebknossosState, screenPos: Point2, plane: OrthoView) {
  const globalPosRounded = calculateGlobalPos(Store.getState(), screenPos).rounded;
  handleFloodFillFromGlobalPosition(state, globalPosRounded, plane);
}

export function handleFloodFillFromGlobalPosition(
  state: WebknossosState,
  globalPos: Vector3,
  plane: OrthoView,
) {
  const positionInLayerSpace = getUntransformedSegmentationPosition(state, globalPos);
  Store.dispatch(floodFillAction(positionInLayerSpace, plane));
}

const MAX_BRUSH_CHANGE_VALUE = 5;
const BRUSH_CHANGING_CONSTANT = 0.02;

export function changeBrushSizeIfBrushIsActiveBy(factor: number) {
  const currentBrushSize = Store.getState().userConfiguration.brushSize;
  const newBrushSize =
    Math.min(Math.ceil(currentBrushSize * BRUSH_CHANGING_CONSTANT), MAX_BRUSH_CHANGE_VALUE) *
      factor +
    currentBrushSize;
  Store.dispatch(updateUserSettingAction("brushSize", newBrushSize));
}
