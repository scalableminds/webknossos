PullQueue = require("./pullqueue")

class TemporalBucketManager
  # Manages temporal buckets (i.e., buckets created for annotation where
  # the original bucket has not arrived from the server yet) and handles
  # their special treatment.


  constructor : (@pullQueue, @pushQueue) ->

    @buckets = []


  addBucket : (bucket) ->

    @pullQueue.add(
        bucket: bucket.zoomedAddress
        priority: PullQueue::PRIORITY_HIGHEST
    )
    @pullQueue.pull()

    bucket.on "bucketLoaded", =>
      if bucket.dirty
        @pushQueue.insert(bucket.zoomedAddress)


module.exports = TemporalBucketManager
