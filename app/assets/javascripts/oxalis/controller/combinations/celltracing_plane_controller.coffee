### define
underscore : _
../viewmodes/plane_controller : PlaneController
../../constants : constants
###

class CellTracingPlaneController extends PlaneController


  getPlaneMouseControls : ->

    return _.extend super(),

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
      "n" : => @model.cellTracing.setActiveNode(
        @model.cellTracing.nextCommentNodeID(false), false, true)
      "p" : => @model.cellTracing.setActiveNode(
        @model.cellTracing.nextCommentNodeID(true), false, true)


  popBranch : =>

    _.defer => @model.cellTracing.popBranch().done((id) => 
      @model.cellTracing.setActiveNode(id, false, true)
    )


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
        @model.cellTracing.setActiveNode(nodeID, shiftPressed and altPressed, centered)
        break