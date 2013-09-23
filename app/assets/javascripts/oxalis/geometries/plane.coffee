### define
../model : Model
../view : View
../model/dimensions : Dimensions
../constants : constants
###

class Plane

  # This class is supposed to collect all the Geometries that belong to one single plane such as
  # the plane itself, its texture, borders and crosshairs.

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
      uniform vec2 alpha;
      varying vec2 vUv;

      /* Inspired from: https://github.com/McManning/WebGL-Platformer/blob/master/shaders/main.frag */
      vec4 hsv_to_rgb(vec4 HSV)
      {
        vec4 RGB; /* = HSV.z; */

        float h = HSV.x;
        float s = HSV.y;
        float v = HSV.z;

        float i = floor(h);
        float f = h - i;

        float p = (1.0 - s);
        float q = (1.0 - s * f);
        float t = (1.0 - s * (1.0 - f));

        if (i == 0.0) { RGB = vec4(1.0, t, p, 1.0); }
        else if (i == 1.0) { RGB = vec4(q, 1.0, p, 1.0); }
        else if (i == 2.0) { RGB = vec4(p, 1.0, t, 1.0); }
        else if (i == 3.0) { RGB = vec4(p, q, 1.0, 1.0); }
        else if (i == 4.0) { RGB = vec4(t, p, 1.0, 1.0); }
        else /* i == -1 */ { RGB = vec4(1.0, p, q, 1.0); }

        RGB *= v;

        return RGB;
      }

      void main() {
        vec4 volumeColor = texture2D(volumeTexture, vUv * repeat + offset);
        float id = (volumeColor[0] * 255.0);
        float golden_ratio = 0.618033988749895;

        /* Color map (<= to fight rounding mistakes) */
        
        if ( id > 0.1 ) {
          vec4 HSV = vec4( mod( 6.0 * id * golden_ratio, 6.0), 1.0, 1.0, 1.0 );
          gl_FragColor = (1.0 - alpha[0]/100.0) * texture2D(texture, vUv * repeat + offset) + alpha[0]/100.0 * hsv_to_rgb( HSV );
        } else {
          gl_FragColor = texture2D(texture, vUv * repeat + offset);
        }
      }
        "
    # weird workaround to force JS to pass this as a reference...
    @alpha = new THREE.Vector2( 0, 0)
    uniforms = {
      texture : {type : "t", value : texture},
      volumeTexture : {type : "t", value : volumeTexture},
      offset : {type : "v2", value : offset},
      repeat : {type : "v2", value : repeat},
      alpha : {type : "v2", value : @alpha}
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
    TDViewBordersGeo = new THREE.Geometry()
    TDViewBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2, -pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2,  pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3(  pWidth/2,  pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3(  pWidth/2, -pWidth/2, 0))
    TDViewBordersGeo.vertices.push(new THREE.Vector3( -pWidth/2, -pWidth/2, 0))
    @TDViewBorders = new THREE.Line(TDViewBordersGeo, new THREE.LineBasicMaterial({color: constants.PLANE_COLORS[@planeID], linewidth: 1}))


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

      area = @flycam.getArea(@planeID)
      tPos = @flycam.getTexturePosition(@planeID).slice()
      if @model?
        for dataLayerName of @model.binary
          @model.binary[dataLayerName].planes[@planeID].get(@flycam.getTexturePosition(@planeID), { zoomStep : @flycam.getIntegerZoomStep(), area : @flycam.getArea(@planeID) }).done ([dataBuffer, volumeBuffer]) =>
            if dataBuffer
              if dataLayerName == "color"
                @plane.texture.image.data.set(dataBuffer)
              if dataLayerName == "volume" or dataLayerName == "segmentation"
                @plane.volumeTexture.image.data.set(dataBuffer)
              @flycam.hasNewTexture[@planeID] = true

            if volumeBuffer and not (@model.binary["volume"]? or @model.binary["segmentation"]?)
              # Generate test pattern
              #for i in [0...512]
              #  for j in [0...512]
              #    id = Math.floor(i / 32) * 16 + Math.floor(j / 32)
              #    volumeBuffer[i * 512 + j] = id
              @plane.volumeTexture.image.data.set(volumeBuffer)
              @flycam.hasNewTexture[@planeID] = true
  
      if !(@flycam.hasNewTexture[@planeID] or @flycam.hasChanged)
        return

      @plane.texture.needsUpdate = true
      @plane.volumeTexture.needsUpdate = true
      
      scalingFactor = @flycam.getTextureScalingFactor()
      @plane.repeat.x = (area[2] -  area[0]) / @textureWidth  # (tWidth -4) ???
      @plane.repeat.y = (area[3] -  area[1]) / @textureWidth
      @plane.offset.x = area[0] / @textureWidth
      @plane.offset.y = 1 - area[3] / @textureWidth


  setScale : (factor) =>

    scaleVec = new THREE.Vector3().multiplyVectors(new THREE.Vector3(factor, factor, factor), @scaleVector)
    @plane.scale = @TDViewBorders.scale = @crosshair[0].scale = @crosshair[1].scale = scaleVec


  setRotation : (rotVec) =>

    @plane.rotation = @TDViewBorders.rotation = @crosshair[0].rotation = @crosshair[1].rotation = rotVec


  setPosition : (posVec) =>

    @TDViewBorders.position = @crosshair[0].position = @crosshair[1].position = posVec
    
    offset = new THREE.Vector3(0, 0, 0)
    if      @planeID == constants.PLANE_XY then offset.z =  1
    else if @planeID == constants.PLANE_YZ then offset.x = -1
    else if @planeID == constants.PLANE_XZ then offset.y = -1
    @plane.position = offset.addVectors(posVec, offset)


  setVisible : (visible) =>

    @plane.visible = @TDViewBorders.visible = visible
    @crosshair[0].visible = @crosshair[1].visible = visible and @displayCosshair


  setSegmentationAlpha : (alpha) ->
    @alpha.x = alpha
    @flycam.hasChanged = true


  getMeshes : =>

    [@plane, @TDViewBorders, @crosshair[0], @crosshair[1]]


  setLinearInterpolationEnabled : (value) =>

    @plane.texture.magFilter = if value==true then THREE.LinearFilter else THREE.NearestFilter

