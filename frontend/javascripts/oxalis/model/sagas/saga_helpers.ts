import type { Action } from "oxalis/model/actions/actions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import {} from "redux-saga/effects";
import { ActionPattern, ActionMatchingPattern } from "@redux-saga/types";

export function* takeEveryUnlessBusy<P extends ActionPattern>(
  actionDescriptor: P,
  saga: (arg0: Action) => Saga<void>,
  reason: string,
): Saga<void> {
  /*
   * Similar to takeEvery, this function can be used to react to
   * actions to start sagas. However, the difference is that once the given
   * saga is executed, webKnossos will be marked as busy. When being busy,
   * following actions which match the actionDescriptor are ignored.
   * When the given saga finishes, busy is set to false.
   *
   * Note that busyBlockingInfo is also used/respected in other places within
   * webKnossos.
   */
  function* sagaBusyWrapper(action: Action) {
    const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

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

  yield* takeEvery(actionDescriptor, sagaBusyWrapper);
}

export default {};
