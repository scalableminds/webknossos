// @flow

import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function ViewModeReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "SET_VIEWPORT": {
      return update(state, {
        viewModeData: {
          plane: {
            activeViewport: { $set: action.viewport }
          },
        },
      });
    }

    default:
      return state;
  }
}

export default ViewModeReducer;
