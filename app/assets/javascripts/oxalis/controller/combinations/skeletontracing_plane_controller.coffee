app             = require("app")
THREE           = require("three")
TWEEN           = require("tween.js")
_               = require("lodash")
PlaneController = require("../viewmodes/plane_controller")
constants       = require("../../constants")
dimensions      = require("../../model/dimensions")

class SkeletonTracingPlaneController extends PlaneController

  # See comment in Controller class on general controller architecture.
  #
  # Skeleton Tracing Plane Controller:
  # Extends Plane controller to add controls that are specific to Skeleton
  # Tracing.


  constructor : (@model, @view, @sceneController, @skeletonTracingController) ->

    super(@model, @view, @sceneController)


  start : ->

    super()
    $('.skeleton-plane-controls').show()


  stop : ->

    super()
    $('.skeleton-plane-controls').hide()


  getPlaneMouseControls : (planeId) ->

    return _.extend super(planeId),

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

      "1" : => @skeletonTracingController.toggleSkeletonVisibility()
      "2" : => @sceneController.skeleton.toggleInactiveTreeVisibility()

      #Delete active node
      "delete" : => @model.skeletonTracing.deleteActiveNode()
      "c" : => @model.skeletonTracing.createNewTree()

      #Branches
      "b" : => @model.skeletonTracing.pushBranch()
      "j" : => @popBranch()

      "s" : =>
        @skeletonTracingController.centerActiveNode()
        @cameraController.centerTDView()


  popBranch : =>

    _.defer => @model.skeletonTracing.popBranch().then((id) =>
      @skeletonTracingController.setActiveNode(id, false, true)
    )


  scrollPlanes : (delta, type) =>

    super(delta, type)

    if type == "shift"
      @skeletonTracingController.setRadius(delta)


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

    raycaster.ray.__scalingFactors = app.scaleInfo.nmPerVoxel

    # identify clicked object
    intersects = raycaster.intersectObjects(@sceneController.skeleton.getAllNodes())

    for intersect in intersects

      index = intersect.index
      geometry = intersect.object.geometry

      # Raycaster also intersects with vertices that have an
      # index larger than numItems
      if geometry.nodeIDs.getLength() <= index
        continue

      nodeID = geometry.nodeIDs.getAllElements()[index]

      posArray = geometry.attributes.position.array
      intersectsCoord = [posArray[3 * index], posArray[3 * index + 1], posArray[3 * index + 2]]
      globalPos = @model.flycam.getPosition()

      # make sure you can't click nodes, that are clipped away (one can't see)
      ind = dimensions.getIndices(plane)
      if intersect.object.visible and
        (plane == constants.TDView or
          (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < @cameraController.getClippingDistance(ind[2])+1))

        # set the active Node to the one that has the ID stored in the vertex
        # center the node if click was in 3d-view
        centered = plane == constants.TDView
        @skeletonTracingController.setActiveNode(nodeID, shiftPressed and altPressed, centered)
        break


  setWaypoint : (position, ctrlPressed) =>

    activeNode = @model.skeletonTracing.getActiveNode()
    # set the new trace direction
    if activeNode
      @model.flycam.setDirection([
        position[0] - activeNode.pos[0],
        position[1] - activeNode.pos[1],
        position[2] - activeNode.pos[2]
      ])

    rotation = @model.flycam.getRotation(@activeViewport)
    @addNode(position, rotation, not ctrlPressed)

    # Strg + Rightclick to set new not active branchpoint
    if ctrlPressed and not @model.user.get("newNodeNewTree")

      @model.skeletonTracing.pushBranch()
      @skeletonTracingController.setActiveNode(activeNode.id)


  addNode : (position, rotation, centered) =>

    if @model.user.get("newNodeNewTree") == true
      @model.skeletonTracing.createNewTree()

    if not @model.skeletonTracing.getActiveNode()?
      centered = true

    datasetConfig = @model.get("datasetConfiguration")

    @model.skeletonTracing.addNode(
      position,
      rotation,
      @activeViewport,
      @model.flycam.getIntegerZoomStep(),
      if datasetConfig.get("fourBit") then 4 else 8,
      datasetConfig.get("interpolation")
    )

    if centered
      @centerPositionAnimated(@model.skeletonTracing.getActiveNodePos())


  centerPositionAnimated : (position) ->

    # Let the user still manipulate the "third dimension" during animation
    dimensionToSkip = dimensions.thirdDimensionForPlane(@activeViewport)

    curGlobalPos = @flycam.getPosition()

    (new TWEEN.Tween({
        globalPosX: curGlobalPos[0]
        globalPosY: curGlobalPos[1]
        globalPosZ: curGlobalPos[2]
        flycam: @flycam
        dimensionToSkip: dimensionToSkip
    }))
    .to({
        globalPosX: position[0]
        globalPosY: position[1]
        globalPosZ: position[2]
      }, 200)
    .onUpdate( ->
        position = [@globalPosX, @globalPosY, @globalPosZ]
        position[@dimensionToSkip] = null
        @flycam.setPosition(position)
      )
    .start()


module.exports = SkeletonTracingPlaneController
