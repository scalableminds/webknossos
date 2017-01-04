// helper functions

self.log = (...args) => self.postMessage({ type: "log", time: Date.now(), args });


export default function (obj) {
  const execMessage = function (messageData) {
    const { workerHandle, payload } = messageData;

    const makeSender = type =>
      function (arg, transferred) {
        if (transferred == null) { transferred = []; }
        try {
          self.postMessage({ workerHandle, type, payload: arg }, transferred);
        } catch (error) {
          self.postMessage({ workerHandle, type, payload: arg });
        }
      }
    ;

    obj[payload.method](...payload.args).then(
      makeSender("success"),
      makeSender("error"),
      makeSender("progress"),
    );
  };


  self.addEventListener(
    "message",
    (event) => {
      if (event.data) {
        return execMessage(event.data);
      }
    },

    false,
  );


  return self.postMessage({
    type: "ready",
  });
}
