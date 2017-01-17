import Utils from "libs/utils";
import $ from "jquery";

// `WrappedDispatchedWorker` is a wrapper around the WebWorker API. First you
// initialize it providing url of the javascript worker code. Afterwards
// you can request work using `send` and wait for the result using the
// returned deferred.
class WrappedDispatchedWorker {

  constructor(WorkerClass) {
    this.worker = new WorkerClass();

    this.worker.addEventListener("message", ({ data: packet }) => {
      if (packet.type === "log") {
        console.log(new Date(packet.time).toISOString(), ...packet.args);
      }
    },
    );

    this.worker.onerror = err => Utils.__guard__(console, x => x.error(err));
  }


  // Returns a `$.Deferred` object representing the completion state.
  send(payload) {
    const deferred = new $.Deferred();

    const workerHandle = Math.random();

    const workerMessageCallback = ({ data: packet }) => {
      if (packet.workerHandle === workerHandle) {
        if (packet.type === "progress") {
          deferred.notify(packet.payload);
        } else {
          this.worker.removeEventListener("message", workerMessageCallback, false);

          if (packet.type === "success") {
            deferred.resolve(packet.payload);
          } else {
            deferred.reject(packet.payload);
            console.log("reject", packet);
          }
        }
      }
    };

    this.worker.addEventListener("message", workerMessageCallback, false);
    this.worker.postMessage({ workerHandle, payload });

    return deferred.promise();
  }
}


export default WrappedDispatchedWorker;
