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
###

VIEWPORT_WIDTH   = 380
TEXTURE_SIZE_P   = 9
DISTANCE_3D      = 140

ALLOWED_OXALIS    = MODE_OXALIS    = 0
ALLOWED_ARBITRARY = MODE_ARBITRARY = 1


class Controller

  mode : null
  view : null
  planeController : null
  arbitraryController : null
  abstractTreeController : null
  allowedModes : []
  mode : MODE_OXALIS
  

  constructor : ->

    _.extend(@, new EventMixin())

    @fullScreen = false
    @mode = MODE_OXALIS

    @model = new Model()

    @model.initialize(TEXTURE_SIZE_P, VIEWPORT_WIDTH, DISTANCE_3D).done (settings) =>

      for allowedMode in settings.allowedModes
        @allowedModes.push switch allowedMode
          when "oxalis" then ALLOWED_OXALIS
          when "arbitrary" then ALLOWED_ARBITRARY

      # FPS stats
      stats = new Stats()
      stats.getDomElement().id = "stats"
      $("body").append stats.getDomElement() 

      @view = new View(@model)

      @gui = @createGui()

      @planeController = new PlaneController(@model, stats, @gui)

      @arbitraryController = new ArbitraryController(@model, stats)

      @abstractTreeController = new AbstractTreeController(@model)      

      @initMouse()
      @initKeyboard()

      if ALLOWED_OXALIS not in @allowedModes
        if ALLOWED_ARBITRARY in @allowedModes
          @toggleArbitraryView()
        else
          Toast.error("There was no valid allowed tracing mode specified.")


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

      #Delete active node
      "delete" : => @deleteActiveNode()

      "c" : => @createNewTree()


      #Activate ArbitraryView
      "m" : => @toggleArbitraryView()
    )


  toggleArbitraryView : ->

    if @mode is MODE_OXALIS and ALLOWED_ARBITRARY in @allowedModes
      @planeController.stop()
      @arbitraryController.start()
      @mode = MODE_ARBITRARY
    else if @mode is MODE_ARBITRARY and ALLOWED_OXALIS in @allowedModes
      @arbitraryController.stop()
      @planeController.start()
      @mode = MODE_OXALIS


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


  createGui : ->

    { model } = @

    gui = new Gui($("#optionswindow"), model)
    gui.update()  

    model.binary.queue.set4Bit(model.user.fourBit)
    model.binary.updateLookupTable(gui.settings.brightness, gui.settings.contrast)

    gui.on
      deleteActiveNode : @deleteActiveNode
      createNewTree : @createNewTree
      setActiveTree : (id) => @setActiveTree(id)
      setActiveNode : (id) => @setActiveNode(id, false) # not centered
      deleteActiveTree : @deleteActiveTree

    gui


  deleteActiveNode : ->

    @model.route.deleteActiveNode()    


  createNewTree : ->

    @model.route.createNewTree()


  setActiveTree : (treeId) ->

    @model.route.setActiveTree(treeId)


  setActiveNode : (nodeId, centered, mergeTree) ->

    @model.route.setActiveNode(nodeId, mergeTree)
    if centered
      @centerActiveNode()


  centerActiveNode : ->

    position = @model.route.getActiveNodePos()
    if position
      @model.flycam.setPosition(position)


  deleteActiveTree : ->

    @model.route.deleteTree(true)