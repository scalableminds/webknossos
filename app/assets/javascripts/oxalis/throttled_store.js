// @flow
/* eslint no-await-in-loop: 0 */
import Deferred from "libs/deferred";
import Store from "oxalis/store";
import * as Utils from "libs/utils";

const listeners = [];
let waitForUpdate = new Deferred();
let prevState;

Store.subscribe(() => {
  const state = Store.getState();
  // No need to do anything if the state didn't change
  if (state !== prevState) {
    prevState = state;
    waitForUpdate.resolve();
    waitForUpdate = new Deferred();
  }
});

async function go() {
  while (true) {
    await waitForUpdate.promise();
    await Utils.animationFrame();
    for (const listener of listeners) {
      listener();
    }
  }
}

go();

export default Object.assign({}, Store, {
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
