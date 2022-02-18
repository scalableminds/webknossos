// @flow

import type { Action } from "oxalis/model/actions/actions";
import { type Saga, call, put, select, _takeEvery } from "oxalis/model/sagas/effect-generators";
import { type Pattern } from "redux-saga";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";

export function* takeEveryUnlessBusy(
  actionDescriptor: Pattern,
  saga: Action => Saga<void>,
  reason: string,
): Saga<void> {
  /*
   * Similar to _takeEvery, this function can be used to react to
   * actions to start sagas. However, the difference is that once the given
   * saga is executed, webKnossos will be marked as busy. When being busy,
   * following actions which match the actionDescriptor are ignored.
   * When the given saga finishes, busy is set to false.
   *
   * Note that busyBlockingInfo is also used/respected in other places within
   * webKnossos.
   */

  function* sagaBusyWrapper(action: Action) {
    const busyBlockingInfo = yield* select(state => state.uiInformation.busyBlockingInfo);
    if (busyBlockingInfo.isBusy) {
      console.warn(
        `Ignoring ${action.type} request (reason: ${busyBlockingInfo.reason || "null"})`,
      );
      return;
    }

    yield* put(setBusyBlockingInfoAction(true, reason));
    yield* call(saga, action);
    yield* put(setBusyBlockingInfoAction(false));
  }

  yield _takeEvery(actionDescriptor, sagaBusyWrapper);
}

export default {};
