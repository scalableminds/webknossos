### define
libs/datgui/dat.gui : DatGui
###

PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
VIEW_3D  = 3

class Gui 
  
  constructor : (container, data, model, sceneController, cameraController, flycam) ->

    @model = model
    @sceneController = sceneController
    @cameraController = cameraController
    @flycam = flycam

    # create GUI
    @settings = { 
                position : "300, 302, 482"
                lockZoom: data.lockZoom
                inverseX: data.mouseInversionX == 1
                inverseY: data.mouseInversionY == 1
                routeClippingDistance: data.routeClippingDistance
                displayCrosshairs: data.displayCrosshair
                displayPrevXY : data.displayPreviewXY
                displayPrevYZ : data.displayPreviewYZ
                displayPrevXZ : data.displayPreviewXZ
              }
    @gui  = new dat.GUI({autoPlace: false})
    
    container.append @gui.domElement
    
    #c = gui.add text, "speed", 1, 100
    #c.onChange (value) -> Controller.setRouteClippingDistance value
    
    #$(gui.domElement).css
    #  position : 'absolute'
    #  left : '220px'
    #  top : '260px'
    #  height : '500px'
    
    fPosition = @gui.addFolder("Position")
    posController = (fPosition.add @settings, "position").name("Position")
    posController.listen()
    posController.onFinishChange(@setPosFromString)
    fControls = @gui.addFolder("Controls")
    (fControls.add @settings, "lockZoom")
                          .name("Lock Zoom")
                          .onChange(@setLockZoom)
    (fControls.add @settings, "inverseX")
                          .name("Inverse X")
                          .onChange(@setMouseInversionX)
    (fControls.add @settings, "inverseY")
                          .name("Inverse Y")
                          .onChange(@setMouseInversionY)

    fView = @gui.addFolder("View")
    (fView.add @settings, "routeClippingDistance", 1, 100)
                          .name("Clipping Distance")    
                          .onChange(@setRouteClippingDistance)
    (fView.add @settings, "displayCrosshairs")
                          .name("Show Crosshairs")
                          .onChange(@setDisplayCrosshair)
    (fView.add @settings, "displayPrevXY")
                          .name("Display XY-Plane")
                          .onChange(@setDisplayPreviewXY)
    (fView.add @settings, "displayPrevYZ")
                          .name("Display YZ-Plane")
                          .onChange(@setDisplayPreviewYZ)
    (fView.add @settings, "displayPrevXZ")
                          .name("Display XZ-Plane")
                          .onChange(@setDisplayPreviewXZ)

    fPosition.open()
    fControls.open()
    fView.open()

  setPosFromString : (posString) =>
    stringArray = posString.split(",")
    pos = [parseInt(stringArray[0]), parseInt(stringArray[1]), parseInt(stringArray[2])]
    @flycam.setGlobalPos(pos)

  updateGlobalPosition : =>
    pos = @flycam.getGlobalPos()
    @settings.position = pos[0] + ", " + pos[1] + ", " + pos[2]

  setRouteClippingDistance : (value) =>
    @model.User.Configuration.routeClippingDistance = (Number) value
    @cameraController.setRouteClippingDistance((Number) value)
    @model.User.Configuration.push()   

  setLockZoom : (value) =>
    @model.User.Configuration.lockZoom = value
    @model.User.Configuration.push()      

  setDisplayCrosshair : (value) =>
    @model.User.Configuration.displayCrosshair = value
    @sceneController.setDisplayCrosshair(value)
    @model.User.Configuration.push()    

  setDisplayPreviewXY : (value) =>
    @model.User.Configuration.displayPreviewXY = value
    @sceneController.setDisplaySV PLANE_XY, value
    @model.User.Configuration.push()      

  setDisplayPreviewYZ : (value) =>
    @model.User.Configuration.displayPreviewYZ = value
    @sceneController.setDisplaySV PLANE_YZ, value
    @model.User.Configuration.push()      

  setDisplayPreviewXZ : (value) =>
    @model.User.Configuration.displayPreviewXZ = value
    @sceneController.setDisplaySV PLANE_XZ, value
    @model.User.Configuration.push()      

  setMouseInversionX : (value) =>
    if value is true
      @model.User.Configuration.mouseInversionX = 1
    else
      @model.User.Configuration.mouseInversionX = -1
    @model.User.Configuration.push()         

  setMouseInversionY : (value) =>
    if value is true
      @model.User.Configuration.mouseInversionY = 1
    else
      @model.User.Configuration.mouseInversionY = -1
    @model.User.Configuration.push()  