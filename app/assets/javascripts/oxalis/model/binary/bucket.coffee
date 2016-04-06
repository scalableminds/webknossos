Backbone = require("backbone")
_ = require("lodash")

class Bucket


  STATE_UNREQUESTED : 0
  STATE_REQUESTED : 1
  STATE_LOADED : 2

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

    throw new Error("Unexpected state: " + @state)


  merge : (newData) ->

    voxelPerBucket = 1 << @BUCKET_SIZE_P * 3
    for i in [0...voxelPerBucket]

      oldVoxel = (@data[i * @BYTE_OFFSET + j] for j in [0...@BYTE_OFFSET])
      oldVoxelEmpty = _.reduce(oldVoxel, ((memo, v) => memo and v == 0), true)

      if oldVoxelEmpty
        for j in [0...@BYTE_OFFSET]
          @data[i * @BYTE_OFFSET + j] = newData[i * @BYTE_OFFSET + j]


class NullBucket extends Bucket

  constructor : ->
    super(0)
    @state = @STATE_LOADED

  label : (_) ->  # Do nothing


module.exports = {Bucket, NullBucket}
