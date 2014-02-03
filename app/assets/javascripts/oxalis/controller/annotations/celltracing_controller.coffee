### define
../../model/dimensions : Dimensions
../../constants : constants
../abstract_tree_controller : AbstractTreeController
###

class CellTacingController

  # See comment in Controller class on general controller architecture.
  #
  # Cell Tracing Controller:
  # Add Skeleton Tracing controls that are not specific to the view mode.
  # Also, this would be the place to define general Skeleton Tracing
  # functions that can be called by the specific view mode controller.


  constructor : ( @model, @sceneController, @gui, @skeletonTracingView ) ->

    @abstractTreeController = new AbstractTreeController(@model)
    @abstractTreeController.view.on 
      nodeClick : (id) => @model.cellTracing.setActiveNode(id, false, true)

    @gui.on
      deleteActiveNode : =>
        @model.cellTracing.deleteActiveNode()
      setActiveTree : (id) => @model.cellTracing.setActiveTree(id)
      setActiveNode : (id) => @model.cellTracing.setActiveNode(id)

    @model.cellTracing.on
      newActiveNode : (centered) =>
        @centerActiveNode if centered

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
      @model.cellTracing.setActiveNode($(event.target).data("nodeid"), false, true)

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

    @sceneController.skeleton.toggleVisibility()
    # Show warning, if this is the first time to use
    # this function for this user
    if @model.user.firstVisToggle
      @skeletonTracingView.showFirstVisToggle()
      @model.user.firstVisToggle = false
      @model.user.push()


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


  # Comments

  prevComment : =>

    @model.cellTracing.setActiveNode(
      @model.cellTracing.nextCommentNodeID(false), false, true)


  nextComment : =>

    @model.cellTracing.setActiveNode(
      @model.cellTracing.nextCommentNodeID(true), false, true)

    
