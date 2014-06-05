### define
app : app
backbone : backbone
oxalis/model/dimensions : Dimensions
oxalis/constants : constants
###

class SkeletonTacingController

  # See comment in Controller class on general controller architecture.
  #
  # Skeleton Tracing Controller:
  # Add Skeleton Tracing controls that are not specific to the view mode.
  # Also, this would be the place to define general Skeleton Tracing
  # functions that can be called by the specific view mode controller.


  constructor : ( @model, @sceneController, @gui, @skeletonTracingView ) ->

    _.extend(@, Backbone.Events)
    @listenTo(@model.skeletonTracing, "newActiveNode", (nodeId) -> @setActiveNode(nodeId, false, true))

    # TODO add to tracing model
    # @gui.on
    #   deleteActiveNode : =>
    #     @model.skeletonTracing.deleteActiveNode()
    #   setActiveTree : (id) => @model.skeletonTracing.setActiveTree(id)
    #   setActiveNode : (id) => @model.skeletonTracing.setActiveNode(id)


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


  deleteActiveNode : =>

    @model.skeletonTracing.deleteActiveNode()


  setActiveTree : (treeId, centered) ->

    @model.skeletonTracing.setActiveTree(treeId)
    if centered
      @model.skeletonTracing.centerActiveNode()



