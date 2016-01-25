
class Bucket


  STATE_UNREQUESTED : 0
  STATE_REQUESTED : 1
  STATE_LOADED : 2

  BUCKET_SIZE_P : 5


  constructor : (@BIT_DEPTH) ->

    @BUCKET_LENGTH = (1 << @BUCKET_SIZE_P * 3) * (@BIT_DEPTH >> 3)
    @BYTE_OFFSET   = (@BIT_DEPTH >> 3)

    @state = @STATE_UNREQUESTED
    @dirty = false
    @accessed = true

    @data = null
    @mergedCallback = null


  access : ->

    @accessed = true


  collect : ->

    collect = not @accessed and not @dirty
    @accessed = false
    return collect


  needsRequest : ->

    return @state == @STATE_UNREQUESTED


  isLoaded : ->

    return @state == @STATE_LOADED


  label : (labelFunc, mergedCallback) ->

    @dirty = true
    if @state != @STATE_LOADED
      @mergedCallback = mergedCallback

    labelFunc(@getOrCreateData())


  getOrCreateData : ->

    @accessed = true

    unless @data?
      @data = new Uint8Array(@BUCKET_LENGTH)

    return @data


  pull : ->

    @state = switch @state
      when @STATE_UNREQUESTED then @STATE_REQUESTED
      else @unexpectedState()


  receiveData : (data) ->

    @state = switch @state
      when @STATE_REQUESTED
        if @dirty
          @merge(data)
          @mergedCallback()
        else
          @data = data
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

  constructor : (BIT_DEPTH) ->
    super(BIT_DEPTH)

    @state = @STATE_LOADED
    @data = new Uint8Array(@BUCKET_LENGTH)

  label : (_) ->  # Do nothing

module.exports = {Bucket, NullBucket}
