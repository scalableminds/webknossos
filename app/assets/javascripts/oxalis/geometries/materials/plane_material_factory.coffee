### define
three : THREE
###

class PlaneMaterialFactory


  constructor : (@model, tWidth) ->

    # create textures
    textures = {}
    for name, binary of @model.binary
      bytes = binary.targetBitDepth >> 3
      textures[name] = @createDataTexture(tWidth, bytes)
      textures[name].category = binary.category

    uniforms =
      texture :
        type : "t"
        value : textures['color']
      volumeTexture :
        type : "t"
        value : textures['segmentation']
      offset :
        type : "v2"
        value : new THREE.Vector2(0, 0)
      repeat :
        type : "v2"
        value : new THREE.Vector2(1, 1)
      alpha :
        type : "f"
        value : 0

    vertexShader   = @getVertexShader()
    fragmentShader = @getFragmentShader()

    @material = new THREE.ShaderMaterial({
      uniforms
      vertexShader
      fragmentShader
    })

    @material.setData = (name, data) ->
      textures[name].image.data.set(data)
      textures[name].needsUpdate = true

    @material.setColorInterpolation = (interpolation) ->
      for name, texture of textures
        if texture.category == "color"
          texture.magFilter = interpolation

    @material.setScaleParams = ({offset, repeat}) ->
      uniforms.offset.value.set offset.x, offset.y
      uniforms.repeat.value.set repeat.x, repeat.y

    @material.setSegmentationAlpha = (alpha) ->
      uniforms.alpha.value = alpha


  getMaterial : ->

    return @material


  createDataTexture : (width, bytes) ->

    format = if bytes == 1 then THREE.LuminanceFormat else THREE.RGBFormat
    
    return new THREE.DataTexture(
      new Uint8Array(bytes * width * width), width, width,
      format, THREE.UnsignedByteType,
      new THREE.UVMapping(),
      THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
      THREE.NearestFilter, THREE.LinearMipmapLinearFilter
    )


  getVertexShader : ->

    return "
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position =   projectionMatrix * 
                        modelViewMatrix * 
                        vec4(position,1.0); }
    "


  getFragmentShader : ->

    return "
      uniform sampler2D texture, volumeTexture;
      uniform vec2 offset, repeat;
      uniform float alpha;
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
          gl_FragColor = (1.0 - alpha/100.0) * texture2D(texture, vUv * repeat + offset) + alpha/100.0 * hsv_to_rgb( HSV );
        } else {
          gl_FragColor = texture2D(texture, vUv * repeat + offset);
        }
      }
    "