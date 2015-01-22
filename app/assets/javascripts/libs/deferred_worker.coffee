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


  execute : (data, transferrables=[]) ->

    jobId = @jobIdCounter++
    @jobs[jobId] = {
      deferred : new $.Deferred()
      startTime : (new Date()).getTime()
    }

    @webWorker.postMessage({data, jobId}, transferrables)

    return @jobs[jobId].deferred


  onMessage : ({jobId, result}) ->

    @jobs[jobId].deferred.resolve(result)
    time = (new Date()).getTime()
    console.log "Job finished, took:", (time - @jobs[jobId].startTime)
    delete @jobs[jobId]
