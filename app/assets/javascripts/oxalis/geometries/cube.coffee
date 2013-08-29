### define
../constants : constants
../model/dimensions : dimensions
###

class Cube

  constructor : (@model, properties) ->

    @min               = properties.min               || [0, 0, 0]
    @max               = properties.max
    lineWidth          = properties.lineWidth         || 1
    color              = properties.color             || 0x000000
    @showCrossSections = properties.showCrossSections || false
    
    @initialized = false
    @visible     = true

    @model.flycam.on({
      positionChanged : (pos) => @updatePosition(pos) })

    lineProperties = {color: color, linewidth: lineWidth}

    @cube = new THREE.Line(
      new THREE.Geometry(),
      new THREE.LineBasicMaterial( lineProperties ))

    @crossSections = []
    for i in constants.ALL_PLANES
      @crossSections.push(
        new THREE.Line(
          new THREE.Geometry(),
          new THREE.LineBasicMaterial( lineProperties )))


    if @min? and @max?
      @setCorners(@min, @max)

  setCorners : (@min, @max) ->

    vec = (x, y, z) ->
      new THREE.Vector3(x, y, z)

    v = (@cube.geometry.vertices = [])
    v.push( vec( min[0], min[1], min[2] ));      v.push( vec( min[0], max[1], min[2] ))
    v.push( vec( max[0], max[1], min[2] ));      v.push( vec( max[0], min[1], min[2] ))
    v.push( vec( max[0], min[1], max[2] ));      v.push( vec( max[0], max[1], max[2] ))
    v.push( vec( min[0], max[1], max[2] ));      v.push( vec( min[0], min[1], max[2] ))
    v.push( vec( min[0], min[1], min[2] ));      v.push( vec( max[0], min[1], min[2] ))
    v.push( vec( max[0], max[1], min[2] ));      v.push( vec( max[0], max[1], max[2] ))
    v.push( vec( max[0], min[1], max[2] ));      v.push( vec( min[0], min[1], max[2] ))
    v.push( vec( min[0], max[1], max[2] ));      v.push( vec( min[0], max[1], min[2] ))

    v = (@crossSections[constants.PLANE_XY].geometry.vertices = [])
    v.push( vec( min[0], min[1], 0 ));     v.push( vec( min[0], max[1], 0 ))
    v.push( vec( max[0], max[1], 0 ));     v.push( vec( max[0], min[1], 0 ))
    v.push( vec( min[0], min[1], 0 ))

    v = (@crossSections[constants.PLANE_YZ].geometry.vertices = [])
    v.push( vec( 0, min[1], min[2] ));     v.push( vec( 0, min[1], max[2] ))
    v.push( vec( 0, max[1], max[2] ));     v.push( vec( 0, max[1], min[2] ))
    v.push( vec( 0, min[1], min[2] ))

    v = (@crossSections[constants.PLANE_XZ].geometry.vertices = [])
    v.push( vec( min[0], 0, min[2] ));     v.push( vec( min[0], 0, max[2] ))
    v.push( vec( max[0], 0, max[2] ));     v.push( vec( max[0], 0, min[2] ))
    v.push( vec( min[0], 0, min[2] ))

    for mesh in @crossSections.concat( [@cube] )
      mesh.geometry.verticesNeedUpdate = true

    @initialized = true
    @updatePosition(@model.flycam.getPosition())

  updatePosition : (position) ->

    if not @initialized
      return

    for i in constants.ALL_PLANES

      thirdDim = dimensions.thirdDimensionForPlane(i)
      geo = @crossSections[i].geometry
      for j in [0...geo.vertices.length]
        array = geo.vertices[j].toArray()
        array[thirdDim] = position[thirdDim]
        geo.vertices[j] = new THREE.Vector3(array...)
      
      geo.verticesNeedUpdate = true

  getMeshes : ->

    return [ @cube ].concat( @crossSections )

  updateForCam : (id) ->

    if not @initialized
      return

    for i in [0..2]

      thirdDim = dimensions.thirdDimensionForPlane(i)
      position = @model.flycam.getPosition()
      if position[thirdDim] >= @min[thirdDim] and position[thirdDim] <= @max[thirdDim]
        @crossSections[i].visible = @visible and (i == id) and @showCrossSections
      else
        @crossSections[i].visible = false

    @cube.visible = @visible and (id == constants.TDView)

  setVisibility : (visible) ->

    @visible = visible