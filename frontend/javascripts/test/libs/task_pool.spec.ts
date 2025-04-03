import { call, type Saga } from "oxalis/model/sagas/effect-generators";
import { runSaga } from "redux-saga";
import processTaskWithPool from "libs/async/task_pool";
import * as Utils from "libs/utils";
import { describe, it, expect } from "vitest";

/*eslint func-names: ["warn", "always", { "generators": "never" }]*/
type Tasks = Array<() => Saga<void>>;

describe("Task Pool", () => {
  it("should run a simple task", async () => {
    const protocol: number[] = [];
    const tasks: Tasks = [
      function* () {
        yield* call(Utils.sleep, 100);
        protocol.push(1);
      },
    ];
    await runSaga({}, processTaskWithPool, tasks, 1).toPromise();
    expect(protocol.length).toBe(1);
  });

  it("should deal with an empty task array", async () => {
    const tasks: Tasks = [];
    await runSaga({}, processTaskWithPool, tasks, 1).toPromise();
    // If we've reached here without errors, the test passes
    expect(true).toBe(true);
  });

  it("should deal with a failing task while the other tasks are still executed", async () => {
    const protocol: number[] = [];
    const tasks: Tasks = [
      function* () {
        yield* call(Utils.sleep, 10);
        throw new Error("Some Error");
      },
      function* () {
        yield* call(Utils.sleep, 300);
        protocol.push(1);
      },
    ];

    try {
      await runSaga({}, processTaskWithPool, tasks, 1).toPromise();
      expect.fail("processTaskWithPool should fail");
    } catch (_exception) {
      expect(protocol).toEqual([1]);
    }
  });

  it("should run tasks sequentially", async () => {
    const protocol: number[] = [];
    const tasks: Tasks = [
      function* () {
        yield* call(Utils.sleep, 300);
        protocol.push(1);
      },
      function* () {
        yield* call(Utils.sleep, 200);
        protocol.push(2);
      },
      function* () {
        yield* call(Utils.sleep, 100);
        protocol.push(3);
      },
    ];
    await runSaga({}, processTaskWithPool, tasks, 1).toPromise();
    expect(protocol).toEqual([1, 2, 3]);
  });

  it("should run tasks in a sliding window manner", async () => {
    const protocol: number[] = [];
    const tasks: Tasks = [
      function* () {
        yield* call(Utils.sleep, 10);
        protocol.push(2);
      },
      function* () {
        protocol.push(1);
        yield* call(Utils.sleep, 500);
        protocol.push(4);
      },
      function* () {
        yield* call(Utils.sleep, 10);
        protocol.push(3);
      },
    ];
    await runSaga({}, processTaskWithPool, tasks, 2).toPromise();
    expect(protocol).toEqual([1, 2, 3, 4]);
  });

  it("should cope with too large pool size", async () => {
    const protocol: number[] = [];
    const tasks: Tasks = [
      function* () {
        yield* call(Utils.sleep, 10);
        protocol.push(2);
      },
      function* () {
        protocol.push(1);
        yield* call(Utils.sleep, 500);
        protocol.push(4);
      },
      function* () {
        yield* call(Utils.sleep, 100);
        protocol.push(3);
      },
    ];
    await runSaga({}, processTaskWithPool, tasks, 10).toPromise();
    expect(protocol).toEqual([1, 2, 3, 4]);
  });
});
