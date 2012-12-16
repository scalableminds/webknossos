### define 
../buffer_utils : BufferUtils
###


class Cloudify

  DESCRIPTION : "Makes clouds out of the given input"

  PARAMETER :
    input :
      rgba: "Uint8Array"
      dimensions : '[]'


  ready: false
  cloud: null
  size: 32


  constructor : () ->

    @cloud = new Image()
    @cloud.src = "/assets/images/cloud32.png"   
    @cloud.onload = => @ready = true


  execute : ({ input : { rgba, dimensions }}) ->

    { cloud, ready, size } = @

    unless ready
      return rgba

    width = dimensions[0]
    height = dimensions[1]

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")

    i = 0
    j = 0
    while i < 50 and j < 1000
      j++
      x = Math.floor(Math.random() * width)
      y = Math.floor(Math.random() * height)

      a = rgba[(y * width + x) * 4 + 3]
      
      if a is 0
        continue

      context.drawImage(cloud, x - size*0.5, y - size*0.5)
      i++


    canvasData = context.getImageData(0, 0, width, height).data
    for l in [0...canvasData.length] by 4
      rgba[l + 0] = 0
      rgba[l + 1] = 0
      rgba[l + 2] = 0
      rgba[l + 3] = canvasData[l + 3]
