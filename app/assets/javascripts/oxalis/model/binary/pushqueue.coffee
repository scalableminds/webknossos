### define
###

class PushQueue


  constructor : (@dataSetName, @cube, @dataLayerName) ->

    @queue = []


  insert : (bucket) ->

    @queue.push( bucket )
    @removeDuplicates()


  clear : ->

    @queue = []


  removeDuplicates : ->
    
    @queue.sort( @comparePositions )

    i = 0
    while i < @queue.length - 1
      if @comparePositions( @queue[i], @queue[i+1] ) == 0
        @queue.splice( i, 1 )
      else
        i++
        

  comparePositions : ([x1, y1, z1], [x2, y2, z2]) ->
      
      diffX = x1 - x2
      diffY = y1 - y2
      diffZ = z1 - z2
      return diffX || diffY || diffZ


  test : ->

    @clear()

    @insert( [1, 2, 3] )
    @insert( [1, 2, 2] )
    @insert( [1, 2, 4] )
    @insert( [1, 2, 3] ) #d
    @insert( [1, 3, 3] )
    @insert( [1, 1, 3] )
    @insert( [2, 2, 3] )
    @insert( [0, 2, 3] )
    @insert( [2, 2, 3] ) # d

    @print()
    
 
  print : ->

    for e in @queue
      console.log(e)