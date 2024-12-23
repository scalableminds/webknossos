// @ts-nocheck
import Deferred from "libs/async/deferred";
import runAsync from "test/helpers/run-async";
import test from "ava";

function makeGetState(promise) {
  let resolved = false;
  let rejected = false;
  let result = null;
  promise.then(
    (res) => {
      resolved = true;
      result = res;
    },
    (res) => {
      rejected = true;
      result = res;
    },
  );
  return function () {
    return {
      resolved,
      rejected,
      result,
    };
  };
}

test("Deferred should initialize an unresolved Promise", (t) => {
  t.plan(2);
  const deferred = new Deferred();
  const getState = makeGetState(deferred.promise());
  return runAsync([
    () => {
      const { resolved, rejected } = getState();
      t.is(resolved, false);
      t.is(rejected, false);
    },
  ]);
});
test("Deferred should resolve the Promise", (t) => {
  t.plan(3);
  const deferred = new Deferred();
  const getState = makeGetState(deferred.promise());
  deferred.resolve(123);
  return runAsync([
    () => {
      const { resolved, rejected, result } = getState();
      t.is(resolved, true);
      t.is(rejected, false);
      t.is(result, 123);
    },
  ]);
});
test("Deferred should reject the Promise", (t) => {
  t.plan(3);
  const deferred = new Deferred();
  const getState = makeGetState(deferred.promise());
  deferred.reject(123);
  return runAsync([
    () => {
      const { resolved, rejected, result } = getState();
      t.is(resolved, false);
      t.is(rejected, true);
      t.is(result, 123);
    },
  ]);
});
