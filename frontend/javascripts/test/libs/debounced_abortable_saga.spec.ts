import type { Saga } from "oxalis/model/sagas/effect-generators";
import { sleep } from "libs/utils";
import test from "ava";
import _ from "lodash";
import { createDebouncedAbortableCallable } from "libs/async/debounced_abortable_saga";

const createAbortableFnWithProtocol = () => {
  const protocol: string[] = [];
  function* abortableFn(msg: { id: number }): Saga<void> {
    protocol.push(`await-${msg.id}`);
    yield sleep(1000);
    protocol.push(`run-${msg.id}`);
  }

  return { abortableFn, protocol };
};

const DEBOUNCE_THRESHOLD = 100;
test("DebouncedAbortableSaga: Test simplest case", async (t) => {
  t.plan(1);
  const { abortableFn, protocol } = createAbortableFnWithProtocol();
  const fn = createDebouncedAbortableCallable(abortableFn, DEBOUNCE_THRESHOLD, this);

  fn({ id: 1 });

  await sleep(2000);
  t.deepEqual(protocol, ["await-1", "run-1"]);
});

test("DebouncedAbortableSaga: Rapid calls where the last one should win", async (t) => {
  t.plan(1);
  const { abortableFn, protocol } = createAbortableFnWithProtocol();
  const fn = createDebouncedAbortableCallable(abortableFn, DEBOUNCE_THRESHOLD, this);

  fn({ id: 1 });
  fn({ id: 2 });
  fn({ id: 3 });

  await sleep(2000);
  t.deepEqual(protocol, ["await-3", "run-3"]);
});

test("DebouncedAbortableSaga: Rapid calls with small breaks", async (t) => {
  t.plan(1);
  const { abortableFn, protocol } = createAbortableFnWithProtocol();
  const fn = createDebouncedAbortableCallable(abortableFn, DEBOUNCE_THRESHOLD, this);

  // Rapid calls with small breaks in-between.
  // The small breaks are long enough to satisfy the debounding,
  // but not long enough to let the awaiting through.
  fn({ id: 1 });
  fn({ id: 2 });
  fn({ id: 3 });
  await sleep(150);
  fn({ id: 4 });
  fn({ id: 5 });
  await sleep(150);
  fn({ id: 6 });
  fn({ id: 7 });

  await sleep(2000);
  t.deepEqual(protocol, ["await-3", "await-5", "await-7", "run-7"]);
});

test.skip("High volume calls", async () => {
  // This is not a unit test, but rather a small speed test
  // to make a note that the classic _.debounce is way faster.
  // For 1000 invocations, _.debounce is roughly 10x faster.
  // However, this probably not a bottleneck right now.

  const lodashDebounced = _.debounce((_obj: { id: number }) => {});

  const { abortableFn } = createAbortableFnWithProtocol();
  const fn = createDebouncedAbortableCallable(abortableFn, DEBOUNCE_THRESHOLD, this);

  console.time("Benchmarking debounce stuff");
  for (let i = 0; i < 1000; i++) {
    fn({ id: i });
  }
  console.timeEnd("Benchmarking debounce stuff");

  console.time("Benchmarking lodash debounce stuff");
  for (let i = 0; i < 1000; i++) {
    lodashDebounced({ id: i });
  }
  console.timeEnd("Benchmarking lodash debounce stuff");
});
