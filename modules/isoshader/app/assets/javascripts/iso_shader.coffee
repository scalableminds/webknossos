### define
libs/request : Request
libs/input : Input
libs/gl-matrix : glMatrix
three : THREE
stats : Stats
./isoshader/asset_handler : AssetHandler
###

class Isoshader


  constructor : ->

    @assetHandler = new AssetHandler()
    @canvas = $("#webgl_canvas")


    @quality = 2
    @quality_levels = [ 0.5, 1, 2, 4, 8 ]
    texture_res = 128
    texture_loaded = false #shader only compiles after texture was loaded

    @parameters =
      startTime: Date.now()
      time: 0
      mouseX: 0.5
      mouseY: 0.5
      screenWidth: 0
      screenHeight: 0

    @cam =
      pos: glMatrix.vec3.fromValues(10, 10, 10)
      dir: glMatrix.quat.fromValues(0, 0, 0, 1)
      mouse_is_down: false
      mouse_prev_x: 0
      mouse_prev_y: 0
      keys:[]
      prev_update_time: Date.now()

    @cam_matrix = []
    @cam_matrix = glMatrix.mat4.fromRotationTranslation(@cam_matrix, @cam.dir, @cam.pos)

    @surfaces = [{},{}]
    surface_uniforms = ["texture","threshold","draw_surface","draw_map"]

    turn_speed = 0.003
    key_turn_speed = 0.2
    roll_speed = 0.1

    initial_motion_speed = 1.0
    motion_accel = 0.1
    motion_decel = 0.7

    forward_speed = 1.0 #now set internally to do acceleration etc
    strafe_speed = 1.0

    threshold_speed = 0.01
    max_dt = 0.2
    debug_mode = 0
    max_debug_mode = 2
    shading_type = 3

    @initSurfaces()
    @initKeyboard()
    @initMouse()
    @initGUI()
    @initThreeJS()

    $.when(@assetHandler).then (assetHandler) =>
      @assetHandler = assetHandler
      @initGeometry()


  initSurfaces : ->

    for i in [0 .. @surfaces.length - 1]
      surface = {}
      surface.threshold = 0.61
      surface.uniform_name = "surface_#{i}"
      surface.draw_surface = 0
      surface.draw_map = 0

      surface.draw_surface = 1 if not @surfaces[1].draw_surface_set

      @surfaces[i] = surface


  initThreeJS : ->

    width  = @canvas.width()
    height = @canvas.height()

    # Initialize main THREE.js components
    @renderer = new THREE.WebGLRenderer( canvas: @canvas[0], clearColor: 0xffffff, antialias: true, preserveDrawingBuffer: true  )
    @camera = new THREE.PerspectiveCamera(90, width / height, 0.1, 10000)
    @scene = new THREE.Scene()

    @scene.add(@camera)
    #@camera.lookAt(new THREE.Vector3( 0, 0, 0 ))

    @renderer.setSize(width, height)

    #FPS stats
    @stats = new Stats()
    statsDomElement = @stats.getDomElement()
    statsDomElement.id = "fps-stats"
    $("body").append(statsDomElement)

    @resize()

    # Dont forget to handle window resizing!
    $(window).resize( => @.resize() )


  initGeometry : ->

    geometry = new THREE.PlaneGeometry(1,1,1,1)
    material = @initShader()

    mesh = new THREE.Mesh(geometry, material)
    @scene.add(mesh)

    # start the rendering loop
    @animate()

  initShader : ->

    parameters = @parameters

    shaderUniforms =
      time :          { type: "f", value: parameters.time }
      resolution :    { type: "v2", value: new THREE.Vector2(parameters.screenWidth, parameters.screenHeight) }
      camera_matrix : { type: "m4", value: new THREE.Matrix4(@camera_matrix) }
      backbuffer :    { type: "backbuffer", value: new THREE.Texture() } #unused right now
      mouse :         { type: "mouse", value: new THREE.Vector2(parameters.mouseX, parameters.mouseY) } #unused

    for i in [0 .. @surfaces.length - 1]

      texture = new THREE.Texture( @assetHandler.getFile("texture")[i] )
      texture.needsUpdate = true

      shaderUniforms["surface_#{i}.texture"] =      { type: "t", value: 0, texture: texture }
      shaderUniforms["surface_#{i}.threshold"] =    { type: "f", value: @surfaces[i].threshold }
      shaderUniforms["surface_#{i}.draw_surface"] = { type: "i", value: @surfaces[i].draw_surface }
      shaderUniforms["surface_#{i}.draw_map"] =     { type: "i", value: @surfaces[i].draw_map }

    @shaderMaterial = new THREE.ShaderMaterial(
      uniforms : shaderUniforms
      vertexShader : @assetHandler.getFile("vertexShader")
      fragmentShader : @assetHandler.getFile("fragmentShader")
    )


  initKeyboard : ->

    input = new Input.KeyboardNoLoop(
      #enable or disable surface
      "m" : @surfaces[0].draw_surface = +!@surfaces[0].draw_surface
      "p" : @surfaces[1].draw_surface = +!@surfaces[1].draw_surface

      # thresholds
      "," : @surfaces[0].threshold
      "." : @surfaces[0].threshold
      "[" : @surfaces[1].threshold
      "]" : @surfaces[1].threshold

      "t" :  ->

      # TODO : camera keys wsad, arrow keys
    )


  initMouse : ->

      #parameters.mouseX = event.clientX / window.innerWidth;
      #parameters.mouseY = 1 - event.clientY / window.innerHeight;

      new Input.Mouse(
        @canvas
        "x" : (distX) => @parameters.mouseX = distX
        "y" : (distY) => @parameters.mouseY = distY

        #TODO: Camera mouse handling
      )


  initGUI : ->

    qualitySelection = $("quality")
    qualitySelection.selectedIndex = @quality
    qualitySelection.on( "change", (evt) =>
      @quality = evt.target.selectedIndex
    )

    shadingSelection = $("shading")
    shadingSelection.selectedIndex = @shading_type
    shadingSelection.on( "change", (evt) =>
      @shading_type = evt.target.selectedIndex
    )


  createRenderTargets : ->


  updateUniforms : ->

    parameters = @parameters
    shaderMaterial = @ShaderMaterial

    parameters.time = Date.now() - parameters.startTime
    @cam_matrix = glMatrix.mat4.fromRotationTranslation(@cam_matrix, @cam.dir, @cam.pos)

    @shaderMaterial.uniforms["time"] = parameters.time / 1000
    @shaderMaterial.uniforms["resolution"] = new THREE.Vector2(parameters.screenWidth, parameters.screenHeight)
    @shaderMaterial.uniforms["camera_matrix"] = new THREE.Matrix4(@camera_matrix) #array or single values???

    #both unused right now in shader
    #@shaderMaterial.uniforms["backbuffer"] = new THREE.Texture()
    #@shaderMaterial.uniforms["mouse"] = new THREE.Vector2(parameters.mouseX, parameters.mouseY)


  animate : ->

    @updateUniforms()

    @stats.update()
    @renderer.render @scene, @camera

    window.requestAnimationFrame => @animate()


  resize : ->

    width = window.innerWidth / @quality
    height = window.innerHeight / @quality

    #needs both with/height and style width/height
    @canvas.width(width)
    @canvas.height(height)

    @canvas.css("width", window.innerWidth)
    @canvas.css("height", window.innerHeight)

    @parameters.screenWidth = width
    @parameters.screenHeight = height

    @renderer.setSize( width, height )
    @camera.aspect = width / height
    @camera.updateProjectionMatrix()

