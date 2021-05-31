// @flow

export default function processTaskWithPool<T>(
  tasks: Array<() => Promise<T>>,
  poolSize: number,
): Promise<Array<T>> {
  return new Promise((resolve, reject) => {
    const promises = [];
    let isFinalResolveScheduled = false;

    const startNextTask = () => {
      if (tasks.length === 0) {
        if (!isFinalResolveScheduled) {
          isFinalResolveScheduled = true;

          // All tasks were kicked off, which is why all promises can be
          // awaited now together.
          Promise.all(promises).then(resolve, reject);
        }
        return;
      }

      const task = tasks.shift();
      const newPromise = task();
      promises.push(newPromise);

      // If that promise is done, process a new one (that way,
      // the pool size stays constant until the queue is almost empty.)
      newPromise.then(startNextTask, startNextTask);
    };

    for (let i = 0; i < poolSize; i++) {
      startNextTask();
    }
  });
}
