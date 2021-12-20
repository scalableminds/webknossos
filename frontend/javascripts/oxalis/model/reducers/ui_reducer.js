// @flow

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import { updateKey } from "oxalis/model/helpers/deep_update";
import { setToolReducer, getNextTool } from "oxalis/model/reducers/reducer_helpers";
import { hideBrushReducer } from "oxalis/model/reducers/volumetracing_reducer_helpers";

function UiReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_DROPZONE_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", { showDropzoneModal: action.visible });
    }

    case "SET_VERSION_RESTORE_VISIBILITY": {
      return updateKey(state, "uiInformation", { showVersionRestore: action.active });
    }

    case "SET_STORED_LAYOUTS": {
      const { storedLayouts } = action;
      return updateKey(state, "uiInformation", { storedLayouts });
    }

    case "SET_IMPORTING_MESH_STATE": {
      return updateKey(state, "uiInformation", { isImportingMesh: action.isImporting });
    }

    case "SET_IS_IN_ANNOTATION_VIEW": {
      return updateKey(state, "uiInformation", { isInAnnotationView: action.value });
    }

    case "SET_HAS_ORGANIZATIONS": {
      return updateKey(state, "uiInformation", { hasOrganizations: action.value });
    }

    case "SET_BORDER_OPEN_STATUS": {
      return updateKey(state, "uiInformation", { borderOpenStatus: action.borderOpenStatus });
    }

    case "SET_TOOL": {
      if (!state.tracing.restrictions.allowUpdate) {
        return state;
      }
      return setToolReducer(state, action.tool);
    }

    case "CYCLE_TOOL": {
      if (!state.tracing.restrictions.allowUpdate) {
        return state;
      }
      const nextTool = getNextTool(state);
      if (nextTool == null) {
        // Don't change the current tool if another tool could not be selected.
        return state;
      }
      return setToolReducer(hideBrushReducer(state), nextTool);
    }

    case "SET_THEME": {
      return updateKey(state, "uiInformation", { theme: action.value });
    }

    case "SET_SHARE_MODAL_VISIBILITY": {
      return updateKey(state, "uiInformation", { showShareModal: action.visible });
    }

    case "SET_BUSY_BLOCKING_INFO_ACTION": {
      return updateKey(state, "uiInformation", { busyBlockingInfo: action.value });
    }

    default:
      return state;
  }
}

export default UiReducer;
