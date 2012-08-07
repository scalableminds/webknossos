### define
model : Model
view : View
libs/threejs/fonts/helvetiker_regular.typeface : helvetiker
model/game : Game
###


PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
VIEW_3D  = 3
WIDTH    = 384

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
      View.addGeometry PLANE_XY, mesh

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

      planes             = [new Array(3), new Array(3), new Array(3)]
      textures           = [new Array(3), new Array(3)]
      textureMaterials   = [new Array(3), new Array(3), new Array(3)]
      meshes             = [new Array(3), new Array(3), new Array(3)]
      crosshairs         = [new Array(2), new Array(2), new Array(2)]   # crosshairs for main planes, each consisting of two lines
      crosshairsGeometry = [new Array(2), new Array(2), new Array(2)]

      borderColors       = [0xff0000, 0x0000ff, 0x00ff00]
      crosshairColors    = [[0x0000ff, 0x00ff00], [0xff0000, 0x00ff00], [0x0000ff, 0xff0000]]

      # dimension: [XY, YZ, XZ]; kind: [main, preview, border]
      for dimension in [0..2]
        for kind in [0..2]
          size = if kind==2 then 390 else 380
          planes[kind][dimension] = new THREE.PlaneGeometry(size, size, 1, 1)

          if kind<2
            textures[kind][dimension] = new THREE.DataTexture(new Uint8Array(512*512), 512, 512, THREE.LuminanceFormat, THREE.UnsignedByteType, new THREE.UVMapping(), THREE.ClampToEdgeWrapping , THREE.ClampToEdgeWrapping, THREE.LinearMipmapLinearFilter, THREE.LinearMipmapLinearFilter )
            textures[kind][dimension].needsUpdate = true
            textureMaterials[kind][dimension] = new THREE.MeshBasicMaterial({wireframe : false, map: planes[kind][dimension].texture})
          else
            textureMaterials[kind][dimension] = new THREE.MeshBasicMaterial({wireframe : false, color: borderColors[dimension]})

          meshes[kind][dimension] = new THREE.Mesh( planes[kind][dimension], textureMaterials[kind][dimension] )
          if kind==0
            meshes[kind][dimension].rotation.x = 90 /180*Math.PI

          if kind<2
            meshes[kind][dimension].texture = textures[kind][dimension]

        for i in [0..1]
          crosshairsGeometry[dimension][i] = new THREE.Geometry()
          crosshairsGeometry[dimension][i].vertices.push(new THREE.Vector3(-WIDTH/2*i, -WIDTH/2*(1-i), 1))
          crosshairsGeometry[dimension][i].vertices.push(new THREE.Vector3( WIDTH/2*i,  WIDTH/2*(1-i), 1))
          crosshairs[dimension][i] = new THREE.Line(crosshairsGeometry[dimension][i], new THREE.LineBasicMaterial({color: crosshairColors[dimension][i], linewidth: 1}))
          View.addGeometry dimension, crosshairs[dimension][i]
          if Model.User.Configuration.displayCrosshair?
            crosshairs[dimension][i].visible = Model.User.Configuration.displayCrosshair

      View.crosshairs = crosshairs

      
      #create preview Box depending on Game.dataSet.upperBoundary
      b = Game.dataSet.upperBoundary
      previewBoxGeometry = new THREE.Geometry()
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, b[2], 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], b[2], 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], 0, b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], b[2], b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, b[2], b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], 0, 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], b[2], 0))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], b[2], b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(b[0], 0, b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, 0, b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, b[2], b[1]))
      previewBoxGeometry.vertices.push(new THREE.Vector3(0, b[2], 0))
      previewBox = new THREE.Line(previewBoxGeometry, new THREE.LineBasicMaterial({color: 0x999999, linewidth: 1}))
      View.addGeometry VIEW_3D, previewBox

      strings   = ["0, 0, 0", b[0]+", 0, 0", "0, "+b[2]+", 0", "0, 0, "+b[2]]
      positions = [new THREE.Vector3(0, b[2], 0), new THREE.Vector3(b[0], b[2], 0), new THREE.Vector3(0, b[2], b[1]), new THREE.Vector3(0, 0, 0)]
      texts     = new Array(4)
      for i in [0..3]
        texts[i] = new THREE.Mesh(new THREE.TextGeometry(strings[i], {size : 200, height : 20, font : "helvetiker"}), new THREE.MeshBasicMaterial({color: 0x999999}))
        texts[i].position = positions[i]
        View.addGeometry VIEW_3D, texts[i]
      View.texts = texts

      # create route
      View.createRoute 1000

      meshes[1][PLANE_YZ].rotation.z = meshes[2][PLANE_YZ].rotation.z = -90 /180*Math.PI
      
      meshes[1][PLANE_XZ].rotation.x = meshes[2][PLANE_XZ].rotation.x = 90 /180*Math.PI

      View.meshes = meshes
      for kind in [0..2]
        for dimension in [0..2]
          scene = if kind==0 then dimension else VIEW_3D
          View.addGeometry scene, View.meshes[kind][dimension]
    )