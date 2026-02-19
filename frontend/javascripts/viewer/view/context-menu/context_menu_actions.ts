import type { MenuProps } from "antd";
import type { Dispatch } from "redux";
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

export const Actions = {
  deleteNode(dispatch: Dispatch<any>, nodeId: number, treeId: number) {
    dispatch(deleteNodeAsUserAction(Store.getState(), nodeId, treeId));
  },

  setActiveCell(
    dispatch: Dispatch<any>,
    segmentId: number,
    somePosition?: Vector3,
    someAdditionalCoordinates?: AdditionalCoordinate[],
  ) {
    dispatch(setActiveCellAction(segmentId, somePosition, someAdditionalCoordinates));
  },

  setBoundingBoxName(dispatch: Dispatch<any>, id: number, name: string) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        name,
      }),
    );
  },

  setBoundingBoxColor(dispatch: Dispatch<any>, id: number, color: Vector3) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        color,
      }),
    );
  },

  deleteBoundingBox(dispatch: Dispatch<any>, id: number) {
    dispatch(deleteUserBoundingBoxAction(id));
  },

  hideBoundingBox(dispatch: Dispatch<any>, id: number) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        isVisible: false,
      }),
    );
  },
  removeMesh(dispatch: Dispatch<any>, layerName: string, meshId: number) {
    dispatch(removeMeshAction(layerName, meshId));
  },
  hideMesh(dispatch: Dispatch<any>, layerName: string, meshId: number) {
    dispatch(
      updateMeshVisibilityAction(
        layerName,
        meshId,
        false,
        Store.getState().flycam.additionalCoordinates,
      ),
    );
  },
  setPosition(dispatch: Dispatch<any>, position: Vector3) {
    dispatch(setPositionAction(position));
  },
  refreshMesh(dispatch: Dispatch<any>, layerName: string, segmentId: number) {
    dispatch(refreshMeshAction(layerName, segmentId));
  },
};

export const hideContextMenu = (
  info?: Parameters<NonNullable<MenuProps["onClick"]>>[0] | undefined,
) => {
  if (info?.key === "load-stats") {
    return;
  }
  Store.dispatch(hideContextMenuAction());
};
