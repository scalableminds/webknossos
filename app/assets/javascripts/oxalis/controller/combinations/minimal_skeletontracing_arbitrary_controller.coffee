_                   = require("lodash")
app                 = require("app")
Input               = require("libs/input")
ArbitraryController = require("../viewmodes/arbitrary_controller")
Constants           = require("../../constants")

class MinimalSkeletonTracingArbitraryController extends ArbitraryController

  # See comment in Controller class on general controller architecture.
  #
  # Minimal Skeleton Tracing Arbitrary Controller:
  # Extends Arbitrary controller to add controls that are specific to minimal Arbitrary mode.

  constructor : (args...) ->

    super args...

    _.defer => @setRecord(true)


  initKeyboard : ->

    getVoxelOffset  = (timeFactor) =>

      return @model.user.get("moveValue3d") * timeFactor / app.scaleInfo.baseVoxel / Constants.FPS

    @input.keyboard = new Input.Keyboard(

      "space"         : (timeFactor) =>
        @cam.move [0, 0, getVoxelOffset(timeFactor)]
        @moved()
      "ctrl + space"   : (timeFactor) => @cam.move [0, 0, -getVoxelOffset(timeFactor)]

      #Zoom in/out
      "i"             : (timeFactor) => @cam.zoomIn()
      "o"             : (timeFactor) => @cam.zoomOut()

      #Change move value
      "h"             : (timeFactor) => @changeMoveValue(25)
      "g"             : (timeFactor) => @changeMoveValue(-25)

      #Rotate in distance
      "left"          : (timeFactor) => @cam.yaw @model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
      "right"         : (timeFactor) => @cam.yaw -@model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
      "up"            : (timeFactor) => @cam.pitch -@model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
      "down"          : (timeFactor) => @cam.pitch @model.user.get("rotateValue") * timeFactor, @mode == Constants.MODE_ARBITRARY
    )

    @input.keyboardNoLoop = new Input.KeyboardNoLoop(
      #Recenter active node
      "y" : => @centerActiveNode()
    )

    @input.keyboardOnce = new Input.Keyboard(

      #Delete active node and recenter last node
      "shift + space" : =>
        @model.skeletonTracing.deleteActiveNode()
        @centerActiveNode()

    , -1)


module.exports = MinimalSkeletonTracingArbitraryController
