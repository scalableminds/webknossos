/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import AsyncTaskQueue from "libs/async_task_queue";
import Deferred from "libs/deferred";
import * as Utils from "libs/utils";
import sinon from "sinon";
import test from "ava";

test("AsyncTaskQueue should run a task (1/2)", async t => {
  t.plan(1);
  const queue = new AsyncTaskQueue();
  const task = new Deferred();

  queue.scheduleTask(task.task());
  await Utils.sleep(1);
  t.is(queue.isBusy(), true);
  task.resolve();

  await queue.join();
});

test("AsyncTaskQueue should run a task (2/2)", async t => {
  t.plan(2);
  const queue = new AsyncTaskQueue();
  const task = new Deferred();
  const result = "foo";

  const handle = queue.scheduleTask(task.task());
  await Utils.sleep(1);
  t.is(queue.isBusy(), true);
  task.resolve(result);

  t.deepEqual(await handle, result);
});

test("AsyncTaskQueue should fail the queue on a failed task", async t => {
  t.plan(4);
  const result = new Error("foo");
  const queue = new AsyncTaskQueue(0);
  const task = new Deferred();

  const catcherBox = { do: () => {} };
  sinon.spy(catcherBox, "do");

  const handle = queue.scheduleTask(task.task());
  handle.catch(catcherBox.do);
  await Utils.sleep(1);
  t.is(queue.isBusy(), true);
  task.reject(result);

  try {
    await queue.join();
  } catch (err) {
    t.true(catcherBox.do.calledWith(result));
    t.is(err, result);
    t.is(queue.failed, true);
  }
});

test("AsyncTaskQueue should seralize task execution", async t => {
  t.plan(1);
  const queue = new AsyncTaskQueue(0);
  const task1 = new Deferred();
  const task2 = new Deferred();
  const taskLog = [];

  const handle1 = queue.scheduleTask(task1.task());
  handle1.then(() => taskLog.push(1));
  const handle2 = queue.scheduleTask(task2.task());
  handle2.then(() => taskLog.push(2));
  await Utils.sleep(1);
  task2.resolve();
  task1.resolve();

  await queue.join();
  t.deepEqual(taskLog, [1, 2]);
});

test.serial("AsyncTaskQueue should retry failed tasks (1/2)", async t => {
  t.plan(3);
  const result = new Error("foo");
  const queue = new AsyncTaskQueue(3, 1);
  const deferredBox = { value: new Deferred() };
  const task = () => deferredBox.value.promise();

  const catcherBox = { do: () => {} };
  sinon.spy(catcherBox, "do");

  const handle = queue.scheduleTask(task);
  handle.catch(catcherBox.do);
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Utils.sleep(5);
    deferredBox.value.reject(result);
    deferredBox.value = new Deferred();
  }

  try {
    await queue.join();
  } catch (err) {
    t.true(catcherBox.do.calledWith(result));
    t.is(err, result);
    t.is(queue.failed, true);
  }
});

test.serial("AsyncTaskQueue should retry failed tasks (2/2)", async t => {
  t.plan(1);
  const result = new Error("foo");
  const queue = new AsyncTaskQueue(3, 1);
  const deferredBox = { value: new Deferred() };
  const task = () => deferredBox.value.promise();

  const handle = queue.scheduleTask(task);
  for (let i = 0; i < 2; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Utils.sleep(5);
    deferredBox.value.reject(result);
    deferredBox.value = new Deferred();
  }
  await Utils.sleep(5);
  deferredBox.value.resolve();

  await handle;
  await queue.join();
  // ensure that we get to this point
  t.pass();
});
