PullQueue = require("./pullqueue")
_ = require("lodash")


class TemporalBucketManager
  # Manages temporal buckets (i.e., buckets created for annotation where
  # the original bucket has not arrived from the server yet) and handles
  # their special treatment.


  constructor : (@pullQueue, @pushQueue) ->

    @loadedPromises = []


  getCount : ->

    return @loadedPromises.length


  addBucket : (bucket) ->

    @pullBucket(bucket)
    @loadedPromises.push(@makeLoadedPromise(bucket))


  pullBucket : (bucket) ->

    @pullQueue.add(
        bucket: bucket.zoomedAddress
        priority: PullQueue::PRIORITY_HIGHEST
    )
    @pullQueue.pull()


  makeLoadedPromise : (bucket) ->

    loadedPromise = new Promise(
      (resolve, reject) =>
        bucket.on "bucketLoaded", =>

          if bucket.dirty
            @pushQueue.insert(bucket.zoomedAddress)

          _.removeElement(@loadedPromises, loadedPromise)
          resolve()
    )
    return loadedPromise


  getAllLoadedPromise : ->

    return Promise.all(@loadedPromises)


module.exports = TemporalBucketManager
