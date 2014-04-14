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
    @listenTo(app.vent, "activeNode:change", (nodeId) -> setActiveNode : (nodeId, false, true))

    # TODO add to tracing model
    # @gui.on
    #   deleteActiveNode : =>
    #     @model.skeletonTracing.deleteActiveNode()
    #   setActiveTree : (id) => @model.skeletonTracing.setActiveTree(id)
    #   setActiveNode : (id) => @model.skeletonTracing.setActiveNode(id)

    # Manage side bar input
    $("#tree-name-submit").click (event) =>
      @model.skeletonTracing.setTreeName($("#tree-name-input").val())

    $("#tree-name-input").keypress (event) =>
      if event.which == 13
        $("#tree-name-submit").click()
        $("#tree-name-input").blur()

    $("#tree-prev-button").click (event) =>
      @selectNextTree(false)

    $("#tree-next-button").click (event) =>
      @selectNextTree(true)

    $("#tree-create-button").click =>
      @model.skeletonTracing.createNewTree()

    $("#tree-delete-button").click =>
      @model.skeletonTracing.deleteTree(true)

    $("#tree-list").on "click", "a[data-treeid]", (event) =>
      event.preventDefault()
      @setActiveTree($(event.currentTarget).data("treeid"), true)

    $("#tree-color-shuffle").click =>
      @model.skeletonTracing.shuffleTreeColor()

    $("#tree-color-shuffle-all").click =>
      @model.skeletonTracing.shuffleAllTreeColors()

    $("#tree-sort").on "click", "a[data-sort]", (event) =>
      event.preventDefault()
      @model.user.set("sortTreesByName", ($(event.currentTarget).data("sort") == "name"))


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


  centerActiveNode : =>

    position = @model.skeletonTracing.getActiveNodePos()
    if position
      @model.flycam.setPosition(position)


  setActiveNode : (nodeId, merge = false, centered = false) ->

    @model.skeletonTracing.setActiveNode nodeId, merge
    @centerActiveNode() if centered


  deleteActiveNode : =>

    @model.skeletonTracing.deleteActiveNode()


  setActiveTree : (treeId, centered) ->

    @model.skeletonTracing.setActiveTree(treeId)
    if centered
      @centerActiveNode()


  selectNextTree : (next) ->

    @model.skeletonTracing.selectNextTree(next)
    @centerActiveNode()
