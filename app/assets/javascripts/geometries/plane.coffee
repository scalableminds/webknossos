### define
model : Model
view : View
libs/threejs/fonts/helvetiker_regular.typeface : helvetiker
model/game : Game
###


PLANE_XY         = 0
PLANE_YZ         = 1
PLANE_XZ         = 2
VIEW_3D          = 3
BORDER_COLORS    = [0xff0000, 0x0000ff, 0x00ff00]
CROSSHAIR_COLORS = [[0x0000ff, 0x00ff00], [0xff0000, 0x00ff00], [0x0000ff, 0xff0000]]

class Plane

  # This class is supposed to collect all the Geometries that belong to one single plane such as
  # the plane itself, its texture, borders and crosshairs.

  constructor : (planeWidth, textureWidth, flycam, planeID, model) ->
    @flycam       = flycam
    @planeID      = planeID
    @model        = model
    @planeWidth   = planeWidth
    @textureWidth = textureWidth

    @createMeshes(planeWidth, textureWidth)

  createMeshes : (pWidth, tWidth) ->
    # create plane
    planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1)

    # create texture
    texture             = new THREE.DataTexture(new Uint8Array(tWidth*tWidth), tWidth, tWidth, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
    texture.needsUpdate = true
    textureMaterial     = new THREE.MeshBasicMaterial({wireframe : false, map: planeGeo.texture})

    # create mesh
    @plane = new THREE.Mesh( planeGeo, textureMaterial )
    @plane.texture = texture

    # create crosshair
    crosshairGeometries = new Array(2)
    @crosshair          = new Array(2)
    for i in [0..1]
      crosshairGeometries[i] = new THREE.Geometry()
      crosshairGeometries[i].vertices.push(new THREE.Vector3(-pWidth/2*i, -pWidth/2*(1-i), 1))
      crosshairGeometries[i].vertices.push(new THREE.Vector3( pWidth/2*i,  pWidth/2*(1-i), 1))
      @crosshair[i] = new THREE.Line(crosshairGeometries[i], new THREE.LineBasicMaterial({color: CROSSHAIR_COLORS[@planeID][i], linewidth: 1}))
      
    # create borders
    prevBordersGeo = new THREE.Geometry()
    prevBordersGeo.vertices.push(new THREE.Vector3(-pWidth/2, 1, -pWidth/2))
    prevBordersGeo.vertices.push(new THREE.Vector3(-pWidth/2, 1,  pWidth/2))
    prevBordersGeo.vertices.push(new THREE.Vector3( pWidth/2, 1,  pWidth/2))
    prevBordersGeo.vertices.push(new THREE.Vector3( pWidth/2, 1, -pWidth/2))
    prevBordersGeo.vertices.push(new THREE.Vector3(-pWidth/2, 1, -pWidth/2))
    @prevBorders = new THREE.Line(prevBordersGeo, new THREE.LineBasicMaterial({color: BORDER_COLORS[@planeID], linewidth: 1}))

  setDisplayCrosshair : (value) =>
    @crosshair[0].visible = value
    @crosshair[1].visible = value

  setDisplayPlane : (value) =>
    @plane.visible = value

  updateTexture : (texture) =>

      globalPos = @flycam.getGlobalPos()

      if @flycam.needsUpdate @planeID
        @flycam.notifyNewTexture @planeID

      if texture?
        @plane.texture = texture.clone()
      else if @model?
        #console.log "Args: " + [@flycam.getTexturePosition(@planeID), @flycam.getIntegerZoomStep(@planeID), @flycam.getArea(@planeID), @planeID]
        @model.Binary.get(@flycam.getTexturePosition(@planeID), @flycam.getIntegerZoomStep(@planeID), @flycam.getArea(@planeID), @planeID).done (buffer) =>
          if buffer
            @plane.texture.image.data.set(buffer)
            #@newTextures[dimension] = true

      #@newTextures[dimension] |= @cam2d.hasChanged
      #if !@newTextures[dimension]
      #  continue

      @plane.texture.needsUpdate = true
      @plane.material.map = @plane.texture
      
      offsets = @flycam.getOffsets @planeID
      scalingFactor = @flycam.getTextureScalingFactor @planeID
      map = @plane.material.map
      map.repeat.x = @planeWidth*scalingFactor / @textureWidth;  # (tWidth -4) ???
      map.repeat.y = @planeWidth*scalingFactor / @textureWidth;
      map.offset.x = offsets[0] / @textureWidth;
      map.offset.y = offsets[1] / @textureWidth;

  setScale : (factor) =>
    @plane.scale = @prevBorders.scale = @crosshair[0].scale = @crosshair[1].scale = new THREE.Vector3(factor, factor, factor)

  setRotation : (rotVec) =>
    @plane.rotation = @prevBorders.rotation = @crosshair[0].rotation = @crosshair[1].rotation = rotVec

  setPosition : (posVec) =>
    @plane.position = @prevBorders.position = @crosshair[0].position = @crosshair[1].position = posVec
    @prevBorders.position.z = @crosshair[0].position.z = @crosshair[1].position.z = posVec.z + 1

  getMeshes : =>
    [@plane, @prevBorders, @crosshair[0], @crosshair[1]]