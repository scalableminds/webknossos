### define ###

class ResizableBuffer

  GROW_MULTIPLIER : 1.3

  constructor : (@elementLength, initialCapacity = 100, @bufferType = Float32Array) ->

    @capacity = initialCapacity * elementLength
    @buffer = new @bufferType(@capacity)

    @length = 0


  clear : ->

    @length = 0


  isEmpty : -> @length == 0

  isFull : -> @length == @capacity

  getLength : -> @length/@elementLength

  getBuffer : -> @buffer

  getAllElements : -> @buffer.subarray(0, @length)

  get : (i) -> @buffer[i]

  set : (element, i) ->

    @buffer.set(element, i * @elementLength)


  push : (element) ->

    @ensureCapacity()

    { buffer, elementLength, length } = this
   
    buffer.set(element, length)

    @length += elementLength


  pushMany : (elements) ->

    @ensureCapacity(@length + elements.length * @elementLength)

    { buffer, elementLength, length } = this

    for element in elements
      buffer.set(element, length)
      length += elementLength

    @length += elements.length * elementLength

  pushSubarray : (subarray) ->

    @ensureCapacity(@length + subarray.length)

    { buffer, elementLength, length } = this

    buffer.set(subarray, length)

    @length += subarray.length


  pop : (r = new Array(@elementLength)) ->

    return unless @length

    { buffer, elementLength, length } = this

    for i in [(elementLength - 1)..0] by -1
      r[i] = buffer[--length]
    
    @length -= elementLength

    r


  top : (r = new Array(@elementLength)) ->

    return unless @length

    { buffer, elementLength, length } = this

    for i in [(elementLength - 1)..0] by -1
      r[i] = buffer[--length]

    r


  ensureCapacity : (newCapacity = @length + @elementLength) ->

    if @capacity < newCapacity

      { buffer } = this

      while @capacity < newCapacity

        @capacity = Math.floor(@capacity * @GROW_MULTIPLIER)
        @capacity -= @capacity % @elementLength

      newBuffer = new @bufferType(@capacity)

      newBuffer.set(buffer)
      
      @buffer = newBuffer