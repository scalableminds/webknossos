### define
three : THREE
./abstract_material_factory : AbstractMaterialFactory
###

class AbstractPlaneMaterialFactory extends AbstractMaterialFactory


  constructor : (@model, @tWidth) ->

    @minFilter = THREE.NearestFilter
    @maxFilter = THREE.NearestFilter
    super(@model)


  setupAttributesAndUniforms : ->

    super()

    settings = @model.user.getOrCreateBrightnessContrastColorSettings(
      @model
    )

    for binary in @model.getColorBinaries()
      name = @sanitizeName(binary.name)
      @uniforms[name + "_brightness"] =
        type : "f"
        value : settings[binary.name].brightness / 255
      @uniforms[name + "_contrast"] =
        type : "f"
        value : settings[binary.name].contrast

    @createTextures()


  makeMaterial : (options) ->

    super(options)

    @material.setData = (name, data) =>
      textureName = @sanitizeName(name)
      @textures[textureName]?.image.data.set(data)
      @textures[textureName]?.needsUpdate = true


  setupChangeListeners : ->

    for binary in @model.getColorBinaries()
      do (binary) =>
        binary.on
          newColorSettings : (brightness, contrast) =>
            name = @sanitizeName(binary.name)
            @uniforms[name + "_brightness"].value = brightness / 255
            @uniforms[name + "_contrast"].value = contrast


  createTextures : ->

    throw new Error("Subclass responsibility")


  sanitizeName : (name) ->
    # Make sure name starts with a letter and contains
    # no "-" signs

    return unless name?
    return "binary_" + name.replace(/-/g, "_")


  createDataTexture : (width, bytes) ->

    format = if bytes == 1 then THREE.LuminanceFormat else THREE.RGBFormat

    return new THREE.DataTexture(
      new Uint8Array(bytes * width * width), width, width,
      format, THREE.UnsignedByteType,
      new THREE.UVMapping(),
      THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
      @minFilter, @maxFilter
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
