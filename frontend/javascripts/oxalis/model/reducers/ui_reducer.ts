import { AnnotationToolEnum, AvailableToolsInViewMode } from "oxalis/constants";
import type { Action } from "oxalis/model/actions/actions";
import { updateKey, updateKey2 } from "oxalis/model/helpers/deep_update";
import {
  getNextTool,
  getPreviousTool,
  setToolReducer,
} from "oxalis/model/reducers/reducer_helpers";
import { hideBrushReducer } from "oxalis/model/reducers/volumetracing_reducer_helpers";
import type { OxalisState } from "oxalis/store";

function UiReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_DROPZONE_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", {
        showDropzoneModal: action.visible,
      });
    }

    case "SET_VERSION_RESTORE_VISIBILITY": {
      return updateKey(state, "uiInformation", {
        showVersionRestore: action.active,
      });
    }

    case "SET_STORED_LAYOUTS": {
      const { storedLayouts } = action;
      return updateKey(state, "uiInformation", {
        storedLayouts,
      });
    }

    case "SET_IMPORTING_MESH_STATE": {
      return updateKey(state, "uiInformation", {
        isImportingMesh: action.isImporting,
      });
    }

    case "SET_IS_IN_ANNOTATION_VIEW": {
      return updateKey(state, "uiInformation", {
        isInAnnotationView: action.value,
      });
    }

    case "SET_HAS_ORGANIZATIONS": {
      return updateKey(state, "uiInformation", {
        hasOrganizations: action.value,
      });
    }

    case "SET_BORDER_OPEN_STATUS": {
      return updateKey(state, "uiInformation", {
        borderOpenStatus: action.borderOpenStatus,
      });
    }

    case "SET_TOOL": {
      if (!state.tracing.restrictions.allowUpdate) {
        if (AvailableToolsInViewMode.includes(AnnotationToolEnum[action.tool])) {
          return setToolReducer(state, action.tool);
        }
        return state;
      }

      return setToolReducer(state, action.tool);
    }

    case "CYCLE_TOOL": {
      if (!state.tracing.restrictions.allowUpdate) {
        return state;
      }

      const nextTool = action.backwards ? getPreviousTool(state) : getNextTool(state);

      if (nextTool == null) {
        // Don't change the current tool if another tool could not be selected.
        return state;
      }

      return setToolReducer(hideBrushReducer(state), nextTool);
    }

    case "SET_THEME": {
      return updateKey(state, "uiInformation", {
        theme: action.value,
      });
    }

    case "SET_DOWNLOAD_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", { showDownloadModal: action.visible });
    }

    case "SET_PYTHON_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", { showPythonClientModal: action.visible });
    }

    case "SET_SHARE_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", {
        showShareModal: action.visible,
      });
    }

    case "SET_AI_JOB_MODAL_STATE": {
      return updateKey(state, "uiInformation", {
        aIJobModalState: action.state,
      });
    }

    case "SET_MERGE_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", {
        showMergeAnnotationModal: action.visible,
      });
    }

    case "SET_USER_SCRIPTS_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", {
        showAddScriptModal: action.visible,
      });
    }

    case "SET_ZARR_LINKS_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", {
        showZarrPrivateLinksModal: action.visible,
      });
    }

    case "SET_CREATE_ANIMATION_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", {
        showRenderAnimationModal: action.visible,
      });
    }

    case "SET_BUSY_BLOCKING_INFO_ACTION": {
      if (action.value.isBusy && state.uiInformation.busyBlockingInfo.isBusy) {
        throw new Error(
          "Busy-mutex violated. Cannot set isBusy to true, as it is already set to true.",
        );
      }

      return updateKey(state, "uiInformation", {
        busyBlockingInfo: action.value,
      });
    }

    case "SET_IS_WK_READY": {
      return updateKey(state, "uiInformation", { isWkReady: action.isReady });
    }
    case "WK_READY": {
      return updateKey(state, "uiInformation", { isWkReady: true });
    }

    case "SET_QUICK_SELECT_STATE": {
      return updateKey(state, "uiInformation", {
        quickSelectState: action.state,
      });
    }

    case "SET_ARE_QUICK_SELECT_SETTINGS_OPEN": {
      return updateKey(state, "uiInformation", {
        areQuickSelectSettingsOpen: action.isOpen,
      });
    }

    case "HIDE_MEASUREMENT_TOOLTIP": {
      return updateKey2(state, "uiInformation", "measurementToolInfo", {
        lastMeasuredPosition: null,
      });
    }

    case "SET_LAST_MEASURED_POSITION": {
      return updateKey2(state, "uiInformation", "measurementToolInfo", {
        lastMeasuredPosition: action.position,
      });
    }
    case "SET_IS_MEASURING": {
      return updateKey2(state, "uiInformation", "measurementToolInfo", {
        isMeasuring: action.isMeasuring,
      });
    }
    case "SET_NAVBAR_HEIGHT": {
      return updateKey(state, "uiInformation", {
        navbarHeight: action.navbarHeight,
      });
    }

    case "SHOW_CONTEXT_MENU": {
      return updateKey2(state, "uiInformation", "contextInfo", {
        contextMenuPosition: action.contextMenuPosition,
        clickedNodeId: action.clickedNodeId,
        clickedBoundingBoxId: action.clickedBoundingBoxId,
        globalPosition: action.globalPosition,
        viewport: action.viewport,
        meshId: action.meshId,
        meshIntersectionPosition: action.meshIntersectionPosition,
        unmappedSegmentId: action.unmappedSegmentId,
      });
    }

    case "HIDE_CONTEXT_MENU": {
      return updateKey2(state, "uiInformation", "contextInfo", {
        contextMenuPosition: null,
        clickedNodeId: null,
        clickedBoundingBoxId: null,
        globalPosition: null,
        viewport: null,
        meshId: null,
        meshIntersectionPosition: null,
        unmappedSegmentId: null,
      });
    }
    case "SET_ACTIVE_USER_BOUNDING_BOX_ID": {
      return updateKey(state, "uiInformation", {
        activeUserBoundingBoxId: action.id,
      });
    }

    case "SET_GLOBAL_PROGRESS": {
      return updateKey(state, "uiInformation", {
        globalProgress: action.value,
      });
    }

    default:
      return state;
  }
}

export default UiReducer;
