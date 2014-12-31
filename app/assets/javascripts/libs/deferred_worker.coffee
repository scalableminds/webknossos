### define
jquery : $
###

# Wraps WebWorker to return $.Deferred objects
class DeferredWorker


  constructor : (jsFilePath) ->

    @webWorker = new Worker(jsFilePath)


  execute : (data) ->

    deferred = $.Deferred( =>

      @webWorker.onmessage = (evt) ->
        deferred.resolve(evt.data)
      @webWorker.onError = (evt) ->
        deferred.reject(evt)

      @webWorker.postMessage(data)
    )

    return deferred.promise()
