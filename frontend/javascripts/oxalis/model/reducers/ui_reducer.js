// @flow

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import { updateKey } from "oxalis/model/helpers/deep_update";

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

    case "REFRESH_ISOSURFACES": {
      return updateKey(state, "uiInformation", { isRefreshingIsosurfaces: true });
    }

    case "FINISHED_REFRESHING_ISOSURFACES": {
      return updateKey(state, "uiInformation", { isRefreshingIsosurfaces: false });
    }

    case "SET_BORDER_OPEN_STATUS": {
      return updateKey(state, "uiInformation", { borderOpenStatus: action.borderOpenStatus });
    }

    case "SET_THEME": {
      return updateKey(state, "uiInformation", { theme: action.value });
    }

    default:
      return state;
  }
}

export default UiReducer;
