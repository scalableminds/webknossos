/**
 * volumetracing_reducer.js
 * @flow
 */
import update from "immutability-helper";

import { ContourModeEnum } from "oxalis/constants";
import type { OxalisState, VolumeTracing } from "oxalis/store";
import type {
  VolumeTracingAction,
  UpdateSegmentAction,
  SetSegmentsAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
} from "oxalis/model/reducers/reducer_helpers";
import {
  getVolumeTracing,
  getRequestedOrVisibleSegmentationLayer,
  getVolumeTracingById,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  setActiveCellReducer,
  createCellReducer,
  updateDirectionReducer,
  addToLayerReducer,
  resetContourReducer,
  hideBrushReducer,
  setContourTracingModeReducer,
  setMaxCellReducer,
  updateVolumeTracing,
} from "oxalis/model/reducers/volumetracing_reducer_helpers";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import DiffableMap from "libs/diffable_map";
import * as Utils from "libs/utils";

type SegmentUpdateInfo =
  | {
      +type: "UPDATE_VOLUME_TRACING",
      +volumeTracing: VolumeTracing,
    }
  | {
      +type: "UPDATE_LOCAL_SEGMENTATION_DATA",
      +layerName: string,
    }
  | {
      +type: "NOOP",
    };

function getSegmentUpdateInfo(state: OxalisState, layerName: ?string): SegmentUpdateInfo {
  // If the the action is referring to a volume tracing, only update
  // the given state if handleVolumeTracing is true.
  // Returns [shouldHandleUpdate, layerName]

  const layer = getRequestedOrVisibleSegmentationLayer(state, layerName);
  if (!layer) {
    return { type: "NOOP" };
  }
  if (layer.tracingId != null) {
    const volumeTracing = getVolumeTracingById(state.tracing, layer.tracingId);
    return { type: "UPDATE_VOLUME_TRACING", volumeTracing };
  } else {
    return { type: "UPDATE_LOCAL_SEGMENTATION_DATA", layerName: layer.name };
  }
}

function handleSetSegments(state: OxalisState, action: SetSegmentsAction) {
  const { segments, layerName } = action;

  const updateInfo = getSegmentUpdateInfo(state, layerName);
  if (updateInfo.type === "NOOP") {
    return state;
  }

  if (updateInfo.type === "UPDATE_VOLUME_TRACING") {
    return updateVolumeTracing(state, updateInfo.volumeTracing, { segments });
  }

  // Update localSegmentationData
  return updateKey2(state, "localSegmentationData", updateInfo.layerName, { segments });
}

function handleUpdateSegment(state: OxalisState, action: UpdateSegmentAction) {
  const { segmentId, segment, layerName: _layerName } = action;

  const updateInfo = getSegmentUpdateInfo(state, _layerName);
  if (updateInfo.type === "NOOP") {
    return state;
  }

  const { segments } =
    updateInfo.type === "UPDATE_VOLUME_TRACING"
      ? updateInfo.volumeTracing
      : state.localSegmentationData[updateInfo.layerName];

  const oldSegment = segments.getNullable(segmentId);

  let somePosition;
  if (segment.somePosition) {
    somePosition = Utils.floor3(segment.somePosition);
  } else {
    if (oldSegment == null) {
      // UPDATE_SEGMENT was called for a non-existing segment without providing
      // a position. Ignore this action, as the a segment cannot be created without
      // a position.
      return state;
    }
    somePosition = oldSegment.somePosition;
  }

  const newSegment = {
    // If oldSegment exists, its creationTime will be
    // used by ...oldSegment
    creationTime: action.timestamp,
    ...oldSegment,
    ...segment,
    somePosition,
    id: segmentId,
  };

  const newSegmentMap = segments.set(segmentId, newSegment);

  if (updateInfo.type === "UPDATE_VOLUME_TRACING") {
    return updateVolumeTracing(state, updateInfo.volumeTracing, { segments: newSegmentMap });
  }

  // Update localSegmentationData
  return updateKey2(state, "localSegmentationData", updateInfo.layerName, {
    segments: newSegmentMap,
  });
}

function VolumeTracingReducer(state: OxalisState, action: VolumeTracingAction): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      // As the frontend doesn't know all cells, we have to keep track of the highest id
      // and cannot compute it
      const maxCellId = action.tracing.largestSegmentId;
      const userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(
        action.tracing.userBoundingBoxes,
      );
      const volumeTracing: VolumeTracing = {
        createdTimestamp: action.tracing.createdTimestamp,
        type: "volume",
        segments: new DiffableMap(
          action.tracing.segments.map(segment => [
            segment.segmentId,
            {
              ...segment,
              id: segment.segmentId,
              somePosition: Utils.point3ToVector3(segment.anchorPosition),
            },
          ]),
        ),
        activeCellId: 0,
        lastCentroid: null,
        contourTracingMode: ContourModeEnum.DRAW,
        contourList: [],
        maxCellId,
        tracingId: action.tracing.id,
        version: action.tracing.version,
        boundingBox: convertServerBoundingBoxToFrontend(action.tracing.boundingBox),
        // todo: use AnnotationLayerDescriptor::name here
        // layerName: action.tracing.fallbackLayer || "Volume Tracing",

        fallbackLayer: action.tracing.fallbackLayer,
        userBoundingBoxes,
      };

      // todo: adapt to multiple volumeTracing
      const newState = update(state, { tracing: { volumes: { $set: [volumeTracing] } } });
      return createCellReducer(newState, volumeTracing, action.tracing.activeSegmentId);
    }

    case "SET_SEGMENTS": {
      return handleSetSegments(state, action);
    }

    case "UPDATE_SEGMENT": {
      return handleUpdateSegment(state, action);
    }
    default:
    // pass
  }

  return getVolumeTracing(state.tracing)
    .map(volumeTracing => {
      switch (action.type) {
        case "SET_ACTIVE_CELL": {
          return setActiveCellReducer(state, volumeTracing, action.cellId);
        }

        case "CREATE_CELL": {
          return createCellReducer(state, volumeTracing);
        }

        case "UPDATE_DIRECTION": {
          return updateDirectionReducer(state, volumeTracing, action.centroid);
        }

        case "ADD_TO_LAYER": {
          return addToLayerReducer(state, volumeTracing, action.position);
        }

        case "RESET_CONTOUR": {
          return resetContourReducer(state, volumeTracing);
        }

        case "HIDE_BRUSH": {
          return hideBrushReducer(state);
        }

        case "SET_CONTOUR_TRACING_MODE": {
          return setContourTracingModeReducer(state, volumeTracing, action.mode);
        }

        case "SET_MAX_CELL": {
          return setMaxCellReducer(state, volumeTracing, action.cellId);
        }

        case "FINISH_ANNOTATION_STROKE": {
          // Possibly update the maxCellId after volume annotation
          const { activeCellId, maxCellId } = volumeTracing;
          return setMaxCellReducer(state, volumeTracing, Math.max(activeCellId, maxCellId));
        }

        default:
          return state;
      }
    })
    .getOrElse(state);
}

export default VolumeTracingReducer;
