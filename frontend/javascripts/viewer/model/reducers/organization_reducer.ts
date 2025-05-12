import update from "immutability-helper";
import type { Action } from "viewer/model/actions/actions";
import type { WebknossosState } from "viewer/store";

function OrganizationReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_ACTIVE_ORGANIZATION": {
      return update(state, {
        activeOrganization: {
          $set: action.organization,
        },
      });
    }

    case "SET_ACTIVE_ORGANIZATIONS_CREDIT_BALANCE": {
      return update(state, {
        activeOrganization: {
          creditBalance: {
            $set: action.creditBalance,
          },
        },
      });
    }

    default:
      return state;
  }
}

export default OrganizationReducer;
