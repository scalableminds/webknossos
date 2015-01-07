### define
jquery : $
###

# Wraps WebWorker to return $.Deferred objects
# The Worker has to accept {jobId, data} objects and
# post messages with {jobId, result}
class DeferredWorker


  constructor : (jsFilePath) ->

    @webWorker = new Worker(jsFilePath)
    @jobs = {}
    @jobIdCounter = 0

    @webWorker.onmessage = (evt) => @onMessage(evt.data)


  execute : (data) ->

    jobId = @jobIdCounter++
    @jobs[jobId] = $.Deferred()

    @webWorker.postMessage({data, jobId})

    return @jobs[jobId]


  onMessage : ({jobId, result}) ->

    @jobs[jobId].resolve(result)
    delete @jobs[jobId]
