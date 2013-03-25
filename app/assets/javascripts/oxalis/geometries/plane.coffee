### define
../model : Model
../view : View
../model/dimensions : Dimensions
../constants : constants
###

class Plane

  # This class is supposed to collect all the Geometries that belong to one single plane such as
  # the plane itself, its texture, borders and crosshairs.

  BORDER_COLORS    : [0xff0000, 0x0000ff, 0x00ff00]
  CROSSHAIR_COLORS : [[0x0000ff, 0x00ff00], [0xff0000, 0x00ff00], [0x0000ff, 0xff0000]]
  GRAY_CH_COLOR    : 0x222222

  constructor : (planeWidth, textureWidth, flycam, planeID, model) ->
    @flycam          = flycam
    @planeID         = planeID
    @model           = model
    @planeWidth      = planeWidth
    @textureWidth    = textureWidth
    @displayCosshair = true

    # planeWidth means that the plane should be that many voxels wide in the
    # dimension with the highest resolution. In all other dimensions, the plane
    # is smaller in voxels, so that it is squared in nm.
    # --> model.scaleInfo.baseVoxel
    scaleArray = Dimensions.transDim(@model.scaleInfo.baseVoxelFactors, @planeID)
    @scaleVector = new THREE.Vector3(scaleArray...)
    
    @createMeshes(planeWidth, textureWidth)

  createMeshes : (pWidth, tWidth) ->
    # create plane
    planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1)
    volumePlaneGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1)

    # create texture
    texture             = new THREE.DataTexture(new Uint8Array(tWidth*tWidth), tWidth, tWidth, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
    texture.needsUpdate = true
    volumeTexture       = new THREE.DataTexture(new Uint8Array(tWidth*tWidth), tWidth, tWidth, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
    
    offset = new THREE.Vector2(0, 0)
    repeat = new THREE.Vector2(0, 0)

    vertexShader = "
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position =   projectionMatrix * 
                        modelViewMatrix * 
                        vec4(position,1.0); }"
    fragmentShader = "
      uniform sampler2D texture, volumeTexture;
      uniform vec2 offset, repeat;
      varying vec2 vUv;
      void main() {
        vec4 volumeColor = texture2D(volumeTexture, vUv * repeat + offset);
        
        /* Color map (<= to fight rounding mistakes) */
             if(volumeColor[0] * 255.0 <= 0.1) volumeColor = vec4(0.0, 0.0, 0.0, 1);
        else if(volumeColor[0] * 255.0 <= 1.1) volumeColor = vec4(0.3, 0.0, 0.0, 1);
        else if(volumeColor[0] * 255.0 <= 2.1) volumeColor = vec4(0.0, 0.3, 0.0, 1);
        else if(volumeColor[0] * 255.0 <= 3.1) volumeColor = vec4(0.0, 0.0, 0.3, 1);
        else if(volumeColor[0] * 255.0 <= 4.1) volumeColor = vec4(0.3, 0.3, 0.0, 1);
        else if(volumeColor[0] * 255.0 <= 5.1) volumeColor = vec4(0.0, 0.3, 0.3, 1);
        else if(volumeColor[0] * 255.0 <= 6.1) volumeColor = vec4(0.3, 0.0, 0.3, 1);

        gl_FragColor = texture2D(texture, vUv * repeat + offset) + volumeColor; }"
    uniforms = {
      texture : {type : "t", value : texture},
      volumeTexture : {type : "t", value : volumeTexture},
      offset : {type : "v2", value : offset},
      repeat : {type : "v2", value : repeat}
    }
    textureMaterial = new THREE.ShaderMaterial({
      uniforms : uniforms,
      vertexShader : vertexShader,
      fragmentShader : fragmentShader
      })

    # create mesh
    @plane = new THREE.Mesh( planeGeo, textureMaterial )
    @plane.texture = texture
    @plane.volumeTexture = volumeTexture
    @plane.offset = offset
    @plane.repeat = repeat
    # Never interpolate
    @plane.texture.magFilter = THREE.NearestFilter
    @plane.volumeTexture.magFilter = THREE.NearestFilter

    # create crosshair
    crosshairGeometries = new Array(2)
    @crosshair          = new Array(2)
    for i in [0..1]
      crosshairGeometries[i] = new THREE.Geometry()
      crosshairGeometries[i].vertices.push(new THREE.Vector3(-pWidth/2*i, -pWidth/2*(1-i), 0))
      crosshairGeometries[i].vertices.push(new THREE.Vector3( -25*i,  -25*(1-i), 0))
      crosshairGeometries[i].vertices.push(new THREE.Vector3( 25*i, 25*(1-i), 0))
      crosshairGeometries[i].vertices.push(new THREE.Vector3( pWidth/2*i,  pWidth/2*(1-i), 0))
      @crosshair[i] = new THREE.Line(crosshairGeometries[i], new THREE.LineBasicMaterial({color: @CROSSHAIR_COLORS[@planeID][i], linewidth: 1}), THREE.LinePieces)
      
    # create borders
    prevBordersGeo = new THREE.Geometry()
    prevBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2, -pWidth/2, 0))
    prevBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2,  pWidth/2, 0))
    prevBordersGeo.vertices.push(new THREE.Vector3(  pWidth/2,  pWidth/2, 0))
    prevBordersGeo.vertices.push(new THREE.Vector3(  pWidth/2, -pWidth/2, 0))
    prevBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2, -pWidth/2, 0))
    @prevBorders = new THREE.Line(prevBordersGeo, new THREE.LineBasicMaterial({color: @BORDER_COLORS[@planeID], linewidth: 1}))

  setDisplayCrosshair : (value) =>
    @displayCosshair = value

  setOriginalCrosshairColor : =>
    for i in [0..1]
      @crosshair[i].material = new THREE.LineBasicMaterial({color: @CROSSHAIR_COLORS[@planeID][i], linewidth: 1})

  setGrayCrosshairColor : =>
    for i in [0..1]
      @crosshair[i].material = new THREE.LineBasicMaterial({color: @GRAY_CH_COLOR, linewidth: 1})

  updateTexture : =>

      globalPos = @flycam.getPosition()

      if @flycam.needsUpdate @planeID
        @flycam.notifyNewTexture @planeID

      area = @flycam.getArea(@planeID)
      tPos = @flycam.getTexturePosition(@planeID).slice()
      if @model?
        @model.binary.planes[@planeID].get(@flycam.getTexturePosition(@planeID), { zoomStep : @flycam.getIntegerZoomStep(@planeID), area : @flycam.getArea(@planeID) }).done ([dataBuffer, volumeBuffer]) =>
          if dataBuffer
            @plane.texture.image.data.set(dataBuffer)
            @flycam.hasNewTexture[@planeID] = true
          if volumeBuffer
            @plane.volumeTexture.image.data.set(volumeBuffer)
  
      if !(@flycam.hasNewTexture[@planeID] or @flycam.hasChanged)
        return

      @plane.texture.needsUpdate = true
      @plane.volumeTexture.needsUpdate = true
      
      scalingFactor = @flycam.getTextureScalingFactor @planeID
      @plane.repeat.x = (area[2] -  area[0]) / @textureWidth  # (tWidth -4) ???
      @plane.repeat.y = (area[3] -  area[1]) / @textureWidth
      @plane.offset.x = area[0] / @textureWidth
      @plane.offset.y = 1 - area[3] / @textureWidth

  setScale : (factor) =>
    scaleVec = new THREE.Vector3().multiplyVectors(new THREE.Vector3(factor, factor, factor), @scaleVector)
    @plane.scale = @prevBorders.scale = @crosshair[0].scale = @crosshair[1].scale = scaleVec

  setRotation : (rotVec) =>
    @plane.rotation = @prevBorders.rotation = @crosshair[0].rotation = @crosshair[1].rotation = rotVec

  setPosition : (posVec) =>
    @prevBorders.position = @crosshair[0].position = @crosshair[1].position = posVec
    
    offset = new THREE.Vector3(0, 0, 0)
    if      @planeID == constants.PLANE_XY then offset.z =  1
    else if @planeID == constants.PLANE_YZ then offset.x = -1
    else if @planeID == constants.PLANE_XZ then offset.y = -1
    @plane.position = offset.addVectors(posVec, offset)

  setVisible : (visible) =>
    @plane.visible = @prevBorders.visible = visible
    @crosshair[0].visible = @crosshair[1].visible = visible and @displayCosshair

  getMeshes : =>
    [@plane, @prevBorders, @crosshair[0], @crosshair[1]]

  setLinearInterpolationEnabled : (value) =>
    @plane.texture.magFilter = if value==true then THREE.LinearFilter else THREE.NearestFilter
