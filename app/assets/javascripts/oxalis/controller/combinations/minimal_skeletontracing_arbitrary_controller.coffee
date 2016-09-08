_                   = require("lodash")
app                 = require("app")
Input               = require("libs/input")
ArbitraryController = require("../viewmodes/arbitrary_controller")
Constants           = require("../../constants")
Toast               = require("libs/toast")

class MinimalSkeletonTracingArbitraryController extends ArbitraryController

  # See comment in Controller class on general controller architecture.
  #
  # Minimal Skeleton Tracing Arbitrary Controller:
  # Extends Arbitrary controller to add controls that are specific to minimal Arbitrary mode.

  constructor : (args...) ->

    super args...

    _.defer => @setRecord(true)


  initKeyboard : ->

    @input.keyboard = new Input.Keyboard(

      "space"         : (timeFactor) =>
        @move(timeFactor)

      #Zoom in/out
      "i"             : (timeFactor) => @cam.zoomIn()
      "o"             : (timeFactor) => @cam.zoomOut()

      #Rotate in distance
      "left"          : (timeFactor) => @cam.yaw @model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
      "right"         : (timeFactor) => @cam.yaw -@model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
      "up"            : (timeFactor) => @cam.pitch -@model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
      "down"          : (timeFactor) => @cam.pitch @model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
    )

    @input.keyboardNoLoop = new Input.KeyboardNoLoop(

      #Branches
      "b" : => @pushBranch()
      "j" : => @popBranch()

      #Branchpointvideo
      "." : => @nextNode(true)
      "," : => @nextNode(false)

    )

    @input.keyboardOnce = new Input.Keyboard(

      #Delete active node and recenter last node
      "shift + space" : =>
        @deleteActiveNode()

    , -1)


  # make sure that it is not possible to keep nodes from being created
  setWaypoint : =>

    return if @isBranchpointvideoMode()
    unless @model.get("flightmodeRecording")
      @model.set("flightmodeRecording", true)
    super


  deleteActiveNode : ->

    return if @isBranchpointvideoMode()
    skeletonTracing = @model.skeletonTracing
    activeNode = skeletonTracing.getActiveNode()
    if activeNode.id == 1
      Toast.error("Unable: Attempting to delete first node")
    else
      _.defer => @model.skeletonTracing.deleteActiveNode().then( => @centerActiveNode() )


module.exports = MinimalSkeletonTracingArbitraryController
