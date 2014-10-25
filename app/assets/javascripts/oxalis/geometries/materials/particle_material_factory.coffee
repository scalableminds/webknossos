### define
app : app
three : THREE
./abstract_material_factory : AbstractMaterialFactory
###

class ParticleMaterialFactory extends AbstractMaterialFactory


  setupAttributesAndUniforms : ->

    super()

    @uniforms = _.extend @uniforms,
      zoomFactor :
        type : "f"
        value : @model.flycam.getPlaneScalingFactor()
      baseVoxel :
        type : "f"
        value : app.scaleInfo.baseVoxel
      particleSize :
        type : "f"
        value : @model.user.get("particleSize")
      scale :
        type : "f"
        value : @model.user.get("scale")
      showRadius :
        type : "i"
        value : 1
      devicePixelRatio :
        type : "f"
        value : window.devicePixelRatio || 1

    @attributes = _.extend @attributes,
      size :
        type : "f"


  makeMaterial : ->

    super( vertexColors : true )

    @material.setShowRadius = (showRadius) =>
      @uniforms.showRadius.value = if showRadius then 1 else 0


  setupChangeListeners : ->

    super()

    @listenTo(@model.user, "change:particleSize", (model, size) ->
      @uniforms.particleSize.value = size
    )
    @listenTo(@model.user, "change:scale", (model, scale) ->
      @uniforms.scale.value = scale
    )
    @listenTo(@model.user, "change:overrideNodeRadius", @model.flycam.update)

    @listenTo(@model.flycam, "zoomStepChanged", ->
      @uniforms.zoomFactor.value = @model.flycam.getPlaneScalingFactor()
    )


  getVertexShader : ->

    return """
      uniform float zoomFactor;
      uniform float baseVoxel;
      uniform float particleSize;
      uniform float scale;
      uniform int   showRadius;
      uniform float devicePixelRatio;
      varying vec3 vColor;
      attribute float size;

      void main()
      {
          vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
          vColor = color;
          if (showRadius == 1)
            gl_PointSize = max(
              size / zoomFactor / baseVoxel,
              particleSize ) * devicePixelRatio * scale;
          else
            gl_PointSize = particleSize;
          gl_Position = projectionMatrix * mvPosition;
      }
    """


  getFragmentShader : ->

    return """
      varying vec3 vColor;

      void main()
      {
          gl_FragColor = vec4( vColor, 1.0 );
      }
    """
