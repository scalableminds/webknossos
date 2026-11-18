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
import { mapId } from "viewer/model/helpers/mapped_id_lookup";
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

// Returns the segment ids that are currently rendered at the given position in the visible
// segmentation layer. Nothing is loaded: if the bucket isn't loaded, both ids are 0. If the
// local mapping doesn't know the unmapped id (yet), the mapped id is 0, because the segment
// isn't rendered then either. If the server applied the mapping to the bucket, the unmapped id
// is null, because it isn't known. Note that the mapped id is also mapped if the zoom limit for
// agglomerate mappings is exceeded (although the mapping isn't rendered then). Use this for interactions with what the user sees (hover,
// clicks, context menu). For positions that may not be loaded, use the front-end API (see
// getLayerPositionAndRenderedZoomStep).
// This must not be memoized on the position: the result depends on live state (loaded
// buckets, mapping, visible layer, additional coordinates, rendered zoom step), e.g., the
// mapped id can change due to a foreign proofreading action.
export function getSegmentIdsAtPosition(globalPos: Vector3): {
  unmappedId: bigint | null;
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
  const cube = Model.getCubeByLayerName(layer.name);
  const { additionalCoordinates } = state.flycam;
  const id = toBigInt(cube.getDataValue(posInLayerSpace, additionalCoordinates, renderedZoomStep));
  const bucket = cube.getBucket(
    cube.positionToZoomedAddress(
      posInLayerSpace.map(Math.floor) as Vector3,
      additionalCoordinates,
      renderedZoomStep,
    ),
  );
  if (bucket.type === "data" && bucket.serverMappingName != null) {
    return { unmappedId: null, mappedId: id };
  }
  return { unmappedId: id, mappedId: mapId(state, layer.name, id) ?? 0n };
}

// Returns the position in the space of the given segmentation layer and the zoom step that will
// ultimately be rendered there. Pass both to the data value methods of the front-end API to read
// the segment id that the user sees (once the data is loaded) at the given global position.
export async function getLayerPositionAndRenderedZoomStep(
  layerName: string,
  globalPos: Vector3,
): Promise<{ positionInLayer: Vector3; zoomStep: number }> {
  const positionInLayer = globalToLayerTransformedPosition(
    globalPos,
    layerName,
    "segmentation",
    Store.getState(),
  );
  const zoomStep = await api.data.getUltimatelyRenderedZoomStepAtPosition(
    layerName,
    positionInLayer,
  );
  return { positionInLayer, zoomStep };
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
