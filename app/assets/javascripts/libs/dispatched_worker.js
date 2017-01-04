import $ from "jquery";
import _ from "lodash";

// `DispatchedWorker` is a wrapper around the WebWorker API. First you
// initialize it providing a worker object of the javascript worker code.
// Afterwards you can request work using `send` and wait for the result
// using the returned deferred.
class DispatchedWorker {

  constructor(workerClass) {
    this.worker = new workerClass();

    this.worker.onerror = err => __guard__(console, x => x.error(err));
  }


  // Returns a `$.Deferred` object representing the completion state.
  send(payload) {
    const deferred = new $.Deferred();

    _.defer(() => {
      const workerHandle = Math.random();

      const workerMessageCallback = ({ data: packet }) => {
        if (packet.workerHandle === workerHandle) {
          this.worker.removeEventListener("message", workerMessageCallback, false);
          if (packet.error) {
            return deferred.reject(packet.error);
          } else {
            return deferred.resolve(packet.payload);
          }
        }
      };

      this.worker.addEventListener("message", workerMessageCallback, false);
      return this.worker.postMessage({ workerHandle, payload });
    },
    );


    return deferred.promise();
  }
}


DispatchedWorker.Pool = class Pool {

  constructor(workerClass, workerLimit = 3) {
    this.workerClass = workerClass;
    this.workerLimit = workerLimit;
    this.queue = [];
    this.workers = [];
  }


  send(data) {
    let worker;
    for (const _worker of this.workers) {
      if (!_worker.busy) {
        worker = _worker;
        break;
      }
    }

    if (!worker && this.workers.length < this.workerLimit) {
      worker = this.spawnWorker();
    }

    if (worker) {
      return worker.send(data);
    } else {
      return this.queuePush(data);
    }
  }


  spawnWorker() {
    const worker = new DispatchedWorker(this.workerClass);
    worker.busy = false;

    const workerReset = () => {
      worker.busy = false;
      return this.queueShift(worker);
    };


    worker.worker.onerror = function (err) {
      __guard__(console, x => x.error(err));
      return workerReset();
    };


    worker.worker.addEventListener("message", workerReset, false);

    this.workers.push(worker);

    return worker;
  }


  queueShift(worker) {
    if (this.queue.length > 0 && !worker.busy) {
      const { data, deferred } = this.queue.shift();
      return worker.send(data)
        .done(data => deferred.resolve(data))
        .fail(err => deferred.reject(err));
    }
  }


  queuePush(data) {
    const deferred = $.Deferred();
    return this.queue.push({ data, deferred });
  }
};


export default DispatchedWorker;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
