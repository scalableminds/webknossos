import type { Saga } from "redux-saga";
import { call } from "typed-redux-saga";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";

export default function* idReservationSaga(): Saga<void> {
  yield* call(ensureWkInitialized);

  return null;
}
