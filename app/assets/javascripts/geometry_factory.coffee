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
      temp = new THREE.Geometry()

      #create some colors for a funny texture
      funWithColors = new Uint8Array(geometry.normalVertices.length)

      for i in [0..geometry.normalVertices.length - 1] by 3
        x = geometry.normalVertices[i]
        y = geometry.normalVertices[i + 1]
        z = geometry.normalVertices[i + 2]
        temp.vertices.push new THREE.Vector3(x,y,z)
        

        funWithColors[i] = Math.random() * 255
        funWithColors[i + 1] = Math.random() * 255
        funWithColors[i + 2] = Math.random() * 255

      range = 128
      offset = 64

      for i in [0..geometry.indices.length - 1] by 3
        v1 = geometry.indices[i]
        v2 = geometry.indices[i + 1]
        v3 = geometry.indices[i + 2]

        # for some reason every second face is flipped
        if i % 6 == 0
          temp.faces.push new THREE.Face3(v1, v2, v3)
        else
          temp.faces.push new THREE.Face3(v3, v2, v1)

        #uv
        uv1 = 
          "s" : (temp.vertices[v1].x + offset) / range,
          "t" : (temp.vertices[v1].y + offset) / range
        uv2 = 
          "s" : (temp.vertices[v2].x + offset) / range,
          "t" : (temp.vertices[v2].y + offset) / range
        uv3 = 
          "s" : (temp.vertices[v3].x + offset) / range,
          "t" : (temp.vertices[v3].y + offset) / range

        temp.faceVertexUvs[0].push( [
          new THREE.UV(uv1.s,1 - uv1.t),
          new THREE.UV(uv2.s,1 - uv2.t),
          new THREE.UV(uv3.s,1 - uv3.t)
        ] )

      temp.dynamic = true #FUCKING IMPORTANT

      attributes =
        interpolationBuffer0 :
          type : "v4",
          value : []
        interpolationBuffer1 :
          type : "v4",
          value : []
        interpolationBufferDelta :
          type : "v3",
          value : []

      shaderMaterial = new THREE.ShaderMaterial(
          attributes : attributes,
          vertexShader : shader.vertexShader,
          fragmentShader : shader.fragmentShader,
        )

      #width, depth, segmentsWidth, segmentsDepth
      temp = new THREE.PlaneGeometry(128, 128, 1, 1)

      texture = new THREE.DataTexture( funWithColors, 128, 128, THREE.RGBFormat ) 
      texture.needsUpdate = true

      textureMaterial = new THREE.MeshBasicMaterial({wireframe : false, map: texture})

      trianglesplane = new THREE.Mesh( temp, textureMaterial )

      trianglesplane.queryVertices = geometry.queryVertices
      trianglesplane.attributes = attributes
      View.trianglesplane = trianglesplane    
      View.addGeometry View.trianglesplane
