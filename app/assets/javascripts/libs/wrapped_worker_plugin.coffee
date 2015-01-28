### define
jquery : $
lodash : _
###

# `WrappedDispatchedWorker` is a wrapper around the WebWorker API. First you
# initialize it providing url of the javascript worker code. Afterwards
# you can request work using `send` and wait for the result using the
# returned deferred.
class WrappedDispatchedWorker

  @load : (name, parentRequire, loader, config) ->

    if config.isBuild
      loader()
    else
      loader( -> new WrappedDispatchedWorker(name, parentRequire.toUrl("lib/worker_plugin_worker.js")))
    return


  @write : (pluginName, moduleName, writer) ->

    writer("")


  constructor : (@url, loaderUrl) ->

    @worker = new Worker(loaderUrl)

    @worker.addEventListener("message", ({ data : packet }) =>
      if packet.type == "log"
        console.log(new Date(packet.time).toISOString(), packet.args...)

      if packet.type == "ready"
        @worker.postMessage(
          type : "load"
          payload : @url
        )
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


  class @Pool

    constructor : (@url, @workerLimit = 3) ->
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

      worker = new WrappedDispatchedWorker(@url)
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
