### define
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
        value : @model.user.particleSize

    attributes =
      size :
        type : "f"
        value : []

    vertexShader   = @getVertexShader()
    fragmentShader = @getFragmentShader()

    @material = new THREE.ShaderMaterial({
      attributes
      uniforms
      vertexShader
      fragmentShader
      vertexColors : true
    })

    @material.setSizes = (sizes) ->
      attributes.size.value = sizes
      attributes.size.needsUpdate = true

    @material.setZoomFactor = (zoomFactor) ->
      uniforms.zoomFactor.value = zoomFactor

    @model.user.on "particleSizeChanged", (size) ->
      uniforms.minParticleSize.value = size

    @model.flycam.on "zoomStepChanged", =>
      uniforms.zoomFactor.value = @model.flycam.getPlaneScalingFactor()


  getMaterial : ->

    return @material


  getVertexShader : ->

    return "
      uniform float zoomFactor;
      uniform float baseVoxel;
      uniform float minParticleSize;
      varying vec3 vColor;
      attribute float size;

      void main() 
      {
          vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
          vColor = color;
          gl_PointSize = max(
            size / zoomFactor / baseVoxel,
            minParticleSize );
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