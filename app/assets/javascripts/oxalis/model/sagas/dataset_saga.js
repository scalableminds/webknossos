// @flow
import { type Saga, select, take } from "oxalis/model/sagas/effect-generators";
import Toast from "libs/toast";
import messages from "messages";

export default function* watchIsScratchSaga(): Saga<void> {
  yield* take("WK_READY");

  const isScratch = yield* select(state => state.dataset.dataStore.isScratch);
  if (isScratch) {
    Toast.error(messages["dataset.is_scratch"], { sticky: true });
  }
}
