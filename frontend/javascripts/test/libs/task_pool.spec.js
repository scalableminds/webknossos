// @noflow
import processTaskWithPool from "libs/task_pool";
import * as Utils from "libs/utils";
import test from "ava";

test.serial("processTaskWithPool should run a simple task", async t => {
  t.plan(1);

  const protocol = [];

  const tasks = [
    async () => {
      await Utils.sleep(1);
      protocol.push(1);
    },
  ];

  await processTaskWithPool(tasks, 1);

  t.is(protocol.length, 1);
});

test.serial("processTaskWithPool should deal with an empty task array", async t => {
  t.plan(1);

  const tasks = [];
  await processTaskWithPool(tasks, 1);

  t.pass();
});

test.serial(
  "processTaskWithPool should deal with a failing task while the other tasks are still executed",
  async t => {
    t.plan(1);

    const protocol = [];

    const tasks = [
      async () => {
        await Utils.sleep(0.1);
        throw new Error("Some Error");
      },
      async () => {
        await Utils.sleep(3);
        protocol.push(1);
      },
    ];

    try {
      await processTaskWithPool(tasks, 1);
      t.fail("processTaskWithPool should fail");
    } catch (exception) {
      t.deepEqual(protocol, [1]);
    }
  },
);

test.serial("processTaskWithPool should run tasks sequentially", async t => {
  t.plan(1);

  const protocol = [];

  const tasks = [
    async () => {
      await Utils.sleep(3);
      protocol.push(1);
    },
    async () => {
      await Utils.sleep(2);
      protocol.push(2);
    },
    async () => {
      await Utils.sleep(1);
      protocol.push(3);
    },
  ];

  await processTaskWithPool(tasks, 1);

  t.deepEqual(protocol, [1, 2, 3]);
});

test.serial("processTaskWithPool should run tasks in a sliding window manner", async t => {
  t.plan(1);

  const protocol = [];

  const tasks = [
    async () => {
      await Utils.sleep(0.1);
      protocol.push(2);
    },
    async () => {
      protocol.push(1);
      await Utils.sleep(5);
      protocol.push(4);
    },
    async () => {
      await Utils.sleep(0.1);
      protocol.push(3);
    },
  ];

  await processTaskWithPool(tasks, 2);

  t.deepEqual(protocol, [1, 2, 3, 4]);
});

test.serial("processTaskWithPool should cope with too large pool size", async t => {
  t.plan(1);

  const protocol = [];

  const tasks = [
    async () => {
      await Utils.sleep(0.1);
      protocol.push(2);
    },
    async () => {
      protocol.push(1);
      await Utils.sleep(5);
      protocol.push(4);
    },
    async () => {
      await Utils.sleep(1);
      protocol.push(3);
    },
  ];

  await processTaskWithPool(tasks, 10);

  t.deepEqual(protocol, [1, 2, 3, 4]);
});
