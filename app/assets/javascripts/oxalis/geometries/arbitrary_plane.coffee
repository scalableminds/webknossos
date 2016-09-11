_                             = require("lodash")
backbone                      = require("backbone")
THREE                         = require("three")
{M4x4, V3}                    = require("libs/mjs")
constants                     = require("oxalis/constants")
ArbitraryPlaneMaterialFactory = require("./materials/arbitrary_plane_material_factory")

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

  cam : null
  model : null
  controller : null

  mesh : null

  isDirty : true

  queryVertices : null
  width : 0
  height : 0
  x : 0


  constructor : (@cam, @model, @controller, @width = 128) ->

    _.extend(@, Backbone.Events)

    @mesh = @createMesh()

    @listenTo(@cam, "changed", -> @isDirty = true)
    @listenTo(@model.flycam, "positionChanged", -> @isDirty = true)

    for name, binary of @model.binary
      binary.cube.on "bucketLoaded", => @isDirty = true

    throw "width needs to be a power of 2" unless Math.log(@width) / Math.LN2 % 1 != 1


  setMode : ( mode, radius ) ->

    @queryVertices = switch mode
      when constants.MODE_ARBITRARY       then @calculateSphereVertices()
      when constants.MODE_ARBITRARY_PLANE then @calculatePlaneVertices()

    @isDirty = true


  attachScene : (scene) ->

    scene.add(@mesh)


  update : ->

    if @isDirty

      { mesh, cam } = this

      matrix = cam.getZoomedMatrix()

      newVertices = M4x4.transformPointsAffine matrix, @queryVertices
      newColors = @model.getColorBinaries()[0].getByVerticesSync(newVertices)

      @textureMaterial.setData("color", newColors)

      m = cam.getZoomedMatrix()

      mesh.matrix.set m[0], m[4], m[8], m[12],
                      m[1], m[5], m[9], m[13],
                      m[2], m[6], m[10], m[14],
                      m[3], m[7], m[11], m[15]

      mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI))
      mesh.matrixWorldNeedsUpdate = true

      @isDirty = false


  calculateSphereVertices : ( sphericalCapRadius = @cam.distance ) ->

    queryVertices = new Float32Array(@width * @width * 3)

    # so we have Point [0, 0, 0] centered
    currentIndex = 0

    vertex        = [0, 0, 0]
    vector        = [0, 0, 0]
    centerVertex  = [0, 0, -sphericalCapRadius]

    # Transforming those normalVertices to become a spherical cap
    # which is better more smooth for querying.
    # http://en.wikipedia.org/wiki/Spherical_cap
    for y in [0...@width] by 1
      for x in [0...@width] by 1

        vertex[0] = x - (Math.floor @width/2)
        vertex[1] = y - (Math.floor @width/2)
        vertex[2] = 0

        vector = V3.sub(vertex, centerVertex, vector)
        length = V3.length(vector)
        vector = V3.scale(vector, sphericalCapRadius / length, vector)

        queryVertices[currentIndex++] = centerVertex[0] + vector[0]
        queryVertices[currentIndex++] = centerVertex[1] + vector[1]
        queryVertices[currentIndex++] = centerVertex[2] + vector[2]

    queryVertices


  calculatePlaneVertices : ->

    queryVertices = new Float32Array(@width * @width * 3)

    # so we have Point [0, 0, 0] centered
    currentIndex = 0

    for y in [0...@width] by 1
      for x in [0...@width] by 1

        queryVertices[currentIndex++] = x - (Math.floor @width/2)
        queryVertices[currentIndex++] = y - (Math.floor @width/2)
        queryVertices[currentIndex++] = 0

    queryVertices


  applyScale : (delta) ->

    @x = Number(@mesh.scale.x) + Number(delta)

    if @x > .5 and @x < 10
      @mesh.scale.x = @mesh.scale.y = @mesh.scale.z = @x
      @cam.update()


  createMesh : ->

    if @controller.isBranchpointvideoMode()

      options =
        polygonOffset : true
        polygonOffsetFactor : 10.0
        polygonOffsetUnits : 40.0

      factory = new ArbitraryPlaneMaterialFactory(@model, @width)
      factory.makeMaterial(options)
      @textureMaterial = factory.getMaterial()

    else

      @textureMaterial = new ArbitraryPlaneMaterialFactory(@model, @width).getMaterial()

    # create mesh
    plane = new THREE.Mesh(
      new THREE.PlaneGeometry(@width, @width, 1, 1)
      @textureMaterial
    )
    plane.rotation.x = Math.PI
    @x = 1

    plane.matrixAutoUpdate = false
    plane.doubleSided = true

    plane

module.exports = ArbitraryPlane
