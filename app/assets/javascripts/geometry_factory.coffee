### define
model : Model
view : View
libs/threejs/fonts/helvetiker_regular.typeface : helvetiker
###

# This module is responsible for loading Geometry objects like meshes
# or creating them programmatically.
# These objects initalized with default values (postion, materials, etc)
# before passing them to the View, where they will be added to the scene
# and rendered.
# 
# It has lost some importance since switching to THREE.js because
# a lot of things require less code.
GeometryFactory =

  # This method loads *.OBJ 3D files.
  # Traditionally the data require to create a geometry mesh
  # should be provided by the Model (-> Model.Mesh), but 
  # for right now let's rely on THREE.js model loader.
  createMesh : (fileName, x = 0, y = 0, z = 0) ->

    @binLoader ?= new THREE.JSONLoader()
    @binLoader.load "assets/mesh/" + fileName, (geometry) ->

      mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial( { color: 0xffffff, shading: THREE.NoShading, vertexColors: THREE.VertexColors } ))
      mesh.position.x = x
      mesh.position.y = y
      mesh.position.z = z
      View.addGeometryXY mesh

  # Let's set up our trianglesplane.
  # It serves as a "canvas" where the brain images
  # are drawn.
  # Don't let the name fool you, this is just an 
  # ordinary plane with a texture applied to it.
  # 
  # User tests showed that looking a bend surface (a half sphere)
  # feels more natural when moving around in 3D space.
  # To acknowledge this fact we determine the pixels that will
  # be displayed by requesting them as though they were
  # attached to bend surface.
  # The result is then projected on a flat surface.
  # For me detail look in Model.
  #
  # queryVertices: holds the position/matrices 
  # needed to for the bend surface.
  # normalVertices: (depricated) holds the vertex postion 
  # for the flat surface
  createTrianglesplane : (width, zOffset) ->
    $.when(
    #  Model.Shader.get("trianglesplane")
    #  Model.Trianglesplane.get(width, zOffset)  
    #).pipe (shader, geometry) ->

      planexy = new THREE.PlaneGeometry(380, 380, 1, 1)
      planeyz = new THREE.PlaneGeometry(380, 380, 1, 1)
      planexz = new THREE.PlaneGeometry(380, 380, 1, 1)
      planePrevXY = new THREE.PlaneGeometry(384, 384, 1, 1)
      planePrevYZ = new THREE.PlaneGeometry(384, 384, 1, 1)
      planePrevXZ = new THREE.PlaneGeometry(384, 384, 1, 1)
      
      #create preview Box (2500x2500)
      previewBoxGeometry = new THREE.Geometry()
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 2500, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 2500, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 0, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 2500, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 2500, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 2500, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 2500, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(2500, 0, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 2500, 2500))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 2500, 0))
      previewBox = new THREE.Line(previewBoxGeometry, new THREE.LineBasicMaterial({color: 0x999999, linewidth: 1}))
      View.addGeometryPrev previewBox
      # TODO: find right rotation:
      text1 = new THREE.Mesh(new THREE.TextGeometry("0, 0, 0", {size : 120, height : 20, font : "helvetiker"}), new THREE.MeshBasicMaterial({color: 0x999999}))
      text1.position = new THREE.Vector3(0, 2500, 0)
      text1.rotation = new THREE.Vector3(0, 35 /180*Math.PI, 0)
      View.addGeometryPrev text1
      text2 = new THREE.Mesh(new THREE.TextGeometry("2500, 0, 0", {size : 120, height : 20, font : "helvetiker"}), new THREE.MeshBasicMaterial({color: 0x999999}))
      text2.position = new THREE.Vector3(2000, 2300, 0)
      text2.rotation = new THREE.Vector3(0, 35 /180*Math.PI, 0)
      View.addGeometryPrev text2
      text3 = new THREE.Mesh(new THREE.TextGeometry("0, 2500, 0", {size : 120, height : 20, font : "helvetiker"}), new THREE.MeshBasicMaterial({color: 0x999999}))
      text3.position = new THREE.Vector3(0, 2500, 2500)
      text3.rotation = new THREE.Vector3(0, 35 /180*Math.PI, 0)
      View.addGeometryPrev text3
      text4 = new THREE.Mesh(new THREE.TextGeometry("0, 0, 2500", {size : 120, height : 20, font : "helvetiker"}), new THREE.MeshBasicMaterial({color: 0x999999}))
      text4.position = new THREE.Vector3(0, 0, 0)
      text4.rotation = new THREE.Vector3(0, 35 /180*Math.PI, 0)
      View.addGeometryPrev text4

      # create route
      View.createRoute 10

      # arguments: data, width, height, format, type, mapping, wrapS, wrapT, magFilter, minFilter 
      texturexy = new THREE.DataTexture(new Uint8Array(512*512), 512, 512, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
      texturexy.needsUpdate = true

      textureyz = new THREE.DataTexture(new Uint8Array(512*512), 512, 512, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
      textureyz.needsUpdate = true

      texturexz = new THREE.DataTexture(new Uint8Array(512*512), 512, 512, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
      texturexz.needsUpdate = true

      texturePrevXY = new THREE.DataTexture(new Uint8Array(512*512), 512, 512, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
      texturePrevXY.needsUpdate = true
      texturePrevYZ = new THREE.DataTexture(new Uint8Array(512*512), 512, 512, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
      texturePrevYZ.needsUpdate = true
      texturePrevXZ = new THREE.DataTexture(new Uint8Array(512*512), 512, 512, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
      texturePrevXZ.needsUpdate = true

      textureMaterialxy = new THREE.MeshBasicMaterial({wireframe : false, map: planexy.texture})
      textureMaterialyz = new THREE.MeshBasicMaterial({wireframe : false, map: planeyz.texture})
      textureMaterialxz = new THREE.MeshBasicMaterial({wireframe : false, map: planexz.texture})
      textureMaterialPrevXY = new THREE.MeshBasicMaterial({wireframe : false, map: planePrevXY.texture})
      textureMaterialPrevYZ = new THREE.MeshBasicMaterial({wireframe : false, map: planePrevYZ.texture})
      textureMaterialPrevXZ = new THREE.MeshBasicMaterial({wireframe : false, map: planePrevXZ.texture})

      trianglesplanexy = new THREE.Mesh( planexy, textureMaterialxy )
      trianglesplanexy.rotation.x = 90 /180*Math.PI
      
      trianglesplaneyz = new THREE.Mesh( planeyz, textureMaterialyz )
      trianglesplaneyz.rotation.x = 90 /180*Math.PI

      trianglesplanexz = new THREE.Mesh( planexz, textureMaterialxz )
      trianglesplanexz.rotation.x = 90 /180*Math.PI

      trianglesplanePrevXY = new THREE.Mesh( planePrevXY, textureMaterialPrevXY )
      
      trianglesplanePrevYZ = new THREE.Mesh( planePrevYZ, textureMaterialPrevYZ )
      trianglesplanePrevYZ.rotation.x = 90 /180*Math.PI
      trianglesplanePrevYZ.rotation.z = -90 /180*Math.PI
      
      trianglesplanePrevXZ = new THREE.Mesh( planePrevXZ, textureMaterialPrevXZ )
      trianglesplanePrevXZ.rotation.x = 90 /180*Math.PI

      trianglesplanexy.texture = texturexy
      trianglesplaneyz.texture = textureyz
      trianglesplanexz.texture = texturexz
      trianglesplanePrevXY.texture = texturePrevXY
      trianglesplanePrevYZ.texture = texturePrevYZ
      trianglesplanePrevXZ.texture = texturePrevXZ

      View.trianglesplanexy = trianglesplanexy
      View.addGeometryXY View.trianglesplanexy

      View.trianglesplaneyz = trianglesplaneyz
      View.addGeometryYZ View.trianglesplaneyz

      View.trianglesplanexz = trianglesplanexz
      View.addGeometryXZ View.trianglesplanexz

      View.trianglesplanePrevXY = trianglesplanePrevXY
      View.addGeometryPrev View.trianglesplanePrevXY
      View.trianglesplanePrevYZ = trianglesplanePrevYZ
      View.addGeometryPrev View.trianglesplanePrevYZ
      View.trianglesplanePrevXZ = trianglesplanePrevXZ
      View.addGeometryPrev View.trianglesplanePrevXZ
    )