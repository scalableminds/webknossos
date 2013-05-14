### define
underscore : _
jquery : $
../../libs/request : Request
../../libs/event_mixin : EventMixin
###

class StateLogger

  PUSH_THROTTLE_TIME : 30000 #30s

  constructor : (@route, @flycam, @version, @dataId, @isEditable) ->

    _.extend(this, new EventMixin())

    @committedDiffs = []
    @newDiffs = []
    @committedCurrentState = true

    @failedPushCount = 0

  pushDiff : (action, value, push = true) ->
    @newDiffs.push({
      action : action
      value : value
    })
    # In order to assure that certain actions are atomic,
    # it is sometimes necessary not to push.
    if push
      @push()

  #### TREES

  treeObject : (tree, oldId) ->
    treeColor = new THREE.Color(tree.color)
    return {
      id: if oldId then oldId else tree.treeId
      updatedId: if oldId then tree.treeId
      color: [treeColor.r, treeColor.g, treeColor.b, 1]
      name: tree.name
      }

  createTree : (tree) ->
    @pushDiff("createTree", @treeObject(tree))

  updateTree : (tree, oldId = false) ->
    @pushDiff("updateTree", @treeObject(tree, oldId))

  deleteTree : (tree) ->
    @pushDiff("deleteTree", {
      id: tree.treeId
      })

  mergeTree : (sourceTree, targetTree, lastNodeId, activeNodeId) ->
    # Make sure that those nodes exist
    found = false; treeIds = []
    for node in sourceTree.nodes
      found |= (node.id == lastNodeId)
      treeIds.push(node.id)
    $.assert(found, "lastNodeId not in sourceTree",
      {sourceTreeNodeIds : treeIds, lastNodeId : lastNodeId})

    found = false; treeIds = []
    for node in targetTree.nodes
      found |= (node.id == activeNodeId)
      treeIds.push(node.id)
    $.assert(found, "activeNodeId not in targetTree",
      {targetTreeNodeIds : treeIds, activeNodeId : activeNodeId})

    # Copy all edges and nodes from sourceTree to
    # targetTree, while leaving targetTree's properties
    # unchanged. Then, delete sourceTree.
    @pushDiff("mergeTree", {
        sourceId : sourceTree.treeId
        targetId : targetTree.treeId
      }, false)
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
    $.assert(node.neighbors.length == 1,
      "Node has to have exactly one neighbor", node.neighbors.length)

    return {
      treeId : treeId
      source : node.neighbors[0].id
      target : node.id
    }

  createNode : (node, treeId) ->
    $.assert(node.neighbors.length <= 1,
      "New node can't have more than one neighbor", node.neighbors.length)
    if node.neighbors[0]
      $.assert(node.treeId == node.neighbors[0].treeId,
        "Neighbot has different treeId",
        {treeId1 : node.treeId, treeId2 : node.neighbors[0].treeId})

    needsEdge = node.neighbors.length == 1
    @pushDiff("createNode", @nodeObject(node, treeId), !needsEdge)
    if needsEdge
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
        comments : @route.getPlainComments()
        activeNodeId : @route.getActiveNodeId()
        editPosition : @flycam.getPosition()
      }
    })

  #### SERVER COMMUNICATION

  stateSaved : ->
    return @committedCurrentState and @committedDiffs.length == 0

  push : ->
    if @isEditable
      @committedCurrentState = false
      @pushDebounced()

  # Pushes the buffered route to the server. Pushing happens at most 
  # every 30 seconds.
  pushDebounced : ->
    saveFkt = => @pushImpl(true)
    @pushDebounced = _.throttle(_.mutexDeferred( saveFkt, -1), @PUSH_THROTTLE_TIME)
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
    @committedCurrentState = true
    data = @concatUpdateTracing(@committedDiffs)
    console.log "Sending data: ", data

    Request.send(
      url : "/tracing/#{@dataId}?version=#{(@version + 1)}"
      method : "PUT"
      data : data
      contentType : "application/json"
    )
    .fail (responseObject) =>
      
      @failedPushCount++

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
        @trigger("pushFailed", @failedPushCount >= 3 );
      @pushDeferred.reject()
      @pushDeferred = null

    .done (response) =>
      
      @failedPushCount = 0
      
      @version = response.version
      @committedDiffs = []
      @pushDeferred.resolve()
      @pushDeferred = null