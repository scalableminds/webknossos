/* import { listCurrentAndUpcomingMaintenances } from "admin/admin_rest_api";
import { call, takeEvery } from "typed-redux-saga";
import { MaintenanceAction, setIsUnderMaintenanceAction } from "../actions/actions";
import { Store } from "oxalis/singletons";

function* updateIsInMaintenance(fetchMaintenanceAction: MaintenanceAction) {
    const isUnderMaintenance = yield* call(fetchIsUnderMaintenance);
    Store.dispatch(setIsUnderMaintenanceAction(isUnderMaintenance));
}

const fetchIsUnderMaintenance = async () => {
    const allMaintenances = await listCurrentAndUpcomingMaintenances();
    const currentEpoch = Date.now();
    const currentMaintenance = allMaintenances?.find(
        (maintenance) => maintenance.startTime < currentEpoch && maintenance.endTime > currentEpoch,
    );
    return currentMaintenance != null;
}

export function* saveTracingAsync() {
    yield* takeEvery("FETCH_IS_UNDER_MAINTENANCE", updateIsInMaintenance);
} */