importScripts('../libs/require-2.1.1.js')

class PullWorker

  # Constants
  queue : []
  dataSetId : ""
  batchCount : 0

onmessage = (message) ->

  postMessage(message.data)