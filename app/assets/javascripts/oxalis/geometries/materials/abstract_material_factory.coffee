Backbone = require("backbone")
THREE    = require("three")

class AbstractMaterialFactory


  constructor : (@model) ->

    _.extend(this, Backbone.Events)

    @setupAttributesAndUniforms()
    @makeMaterial()
    @setupChangeListeners()


  setupAttributesAndUniforms : ->

    @uniforms = {}
    @attributes = {}


  makeMaterial : (options = {}) ->

    options = _.extend options, {
      @uniforms
      @attributes
      vertexShader   : @getVertexShader()
      fragmentShader : @getFragmentShader()
    }

    @material = new THREE.ShaderMaterial(options)


  setupChangeListeners : ->


  getMaterial : ->

    return @material


  getVertexShader : ->


  getFragmentShader : ->


module.exports = AbstractMaterialFactory
