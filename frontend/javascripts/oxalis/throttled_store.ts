/* eslint no-await-in-loop: 0 */
import type { Store as StoreType } from "redux";
import Deferred from "libs/async/deferred";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
const MAXIMUM_STORE_UPDATE_DELAY = 10000;
const listeners: Array<() => void> = [];
let waitForUpdate = new Deferred();
let prevState: OxalisState | undefined;
Store.subscribe(() => {
  const state = Store.getState();

  // No need to do anything if the state didn't change
  if (state !== prevState) {
    prevState = state;
    waitForUpdate.resolve(null);
  }
});

async function go() {
  while (true) {
    await waitForUpdate.promise();
    waitForUpdate = new Deferred();
    await Utils.animationFrame(MAXIMUM_STORE_UPDATE_DELAY);

    for (const listener of listeners) {
      listener();
    }
  }
}

go();
const ThrottledStore: StoreType<OxalisState> = Object.assign({}, Store, {
  subscribe(listener: () => void): () => void {
    listeners.push(listener);
    return function unsubscribe() {
      const i = listeners.indexOf(listener);

      if (i >= 0) {
        listeners.splice(i, 1);
      }
    };
  },
});
export default ThrottledStore;
