$ = require("jquery")
_ = require("lodash")

# `DispatchedWorker` is a wrapper around the WebWorker API. First you
# initialize it providing a worker object of the javascript worker code.
# Afterwards you can request work using `send` and wait for the result
# using the returned deferred.
class DispatchedWorker

  constructor : (workerClass) ->

    @worker = new workerClass()

    @worker.onerror = (err) -> console?.error(err)


  # Returns a `$.Deferred` object representing the completion state.
  send : (payload) ->

    deferred = new $.Deferred()

    _.defer(=>

      workerHandle = Math.random()

      workerMessageCallback = ({ data : packet }) =>

        if packet.workerHandle == workerHandle
          @worker.removeEventListener("message", workerMessageCallback, false)
          if packet.error
            deferred.reject(packet.error)
          else
            deferred.resolve(packet.payload)

      @worker.addEventListener("message", workerMessageCallback, false)
      @worker.postMessage { workerHandle, payload }
    )


    return deferred.promise()


class DispatchedWorker.Pool

  constructor : (@workerClass, @workerLimit = 3) ->

    @queue = []
    @workers = []


  send : (data) ->

    for _worker in @workers when not _worker.busy
      worker = _worker
      break

    if not worker and @workers.length < @workerLimit
      worker = @spawnWorker()

    if worker
      worker.send(data)
    else
      @queuePush(data)


  spawnWorker : ->

    worker = new DispatchedWorker(@workerClass)
    worker.busy = false

    workerReset = =>

      worker.busy = false
      @queueShift(worker)


    worker.worker.onerror = (err) ->

      console?.error(err)
      workerReset()


    worker.worker.addEventListener("message", workerReset, false)

    @workers.push(worker)

    worker


  queueShift : (worker) ->

    if @queue.length > 0 and not worker.busy
      { data, deferred } = @queue.shift()
      worker.send(data)
        .done (data) -> deferred.resolve(data)
        .fail (err) -> deferred.reject(err)


  queuePush : (data) ->

    deferred = $.Deferred()
    @queue.push { data, deferred }


module.exports = DispatchedWorker
