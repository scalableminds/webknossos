Backbone = require("backbone")
_ = require("lodash")

class Bucket


  STATE_UNREQUESTED : 0
  STATE_REQUESTED : 1
  STATE_LOADED : 2

  STATE_NAMES = ["unrequested", "requested", "loaded"]

  BUCKET_SIZE_P : 5


  constructor : (@BIT_DEPTH, @zoomedAddress, @temporalBucketManager) ->

    _.extend(this, Backbone.Events)

    @BUCKET_LENGTH = (1 << @BUCKET_SIZE_P * 3) * (@BIT_DEPTH >> 3)
    @BYTE_OFFSET   = (@BIT_DEPTH >> 3)

    @state = @STATE_UNREQUESTED
    @dirty = false
    @accessed = true

    @data = null


  shouldCollect : ->

    collect = not @accessed and not @dirty and @state != @STATE_REQUESTED
    @accessed = false
    return collect


  needsRequest : ->

    return @state == @STATE_UNREQUESTED


  isLoaded : ->

    return @state == @STATE_LOADED


  label : (labelFunc) ->

    labelFunc(@getOrCreateData())
    @dirty = true


  hasData : ->

    return @data?


  getData : ->

    unless @data?
      throw new Error("Bucket.getData() called, but data does not exist.")

    @accessed = true
    return @data


  getOrCreateData : ->

    unless @data?
      @data = new Uint8Array(@BUCKET_LENGTH)
      @temporalBucketManager.addBucket(this)

    return @getData()


  pull : ->

    @state = switch @state
      when @STATE_UNREQUESTED then @STATE_REQUESTED
      else @unexpectedState()


  pullFailed : ->

    @state = switch @state
      when @STATE_REQUESTED then @STATE_UNREQUESTED
      else @unexpectedState()


  receiveData : (data) ->

    @state = switch @state
      when @STATE_REQUESTED
        if @dirty
          @merge(data)
        else
          @data = data
        @trigger("bucketLoaded")
        @STATE_LOADED
      else
        @unexpectedState()


  push : ->

    switch @state
      when @STATE_LOADED
        @dirty = false
      else
        @unexpectedState()


  unexpectedState : ->

    throw new Error("Unexpected state: " + @STATE_NAMES[@state])


  merge : (newData) ->

    voxelPerBucket = 1 << @BUCKET_SIZE_P * 3
    for i in [0...voxelPerBucket]

      oldVoxel = (@data[i * @BYTE_OFFSET + j] for j in [0...@BYTE_OFFSET])
      oldVoxelEmpty = _.reduce(oldVoxel, ((memo, v) => memo and v == 0), true)

      if oldVoxelEmpty
        for j in [0...@BYTE_OFFSET]
          @data[i * @BYTE_OFFSET + j] = newData[i * @BYTE_OFFSET + j]


class NullBucket

  # A NullBucket represents a bucket that does not exist, e.g. because it's
  # outside the dataset's bounding box. It supports only a small subset of
  # Bucket's methods.


  TYPE_OUT_OF_BOUNDING_BOX : 1
  TYPE_OTHER : 2


  constructor : (type) ->

    @isNullBucket = true
    @isOutOfBoundingBox = type == @TYPE_OUT_OF_BOUNDING_BOX


  hasData : -> return false
  needsRequest : -> return false


module.exports = {Bucket, NullBucket}
