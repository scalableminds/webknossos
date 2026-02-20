import type { MenuProps } from "antd";
import { useDispatch } from "react-redux";
import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
  refreshMeshAction,
  removeMeshAction,
  updateMeshVisibilityAction,
} from "viewer/model/actions/annotation_actions";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { deleteNodeAsUserAction } from "viewer/model/actions/skeletontracing_actions_with_effects";
import { hideContextMenuAction } from "viewer/model/actions/ui_actions";
import { setActiveCellAction } from "viewer/model/actions/volumetracing_actions";
import Store from "viewer/store";

export function useContextMenuActions() {
  const dispatch = useDispatch();

  return {
    deleteNode: (nodeId: number, treeId: number) => {
      dispatch(deleteNodeAsUserAction(Store.getState(), nodeId, treeId));
    },

    setActiveCell: (
      segmentId: number,
      somePosition?: Vector3,
      someAdditionalCoordinates?: AdditionalCoordinate[],
      maybeUnmappedSegmentId?: number,
    ) => {
      dispatch(
        setActiveCellAction(
          segmentId,
          somePosition,
          someAdditionalCoordinates,
          maybeUnmappedSegmentId,
        ),
      );
    },

    setBoundingBoxName: (id: number, name: string) => {
      dispatch(
        changeUserBoundingBoxAction(id, {
          name,
        }),
      );
    },

    setBoundingBoxColor: (id: number, color: Vector3) => {
      dispatch(
        changeUserBoundingBoxAction(id, {
          color,
        }),
      );
    },

    deleteBoundingBox: (id: number) => {
      dispatch(deleteUserBoundingBoxAction(id));
    },

    hideBoundingBox: (id: number) => {
      dispatch(
        changeUserBoundingBoxAction(id, {
          isVisible: false,
        }),
      );
    },

    removeMesh: (layerName: string, meshId: number) => {
      dispatch(removeMeshAction(layerName, meshId));
    },

    hideMesh: (layerName: string, meshId: number) => {
      dispatch(
        updateMeshVisibilityAction(
          layerName,
          meshId,
          false,
          Store.getState().flycam.additionalCoordinates,
        ),
      );
    },

    setPosition: (position: Vector3) => {
      dispatch(setPositionAction(position));
    },

    refreshMesh: (layerName: string, segmentId: number) => {
      dispatch(refreshMeshAction(layerName, segmentId));
    },

    hideContextMenu: () => {
      dispatch(hideContextMenuAction());
    },
  };
}

// Keep the global hideContextMenu for non-React contexts or where it's simpler
export const hideContextMenu = (
  info?: Parameters<NonNullable<MenuProps["onClick"]>>[0] | undefined,
) => {
  if (info?.key === "load-stats") {
    return;
  }
  Store.dispatch(hideContextMenuAction());
};
