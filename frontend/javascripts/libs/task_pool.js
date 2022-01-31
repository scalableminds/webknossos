// @flow
import { type Saga, type Task, join, call, fork } from "oxalis/model/sagas/effect-generators";

export default function* processTaskWithPool(
  tasks: Array<() => Saga<void>>,
  poolSize: number,
): Saga<void> {
  const startedTasks: Array<Task<void>> = [];
  let isFinalResolveScheduled = false;
  let error = null;

  function* forkSafely(fn): Saga<void> {
    // Errors from forked tasks cannot be caught, see https://redux-saga.js.org/docs/advanced/ForkModel/#error-propagation
    // However, the task pool should not abort if a single task fails.
    // Therefore, use this wrapper to safely execute all tasks and possibly rethrow the last error in the end.
    try {
      yield* call(fn);
    } catch (e) {
      error = e;
    }
  }

  function* startNextTask(): Saga<void> {
    if (tasks.length === 0) {
      if (!isFinalResolveScheduled) {
        isFinalResolveScheduled = true;

        // All tasks were kicked off, which is why all tasks can be
        // awaited now together.
        yield* join(startedTasks);
        if (error != null) throw error;
      }
      return;
    }

    const task = tasks.shift();
    const newTask = yield* fork(forkSafely, task);
    startedTasks.push(newTask);

    // If that task is done, process a new one (that way,
    // the pool size stays constant until the queue is almost empty.)
    yield* join(newTask);
    yield* call(startNextTask);
  }

  for (let i = 0; i < poolSize; i++) {
    yield* fork(startNextTask);
  }
  // The saga will wait for all forked tasks to terminate before returning.
}
