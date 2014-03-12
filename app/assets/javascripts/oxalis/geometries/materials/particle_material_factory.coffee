### define
three : THREE
###

class ParticleMaterialFactory


  constructor : (@model) ->

    uniforms =
      zoomFactor :
        type : "f"
        value : @model.flycam.getPlaneScalingFactor()
      baseVoxel :
        type : "f"
        value : @model.scaleInfo.baseVoxel
      minParticleSize :
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

    attributes =
      size :
        type : "f"

    vertexShader   = @getVertexShader()
    fragmentShader = @getFragmentShader()

    @material = new THREE.ShaderMaterial({
      attributes
      uniforms
      vertexShader
      fragmentShader
      vertexColors : true
    })

    @material.setShowRadius = (showRadius) ->
      uniforms.showRadius.value = if showRadius then 1 else 0

    @model.user.on
      particleSizeChanged : (size) ->
        uniforms.minParticleSize.value = size
      scaleChanged : (scale) ->
        uniforms.scale.value = scale

    @model.flycam.on
      zoomStepChanged : =>
        uniforms.zoomFactor.value = @model.flycam.getPlaneScalingFactor()


  getMaterial : ->

    return @material


  getVertexShader : ->

    return "
      uniform float zoomFactor;
      uniform float baseVoxel;
      uniform float minParticleSize;
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
              minParticleSize ) * devicePixelRatio * scale;
          else
            gl_PointSize = minParticleSize;
          gl_Position = projectionMatrix * mvPosition;
      }
    "


  getFragmentShader : ->

    return "
      varying vec3 vColor;

      void main() 
      {
          gl_FragColor = vec4( vColor, 1.0 );
      }
    "