/* eslint no-await-in-loop: 0 */
import type { Action } from "oxalis/model/actions/actions";
import type { Dispatch, Store as StoreType } from "redux";
import Deferred from "libs/deferred";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
const MAXIMUM_STORE_UPDATE_DELAY = 10000;
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'listeners' implicitly has type 'any[]' i... Remove this comment to see the full error message
const listeners = [];
let waitForUpdate = new Deferred();
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'prevState' implicitly has type 'any' in ... Remove this comment to see the full error message
let prevState;
Store.subscribe(() => {
  const state = Store.getState();

  // No need to do anything if the state didn't change
  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'prevState' implicitly has an 'any' type.
  if (state !== prevState) {
    prevState = state;
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    waitForUpdate.resolve();
  }
});

async function go() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await waitForUpdate.promise();
    waitForUpdate = new Deferred();
    await Utils.animationFrame(MAXIMUM_STORE_UPDATE_DELAY);

    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'listeners' implicitly has an 'any[]' typ... Remove this comment to see the full error message
    for (const listener of listeners) {
      listener();
    }
  }
}

go();
// @ts-expect-error ts-migrate(2314) FIXME: Generic type 'Store<S>' requires 1 type argument(s... Remove this comment to see the full error message
const ThrottledStore: StoreType<OxalisState, Action, Dispatch<any>> = Object.assign({}, Store, {
  subscribe(listener: () => void): () => void {
    listeners.push(listener);
    return function unsubscribe() {
      // @ts-expect-error ts-migrate(7005) FIXME: Variable 'listeners' implicitly has an 'any[]' typ... Remove this comment to see the full error message
      const i = listeners.indexOf(listener);

      if (i >= 0) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'listeners' implicitly has an 'any[]' typ... Remove this comment to see the full error message
        listeners.splice(i, 1);
      }
    };
  },
});
export default ThrottledStore;
