### define
underscore : _
../viewmodes/plane_controller : PlaneController
../../constants : constants
###

class CellTracingPlaneController extends PlaneController

  # See comment in Controller class on general controller architecture.
  #
  # Cell Tracing Plane Controller:
  # Extends Plane controller to add controls that are specific to Skeleton
  # Tracing.


  constructor : (@model, stats, @gui, @view, @sceneController, @cellTracingController) ->

    super(@model, stats, @gui, @view, @sceneController)

    @planeView.on
      finishedRender : => @model.cellTracing.rendered()


  getPlaneMouseControls : (planeId) ->

    return _.extend super(planeId),

      leftDownMove : (delta, pos) => 

        @move [
          delta.x * @model.user.getMouseInversionX() / @planeView.scaleFactor
          delta.y * @model.user.getMouseInversionY() / @planeView.scaleFactor
          0
        ]
      

      leftClick : (pos, plane, event) =>
        
        @onClick(pos, event.shiftKey, event.altKey, plane)


      rightClick : (pos, plane, event) =>
        
        @setWaypoint(@calculateGlobalPos( pos ), event.ctrlKey)


  getTDViewMouseControls : ->

    return _.extend super(),

      leftClick : (position, plane, event) =>
        @onClick(position, event.shiftKey, event.altKey, constants.TDView)


  getKeyboardControls : ->

    return _.extend super(),

      "1" : => @toggleVisibility()
      "2" : => @sceneController.skeleton.toggleInactiveTreeVisibility()

      #Delete active node
      "delete" : => @model.cellTracing.deleteActiveNode()
      "c" : => @model.cellTracing.createNewTree()

      #Branches
      "b" : => @model.cellTracing.pushBranch()
      "j" : => @popBranch() 

      "s" : @centerActiveNode

      #Comments
      "n" : => @cellTracingController.setActiveNode(
        @model.cellTracing.nextCommentNodeID(false), false, true)
      "p" : => @cellTracingController.setActiveNode(
        @model.cellTracing.nextCommentNodeID(true), false, true)


  popBranch : =>

    _.defer => @model.cellTracing.popBranch().done((id) => 
      @cellTracingController.setActiveNode(id, false, true)
    )


  scrollPlanes : (delta, type) =>

    super(delta, type)

    if type == "shift"
      @cellTracingController.setParticleSize(delta)


  onClick : (position, shiftPressed, altPressed, plane) =>

    unless shiftPressed # do nothing
      return

    scaleFactor = @planeView.scaleFactor
    camera      = @planeView.getCameras()[plane]
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
        @cellTracingController.setActiveNode(nodeID, shiftPressed and altPressed, centered)
        break
  

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

      @model.cellTracing.pushBranch()
      @cellTracingController.setActiveNode(activeNode.id)
      

  addNode : (position, centered) =>

    if @model.user.newNodeNewTree == true
      @createNewTree()
      # make sure the tree was rendered two times before adding nodes,
      # otherwise our buffer optimizations won't work
      @model.cellTracing.one("finishedRender", =>
        @model.cellTracing.one("finishedRender", =>
          @model.cellTracing.addNode(position, constants.TYPE_USUAL))
        @planeView.draw())
      @planeView.draw()
    else
      @model.cellTracing.addNode(position, constants.TYPE_USUAL, centered)
