### define
underscore : _
jquery : $
###
  
class ActionableQueue

  constructor : ->

    @queue = []
    @pointer = 0


  push : (item) ->

    @queue.push(item)

    if @queue.length == 1
      item.notifyIndex(0)

    else
      item.notifyIndex(@queue.length - 1)

    return


  shift : ->

    item = @queue[@pointer++]

    item.notifyIndex(-1, 0)

    for item, i in @queue when i >= @pointer

      item.notifyIndex(i - @pointer, i + 1 - @pointer)

    return


  at : (index) ->

    @queue[@pointer + index]
    

  reset : -> 

    unless @pointer == 0
      @pointer = 0
      for item, i in @queue
        item.notifyIndex(i)

    return


  head : -> @at(0)

  length : -> @queue.length - @pointer

  empty : -> not @length()



