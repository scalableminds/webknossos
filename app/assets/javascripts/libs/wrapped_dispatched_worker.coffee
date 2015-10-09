_ = require("lodash")

# `WrappedDispatchedWorker` is a wrapper around the WebWorker API. First you
# initialize it providing url of the javascript worker code. Afterwards
# you can request work using `send` and wait for the result using the
# returned deferred.
class WrappedDispatchedWorker

  constructor : (workerClass) ->

    @worker = new workerClass()

    @worker.addEventListener("message", ({ data : packet }) =>
      if packet.type == "log"
        console.log(new Date(packet.time).toISOString(), packet.args...)
    )

    @worker.onerror = (err) -> console?.error(err)


  # Returns a `$.Deferred` object representing the completion state.
  send : (payload) ->

    deferred = new $.Deferred()

    workerHandle = Math.random()

    workerMessageCallback = ({ data : packet }) =>

      if packet.workerHandle == workerHandle

        if packet.type == "progress"
          deferred.notify(packet.payload)

        else
          @worker.removeEventListener("message", workerMessageCallback, false)

          if packet.type == "success"
            deferred.resolve(packet.payload)

          else
            deferred.reject(packet.payload)
            console.log("reject", packet)

    @worker.addEventListener("message", workerMessageCallback, false)
    @worker.postMessage { workerHandle, payload }

    deferred.promise()


module.exports = WrappedDispatchedWorker
