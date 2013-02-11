### define
underscore: _
cwebgl: cWebGL
###

class Shader

  DESCRIPTION : "Executes a GLSL shader on the data"

  PARAMETER :
    input :
      rgba: "Uint8Array"
      segmentation: 'Uint8Array'
      classification: 'Uint8Array'
      segments: '[]'
      dimensions : '[]'
    shaderName: "string"


  constructor : (@assetHandler) ->

    @canvas = $("<canvas>")[0]
    @context = @canvas.getContext("experimental-webgl", native : false)


  execute : ({ input : { rgba, segmentation, classification, dimensions }, shaderName }) ->

    @context.viewportWidth = @canvas.width = dimensions[0]
    @context.viewportHeight = @canvas.height = dimensions[1]

    shader = @context.createShader(@context.FRAGMENT_SHADER)

