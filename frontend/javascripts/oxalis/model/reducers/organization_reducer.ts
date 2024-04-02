import update from "immutability-helper";
import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";

function OrganizationReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_ACTIVE_ORGANIZATION": {
      return update(state, {
        activeOrganization: {
          $set: action.organization,
        },
      });
    }

    default:
      return state;
  }
}

export default OrganizationReducer;
