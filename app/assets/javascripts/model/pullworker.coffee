importScripts('../libs/require-2.1.1.js')

class PullWorker

  # Constants
  BATCH_LIMIT : 10
  BATCH_SIZE : 5
  BUCKET_SIZE_P : 5

  queue : []
  dataSetId : ""
  batchCount : 0
