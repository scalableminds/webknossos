# helper functions

self.log = (args...) ->

  self.postMessage( { type : "log", time : Date.now(), args } )


module.exports = (obj) ->

  queuedMessages = []
  execMessage = (messageData) ->

    { workerHandle, payload } = messageData

    makeSender = (type) ->
      (arg, transferred = []) ->
        try
          self.postMessage( { workerHandle, type, payload : arg }, transferred )
        catch error
          self.postMessage( { workerHandle, type, payload : arg } )
        return

    obj[payload.method](payload.args...).then(
      makeSender("success")
      makeSender("error")
      makeSender("progress")
    )
    return


  self.addEventListener(
    "message"
    (event) ->
      if event.data
        execMessage(event.data)

    false
  )


  self.postMessage(
    type : "ready"
  )
