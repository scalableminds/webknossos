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
import type { ServerVolumeTracing } from "types/api_flow_types";
type SegmentUpdateInfo =
  | {
      readonly type: "UPDATE_VOLUME_TRACING";
      readonly volumeTracing: VolumeTracing;
    }
  | {
      readonly type: "UPDATE_LOCAL_SEGMENTATION_DATA";
      readonly layerName: string;
    }
  | {
      readonly type: "NOOP";
    };

function getSegmentUpdateInfo(
  state: OxalisState,
  layerName: string | null | undefined,
): SegmentUpdateInfo {
  // If the the action is referring to a volume tracing, only update
  // the given state if handleVolumeTracing is true.
  // Returns [shouldHandleUpdate, layerName]
  const layer = getRequestedOrVisibleSegmentationLayer(state, layerName);

  if (!layer) {
    return {
      type: "NOOP",
    };
  }

  if (layer.tracingId != null) {
    const volumeTracing = getVolumeTracingById(state.tracing, layer.tracingId);
    return {
      type: "UPDATE_VOLUME_TRACING",
      volumeTracing,
    };
  } else {
    return {
      type: "UPDATE_LOCAL_SEGMENTATION_DATA",
      layerName: layer.name,
    };
  }
}

function handleSetSegments(state: OxalisState, action: SetSegmentsAction) {
  const { segments, layerName } = action;
  const updateInfo = getSegmentUpdateInfo(state, layerName);

  if (updateInfo.type === "NOOP") {
    return state;
  }

  if (updateInfo.type === "UPDATE_VOLUME_TRACING") {
    return updateVolumeTracing(state, updateInfo.volumeTracing.tracingId, {
      segments,
    });
  }

  // Update localSegmentationData
  return updateKey2(state, "localSegmentationData", updateInfo.layerName, {
    segments,
  });
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
  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ somePosition: Vector3; id: num... Remove this comment to see the full error message
  const newSegmentMap = segments.set(segmentId, newSegment);

  if (updateInfo.type === "UPDATE_VOLUME_TRACING") {
    return updateVolumeTracing(state, updateInfo.volumeTracing.tracingId, {
      segments: newSegmentMap,
    });
  }

  // Update localSegmentationData
  return updateKey2(state, "localSegmentationData", updateInfo.layerName, {
    segments: newSegmentMap,
  });
}

export function serverVolumeToClientVolumeTracing(tracing: ServerVolumeTracing): VolumeTracing {
  // As the frontend doesn't know all cells, we have to keep track of the highest id
  // and cannot compute it
  const maxCellId = tracing.largestSegmentId;
  const userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(tracing.userBoundingBoxes);
  const volumeTracing = {
    createdTimestamp: tracing.createdTimestamp,
    type: "volume",
    segments: new DiffableMap(
      tracing.segments.map((segment) => [
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
    tracingId: tracing.id,
    version: tracing.version,
    boundingBox: convertServerBoundingBoxToFrontend(tracing.boundingBox),
    fallbackLayer: tracing.fallbackLayer,
    userBoundingBoxes,
  };
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ createdTimestamp: number; type: string; se... Remove this comment to see the full error message
  return volumeTracing;
}

function VolumeTracingReducer(state: OxalisState, action: VolumeTracingAction): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      const volumeTracing = serverVolumeToClientVolumeTracing(action.tracing);
      const newVolumes = state.tracing.volumes.filter(
        (tracing) => tracing.tracingId !== volumeTracing.tracingId,
      );
      newVolumes.push(volumeTracing);
      const newState = update(state, {
        tracing: {
          volumes: {
            $set: newVolumes,
          },
        },
      });
      return createCellReducer(newState, volumeTracing, action.tracing.activeSegmentId);
    }

    case "SET_SEGMENTS": {
      return handleSetSegments(state, action);
    }

    case "UPDATE_SEGMENT": {
      return handleUpdateSegment(state, action);
    }

    default: // pass
  }

  if (state.tracing.volumes.length === 0) {
    // If no volume exists yet (i.e., it wasn't initialized, yet),
    // the following reducer code should not run.
    return state;
  }

  const volumeLayer = getRequestedOrVisibleSegmentationLayer(state, null);

  if (volumeLayer == null || volumeLayer.tracingId == null) {
    return state;
  }

  const volumeTracing = getVolumeTracingById(state.tracing, volumeLayer.tracingId);

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
}

export default VolumeTracingReducer;
