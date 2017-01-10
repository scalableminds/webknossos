import $ from "jquery";

// `WrappedDispatchedWorker` is a wrapper around the WebWorker API. First you
// initialize it providing url of the javascript worker code. Afterwards
// you can request work using `send` and wait for the result using the
// returned deferred.
class WrappedDispatchedWorker {

  constructor(workerClass) {
    this.worker = new workerClass();

    this.worker.addEventListener("message", ({ data: packet }) => {
      if (packet.type === "log") {
        return console.log(new Date(packet.time).toISOString(), ...packet.args);
      }
    },
    );

    this.worker.onerror = err => __guard__(console, x => x.error(err));
  }


  // Returns a `$.Deferred` object representing the completion state.
  send(payload) {
    const deferred = new $.Deferred();

    const workerHandle = Math.random();

    const workerMessageCallback = ({ data: packet }) => {
      if (packet.workerHandle === workerHandle) {
        if (packet.type === "progress") {
          return deferred.notify(packet.payload);
        } else {
          this.worker.removeEventListener("message", workerMessageCallback, false);

          if (packet.type === "success") {
            return deferred.resolve(packet.payload);
          } else {
            deferred.reject(packet.payload);
            return console.log("reject", packet);
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

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
