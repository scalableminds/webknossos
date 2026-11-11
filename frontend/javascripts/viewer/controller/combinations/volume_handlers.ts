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
import { mapId, mapIdAsync } from "viewer/model/helpers/mapped_id_lookup";
import {
  getTransformPointUnscaledFn,
  invertTransform,
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
  const layerPos = getTransformPointUnscaledFn(invertTransform(segmentationTransforms))(globalPos);
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

// Returns the segment ids that are currently rendered at the given position in the visible
// segmentation layer. Nothing is loaded: if the bucket isn't loaded, both ids are 0. If the
// local mapping doesn't know the unmapped id (yet), the mapped id is 0, because the segment
// isn't rendered then either. Use this for interactions with what the user sees (hover,
// clicks, context menu). See getSegmentIdsAtPositionAsync for positions that may not be loaded.
// This must not be memoized on the position: the result depends on live state (loaded
// buckets, mapping, visible layer, additional coordinates, rendered zoom step), e.g., the
// mapped id can change due to a foreign proofreading action.
export function getSegmentIdsAtPosition(globalPos: Vector3): {
  unmappedId: bigint;
  mappedId: bigint;
} {
  const layer = Model.getVisibleSegmentationLayer();
  if (!layer) {
    return { unmappedId: 0n, mappedId: 0n };
  }
  const state = Store.getState();
  const posInLayerSpace = globalToLayerTransformedPosition(
    globalPos,
    layer.name,
    "segmentation",
    state,
  );
  const renderedZoomStep = api.data.getRenderedZoomStepAtPosition(layer.name, posInLayerSpace);
  const unmappedId = toBigInt(
    Model.getCubeByLayerName(layer.name).getDataValue(
      posInLayerSpace,
      state.flycam.additionalCoordinates,
      null,
      renderedZoomStep,
    ),
  );
  return { unmappedId, mappedId: mapId(state, layer.name, unmappedId) ?? 0n };
}

// Returns the segment ids at the given position in the given layer. Awaits the loading of the
// bucket and fetches the mapped id from the server if the local mapping doesn't know it.
// The mapped id is null if it can't be determined. With fetchUnknownIds: false, the mapped id
// is only looked up locally (null if unknown).
export async function getSegmentIdsAtPositionAsync(
  layerName: string,
  globalPos: Vector3,
  { fetchUnknownIds = true }: { fetchUnknownIds?: boolean } = {},
): Promise<{ unmappedId: bigint; mappedId: bigint | null }> {
  const posInLayerSpace = globalToLayerTransformedPosition(
    globalPos,
    layerName,
    "segmentation",
    Store.getState(),
  );
  const zoomStep = await api.data.getUltimatelyRenderedZoomStepAtPosition(
    layerName,
    posInLayerSpace,
  );
  // Use the returned value instead of reading the cube again, because the additional
  // coordinates might change while the bucket is loading.
  const unmappedId = toBigInt(
    await api.data.getDataValue(
      layerName,
      posInLayerSpace,
      zoomStep,
      Store.getState().flycam.additionalCoordinates,
    ),
  );
  const mappedId = fetchUnknownIds
    ? await mapIdAsync(layerName, unmappedId)
    : mapId(Store.getState(), layerName, unmappedId);
  return { unmappedId, mappedId };
}

function handlePickCellFromGlobalPosition(
  globalPos: PositionWithRounding,
  additionalCoordinates: AdditionalCoordinate[],
) {
  const { mappedId: segmentId } = getSegmentIdsAtPosition(globalPos.rounded);

  if (segmentId < 0n) {
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
