// @ts-nocheck
import Deferred from "libs/async/deferred";
import runAsync from "test/helpers/run-async";
import { describe, it, expect } from "vitest";

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

describe("Deferred", () => {
  it("should initialize an unresolved Promise", () => {
    const deferred = new Deferred();
    const getState = makeGetState(deferred.promise());
    return runAsync([
      () => {
        const { resolved, rejected } = getState();
        expect(resolved).toBe(false);
        expect(rejected).toBe(false);
      },
    ]);
  });

  it("should resolve the Promise", () => {
    const deferred = new Deferred();
    const getState = makeGetState(deferred.promise());
    deferred.resolve(123);
    return runAsync([
      () => {
        const { resolved, rejected, result } = getState();
        expect(resolved).toBe(true);
        expect(rejected).toBe(false);
        expect(result).toBe(123);
      },
    ]);
  });

  it("should reject the Promise", () => {
    const deferred = new Deferred();
    const getState = makeGetState(deferred.promise());
    deferred.reject(123);
    return runAsync([
      () => {
        const { resolved, rejected, result } = getState();
        expect(resolved).toBe(false);
        expect(rejected).toBe(true);
        expect(result).toBe(123);
      },
    ]);
  });
});
