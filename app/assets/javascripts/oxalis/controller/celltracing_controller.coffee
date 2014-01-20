### define
../model/dimensions : Dimensions
../constants : constants
###

class CellTacingController

  constructor : ( { @model, @view, @sceneController, @cameraController, @move, @calculateGlobalPos, @gui }, controlMode ) ->

    @inTraceMode = controlMode == constants.CONTROL_MODE_TRACE

    @abstractTreeController = new AbstractTreeController(@model)
    @abstractTreeController.view.on 
      nodeClick : (id) => @setActiveNode(id, true, false)

    @gui.on
      deleteActiveNode : =>
        @model.cellTracing.deleteActiveNode()
      setActiveTree : (id) => @setActiveTree(id, false)
      setActiveNode : (id) => @setActiveNode(id, false)
      setActiveCell : (id) => @model.volumeTracing.setActiveCell(id)
      createNewCell : => @model.volumeTracing.createCell()
      newBoundingBox : (bb) => @sceneController.setBoundingBox(bb)

    @mouseControls = 

      leftDownMove : (delta, pos) => 

        @move [
          delta.x * @model.user.getMouseInversionX() / @view.scaleFactor
          delta.y * @model.user.getMouseInversionY() / @view.scaleFactor
          0
        ]
      

      leftClick : (pos, plane, event) =>
        
        if @inTraceMode
          @onClick(pos, event.shiftKey, event.altKey, plane)


      rightClick : (pos, plane, event) =>
        
        if @inTraceMode
          @setWaypoint(@calculateGlobalPos( pos ), event.ctrlKey)


    @keyboardControls =

      "1" : => @sceneController.toggleSkeletonVisibility()
      "2" : => @sceneController.toggleInactiveTreeVisibility()

      #Delete active node
      "delete" : => @model.cellTracing.deleteActiveNode()
      "c" : => @model.cellTracing.createNewTree()

      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch() 

      "s" : @centerActiveNode

      #Comments
      "n" : => @setActiveNode(@model.cellTracing.nextCommentNodeID(false), true)
      "p" : => @setActiveNode(@model.cellTracing.nextCommentNodeID(true), true)

    # For data viewer, no keyboard controls
    if not @inTraceMode
      @keyboardControls = {}

    # Mange side bar input
    $("#comment-input").on "change", (event) => 
      @model.cellTracing.setComment(event.target.value)
      $("#comment-input").blur()

    $("#comment-previous").click =>
      @prevComment()

    $("#comment-next").click =>
      @nextComment()

    $("#tab-comments").on "click", "a[data-nodeid]", (event) =>
      event.preventDefault()
      @setActiveNode($(event.target).data("nodeid"), true, false)

    $("#tree-name-submit").click (event) =>
      @model.cellTracing.setTreeName($("#tree-name-input").val())

    $("#tree-name-input").keypress (event) =>
      if event.which == 13
        $("#tree-name-submit").click()
        $("#tree-name-input").blur()

    $("#tree-prev-button").click (event) =>
      @selectNextTree(false)

    $("#tree-next-button").click (event) =>
      @selectNextTree(true)

    $("#tree-create-button").click =>
      @model.cellTracing.createNewTree()

    $("#tree-delete-button").click =>
      @model.cellTracing.deleteTree(true)

    $("#tree-list").on "click", "a[data-treeid]", (event) =>
      event.preventDefault()
      @setActiveTree($(event.currentTarget).data("treeid"), true)

    $("#tree-color-shuffle").click =>
      @model.cellTracing.shuffleActiveTreeColor()

    $("#tree-sort").on "click", "a[data-sort]", (event) =>
      event.preventDefault()
      @model.user.setValue("sortTreesByName", ($(event.currentTarget).data("sort") == "name"))

    $("#comment-sort").on "click", "a[data-sort]", (event) =>
      event.preventDefault()
      @model.user.setValue("sortCommentsAsc", ($(event.currentTarget).data("sort") == "asc"))


  setParticleSize : (delta) =>

    particleSize = @model.user.particleSize + delta
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize)
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize)

    @model.user.setValue("particleSize", (Number) particleSize)
 

  toggleSkeletonVisibility : =>

    @sceneController.toggleSkeletonVisibility()
    # Show warning, if this is the first time to use
    # this function for this user
    if @model.user.firstVisToggle
      @view.showFirstVisToggle()
      @model.user.firstVisToggle = false
      @model.user.push()


  toggleInactiveTreeVisibility : =>

    @sceneController.toggleInactiveTreeVisibility()
  

  setWaypoint : (position, ctrlPressed) =>

    activeNode = @model.cellTracing.getActiveNode()
    # set the new trace direction
    if activeNode
      @model.flycam.setDirection([
        position[0] - activeNode.pos[0], 
        position[1] - activeNode.pos[1], 
        position[2] - activeNode.pos[2]
      ])

    @addNode(position, not ctrlPressed)

    # Strg + Rightclick to set new not active branchpoint
    if ctrlPressed and 
      @model.user.newNodeNewTree == false and 
        @model.cellTracing.getActiveNodeType() == constants.TYPE_USUAL

      @pushBranch()
      @setActiveNode(activeNode.id)


  onClick : (position, shiftPressed, altPressed, plane) =>

    unless shiftPressed # do nothing
      return

    scaleFactor = @view.scaleFactor
    camera      = @view.getCameras()[plane]
    # vector with direction from camera position to click position
    vector = new THREE.Vector3((position.x / (384 * scaleFactor) ) * 2 - 1, - (position.y / (384 * scaleFactor)) * 2 + 1, 0.5)
    
    # create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    projector = new THREE.Projector()
    raycaster = projector.pickingRay(vector, camera)
    raycaster.ray.threshold = @model.flycam.getRayThreshold(plane)

    raycaster.ray.__scalingFactors = @model.scaleInfo.nmPerVoxel
 
    # identify clicked object
    intersects = raycaster.intersectObjects(@sceneController.skeleton.getAllNodes())
    
    for intersect in intersects

      index = intersect.index
      nodeID = intersect.object.geometry.nodeIDs.getAllElements()[index]

      posArray = intersect.object.geometry.__vertexArray
      intersectsCoord = [posArray[3 * index], posArray[3 * index + 1], posArray[3 * index + 2]]
      globalPos = @model.flycam.getPosition()

      # make sure you can't click nodes, that are clipped away (one can't see)
      ind = Dimensions.getIndices(plane)
      if intersect.object.visible and
        (plane == constants.TDView or
          (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < @cameraController.getClippingDistance(ind[2])+1))

        # set the active Node to the one that has the ID stored in the vertex
        # center the node if click was in 3d-view
        centered = plane == constants.TDView
        @setActiveNode(nodeID, centered, shiftPressed and altPressed)
        break


  ########### Model Interaction

  addNode : (position, centered) =>

    if @model.user.newNodeNewTree == true
      @createNewTree()
      # make sure the tree was rendered two times before adding nodes,
      # otherwise our buffer optimizations won't work
      @model.cellTracing.one("finishedRender", =>
        @model.cellTracing.one("finishedRender", =>
          @model.cellTracing.addNode(position, constants.TYPE_USUAL))
        @view.draw())
      @view.draw()
    else
      @model.cellTracing.addNode(position, constants.TYPE_USUAL, centered)


  pushBranch : =>

    @model.cellTracing.pushBranch()


  popBranch : =>

    _.defer => @model.cellTracing.popBranch().done((id) => 
      @setActiveNode(id, true)
    )


  setActiveNode : (nodeId, centered, mergeTree) =>

    @model.cellTracing.setActiveNode(nodeId, mergeTree)
    if centered
      @centerActiveNode()


  centerActiveNode : =>

    position = @model.cellTracing.getActiveNodePos()
    if position
      @model.flycam.setPosition(position)


  deleteActiveNode : =>

    @model.cellTracing.deleteActiveNode()


  createNewTree : =>

    @model.cellTracing.createNewTree()


  setActiveTree : (treeId, centered) ->

    @model.cellTracing.setActiveTree(treeId)
    if centered
      @centerActiveNode()


  selectNextTree : (next) ->

    @model.cellTracing.selectNextTree(next)
    @centerActiveNode()


  setActiveNode : (nodeId, centered, mergeTree) ->

    @model.cellTracing.setActiveNode(nodeId, mergeTree)
    if centered
      @centerActiveNode()


  centerActiveNode : ->

    if @mode is constants.MODE_PLANE_TRACING
      @planeController.centerActiveNode()
    else
      @arbitraryController.centerActiveNode()


  # Comments

  prevComment : =>

    @setActiveNode(@model.cellTracing.nextCommentNodeID(false), true)


  nextComment : =>

    @setActiveNode(@model.cellTracing.nextCommentNodeID(true), true)

    
