import { call, type Saga } from "oxalis/model/sagas/effect-generators";
import { buffers, type Channel, channel, runSaga } from "redux-saga";
import { delay, race, take } from "redux-saga/effects";

// biome-ignore lint/complexity/noBannedTypes: This is copied from redux-saga because it cannot be imported.
type NotUndefined = {} | null;

/*
 * This function takes a saga and a debounce threshold
 * and returns a function F that will trigger the given saga
 * in a debounced manner.
 * In contrast to a normal debouncing mechanism, the saga
 * will be cancelled if F is called while the saga is running.
 * Note that this means that concurrent executions of the saga
 * are impossible that way (by design).
 *
 * Also note that the performance of this debouncing mechanism
 * is slower than a standard _.debounce. Also see
 * debounced_abortable_saga.spec.ts for a small benchmark.
 */
export function createDebouncedAbortableCallable<T extends NotUndefined, C>(
  fn: (param1: T) => Saga<void>,
  debounceThreshold: number,
  context: C,
) {
  // The communication with the saga is done via a channel.
  // That way, we can expose a normal function that
  // does the triggering by filling the channel.

  // Only the most recent invocation should survive.
  // Therefore, create a sliding buffer with size 1.
  const buffer = buffers.sliding<T>(1);
  const triggerChannel: Channel<T> = channel<T>(buffer);

  const _task = runSaga(
    {},
    debouncedAbortableSagaRunner,
    debounceThreshold,
    triggerChannel,
    // @ts-expect-error TS thinks fn doesn't match, but it does.
    fn,
    context,
  );

  return (msg: T) => {
    triggerChannel.put(msg);
  };
}

export function createDebouncedAbortableParameterlessCallable<C>(
  fn: () => Saga<void>,
  debounceThreshold: number,
  context: C,
) {
  const wrappedFn = createDebouncedAbortableCallable(fn, debounceThreshold, context);
  const dummyParameter = {};
  return () => {
    wrappedFn(dummyParameter);
  };
}

function* debouncedAbortableSagaRunner<T extends NotUndefined, C>(
  debounceThreshold: number,
  triggerChannel: Channel<T>,
  abortableFn: (param: T) => Saga<void>,
  context: C,
): Saga<void> {
  while (true) {
    // Wait for a trigger-call by consuming
    // the channel.
    let msg = yield take(triggerChannel);

    // Repeatedly try to execute abortableFn (each try
    // might be cancelled due to new initiation-requests)
    while (true) {
      const { debounced, latestMessage } = yield race({
        debounced: delay(debounceThreshold),
        latestMessage: take(triggerChannel),
      });

      if (latestMessage) {
        msg = latestMessage;
      }

      if (debounced) {
        const { abortingMessage } = yield race({
          finished: call([context, abortableFn], msg),
          abortingMessage: take(triggerChannel),
        });
        if (abortingMessage) {
          msg = abortingMessage;
        } else {
          break;
        }
      }
    }
  }
}
