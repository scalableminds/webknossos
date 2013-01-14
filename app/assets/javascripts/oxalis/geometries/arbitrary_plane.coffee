### define
three : THREE
m4x4 : M4x4
v3 : V3
underscore : _
###

# Let's set up our trianglesplane.
# It serves as a "canvas" where the brain images
# are drawn.
# Don't let the name fool you, this is just an
# ordinary plane with a texture applied to it.
#
# User tests showed that looking a bend surface (a half sphere)
# feels more natural when moving around in 3D space.
# To acknowledge this fact we determine the pixels that will
# be displayed by requesting them as though they were
# attached to bend surface.
# The result is then projected on a flat surface.
# For me detail look in Model.
#
# queryVertices: holds the position/matrices
# needed to for the bend surface.
# normalVertices: (depricated) holds the vertex postion
# for the flat surface
class ArbitraryPlane

  sphericalCapRadius : 0
  cam : null

  mesh : null

  isDirty : false

  queryVertices : null
  width : 0
  height : 0


  constructor : (@cam, @binary, @width = 128, @height = 128) ->

    @sphericalCapRadius = @cam.distance
    @queryVertices = @calculateQueryVertices()
    @mesh = @createMesh()

    @cam.on "changed", => @isDirty = true
    #@binary.on "bucketLoaded", => @isDirty = true

    throw "width needs to be a power of 2" unless Math.log(width) / Math.LN2 % 1 != 1
    throw "height needs to be a power of 2" unless Math.log(height) / Math.LN2 % 1 != 1


  attachScene : (scene) ->

    scene.add(@mesh)


  update : ->

    if @isDirty

      { mesh, cam } = this
      texture = mesh.material.uniforms["brainData"].texture

      m = @cam.getMatrix()

      newVertices = M4x4.transformPointsAffine m, @queryVertices

      # ATTENTION
      # when playing around with texture please look at setTexture() (line 5752 in WebGLRenderer)
      # the data attribute is only available for DataTexture (in other cases it is only texture.image)
      texture.image.data.set(@binary.getByVerticesSync(newVertices))

      # Update the texture data and make sure the new texture
      # is used by the Mesh's material.
      texture.needsUpdate = true

      #mesh.matrix.set m[0], m[4], m[8], m[12],
      #                m[1], m[5], m[9], m[13],
      #                m[2], m[6], m[10], m[14],
      #                m[3], m[7], m[11], m[15]

      #mesh.matrixWorldNeedsUpdate = true
      #mesh.matrix.rotateX -90 / 180 * Math.PI
      #mesh.matrix.rotateX(0.7)    
      #mesh.matrix.rotateY(Math.PI)  
      #mesh.matrix.translate(new THREE.Vector3(0,20,0))
      @isDirty = false



  calculateQueryVertices : ->

    { width, height, sphericalCapRadius } = this

    queryVertices = new Float32Array(width * height * 3)

    # so we have Point [0, 0, 0] centered
    currentIndex = 0

    vertex        = [0, 0, 0]
    vector        = [0, 0, 0]
    centerVertex  = [0, 0, -sphericalCapRadius]

    # Transforming those normalVertices to become a spherical cap
    # which is better more smooth for querying.
    # http://en.wikipedia.org/wiki/Spherical_cap
    for y in [0...height] by 1
      for x in [0...width] by 1

        vertex[0] = x - (Math.floor width/2)
        vertex[1] = y - (Math.floor height/2)
        vertex[2] = 0

        vector = V3.sub(vertex, centerVertex, vector)
        length = V3.length(vector)
        vector = V3.scale(vector, sphericalCapRadius / length, vector)

        queryVertices[currentIndex++] = centerVertex[0] + vector[0]
        queryVertices[currentIndex++] = centerVertex[1] + vector[1]
        queryVertices[currentIndex++] = centerVertex[2] + vector[2]

    queryVertices


  applyScale : (delta) ->

    x = Number(@mesh.scale.x) + Number(delta)

    if x > .5 and x < 10
      # why z? keep in mind the plane is rotated 90°
      @mesh.scale.x = @mesh.scale.z = x
      @cam.update()


  createMesh : ->

    { height, width } = this
    plane = new THREE.PlaneGeometry(width, height, 1, 1)
    #plane.transparent = true
    # arguments: data, width, height, format, type, mapping, wrapS, wrapT, magFilter, minFilter
    texture = new THREE.DataTexture(
      new Uint8Array(width * height),
      width,
      height,
      THREE.LuminanceFormat,
      THREE.UnsignedByteType,
      new THREE.UVMapping(),
      THREE.ClampToEdgeWrapping,
      THREE.ClampToEdgeWrapping,
      THREE.LinearMipmapLinearFilter,
      THREE.LinearMipmapLinearFilter
    )

    texture.needsUpdate = true

    colorCorrectionMap = THREE.ImageUtils.loadTexture("assets/textures/color_correction_map9d.png")

    shaderUniforms =
      brainData : { type: "t", value: 0, texture: texture },
      colorMap : { type: "t", value: 1, texture: colorCorrectionMap }
      color :    { type: "c", value: new THREE.Color( 0x30D158 ) }

    #textureMaterial = new THREE.MeshBasicMaterial( wireframe: false, map: texture )

    # shader idea from Nvidia:
    # http://http.developer.nvidia.com/GPUGems/gpugems_ch22.html

    vertexShader =
      """
      varying vec2 vUv;

      void main() {

        vUv = vec2( uv.x, uv.y );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

      }"""

    fragmentShader =
    """
      uniform sampler2D brainData;
      uniform sampler2D colorMap;

      varying vec2 vUv;

      const float MIN_ALPHA = 0.1;

      void main() {

        vec4 inputColor = texture2D( brainData, vUv );

        vec3 outColor;
        outColor.r = texture2D( colorMap, vec2( inputColor.r, 1.0 ) ).r;
        outColor.g = texture2D( colorMap, vec2( inputColor.g, 1.0 ) ).g;
        outColor.b = texture2D( colorMap, vec2( inputColor.b, 1.0 ) ).b;

        gl_FragColor = vec4( outColor.rgb, 1.0);
      }
      """

    shaderMaterial = new THREE.ShaderMaterial(
      uniforms : shaderUniforms
      vertexShader : vertexShader
      fragmentShader : fragmentShader
    )
    #shaderMaterial.transparent = true
    mesh = new THREE.Mesh( plane, shaderMaterial )
    mesh.rotation.x = -90 / 180 * Math.PI
    mesh.scale.x = mesh.scale.z = 2
    #mesh.matrixAutoUpdate = false

    mesh

