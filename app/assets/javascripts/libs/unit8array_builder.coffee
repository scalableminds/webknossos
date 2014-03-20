### define
###

class Uint8ArrayBuilder


  constructor : ->

    @arrays = []
    @size   = 0


  push : (array) ->

    @size += array.byteLength
    if (array.constructor == Uint8Array)
      @arrays.push(array)
    else
      @arrays.push( new Uint8Array( array.buffer ) )


  build : ->

    result = new Uint8Array(@size)
    offset = 0

    for array in @arrays
      result.set(array, offset)
      offset += array.byteLength

    return result
