THREE                        = require("three")
AbstractPlaneMaterialFactory = require("./abstract_plane_material_factory")

class ArbitraryPlaneMaterialFactory extends AbstractPlaneMaterialFactory


  createTextures : ->

    @colorName = @sanitizeName(
      @model.getColorBinaries()[0].name
    )

    @textures = {}
    @textures[@colorName] = @createDataTexture(@tWidth, 1)

    @uniforms[@colorName + "_texture"] = {
      type : "t"
      value : @textures[@colorName]
    }


  createDataTexture : (width, bytes) ->

    @minFilter = THREE.LinearFilter
    super(width, bytes)


  getFragmentShader : ->

    return _.template(
      """
      uniform sampler2D <%= colorName %>_texture;
      uniform float <%= colorName %>_brightness, <%= colorName %>_contrast;
      varying vec2 vUv;

      void main()
      {
        float color_value = 0.0;

        /* Get grayscale value */
        color_value = texture2D( <%= colorName %>_texture, vUv).r;

        /* Brightness / Contrast Transformation */
        color_value = (color_value + <%= colorName %>_brightness - 0.5) * <%= colorName %>_contrast + 0.5;

        /* Set frag color */
        gl_FragColor = vec4(color_value, color_value, color_value, 1.0);
      }
      """
    )(colorName : @colorName)

module.exports = ArbitraryPlaneMaterialFactory
