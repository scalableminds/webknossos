import { OxalisState } from "oxalis/store";
import { MaintenanceAction } from "../actions/actions";

function MaintenanceReducer(state: OxalisState, action: MaintenanceAction): OxalisState {
    switch (action.type) {
        case "SET_IS_UNDER_MAINTENANCE":
            const { isUnderMaintenance } = action;
            if (state.isInMaintenance === isUnderMaintenance) return state;
            return { ...state, isInMaintenance: isUnderMaintenance };
        default:
            return state;
    }
}

export default MaintenanceReducer;