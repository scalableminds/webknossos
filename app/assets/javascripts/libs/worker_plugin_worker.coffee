# set up requireJS

importScripts("../../bower_components/requirejs/require.js")
importScripts("../require_config.js")
require.config(
  baseUrl : ".."
)


# helper functions

self.log = (args...) ->

  self.postMessage( { type : "log", time : Date.now(), args } )


module = null

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

  module[payload.method](payload.args...).then(
    makeSender("success")
    makeSender("error")
    makeSender("progress")
  )
  return


self.addEventListener(
  "message"
  (event) ->

    if event.data
      if event.data.type is "load"

        require(
          [ "#{event.data.payload}" ]
          (exportedModule) ->

            # load module into scope
            module = exportedModule

            # run queued messages
            while message = queuedMessages.shift()
              execMessage(message)

            return
        )

      else if module
        execMessage(event.data)

      else
        queuedMessages.push(event.data)


  false
)


self.postMessage(
  type : "ready"
)
