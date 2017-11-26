// @flow

import update from "immutability-helper";

import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function UserReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "SET_ACTIVE_USER": {
      return update(state, {
        activeUser: { $set: action.user },
      });
    }

    default:
      return state;
  }
}

export default UserReducer;
