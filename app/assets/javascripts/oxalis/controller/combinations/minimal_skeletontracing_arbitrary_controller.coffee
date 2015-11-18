### define
../viewmodes/arbitrary_controller : ArbitraryController
libs/input : Input
../../constants : constants
###

class MinimalSkeletonTracingArbitraryController extends ArbitraryController

  # See comment in Controller class on general controller architecture.
  #
  # Minimal Skeleton Tracing Arbitrary Controller:
  # Extends Arbitrary controller to add controls that are specific to minimal Arbitrary mode.

  constructor : (args...) ->

    super args...

    @setRecord(true)


  initKeyboard : ->

    getVoxelOffset  = (timeFactor) =>

      return @model.user.get("moveValue3d") * timeFactor / @model.scaleInfo.baseVoxel / constants.FPS

    @input.keyboard = new Input.Keyboard(

      "space"         : (timeFactor) =>
        @cam.move [0, 0, getVoxelOffset(timeFactor)]
        @moved()

      #Recenter active node
      "y" : => @centerActiveNode()

      #Zoom in/out
      "i"             : (timeFactor) => @cam.zoomIn()
      "o"             : (timeFactor) => @cam.zoomOut()

      #Change move value
      "h"             : (timeFactor) => @changeMoveValue(25)
      "g"             : (timeFactor) => @changeMoveValue(-25)
    )

    @input.keyboardOnce = new Input.Keyboard(

      #Delete active node and recenter last node
      "shift + space" : =>
        @model.skeletonTracing.deleteActiveNode()
        @centerActiveNode()

    , -1)
