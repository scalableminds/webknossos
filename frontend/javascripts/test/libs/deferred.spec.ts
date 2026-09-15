import Deferred from "libs/async/deferred";
import { sleep } from "libs/utils";
import { describe, expect, it } from "vitest";

function makeGetState(promise: Promise<number>) {
  let resolved = false;
  let rejected = false;
  let result: number | null = null;
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
    const deferred = new Deferred<number, number>();
    const getState = makeGetState(deferred.promise());

    const { resolved, rejected } = getState();
    expect(resolved).toBe(false);
    expect(rejected).toBe(false);
  });

  it("should resolve the Promise", async () => {
    const deferred = new Deferred<number, number>();
    const getState = makeGetState(deferred.promise());
    deferred.resolve(123);

    await sleep(0); // allow the promise.then to be executed.
    const { resolved, rejected, result } = getState();
    expect(resolved).toBe(true);
    expect(rejected).toBe(false);
    expect(result).toBe(123);
  });

  it("should reject the Promise", async () => {
    const deferred = new Deferred<number, number>();
    const getState = makeGetState(deferred.promise());
    deferred.reject(123);

    await sleep(0); // allow the promise.then to be executed.
    const { resolved, rejected, result } = getState();
    expect(resolved).toBe(false);
    expect(rejected).toBe(true);
    expect(result).toBe(123);
  });
});
