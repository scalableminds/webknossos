### define 
three : THREE
jquery : $
###

# This loads and caches meshes.

class Mesh

  @LOAD_TIMEOUT : 30000

  mesh : null

  constructor : (geometry) ->

    @mesh = new THREE.Mesh( 
      geometry, 
      new THREE.MeshBasicMaterial( color: 0xffffff, shading: THREE.NoShading, vertexColors: THREE.VertexColors )
    )

  
  setPosition : (x, y, z) ->

    { mesh } = this
    mesh.position.x = x
    mesh.position.y = y
    mesh.position.z = z
    return


  attachScene : (scene) ->
    
    scene.add @mesh


  @load : (filename) ->

    deferred = new $.Deferred()

    new THREE.JSONLoader().load(
      "assets/mesh/" + filename
      (geometry) =>
        deferred.resolve(new this(geometry))
    )

    setTimeout(
      -> deferred.reject("timeout")
      @LOAD_TIMEOUT
    )

    deferred.promise()

    
