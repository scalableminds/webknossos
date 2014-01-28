### define
###

class ParticleMaterialFactory


  constructor : (@baseVoxel) ->

  getMaterial : ->

    uniforms =
      zoomFactor :
        type : "f"
        value : 1
      baseVoxel :
        type : "f"
        value : @baseVoxel

    attributes =
      size :
        type : "f"
        value : []

    vertexShader   = @getVertexShader()
    fragmentShader = @getFragmentShader()

    material = new THREE.ShaderMaterial({
      attributes
      uniforms
      vertexShader
      fragmentShader
      vertexColors : true
    })

    material.setSizes = (sizes) ->
      attributes.size.value = sizes
      attributes.size.needsUpdate = true

    material.setZoomFactor = (zoomFactor) ->
      uniforms.zoomFactor.value = zoomFactor

    return material


  getVertexShader : ->

    return "
      uniform float zoomFactor;
      uniform float baseVoxel;
      varying vec3 vColor;
      attribute float size;

      void main() 
      {
          vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
          vColor = color;
          gl_PointSize = size / zoomFactor / baseVoxel;
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