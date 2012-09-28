### define
libs/request : request
model/game : Game
###

# This takes care of the route. 
  
# Constants
BUFFER_SIZE = 262144 # 1024 * 1204 / 4
PUSH_THROTTLE_TIME = 30000 # 30s

Route = 
  
  # Variables
  branchStack : []

  # Initializes this module and returns a matrix to start your work.
  initialize : _.once ->

    Game.initialize().pipe =>

      request(
        url : "/route/initialize?dataSetId=#{Game.dataSet.id}"
        responseType : "json"
      ).pipe (data) =>
        
        @id          = data.route.id
        @branchStack = data.branches.map (a) -> new Float32Array(a)
        @createBuffer()
        
        $(window).on(
          "unload"
          => 
            @putBranch(@lastPosition) if @lastPosition
            @pushImpl()
        )

        #FIXME we don't need a matrix in the DB, change to just the position
        data.route.origin.slice(12,15)

  # Pushes the buffered route to the server. Pushing happens at most 
  # every 30 seconds.
  push : ->
    @push = _.throttle(_.mutexDeferred(@pushImpl, -1), PUSH_THROTTLE_TIME)
    @push()

  pushImpl : ->

    @initialize().pipe =>
      
      transportBuffer = new Float32Array(@buffer.subarray(0, @bufferIndex))
      @createBuffer()

      request(
        url    : "/route/#{@id}"
        method : 'POST'
        data   : transportBuffer.buffer
      ).fail =>
        
        oldBuffer = @buffer
        oldIndex  = @bufferIndex
        @createBuffer()
        @buffer.set(oldBuffer.subarray(0, oldIndex))
        @buffer.set(transportBuffer, oldIndex)
        @bufferIndex = oldIndex + transportBuffer.length

        @push()

  createBuffer : ->
    @bufferIndex = 0
    @buffer = new Float32Array(BUFFER_SIZE)

  addToBuffer : (typeNumber, value) ->

    @buffer[@bufferIndex++] = typeNumber

    if value and typeNumber != 2
      @buffer.set(value, @bufferIndex)
      @bufferIndex += 3

    @push()

  putBranch : (position) ->

    @initialize().done =>
      
      @addToBuffer(1, position)
      # push TransformationMatrix for compatibility reasons
      @branchStack.push([0,0,0,0,0,0,0,0,0,0,0,0,position[0],position[1],position[2],0])

    return

  popBranch : ->

    @initialize().pipe =>
      
      deferred = new $.Deferred()
      
      { branchStack } = @

      if branchStack.length > 0
        @addToBuffer(2)
        deferred.resolve(branchStack.pop().slice(12,15))
      else
        deferred.reject()

  # Add a point to the buffer. Just keep adding them.
  put : (position) ->

    @initialize().done =>

      position = V3.round(position, position)
      lastPosition = @lastPosition

      if not lastPosition or 
      lastPosition[0] != position[0] or 
      lastPosition[1] != position[1] or 
      lastPosition[2] != position[2]
        @lastPosition = position
        @addToBuffer(0, position)

    return