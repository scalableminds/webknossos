### define ###

class V3RingBuffer

  start : 0
  end : 0
  length : 0

  constructor : (@capacity = 6144, @bufferType = Float32Array) ->
    throw "Parameter `capacity` must be a multiple of 3" unless @capacity % 3 == 0
    @buffer = new @bufferType(@capacity)

  unshift3 : (x, y, z) ->
    throw "V3RingBuffer is full" unless @length < @capacity

    start = if @start == 0
      @start = @capacity - 3
    else
      @start -= 3

    { buffer } = @
    buffer[start]     = x
    buffer[start + 1] = y
    buffer[start + 2] = z

    @length += 3

  unshift : (v) ->
    @unshift3(v[0], v[1], v[2])

  push3 : (x, y, z) ->
    throw "V3RingBuffer is full" unless @length < @capacity

    { buffer, capacity, end } = @
    buffer[end]     = x
    buffer[end + 1] = y
    buffer[end + 2] = z

    if end == capacity - 3
      @end = 0
    else
      @end += 3

    @length += 3

  push : (v) ->
    @push3(v[0], v[1], v[2])

  shift : (r = new @bufferType(3)) ->
    throw "V3RingBuffer is empty" unless @length

    { buffer, start } = @

    r[0] = buffer[start++]
    r[1] = buffer[start++]
    r[2] = buffer[start++]

    @start = if start == @capacity
      0
    else
      start
    @length -= 3

    r

  pop : (r = new @bufferType(3)) ->
    throw "V3RingBuffer is empty" unless @length

    { buffer, end } = @

    end = @capacity if end == 0
    r[2] = buffer[--end]
    r[1] = buffer[--end]
    r[0] = buffer[--end]
    
    @end = end
    @length -= 3
    r




