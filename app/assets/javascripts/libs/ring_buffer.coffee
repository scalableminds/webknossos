### define ###

class RingBuffer

  start : 0
  end : 0
  length : 0

  constructor : (@capacity = 1000) ->

    @buffer = []

  clear : ->

    @end = @start
    @length = 0

  unshift : (v) ->
    throw "RingBuffer is full" unless @length < @capacity

    @start = @capacity if @start == 0
    @buffer[--@start] = v
    @length++


  push : (v) ->
    throw "RingBuffer is full" unless @length < @capacity

    @bufferl[@end++] = v
    @end = 0 if @end == capacity 
    @length++


  shift : ->
    throw "RingBuffer is empty" unless @length

    r = @buffer[@start++]
    @start = 0 if @start == @capacity
    @length--
    r


  pop : ->
    throw "RingBuffer is empty" unless @length

    @end = @capacity if @end == 0
    r = @buffer[--@end]
    @length--
    r