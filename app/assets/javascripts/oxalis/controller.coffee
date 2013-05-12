### define
jquery : $
underscore : _
./controller/plane_controller : PlaneController
./controller/arbitrary_controller : ArbitraryController
./controller/abstract_tree_controller : AbstractTreeController
./model : Model
./view : View
../libs/event_mixin : EventMixin
../libs/input : Input
./view/gui : Gui
../libs/toast : Toast
./constants : constants
###

class Controller

  view : null
  planeController : null
  arbitraryController : null
  abstractTreeController : null
  allowedModes : []
  

  constructor : ->

    _.extend(@, new EventMixin())

    @fullScreen = false
    @mode = constants.MODE_OXALIS

    @model = new Model()

    @model.initialize(constants.TEXTURE_SIZE_P, constants.VIEWPORT_WIDTH, constants.DISTANCE_3D).done (settings) =>

      # Do not continue, when there was an error and we got no settings from the server
      unless settings
        return

      for allowedMode in settings.allowedModes
        @allowedModes.push switch allowedMode
          when "oxalis" then constants.ALLOWED_OXALIS
          when "arbitrary" then constants.ALLOWED_ARBITRARY

      # FPS stats
      stats = new Stats()
      stats.getDomElement().id = "stats"
      $("body").append stats.getDomElement() 

      @view = new View(@model)

      @gui = @createGui(settings)

      @planeController = new PlaneController(@model, stats, @gui, @view.renderer, @view.scene)

      @arbitraryController = new ArbitraryController(@model, stats, @gui, @view.renderer, @view.scene)

      @abstractTreeController = new AbstractTreeController(@model)

      @initMouse()
      @initKeyboard()

      @propagateMode(constants.MODE_OXALIS)

      if constants.ALLOWED_OXALIS not in @allowedModes
        if constants.ALLOWED_ARBITRARY in @allowedModes
          @toggleArbitraryView()
        else
          Toast.error("There was no valid allowed tracing mode specified.")

      @abstractTreeController.view.on 
        nodeClick : (id) => @setActiveNode(id, true, false)

      $("#comment-input").on "change", (event) => 
        @setComment(event.target.value)
        $("#comment-input").blur()

      $("#comment-previous").click =>
        @prevComment()

      $("#comment-next").click =>
        @nextComment()

      $("#tab-comments").on "click", "a[data-nodeid]", (event) =>
        event.preventDefault()
        @setActiveNode($(event.target).data("nodeid"), true, false)

      $("#tree-name-submit").click (event) =>
        @setTreeName($("#tree-name-input").val())

      $("#tree-name-input").keypress (event) =>
        if event.which == 13
          $("#tree-name-submit").click()
          $("#tree-name-input").blur()

      $("#tree-prev-button").click (event) =>
        @selectNextTree(false)

      $("#tree-next-button").click (event) =>
        @selectNextTree(true)

      $("#tree-create-button").click =>
        @createNewTree()

      $("#tree-delete-button").click =>
        @deleteActiveTree()

      $("#tree-list").on "click", "a[data-treeid]", (event) =>
        event.preventDefault()
        @setActiveTree($(event.currentTarget).data("treeid"), true)

      $("#tree-color-shuffle").click =>
        @model.route.shuffleActiveTreeColor()



  initMouse : ->

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return


  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    new Input.KeyboardNoLoop(

      #View
      "t" : => 
        @view.toggleTheme()       
        @abstractTreeController.drawTree()

      "q" : => @toggleFullScreen()

      "1" : => @planeController.toggleSkeletonVisibility()

      "2" : => @planeController.toggleInactiveTreeVisibility()

      #Delete active node
      "delete" : => @deleteActiveNode()

      "c" : => @createNewTree()


      #Activate ArbitraryView
      "m" : => @toggleArbitraryView()
    )


  toggleArbitraryView : ->

    if @mode is constants.MODE_OXALIS and constants.ALLOWED_ARBITRARY in @allowedModes
      @planeController.stop()
      @arbitraryController.start()
      @propagateMode(constants.MODE_ARBITRARY)
    else if @mode is constants.MODE_ARBITRARY and constants.ALLOWED_OXALIS in @allowedModes
      @arbitraryController.stop()
      @planeController.start()
      @propagateMode(constants.MODE_OXALIS)


  propagateMode : (mode) ->

    @mode = mode
    @gui.setMode(mode)
    @view.setMode(mode)


  toggleFullScreen : ->

    if @fullScreen
      cancelFullscreen = document.webkitCancelFullScreen or document.mozCancelFullScreen or document.cancelFullScreen
      @fullScreen = false
      if cancelFullscreen
        cancelFullscreen.call(document)
    else
      body = $("body")[0]
      requestFullscreen = body.webkitRequestFullScreen or body.mozRequestFullScreen or body.requestFullScreen
      @fullScreen = true
      if requestFullscreen
        requestFullscreen.call(body, body.ALLOW_KEYBOARD_INPUT)


  createGui : (settings)->

    { model } = @

    gui = new Gui($("#optionswindow"), model, settings)
    gui.update()  

    model.binary.queue.set4Bit(model.user.fourBit)
    model.binary.updateLookupTable(gui.settings.brightness, gui.settings.contrast)

    gui.on
      deleteActiveNode : @deleteActiveNode
      setActiveTree : (id) => @setActiveTree(id, false)
      setActiveNode : (id) => @setActiveNode(id, false) # not centered

    gui


  deleteActiveNode : ->

    @model.route.deleteActiveNode()


  createNewTree : ->

    @model.route.createNewTree()


  setActiveTree : (treeId, centered) ->

    @model.route.setActiveTree(treeId)
    if centered
      @centerActiveNode()


  selectNextTree : (next) ->

    @model.route.selectNextTree(next)
    @centerActiveNode()


  setActiveNode : (nodeId, centered, mergeTree) ->

    @model.route.setActiveNode(nodeId, mergeTree)
    if centered
      @centerActiveNode()


  centerActiveNode : ->

    if @mode is constants.MODE_OXALIS
      @planeController.centerActiveNode()
    else
      @arbitraryController.centerActiveNode()


  deleteActiveTree : ->

    @model.route.deleteTree(true)


  setTreeName : (name) ->

    @model.route.setTreeName(name)


  setComment : (value) =>

    @model.route.setComment(value)


  prevComment : =>

    @setActiveNode(@model.route.nextCommentNodeID(false), true)


  nextComment : =>

    @setActiveNode(@model.route.nextCommentNodeID(true), true)
