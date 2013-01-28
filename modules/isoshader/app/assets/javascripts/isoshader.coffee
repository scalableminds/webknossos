### define
libs/request : Request
libs/input : Input
libs/Three : THREE
libs/gl_matrix : Mat4
./isoshader/compressor : Compressor
###

class Isoshader


  constructor : ->

    initHelpers()
    compressor = new Compressor()

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

    cam =
      pos: vec3.createFrom(10,10,10)
      dir: quat4.createFrom(0,0,0,1)
      mouse_is_down: false
      mouse_prev_x: 0
      mouse_prev_y: 0
      keys:[]
      prev_update_time: Date.now()

    @surfaces = [{},{}]

    @data_0 = "rawBig.raw.png"
    @data_1 = "skel_strongerDT.png"

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

    @initKeyboard()
    @initMouse()
    @initGUI()

    $.when(
      request(url : "/assets/shader/vertexShader.vs"),
      request(url : "/assets/shader/example.fs")
    ).pipe (vertexShader, fragmentShader) =>
        @shader =
          vertexShader : vertexShader
          fragmentShader :  fragmentShader

        @initThreeJS()
        @initShader()
        @createRenderTargets()


  initSurfaces : ->

    for i in [0 .. @surfaces.length - 1]
      surfaces.threshold = 0.61
      surfaces.uniform_name = "surface_#{i}"
      surfaces.draw_surface = 0
      surfaces.draw_map = 0

      surfaces.texture = THREE.ImageUtils.loadTexture("assets/images/#{@data_#{i}}")
      surfaces.draw_surface = 1 if not surfaces[1].draw_surface_set
      surfaces.draw_map = 1


  initThreeJS : ->

    @canvas = $("#webgl_canvas")
    width  = @canvas.width()
    height = @canvas.height()

    # Initialize main THREE.js components
    @renderer = new THREE.WebGLRenderer( canvas: @canvas, clearColor: 0xffffff, antialias: true, preserveDrawingBuffer: true  )
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

    # start the rendering loop
    @resize()
    @animate()

    # Dont forget to handle window resizing!
    $(window).resize( => @.resize() )


  initShader : ->

    parameters = @parameters

    shaderUniforms =
      time :          { type: "f", value: parameters.time }
      resolution :    { type: "v2", value: new THREE.Vector2(parameters.screenWidth, parameters.screenHeight) }
      camera_matrix : { type: "m4", value: new THREE.Matrix4(camera_matrix) }
      backbuffer :    { type: "backbuffer", value: new THREE.Texture() } #unused right now
      mouse :         { type: "mouse", value: new THREE.Vector2(parameters.mouseX, mouseY) } #unused

    for i in [0 .. @surfaces.length - 1]
      shaderUniforms["surface_#{i}.texture"] = { type: "t", value: 0, texture: @surfaces[i].texture }
      shaderUniforms["surface_#{i}.threshold"] = { type: "f", value: @surfaces[i].threshold }
      shaderUniforms["surface_#{i}.draw_surface"] = { type: "i", value: @surfaces[i].draw_surface }
      shaderUniforms["surface_#{i}.draw_map"] = { type: "i", value: @surfaces[i].draw_map }

    @shaderMaterial = new THREE.ShaderMaterial(
      uniforms : shaderUniforms
      vertexShader : @shader.vertexShader
      fragmentShader : @shader.fragmentShader
    )


  initKeyboard : ->

    input = new Input.KeyBoardNoLoop(
      #enable or disable surface
      "m" : @surfaces[0].draw_surface = +!@surfaces[0].draw_surface
      "p" : @surfaces[1].draw_surface = +!@surfaces[1].draw_surface

      # thresholds
      "," : @surface[0].threshold
      "." : @surface[0].threshold
      "[" : @surface[1].threshold
      "]" : @surface[1].threshold

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
    cam_matrix = Mat4.fromRotationTranslation(cam.dir, cam.pos);

    shaderMaterial.uniforms["time"] = parameters.time / 1000
    shaderMaterial.uniforms["resolution"] = new THREE.Vector2(parameters.screenWidth, parameters.screenHeight)
    shaderMaterial.uniforms["camera_matrix"] = new THREE.Matrix4(camera_matrix) #array or single values???

    #both unused right now in shader
    #shaderMaterial.uniforms["backbuffer"] = new THREE.Texture()
    #shaderMaterial.uniforms["mouse"] = new THREE.Vector2(parameters.mouseX, mouseY)


  animate : ->

    @updateUniforms()

    @renderer.render @scene, @camera
    window.requestAnimationFrame => @animate()




  resize : ->

    width = window.innerWidth / @quality
    height = window.innerHeight / @quality

    #needs both with/height and style width/height
    canvas.width(width)
    canvas.height(height)

    canvas.css("width", window.innerWidth)
    canvas.css("height", window.innerHeight)

    parameters.screenWidth = width
    parameters.screenHeight = height

    @renderer.setSize( width, height )
    @camera.aspect = width / height
    @camera.updateProjectionMatrix()
    @draw()

