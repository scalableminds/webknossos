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
      mouse_prev_x: 0
      mouse_prev_y: 0
      prev_update_time: Date.now()

    @surfaces = [{}]

    @debug_mode = 0
    @shading_type = 3

    @cam_matrix = []
    @cam_matrix = glMatrix.mat4.fromRotationTranslation(@cam_matrix, @cam.dir, @cam.pos)

    # camera movement parameters
    @forward_speed = 1.0
    @strafe_speed = 1.0
    @ROLL_SPEED = 0.1
    @TURN_SPEED = 0.02

    @movement = glMatrix.vec3.fromValues(0, 0, 0)
    @rotation = glMatrix.quat.fromValues(0, 0, 0, 1.0)

    threshold_speed = 0.01

    # let's get started
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
      camera_matrix : { type: "m4", value: new THREE.Matrix4(@cam_matrix...).transpose() },
      shading_type :  { type: "i", value : @shading_type},
      debug_mode :    { type: "i", value : @debug_mode},

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
      texture.flipY = false

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
    )

    new Input.Keyboard(

      "w" : => @movement[2] += @forward_speed * @dt; @accel = true
      "s" : => @movement[2] -= @forward_speed * @dt; @accel = true
      "d" : => @movement[0] += @strafe_speed * @dt;  @accel = true
      "a" : => @movement[0] -= @strafe_speed * @dt;  @accel = true

      "r" : => @movement[1] += @strafe_speed * @dt; @accel = true
      "f" : => @movement[1] -= @strafe_speed * @dt; @accel = true

      "up" :    => @rotation[0] =  @dt * @TURN_SPEED
      "down" :  => @rotation[0] =- @dt * @TURN_SPEED
      "right" : => @rotation[1] =  @dt * @TURN_SPEED
      "left" :  => @rotation[1] =- @dt * @TURN_SPEED
      "q" :     => @rotation[2] =  @dt * @ROLL_SPEED
      "e" :     => @rotation[2] =- @dt * @ROLL_SPEED


    )


  initMouse : ->

    $(window).on "mousemove",(event) =>
      @parameters.mouseX = event.clientX / window.innerWidth
      @parameters.mouseY = 1 - event.clientY / window.innerHeight

      # var x=event.clientX;
      # var y=event.clientY;
      # var dx=x-cam.mouse_prev_x;
      # var dy=y-cam.mouse_prev_y;
      # cam.mouse_prev_x=x;
      # cam.mouse_prev_y=y;
      # if(cam.mouse_is_down){
      #   quat4.multiply(cam.dir, quat4.createFrom(dy*turn_speed, dx*turn_speed,0,1.0));
      #   quat4.normalize(cam.dir);
      # }


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


  cameraStep : ->

    INTIAL_MOTION_SPEED = 1.0
    MOTION_ACCELERATE = 0.1
    MOTION_DECELERATE = 0.7
    MAX_DT = 0.2

    cam = @cam
    forward_speed = @forward_speed
    strafe_speed = @strafe_speed
    dt = @dt
    rotation = @rotation
    movement = @movement

    t = Date.now()
    @dt = t - cam.prev_update_time
    cam.prev_update_time = t
    if @dt > MAX_DT
      @dt = MAX_DT

    @dt = 1

    if @accel
      forward_speed += dt * forward_speed * MOTION_ACCELERATE
    else
      forward_speed -= dt * forward_speed * MOTION_DECELERATE
      if forward_speed < INTIAL_MOTION_SPEED
        forward_speed = INTIAL_MOTION_SPEED
    strafe_speed = forward_speed

    #let's do the heavy lifting
    glMatrix.quat.multiply(cam.dir, cam.dir, rotation)
    glMatrix.quat.normalize(cam.dir,cam.dir)

    #glMatrix.quat.multiplyVec3(cam.dir, cam.dir, movement)
    glMatrix.vec3.add(cam.pos, cam.pos ,movement)

    #reset things
    @accel = false
    @movement = glMatrix.vec3.fromValues(0, 0, 0)
    @rotation = glMatrix.quat.fromValues(0, 0, 0, 1.0)

  updateUniforms : ->

    parameters = @parameters
    shaderMaterial = @ShaderMaterial

    parameters.time = Date.now() - parameters.startTime
    @cam_matrix = glMatrix.mat4.fromRotationTranslation(@cam_matrix, @cam.dir, @cam.pos)

    @shaderMaterial.uniforms["time"].value = parameters.time / 1000
    @shaderMaterial.uniforms["resolution"].value = new THREE.Vector2(parameters.screenWidth, parameters.screenHeight)
    @shaderMaterial.uniforms["camera_matrix"].value = new THREE.Matrix4(@cam_matrix...).transpose()

    @shaderMaterial.uniforms["debug_mode"].value = @debug_mode
    @shaderMaterial.uniforms["shading_type"].value = @shading_type
    @shaderMaterial.uniforms["surface_0.draw_surface"].value = @surfaces[0].draw_surface
    #@shaderMaterial.uniforms["surface_1.draw_surface"].value = @surfaces[1].draw_surface


  animate : ->

    @cameraStep()
    @updateUniforms()
    @stats.update()

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


