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

    @surfaces = [{}]

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
    @debug_mode = 0
    max_debug_mode = 2
    @shading_type = 3

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
      surface.draw_surface = 1
      surface.draw_map = 1

      #surface.draw_surface = 1 if not @surfaces[1].draw_surface_set

      @surfaces[i] = surface

    #@surfaces[1].draw_surface = 0


  initThreeJS : ->

    width  = @canvas.width()
    height = @canvas.height()

    # Initialize main THREE.js components
    @renderer = new THREE.WebGLRenderer( canvas: @canvas[0], preserveDrawingBuffer: true )
    @renderer.autoClearStencil = 0

    @scene = new THREE.Scene()
    @camera = new THREE.Camera()
    @camera.position.z = 1
    @scene.add(@camera)

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

    geometry = new THREE.PlaneGeometry(2,2,1,1)
    material = @initShader()
    #material = new THREE.MeshBasicMaterial({color: 0xff3355})
    @scene.overrideMaterial = material

    isoMesh = new THREE.Mesh(geometry, material)
    isoMesh.doubleSided = true
    @scene.add(isoMesh)

    # start the rendering loop
    @animate()


  initShader : ->

    parameters = @parameters

    shaderUniforms =
      time :          { type: "f", value: parameters.time },
      resolution :    { type: "v2", value: new THREE.Vector2(parameters.screenWidth, parameters.screenHeight) },
      mouse :         { type: "v2", value: new THREE.Vector2(parameters.mouseX, parameters.mouseY) } #unused
      camera_matrix : { type: "m4", value: new THREE.Matrix4(@cam_matrix...) },
      shading_type :  { type: "i", value : @shading_type},
      debug_mode :    { type: "i", value : @debug_mode},
      backbuffer :    { type: "backbuffer", value: new THREE.Texture() }, #unused right now

    for i in [0 .. @surfaces.length - 1]

      texture = new THREE.Texture(
        @assetHandler.getFile("texture")[i],
        new THREE.UVMapping(),
        THREE.RepeatWrapping,
        THREE.RepeatWrapping,
        THREE.LinearFilter,
        THREE.LinearFilter,
        THREE.LuminanceFormat,
        THREE.UnsignedByteType
      )

      texture.needsUpdate = true

      shaderUniforms["surface_#{i}.texture"] =      { type: "t", value: texture }
      shaderUniforms["surface_#{i}.threshold"] =    { type: "f", value: @surfaces[i].threshold }
      shaderUniforms["surface_#{i}.draw_surface"] = { type: "i", value: @surfaces[i].draw_surface }
      shaderUniforms["surface_#{i}.draw_map"] =     { type: "i", value: @surfaces[i].draw_map }

    @shaderMaterial = new THREE.ShaderMaterial(
      uniforms : shaderUniforms
      vertexShader :   @assetHandler.getFile("vertexShader")
      fragmentShader : @assetHandler.getFile("isoShader")
      blending : THREE.NoBlending
      depthTest : false
      side : THREE.DoubleSide
    )


  initKeyboard : ->

    input = new Input.KeyboardNoLoop(
      #enable or disable surface
      "m" : => @surfaces[0].draw_surface = +!@surfaces[0].draw_surface
      "p" : => @surfaces[1].draw_surface = +!@surfaces[1].draw_surface

      "d" : => @debug_mode = +!@debug_mode

      # thresholds
      "," : => @surfaces[0].threshold
      "." : => @surfaces[0].threshold
      "[" : => @surfaces[1].threshold
      "]" : => @surfaces[1].threshold

      "t" :  ->

      # TODO : camera keys wsad, arrow keys
    )


  initMouse : ->

    $(window).on "mousemove",(event) =>
      @parameters.mouseX = event.clientX / window.innerWidth
      @parameters.mouseY = 1 - event.clientY / window.innerHeight


    # new Input.Mouse(
    #   @canvas
    #   "x" : (distX) => @parameters.mouseX = distX
    #   "y" : (distY) => @parameters.mouseY = distY

    #   #TODO: Camera mouse handling
    # )


  initGUI : ->

    qualitySelection = $("#quality")
    qualitySelection.selectedIndex = @quality
    qualitySelection.on( "change", (evt) =>
      @quality = evt.target.selectedIndex
      @resize()
    )

    shadingSelection = $("#shading")
    shadingSelection.selectedIndex = @shading_type
    shadingSelection.on( "change", (evt) =>
      @shading_type = evt.target.selectedIndex
    )


  createRenderTarget : ->

    @renderTarget = new THREE.WebGLRenderTarget(
      @parameters.screenWidth,
      @parameters.screenHeight,
      options =
        wrapS : THREE.ClampToEdgeWrapping
        wrapT : THREE.ClampToEdgeWrapping
        magFilter : THREE.NearestFilter
        minFilter : THREE.NearestFilter
        depthBuffer : true
        stencilBuffer : false
      )

    return new THREE.MeshBasicMaterial(
      map: @renderTarget
      blending : THREE.NoBlending
      side : THREE.DoubleSide
      )
    # return new THREE.ShaderMaterial(
    #   uniforms: {
    #     texture: { type: "t", value: 0, texture: @renderTarget }
    #   }
    #   vertex_shader: @assetHandler.getFile("vertexShader")
    #   fragment_shader:@assetHandler.getFile("basicFragShader")
    #   blending : THREE.NoBlending
    # )

  updateUniforms : ->

    parameters = @parameters
    shaderMaterial = @ShaderMaterial

    parameters.time = Date.now() - parameters.startTime
    @cam_matrix = glMatrix.mat4.fromRotationTranslation(@cam_matrix, @cam.dir, @cam.pos)

    @shaderMaterial.uniforms["time"].value = parameters.time / 1000
    @shaderMaterial.uniforms["resolution"].value = new THREE.Vector2(parameters.screenWidth, parameters.screenHeight)
    @shaderMaterial.uniforms["mouse"].value = new THREE.Vector2(parameters.mouseX, parameters.mouseY)
    @shaderMaterial.uniforms["camera_matrix"].value = new THREE.Matrix4(@cam_matrix...)

    @shaderMaterial.uniforms["debug_mode"].value = @debug_mode
    @shaderMaterial.uniforms["shading_type"].value = @shading_type
    @shaderMaterial.uniforms["surface_0.draw_surface"].value = @surfaces[0].draw_surface
    #@shaderMaterial.uniforms["surface_1.draw_surface"].value = @surfaces[1].draw_surface

    #both unused right now in shader
    #@shaderMaterial.uniforms["backbuffer"] = new THREE.Texture()
    #@shaderMaterial.uniforms["mouse"] = new THREE.Vector2(parameters.mouseX, parameters.mouseY)


  animate : ->

    @updateUniforms()
    @stats.update()

    #render to screen
    @renderer.render( @scene, @camera, )


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


