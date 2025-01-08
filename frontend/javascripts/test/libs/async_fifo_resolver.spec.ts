import test from "ava";
import { AsyncFifoResolver } from "libs/async/async_fifo_resolver";
import { sleep } from "libs/utils";

const createSubmitterFnWithProtocol = () => {
  const resolver = new AsyncFifoResolver();
  const protocol: string[] = [];

  async function submitter(id: number, duration: number) {
    protocol.push(`started-${id}`);
    await resolver.orderedWaitFor(
      sleep(duration).then(() => protocol.push(`sleep-finished-${id}`)),
    );
    protocol.push(`finished-${id}`);
  }

  return { submitter, resolver, protocol };
};

test("AsyncFifoResolver: Test simplest case", async (t) => {
  t.plan(2);

  const { submitter, resolver, protocol } = createSubmitterFnWithProtocol();
  submitter(1, 10);
  submitter(2, 10);

  // Wait until everything is done
  await resolver.orderedWaitFor(Promise.resolve());

  t.deepEqual(protocol, [
    "started-1",
    "started-2",
    "sleep-finished-1",
    "finished-1",
    "sleep-finished-2",
    "finished-2",
  ]);
  t.is(resolver.queue.length, 0);
});

test("AsyncFifoResolver: Test out-of-order sleeps should still finish in order", async (t) => {
  t.plan(2);

  const { submitter, resolver, protocol } = createSubmitterFnWithProtocol();
  submitter(1, 50);
  submitter(2, 10);

  // Wait until everything is done
  await resolver.orderedWaitFor(Promise.resolve());

  t.deepEqual(protocol, [
    "started-1",
    "started-2",
    "sleep-finished-2",
    "sleep-finished-1",
    "finished-1",
    "finished-2",
  ]);
  t.is(resolver.queue.length, 0);
});

test("AsyncFifoResolver: New submits shouldn't block old ones.", async (t) => {
  t.plan(2);

  const { submitter, resolver, protocol } = createSubmitterFnWithProtocol();
  // The first submitter should finish through and should not be blocked
  // by the second one.
  submitter(1, 50);
  submitter(2, 1000);

  await sleep(50);

  t.deepEqual(protocol, ["started-1", "started-2", "sleep-finished-1", "finished-1"]);
  t.is(resolver.queue.length, 1);
});

test("AsyncFifoResolver: Trimming of queue should work despite race condition potential.", async (t) => {
  t.plan(3);

  const { submitter, resolver, protocol } = createSubmitterFnWithProtocol();

  submitter(1, 100);
  const promise = submitter(2, 100);
  t.is(resolver.queue.length, 2);
  submitter(3, 1000);

  await promise;
  submitter(4, 1);

  // Wait until everything is done
  await resolver.orderedWaitFor(Promise.resolve());

  t.deepEqual(protocol, [
    "started-1",
    "started-2",
    "started-3",
    "sleep-finished-1",
    "finished-1",
    "sleep-finished-2",
    "finished-2",
    "started-4",
    "sleep-finished-4",
    "sleep-finished-3",
    "finished-3",
    "finished-4",
  ]);
  t.is(resolver.queue.length, 0);
});
