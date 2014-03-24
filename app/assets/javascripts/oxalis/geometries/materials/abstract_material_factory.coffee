### define
three : THREE
###

class AbstractMaterialFactory


  constructor : (@model) ->

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
