app                     = require("app")
THREE                   = require("three")
AbstractMaterialFactory = require("./abstract_material_factory")

class AbstractPlaneMaterialFactory extends AbstractMaterialFactory


  constructor : (@model, @tWidth) ->

    _.extend(this, Backbone.Events)

    @minFilter = THREE.NearestFilter
    @maxFilter = THREE.NearestFilter
    super(@model)


  setupAttributesAndUniforms : ->

    super()

    for binary in @model.getColorBinaries()
      name = @sanitizeName(binary.name)
      @uniforms[name + "_brightness"] =
        type : "f"
        value : @model.datasetConfiguration.get("layers.#{binary.name}.brightness") / 255
      @uniforms[name + "_contrast"] =
        type : "f"
        value : @model.datasetConfiguration.get("layers.#{binary.name}.contrast")


    @createTextures()


  makeMaterial : (options) ->

    super(options)

    @material.setData = (name, data) =>
      textureName = @sanitizeName(name)
      @textures[textureName]?.image.data.set(data)
      @textures[textureName]?.needsUpdate = true


  setupChangeListeners : ->

    @listenTo(@model.datasetConfiguration, "change", (model) ->

      for binaryName, changes of model.changed.layers or {}
        name = @sanitizeName(binaryName)
        if changes.brightness?
          @uniforms[name + "_brightness"].value = changes.brightness / 255
        if changes.contrast?
          @uniforms[name + "_contrast"].value = changes.contrast
      app.vent.trigger("rerender")
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

module.exports = AbstractPlaneMaterialFactory
