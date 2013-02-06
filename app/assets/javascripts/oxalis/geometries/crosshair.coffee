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

  isDirty : true


  constructor : (scale) ->

    { WIDTH } = @

    canvas = document.createElement('canvas')
    canvas.width = canvas.height = WIDTH
    @context = canvas.getContext("2d")

    @mesh = @createMesh(canvas)
    @setScale(scale)


  update : ->

    { isDirty, context, WIDTH, COLOR, texture, mesh } = @

    return unless isDirty

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

    @isDirty = false  


  setScale : (value) ->

    { SCALE_MIN, SCALE_MAX, mesh } = @

    if value > SCALE_MIN and value < SCALE_MAX
      mesh.scale.x = mesh.scale.y = mesh.scale.z = value

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

    mesh 