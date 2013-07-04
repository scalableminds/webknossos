### define 
three : THREE
###

class VolumeGeometry

  constructor : (@polygonFactory, @min, @max, @id) ->

    triangles = @polygonFactory.getTriangles(@min, @max, @id)
    geo = new THREE.Geometry()

    i = 0
    for triangle in triangles
      for vertex in triangle
        geo.vertices.push( new THREE.Vector3(vertex...) )
      geo.faces.push( new THREE.Face3(i++, i++, i++) )

    @mesh = new THREE.Mesh( geo,
      new THREE.MeshBasicMaterial({
        color : 0xff0000
        wireframe : false
      }))
    @mesh.material.side = THREE.DoubleSide

  getMeshes : ->

    return [@mesh]