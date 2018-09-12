// @flow

import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function UiReducer(state: OxalisState, action: ActionType): OxalisState {
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

    default:
      return state;
  }
}

export default UiReducer;
