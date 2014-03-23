### define
three : THREE
./abstract_plane_material_factory : AbstractPlaneMaterialFactory
###

class ArbitraryPlaneMaterialFactory extends AbstractPlaneMaterialFactory


  constructor : (@model, @tWidth) ->

    super(@model, @tWidth)
    @minFilter = THREE.LinearFilter


  createTextures : ->

    @textures = {
      color : @createDataTexture(@tWidth, 1)
    }

    @uniforms["color_texture"] = {
      type : "t"
      value : @textures["color"]
    }



  getFragmentShader : ->

    return """
      uniform sampler2D color_texture;
      uniform float brightness, contrast;
      varying vec2 vUv;

      void main()
      {
        float color_value  = 0.0;

        /* Get grayscale value */
        color_value = texture2D( color_texture, vUv).r;

        /* Brightness / Contrast Transformation */
        color_value = (color_value + brightness - 0.5) * contrast + 0.5;

        /* Set frag color */
        gl_FragColor = vec4(color_value, color_value, color_value, 1.0);
      }
    """
