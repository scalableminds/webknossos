import runAsync from "../helpers/run-async";
import Deferred from "../../libs/deferred";

describe("Deferred", () => {
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
    return function () { return { resolved, rejected, result }; };
  }

  it("should initialize an unresolved Promise", (done) => {
    const deferred = new Deferred();
    const getState = makeGetState(deferred.promise());

    runAsync([
      () => {
        const { resolved, rejected } = getState();
        expect(resolved).toBe(false);
        expect(rejected).toBe(false);
        done();
      },
    ]);
  });

  it("should resolve the Promise", (done) => {
    const deferred = new Deferred();
    const getState = makeGetState(deferred.promise());

    deferred.resolve(123);

    runAsync([
      () => {
        const { resolved, rejected, result } = getState();
        expect(resolved).toBe(true);
        expect(rejected).toBe(false);
        expect(result).toBe(123);
        done();
      },
    ]);
  });

  it("should reject the Promise", (done) => {
    const deferred = new Deferred();
    const getState = makeGetState(deferred.promise());

    deferred.reject(123);

    runAsync([
      () => {
        const { resolved, rejected, result } = getState();
        expect(resolved).toBe(false);
        expect(rejected).toBe(true);
        expect(result).toBe(123);
        done();
      },
    ]);
  });
});
