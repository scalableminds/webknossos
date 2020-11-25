// @flow
import Deferred from "libs/deferred";
import test from "ava";
import LatestTaskExecutor, { SKIPPED_TASK_REASON } from "libs/latest_task_executor";

test("LatestTaskExecutor: One task", async t => {
  const executor = new LatestTaskExecutor();

  const deferred1 = new Deferred();

  const scheduledPromise = executor.schedule(() => deferred1.promise());

  deferred1.resolve(true);
  return scheduledPromise.then(result => {
    t.true(result);
  });
});

test("LatestTaskExecutor: two successive tasks", async t => {
  const executor = new LatestTaskExecutor();

  const deferred1 = new Deferred();
  const deferred2 = new Deferred();

  const scheduledPromise1 = executor.schedule(() => deferred1.promise());
  deferred1.resolve(1);

  const scheduledPromise2 = executor.schedule(() => deferred2.promise());
  deferred2.resolve(2);

  await scheduledPromise1.then(result => {
    t.is(result, 1);
  });
  await scheduledPromise2.then(result => {
    t.is(result, 2);
  });
});

test("LatestTaskExecutor: two interleaving tasks", async t => {
  const executor = new LatestTaskExecutor();

  const deferred1 = new Deferred();
  const deferred2 = new Deferred();

  const scheduledPromise1 = executor.schedule(() => deferred1.promise());
  const scheduledPromise2 = executor.schedule(() => deferred2.promise());

  deferred1.resolve(1);
  deferred2.resolve(2);

  await scheduledPromise1.then(result => {
    t.is(result, 1);
  });
  await scheduledPromise2.then(result => {
    t.is(result, 2);
  });
});

test("LatestTaskExecutor: three interleaving tasks", async t => {
  const executor = new LatestTaskExecutor<number>();

  const deferred1 = new Deferred();
  const deferred2 = new Deferred();
  const deferred3 = new Deferred();

  const scheduledPromise1 = executor.schedule(() => deferred1.promise());
  const scheduledPromise2 = executor.schedule(() => deferred2.promise());
  const scheduledPromise3 = executor.schedule(() => deferred3.promise());

  deferred1.resolve(1);
  deferred2.resolve(2);
  deferred3.resolve(3);

  await scheduledPromise1.then(result => {
    t.is(result, 1);
  });
  t.throwsAsync(scheduledPromise2, { message: SKIPPED_TASK_REASON });
  await scheduledPromise3.then(result => {
    t.is(result, 3);
  });
});
