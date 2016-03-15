app        = require("app")
backbone   = require("backbone")
Dimensions = require("oxalis/model/dimensions")
constants  = require("oxalis/constants")

class SkeletonTracingController

  # See comment in Controller class on general controller architecture.
  #
  # Skeleton Tracing Controller:
  # Add Skeleton Tracing controls that are not specific to the view mode.
  # Also, this would be the place to define general Skeleton Tracing
  # functions that can be called by the specific view mode controller.


  constructor : (@model, @skeletonTracingView, @sceneController) ->

    _.extend(@, Backbone.Events)


  setParticleSize : (delta) =>

    particleSize = @model.user.get("particleSize") + delta
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize)
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize)

    @model.user.set("particleSize", (Number) particleSize)


  setRadius : (delta) ->

    @model.skeletonTracing.setActiveNodeRadius(
      @model.skeletonTracing.getActiveNodeRadius() * Math.pow(1.05 , delta)
    )


  toggleSkeletonVisibility : =>

    @sceneController.skeleton.toggleVisibility()
    # Show warning, if this is the first time to use
    # this function for this user
    if @model.user.get("firstVisToggle")
      @skeletonTracingView.showFirstVisToggle()
      @model.user.set("firstVisToggle", false)
      @model.user.push()


  setActiveNode : (nodeId, merge = false, centered = false) ->

    @model.skeletonTracing.setActiveNode nodeId, merge
    @model.skeletonTracing.centerActiveNode() if centered


  centerActiveNode : =>

    position = @model.skeletonTracing.getActiveNodePos()
    if position
      @model.flycam.setPosition(position)

module.exports = SkeletonTracingController



