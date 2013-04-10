### define 
three : THREE
###

class Crosshair

  WIDTH : 200
  COLOR : "#2895FF"

  SCALE_MIN : 0.01
  SCALE_MAX : 1

  context : null
  mesh : null
  scale : 0

  isDirty : true


  constructor : (@cam, scale) ->

    { WIDTH } = @

    canvas = document.createElement('canvas')
    canvas.width = canvas.height = WIDTH
    @context = canvas.getContext("2d")

    @mesh = @createMesh(canvas)
    @setScale(scale)


  update : ->

    { isDirty, context, WIDTH, COLOR, texture, mesh, cam } = @

    if @isDirty

      context.clearRect(0, 0, WIDTH, WIDTH)
      
      context.fillStyle = COLOR
      context.strokeStyle = COLOR

      context.lineWidth = 3
      context.moveTo(WIDTH / 2, 3)
      context.beginPath()
      context.arc(WIDTH / 2, WIDTH / 2, WIDTH / 2 - 3, 0, 2 * Math.PI)
      context.stroke()

      context.beginPath()
      context.moveTo(WIDTH / 2, WIDTH / 2 - 1)
      context.arc(WIDTH / 2, WIDTH / 2, 4, 0, 2 * Math.PI, true)
      context.fill()  

      mesh.material.map.needsUpdate = true

    m = @cam.getZoomedMatrix()

    mesh.matrix.set m[0], m[4], m[8], m[12], 
                    m[1], m[5], m[9], m[13], 
                    m[2], m[6], m[10], m[14], 
                    m[3], m[7], m[11], m[15]

    mesh.matrix.rotateY(Math.PI)
    mesh.matrix.translate(new THREE.Vector3(0, 0, 0.5))
    mesh.matrix.scale(new THREE.Vector3(@scale, @scale, @scale))

    mesh.matrixWorldNeedsUpdate = true

    @isDirty = false   


  setScale : (value) ->

    { SCALE_MIN, SCALE_MAX, mesh } = @

    if value > SCALE_MIN and value < SCALE_MAX
      @scale = value

    @isDirty = true


  attachScene : (scene) ->

    scene.add(@mesh)


  createMesh : (canvas) ->

    { WIDTH } = @

    texture = new THREE.Texture(canvas)

    material = new THREE.MeshBasicMaterial(map : texture)
    material.transparent = true
    
    mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, WIDTH)
      material
    )

    mesh.rotation.x = Math.PI

    mesh.matrixAutoUpdate = false
    mesh.doubleSided = true

    mesh 