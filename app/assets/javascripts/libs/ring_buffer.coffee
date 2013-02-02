### define ###

class RingBuffer

  GROW_MULTIPLIER : 1.5

  constructor : (@elementLength, initialCapacity = 1000, @bufferType = Float32Array) ->

    @capacity = initialCapacity * elementLength
    @buffer = new @bufferType(@capacity)

    @start = 0
    @end = 0
    @length = 0


  clear : ->

    @end = @start
    @length = 0


  isEmpty : -> @length == 0

  isFull : -> @length == @capacity


  unshift : (element) ->

    @ensureCapacity()

    { buffer, start, capacity, elementLength } = this

    if start == 0
      @start = capacity - elementLength
    else
      @start -= elementLength

    start = @start

    buffer.set(element, start)

    @length += elementLength

    return


  push : (element) ->

    @ensureCapacity()

    { buffer, end, capacity, elementLength } = this
   
    buffer.set(element, end)

    if end == capacity - elementLength
      @end = 0
    else
      @end += elementLength

    @length += elementLength


  pushMany : (elements) ->

    @ensureCapacity(@length + elements.length * @elementLength)

    { buffer, elementLength } = this
   
    for element in elements

      buffer.set(element, @end)

      if @end == @capacity - elementLength
        @end = 0
      else
        @end += elementLength

    @length += elements.length * elementLength


  shift : (r = new Array(@elementLength)) ->

    return unless @length

    { buffer, start, capacity, elementLength } = this

    for i in [0...elementLength] by 1
      r[i] = buffer[start++]

    @start = if start == capacity
      0
    else
      start

    @length -= elementLength

    r


  pop : (r = new Array(@elementLength)) ->

    return unless @length

    { buffer, end, elementLength } = this

    end = @capacity if end == 0

    for i in [(elementLength - 1)..0] by -1
      r[i] = buffer[--end]
    
    @end = end
    @length -= elementLength

    r


  top : (r = new Array(@elementLength)) ->

    return unless @length

    { buffer, end, elementLength } = this

    for i in [(elementLength - 1)..0] by -1
      r[i] = buffer[--end]

    r


  ensureCapacity : (newCapacity = @length + @elementLength) ->

    if @capacity < newCapacity

      { buffer, start, end } = this

      while @capacity < newCapacity

        @capacity = Math.floor(@capacity * @GROW_MULTIPLIER)
        @capacity -= @capacity % @elementLength

      newBuffer = new @bufferType(@capacity)
      
      if start <= end

        newBuffer.set(buffer)

      else

        newBuffer.set(buffer.subarray(start))
        newBuffer.set(buffer.subarray(0, end), buffer.length - start)
      
      @start = 0
      @end = @length
      @buffer = newBuffer