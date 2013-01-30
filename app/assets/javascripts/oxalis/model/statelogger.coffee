### define
underscore : _
jquery : $
../../libs/request : Request
../../libs/event_mixin : EventMixin
###

PUSH_THROTTLE_TIME = 30000 # 30s

class StateLogger

  constructor : (@route, @flycam, @version, @dataId) ->

    _.extend(this, new EventMixin())

    @committedDiffs = []
    @newDiffs = []
    @savedCurrentState = true

  pushDiff : (action, value) ->
    @newDiffs.push({
      action : action
      value : value
    })
    @push()

  #### TREES

  treeObject : (tree) ->
    treeColor = new THREE.Color(tree.color)
    return {
      id: tree.treeId
      color: [treeColor.r, treeColor.g, treeColor.b, 1]
      }

  createTree : (tree) ->
    @pushDiff("createTree", @treeObject(tree))

  updateTree : (tree) ->
    @pushDiff("updateTree", @treeObject(tree))

  deleteTree : (tree) ->
    @pushDiff("deleteTree", {
      id: tree.treeId
      })

  mergeTree : (sourceTree, targetTree, lastNodeId, activeNodeId) ->
    # Copy all edges and nodes from sourceTree to
    # targetTree, while leaving targetTree's properties
    # unchanged. Then, delete sourceTree.
    @pushDiff("mergeTree", {
        sourceId : sourceTree.treeId
        targetId : targetTree.treeId
      })
    @createEdge(lastNodeId, activeNodeId, targetTree.treeId)

  #### NODES and EDGED

  nodeObject : (node, treeId) ->
    return {
      treeId : treeId,
      id: node.id,
      radius: node.radius,
      position : node.pos
      timestamp: node.time
      # DUMMY VALUES
      viewport : 0		
      resolution: 0
      }

  edgeObject : (node, treeId) ->
    # ASSUMTION: node has exactly one neighbor
    return {
      treeId : treeId
      source : node.neighbors[0].id
      target : node.id
    }

  createNode : (node, treeId) ->
    @pushDiff("createNode", @nodeObject(node, treeId))
    if node.neighbors.length == 1
      @pushDiff("createEdge", @edgeObject(node, treeId))

  updateNode : (node, treeId) ->
    @pushDiff("updateNode", @nodeObject(node, treeId))

  deleteNode : (node, treeId) ->
    # Edges will be deleted implicitly
    @pushDiff("deleteNode", {
      treeId : treeId
      id: node.id
      })

  moveTreeComponent : (sourceId, targetId, nodeIds) ->
    @pushDiff("moveTreeComponent", {
      sourceId : sourceId
      targetId : targetId
      nodeIds : nodeIds
      })

  createEdge : (source, target, treeId) ->
    # used when edges are set manually, e.g. for merging trees
    @pushDiff("createEdge", {
      treeId : treeId
      source : source
      target : target
      })

  concatUpdateTracing : (array) ->
    branchPoints = []
    for branchPoint in @route.branchStack
      branchPoints.push({id : branchPoint.id})
    return array.concat( {
      action : "updateTracing"
      value : {
        branchPoints : branchPoints
        comments : @route.comments
        activeNodeId : @route.getActiveNodeId()
        editPosition : @flycam.getPosition()
      }
    })

  #### SERVER COMMUNICATION

  push : ->
    @savedCurrentState = false
    @pushDebounced()

  # Pushes the buffered route to the server. Pushing happens at most 
  # every 30 seconds.
  pushDebounced : ->
    saveFkt = => @pushImpl(true)
    @pushDebounced = _.throttle(_.mutexDeferred( saveFkt, -1), PUSH_THROTTLE_TIME)
    @pushDebounced()

  pushNow : ->   # Interface for view & controller 
    return @pushImpl(false)

  pushImpl : (notifyOnFailure) ->

    # do not allow multiple pushes, before result is there (breaks versioning)
    # still, return the deferred of the pending push, so that it will be informed about success
    if @pushDeferred?
      return @pushDeferred

    @pushDeferred = new $.Deferred()

    @committedDiffs = @committedDiffs.concat(@newDiffs)
    @newDiffs = []
    data = @concatUpdateTracing(@committedDiffs)
    console.log "Sending data: ", data

    Request.send(
      url : "/tracing/#{@dataId}?version=#{(@version + 1)}"
      method : "PUT"
      data : data
      contentType : "application/json"
    )
    .fail (responseObject) =>
      if responseObject.responseText? && responseObject.responseText != ""
        # restore whatever is send as the response
        try
          response = JSON.parse(responseObject.responseText)
        catch error
          console.error "parsing failed."
        if response.messages?[0]?.error?
          if response.messages[0].error == "tracing.dirtyState"
            $(window).on(
              "beforeunload"
              =>return null)
            alert("Sorry, but the current state is inconsistent. A reload is necessary.")
            window.location.reload()
      @push()
      if (notifyOnFailure)
        @trigger("PushFailed");
      @pushDeferred.reject()
      @pushDeferred = null
    .done (response) =>
      @version = response.version
      @savedCurrentState = true
      @committedDiffs = []
      @pushDeferred.resolve()
      @pushDeferred = null