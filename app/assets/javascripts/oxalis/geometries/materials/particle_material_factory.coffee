### define
###

class ParticleMaterialFactory


  constructor : ->

  getMaterial : (sizes) ->

    attributes     =
      size :
        type : "f"
        value : sizes

    vertexShader   = @getVertexShader()
    fragmentShader = @getFragmentShader()

    material = new THREE.ShaderMaterial({
      attributes
      vertexShader
      fragmentShader
      vertexColors : true
    })

    return material


  getVertexShader : ->

    return "
      varying vec3 vColor;
      attribute float size;

      void main() 
      {
          vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
          vColor = color;
          gl_PointSize = size;
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