import AsyncTaskQueue from "libs/async_task_queue";
import Deferred from "libs/deferred";
import Utils from "libs/utils";

function testAsync(runAsync) {
  return async (done) => {
    try {
      await runAsync();
    } catch (e) {
      fail(e);
    } finally {
      done();
    }
  };
}

describe("AsyncTaskQueue", () => {
  it("should run a task (1/2)", testAsync(async () => {
    const queue = new AsyncTaskQueue();
    const task = new Deferred();

    queue.scheduleTask(task.task());
    await Utils.sleep(1);
    expect(queue.isBusy()).toBe(true);
    task.resolve();

    await queue.join();
  }), 100);

  it("should run a task (2/2)", testAsync(async () => {
    const queue = new AsyncTaskQueue();
    const task = new Deferred();
    const result = "foo";

    const handle = queue.scheduleTask(task.task());
    await Utils.sleep(1);
    expect(queue.isBusy()).toBe(true);
    task.resolve(result);

    expect(await handle).toEqual(result);
  }), 100);

  it("should fail the queue on a failed task", testAsync(async () => {
    const result = new Error("foo");
    const queue = new AsyncTaskQueue(0);
    const task = new Deferred();

    const catcherBox = { do: () => {} };
    spyOn(catcherBox, "do");

    const handle = queue.scheduleTask(task.task());
    handle.catch(catcherBox.do);
    await Utils.sleep(1);
    expect(queue.isBusy()).toBe(true);
    task.reject(result);

    try {
      await queue.join();
    } catch (err) {
      expect(catcherBox.do).toHaveBeenCalledWith(result);
      expect(err).toBe(result);
      expect(queue.failed).toBe(true);
    }
  }), 100);

  it("should seralize task execution", testAsync(async () => {
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
    expect(taskLog).toEqual([1, 2]);
  }), 100);

  it("should retry failed tasks (1/2)", testAsync(async () => {
    const result = new Error("foo");
    const queue = new AsyncTaskQueue(3, 1);
    const deferredBox = { value: new Deferred() };
    const task = () => deferredBox.value.promise();

    const catcherBox = { do: () => {} };
    spyOn(catcherBox, "do");

    const handle = queue.scheduleTask(task);
    handle.catch(catcherBox.do);
    for (let i = 0; i < 3; i++) {
      await Utils.sleep(5);
      deferredBox.value.reject(result);
      deferredBox.value = new Deferred();
    }

    try {
      await queue.join();
    } catch (err) {
      expect(catcherBox.do).toHaveBeenCalledWith(result);
      expect(err).toBe(result);
      expect(queue.failed).toBe(true);
    }
  }), 100);

  it("should retry failed tasks (2/2)", testAsync(async () => {
    const result = new Error("foo");
    const queue = new AsyncTaskQueue(3, 1);
    const deferredBox = { value: new Deferred() };
    const task = () => deferredBox.value.promise();

    const handle = queue.scheduleTask(task);
    for (let i = 0; i < 2; i++) {
      await Utils.sleep(5);
      deferredBox.value.reject(result);
      deferredBox.value = new Deferred();
    }
    await Utils.sleep(5);
    deferredBox.value.resolve();

    await handle;
    await queue.join();
  }), 100);
});
