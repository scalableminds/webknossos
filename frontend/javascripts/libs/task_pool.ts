import type { Saga, Task } from "oxalis/model/sagas/effect-generators";
import { join, call, fork } from "typed-redux-saga";
/*
  Given an array of async tasks, processTaskWithPool
  allows to execute at most ${poolSize} tasks concurrently.
 */

export default function* processTaskWithPool(
  tasks: Array<() => Saga<void>>,
  poolSize: number,
): Saga<void> {
  const startedTasks: Array<Task<void>> = [];
  let isFinalResolveScheduled = false;
  // @ts-expect-error ts-migrate(7034) FIXME: Variable 'error' implicitly has type 'any' in some... Remove this comment to see the full error message
  let error = null;

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'fn' implicitly has an 'any' type.
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
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'error' implicitly has an 'any' type.
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
  } // The saga will wait for all forked tasks to terminate before returning, because
  // fork() creates attached forks (in contrast to spawn()).
}
