import $ from "jquery";
import _ from "lodash";
import Utils from "libs/utils";

// `DispatchedWorker` is a wrapper around the WebWorker API. First you
// initialize it providing a worker object of the javascript worker code.
// Afterwards you can request work using `send` and wait for the result
// using the returned deferred.
class DispatchedWorker {

  constructor(WorkerClass) {
    this.worker = new WorkerClass();

    this.worker.onerror = err => Utils.__guard__(console, x => x.error(err));
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
    let freeWorker;
    for (const worker of this.workers) {
      if (!worker.busy) {
        freeWorker = worker;
        break;
      }
    }

    if (!freeWorker && this.workers.length < this.workerLimit) {
      freeWorker = this.spawnWorker();
    }

    if (freeWorker) {
      return freeWorker.send(data);
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
      Utils.__guard__(console, x => x.error(err));
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
        .done(response => deferred.resolve(response))
        .fail(err => deferred.reject(err));
    }
  }


  queuePush(data) {
    const deferred = $.Deferred();
    return this.queue.push({ data, deferred });
  }
};


export default DispatchedWorker;
