// @flow
import Store from "oxalis/store";
import Deferred from "libs/deferred";
import Utils from "libs/utils";

const listeners = [];
let waitForUpdate = new Deferred();

Store.subscribe(() => {
  waitForUpdate.resolve();
  waitForUpdate = new Deferred();
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
