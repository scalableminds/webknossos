### define
model : Model
view : View
###

GeometryFactory =


  createMesh : (fileName, x = 0, y = 0, z = 0) ->
    #parameter showStatus = true
    @binLoader ?= new THREE.JSONLoader()

    @binLoader.load "assets/mesh/" + fileName, (geometry) ->
      mesh = new THREE.Mesh( geometry, new THREE.MeshFaceMaterial() )
      mesh.position.x = x
      mesh.position.y = y
      mesh.position.z = z
      mesh.doubleSided = true
      View.addGeometry mesh


  createTrianglesplane : (width, zOffset) ->
    $.when(
      Model.Shader.get("trianglesplane")
      Model.Trianglesplane.get(width, zOffset)  
    ).pipe (shader, geometry) ->
      
      #temp.dynamic = true #FUCKING IMPORTANT

      plane = new THREE.PlaneGeometry(128, 128, 1, 1)

      texture = new THREE.ImageUtils.generateDataTexture(128, 128, new THREE.Color(0xff00ff))
      texture.needsUpdate = true

      textureMaterial = new THREE.MeshBasicMaterial({wireframe : false, map: plane.texture})
      trianglesplane = new THREE.Mesh( plane, textureMaterial )
      trianglesplane.rotation.x = 90 /180*Math.PI

      trianglesplane.queryVertices = geometry.queryVertices

      trianglesplane.texture = texture
      View.trianglesplane = trianglesplane    
      View.addGeometry View.trianglesplane
