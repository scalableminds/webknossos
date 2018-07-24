// @flow

import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function UiReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "SET_DROPZONE_MODAL_VISIBILITY_ACTION_TYPE": {
      return update(state, {
        uiInformation: {
          showDropzoneModal: { $set: action.visible },
        },
      });
    }

    default:
      return state;
  }
}

export default UiReducer;
