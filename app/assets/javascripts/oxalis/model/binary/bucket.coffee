Backbone = require("backbone")
_ = require("lodash")

class Bucket


  STATE_UNREQUESTED : 0
  STATE_REQUESTED : 1
  STATE_LOADED : 2

  BUCKET_SIZE_P : 5


  constructor : (@BIT_DEPTH, @zoomedAddress) ->

    _.extend(this, Backbone.Events)

    @BUCKET_LENGTH = (1 << @BUCKET_SIZE_P * 3) * (@BIT_DEPTH >> 3)
    @BYTE_OFFSET   = (@BIT_DEPTH >> 3)

    @state = @STATE_UNREQUESTED
    @dirty = false
    @accessed = true

    @data = null
    @mergedCallback = null


  shouldCollect : ->

    collect = not @accessed and not @dirty
    @accessed = false
    return collect


  needsRequest : ->

    return @state == @STATE_UNREQUESTED


  isLoaded : ->

    return @state == @STATE_LOADED


  label : (labelFunc, createdCallback=_.noop, loadedCallback=_.noop) ->

    labelFunc(@getOrCreateData(createdCallback))
    @dirty = true

    if @state == @STATE_LOADED
      loadedCallback()
    else
      @loadedCallback = loadedCallback


  hasData : ->

    return @data?


  getData : ->

    unless @data?
      throw new Error("Bucket.getData() called, but data does not exist.")

    @accessed = true
    return @data


  getOrCreateData : (createdCallback=_.noop) ->

    unless @data?
      @data = new Uint8Array(@BUCKET_LENGTH)
      createdCallback()

    return @getData()


  pull : ->

    @state = switch @state
      when @STATE_UNREQUESTED then @STATE_REQUESTED
      else @unexpectedState()


  receiveData : (data) ->

    @state = switch @state
      when @STATE_REQUESTED
        if @dirty
          @merge(data)
          @loadedCallback()
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
