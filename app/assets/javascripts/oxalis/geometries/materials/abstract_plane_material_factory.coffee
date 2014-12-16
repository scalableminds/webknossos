### define
three : THREE
./abstract_material_factory : AbstractMaterialFactory
###

class AbstractPlaneMaterialFactory extends AbstractMaterialFactory


  constructor : (@model, @tWidth) ->

    _.extend(this, Backbone.Events)

    @minFilter = THREE.NearestFilter
    @maxFilter = THREE.NearestFilter
    super(@model)


  setupAttributesAndUniforms : ->

    super()

    @uniforms = _.extend @uniforms,
      brightness :
        type : "f"
        value : @model.dataset.get("brightness") / 255
      contrast :
        type : "f"
        value : @model.dataset.get("contrast")

    @createTextures()


  makeMaterial : (options) ->

    super(options)

    @material.setData = (name, data) =>
      textureName = @sanitizeName(name)
      @textures[textureName]?.image.data.set(data)
      @textures[textureName]?.needsUpdate = true


  setupChangeListeners : ->

    @listenTo(@model.dataset, "change:brightness", (model, brightness) ->
      @uniforms.brightness.value = brightness / 255
    )

    @listenTo(@model.dataset, "change:contrast", (model, contrast) ->
      @uniforms.contrast.value = contrast
    )


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
