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
      offset :
        type : "v2"
        value : new THREE.Vector2(0, 0)
      repeat :
        type : "v2"
        value : new THREE.Vector2(1, 1)
      alpha :
        type : "f"
        value : 0

    for name, texture of textures
      uniforms[name + "_texture"] = {
        type : "t"
        value : texture
      }
      unless name == "segmentation"
        color = _.map @model.binary[name].color, (e) -> e / 255
        uniforms[name + "_weight"] = {
          type : "f"
          value : 1
        }
        uniforms[name + "_color"] = {
          type : "v3"
          value : new THREE.Vector3(color...)
        }

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

    for binary in @model.getColorBinaries()
      do (binary) ->
        binary.on "newColor", (color) ->
          color = _.map color, (e) -> e / 255
          uniforms[binary.name + "_color"].value = new THREE.Vector3(color...)


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

    return """
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position =   projectionMatrix *
                        modelViewMatrix *
                        vec4(position,1.0); }
    """


  getFragmentShader : ->

    colorLayerNames = _.map @model.getColorBinaries(), (b) -> b.name

    return _.template(
      """
      <% _.each(layers, function(name) { %>
        uniform sampler2D <%= name %>_texture;
        uniform vec3 <%= name %>_color;
        uniform float <%= name %>_weight;
      <% }) %>

      <% if (hasSegmentation) { %>
        uniform sampler2D segmentation_texture;
      <% } %>

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
        float golden_ratio = 0.618033988749895;

        <% if (hasSegmentation) { %>
          vec4 volume_color = texture2D(segmentation_texture, vUv * repeat + offset);
          float id = (volume_color.r * 255.0);
        <% } else { %>
          float id = 0.0;
        <% } %>

        /* Get Color Value(s) */
        <% if (isRgb) { %>
          vec3 data_color = texture2D( <%= layers[0] %>_texture, vUv * repeat + offset).xyz;
        <% } else { %>
          vec3 data_color = vec3(0.0, 0.0, 0.0)
          <% _.each(layers, function(name){ %>
            + texture2D( <%= name %>_texture, vUv * repeat + offset).r
                * <%= name %>_weight * <%= name %>_color
          <% }) %> ;
        <% } %>

        /* Color map (<= to fight rounding mistakes) */

        if ( id > 0.1 ) {
          vec4 HSV = vec4( mod( 6.0 * id * golden_ratio, 6.0), 1.0, 1.0, 1.0 );
          gl_FragColor = (1.0 - alpha/100.0) * vec4(data_color, 1.0) + alpha/100.0 * hsv_to_rgb( HSV );
        } else {
          gl_FragColor = vec4(data_color, 1.0);
        }
      }
      """
      {
        layers : colorLayerNames
        hasSegmentation : @model.binary["segmentation"]?
        isRgb : @model.binary["color"]?.targetBitDepth == 24
      }
    )
