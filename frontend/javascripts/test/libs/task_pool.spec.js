// @flow
import { type Saga, call } from "oxalis/model/sagas/effect-generators";
import { runSaga } from "redux-saga";
import processTaskWithPool from "libs/task_pool";
import * as Utils from "libs/utils";
import test from "ava";

/*eslint func-names: ["warn", "always", { "generators": "never" }]*/

type Tasks = Array<() => Saga<void>>;

test.serial("processTaskWithPool should run a simple task", async t => {
  t.plan(1);

  const protocol = [];

  const tasks: Tasks = [
    function*() {
      yield* call(Utils.sleep, 100);
      protocol.push(1);
    },
  ];

  await runSaga({}, processTaskWithPool, tasks, 1).toPromise();

  t.is(protocol.length, 1);
});

test.serial("processTaskWithPool should deal with an empty task array", async t => {
  t.plan(1);

  const tasks: Tasks = [];
  await runSaga({}, processTaskWithPool, tasks, 1).toPromise();

  t.pass();
});

test.serial(
  "processTaskWithPool should deal with a failing task while the other tasks are still executed",
  async t => {
    t.plan(1);

    const protocol = [];

    const tasks: Tasks = [
      function*() {
        yield* call(Utils.sleep, 10);
        throw new Error("Some Error");
      },
      function*() {
        yield* call(Utils.sleep, 300);
        protocol.push(1);
      },
    ];

    try {
      await runSaga({}, processTaskWithPool, tasks, 1).toPromise();
      t.fail("processTaskWithPool should fail");
    } catch (exception) {
      t.deepEqual(protocol, [1]);
    }
  },
);

test.serial("processTaskWithPool should run tasks sequentially", async t => {
  t.plan(1);

  const protocol = [];

  const tasks: Tasks = [
    function*() {
      yield* call(Utils.sleep, 300);
      protocol.push(1);
    },
    function*() {
      yield* call(Utils.sleep, 200);
      protocol.push(2);
    },
    function*() {
      yield* call(Utils.sleep, 100);
      protocol.push(3);
    },
  ];

  await runSaga({}, processTaskWithPool, tasks, 1).toPromise();

  t.deepEqual(protocol, [1, 2, 3]);
});

test.serial("processTaskWithPool should run tasks in a sliding window manner", async t => {
  t.plan(1);

  const protocol = [];

  const tasks: Tasks = [
    function*() {
      yield* call(Utils.sleep, 10);
      protocol.push(2);
    },
    function*() {
      protocol.push(1);
      yield* call(Utils.sleep, 500);
      protocol.push(4);
    },
    function*() {
      yield* call(Utils.sleep, 10);
      protocol.push(3);
    },
  ];

  await runSaga({}, processTaskWithPool, tasks, 2).toPromise();

  t.deepEqual(protocol, [1, 2, 3, 4]);
});

test.serial("processTaskWithPool should cope with too large pool size", async t => {
  t.plan(1);

  const protocol = [];

  const tasks: Tasks = [
    function*() {
      yield* call(Utils.sleep, 10);
      protocol.push(2);
    },
    function*() {
      protocol.push(1);
      yield* call(Utils.sleep, 500);
      protocol.push(4);
    },
    function*() {
      yield* call(Utils.sleep, 100);
      protocol.push(3);
    },
  ];

  await runSaga({}, processTaskWithPool, tasks, 10).toPromise();

  t.deepEqual(protocol, [1, 2, 3, 4]);
});
