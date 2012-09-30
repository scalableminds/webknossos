### define
libs/request : request
libs/event_mixin : EventMixin
libs/json_socket : JsonSocket
model/game : Game
model/tracepoint : TracePointClass
###

# This takes care of the route. 
  
# Constants
BUFFER_SIZE = 262144 # 1024 * 1204 / 4
PUSH_THROTTLE_TIME = 30000 # 30s
INIT_TIMEOUT = 10000 # 10s

KIND_USUAL  = 0
KIND_BRANCH = 1

Route = 
  
  # Variables
  branchStack : []
  tree : null
  activeNode : null

  # Initializes this module and returns a position to start your work.
  initialize : _.once ->

    Game.initialize().pipe =>

      _.extend(this, new EventMixin())

      @socket = new JsonSocket(
        senders : [
          new JsonSocket.WebSocket("ws://#{document.location.host}/task/ws/#{Game.task.id}")
          new JsonSocket.Comet("/task/comet/#{Game.task.id}")
        ]
      )

      deferred = new $.Deferred()

      @socket.on "data", (data) =>
        
        Route.data = data
        console.log data
        @id        = data.dataSet.id
        #@branchStack = data.task.branchPoints.map (a) -> new Float32Array(a)
        @branchStack = (data.task.trees[branchPoint.treeId].nodes[branchPoint.id].position for branchPoint in data.task.branchPoints) # when data.task.trees[branchPoint.treeId]?.id? == branchPoint.treeId)
        @createBuffer()

        @idCount = 1
        @tree = null
        @activeNode = @tree
        
        # Build sample tree
        @putNewPoint([300, 300, 200], KIND_USUAL)
        branch = @putNewPoint([300, 320, 200], KIND_BRANCH)
        @putNewPoint([340, 340, 200], KIND_USUAL)
        @putNewPoint([360, 380, 200], KIND_USUAL)
        @activeNode = branch
        branch = @putNewPoint([340, 280, 200], KIND_BRANCH)
        @putNewPoint([360, 270, 200], KIND_USUAL)
        @activeNode = branch
        @putNewPoint([360, 290, 200], KIND_USUAL)
        console.log "--------- TREE ---------"
        console.log @tree.toString()

        $(window).on(
          "unload"
          => 
            @putBranch(@lastPosition) if @lastPosition
            @pushImpl()
        )

        deferred.resolve(data.task.editPosition)

      setTimeout(
        -> deferred.reject()
        INIT_TIMEOUT
      )

      deferred

  # Pushes the buffered route to the server. Pushing happens at most 
  # every 30 seconds.
  push : ->
    console.log "push()"
    @push = _.throttle(_.mutexDeferred(@pushImpl, -1), PUSH_THROTTLE_TIME)
    @push()

  pushImpl : ->

    console.log "pushing..."

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

    #console.log @buffer.subarray(0, 50)

    @push()

  putBranch : (position) ->

    @initialize().done =>
      
      @addToBuffer(1, position)
      # push TransformationMatrix for compatibility reasons
      @branchStack.push(position)

      @putNewPoint(position, KIND_BRANCH)

    return

  popBranch : ->

    @initialize().pipe =>

      savedActiveNode = @activeNode
      if @activeNode
        while (true)
          @activeNode = @activeNode.parent
          unless @activeNode
            break
          if (@activeNode.kind == KIND_BRANCH)
            break
      unless @activeNode
        @activeNode = savedActiveNode
      
      deferred = new $.Deferred()
      
      # Georg doesn't get the following lines
      { branchStack } = @

      if branchStack.length > 0
        @addToBuffer(2)
        #deferred.resolve(branchStack.pop())
        deferred.resolve(@activeNode.pos)
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

      @putNewPoint(position, KIND_USUAL)

    return

  putNewPoint : (position, kind) ->
      point = new TracePoint(@activeNode, kind, @idCount++, position, 1, 1)
      if @activeNode
        @activeNode.appendNext(point)
      else
        @tree = point
      @activeNode = point
      #console.log @tree.toString()
      #console.log @getNodeList()
      #for item in @getNodeList()
      #  console.log item.id

  getActiveNodeId : ->
    @activeNode.id

  getActiveNodePos : ->
    @activeNode.pos

  setActiveNode : (id) ->
    findResult = if @tree.id == id then @tree else @tree.findNodeById(id)
    if (findResult)
      @activeNode = findResult
    return @activeNode.pos

  deleteActiveNode : ->
    id = @activeNode.id
    @activeNode = @activeNode.parent
    @activeNode.remove(id)
    console.log @tree.toString()

  getTree : ->
    @tree

  getNodeList : (start) ->
    unless start
      start = @tree
    result = [start]
    for c in start.getChildren()
      if c
        result = result.concat(@getNodeList(c))
    return result