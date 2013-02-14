### define
./asset_handler : AssetHandler
libs/gl-matrix : glMatrix
three : THREE
stats : Stats

###

class View

  constructor : (@canvas, @dataCam) ->

    @assetHandler = new AssetHandler()

    @uniforms =
      startTime : Date.now()
      time : 0
      screenWidth : 0
      screenHeight : 0
      shading_type : 3
      debug_mode : 0
      quality : 2

    $.when(@assetHandler).then (assetHandler) =>
      @assetHandler = assetHandler
      @initGeometry()

  initThreeJS : (@surfaces) ->

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
    $(window).resize( => @resize() )


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

    uniforms = @uniforms

    shaderUniforms =
      time :          { type: "f", value: uniforms.time },
      resolution :    { type: "v2", value: new THREE.Vector2(uniforms.screenWidth, uniforms.screenHeight) },
      camera_matrix : { type: "m4", value: new THREE.Matrix4() },
      shading_type :  { type: "i", value : uniforms.shading_type},
      debug_mode :    { type: "i", value : uniforms.debug_mode},

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


  updateUniforms : (uniforms) ->

    uniforms = @uniforms
    shaderMaterial = @shaderMaterial

    uniforms.time = Date.now() - uniforms.startTime
    cam_matrix = @dataCam.getMatrix()

    shaderMaterial.uniforms["time"].value = uniforms.time / 1000
    shaderMaterial.uniforms["resolution"].value = new THREE.Vector2(uniforms.screenWidth, uniforms.screenHeight)
    shaderMaterial.uniforms["camera_matrix"].value = new THREE.Matrix4(cam_matrix...).transpose()

    shaderMaterial.uniforms["debug_mode"].value = uniforms.debug_mode
    shaderMaterial.uniforms["shading_type"].value = uniforms.shading_type
    shaderMaterial.uniforms["surface_0.draw_surface"].value = @surfaces[0].draw_surface
    #@shaderMaterial.uniforms["surface_1.draw_surface"].value = @surfaces[1].draw_surface


  setUniform : (name, value) ->

    @uniforms[name] = value


  animate : ->

    @dataCam.update()
    @updateUniforms()
    @stats.update()

    @renderer.render( @scene, @camera, )
    window.requestAnimationFrame => @animate()


  resize : ->

    width = window.innerWidth / @uniforms.quality
    height = window.innerHeight / @uniforms.quality

    #needs both with/height and style width/height
    @canvas.width(width)
    @canvas.height(height)

    @canvas.css("width", window.innerWidth)
    @canvas.css("height", window.innerHeight)

    @uniforms.screenWidth = width
    @uniforms.screenHeight = height

    @renderer.setSize( width, height )
