// @flow

import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";

function UiReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_DROPZONE_MODAL_VISIBILITY": {
      return update(state, {
        uiInformation: {
          showDropzoneModal: { $set: action.visible },
        },
      });
    }

    case "SET_VERSION_RESTORE_VISIBILITY": {
      return update(state, {
        uiInformation: {
          showVersionRestore: { $set: action.active },
        },
      });
    }

    case "SET_STORED_LAYOUTS": {
      return update(state, {
        uiInformation: {
          storedLayouts: { $set: action.storedLayouts },
        },
      });
    }

    default:
      return state;
  }
}

export default UiReducer;
