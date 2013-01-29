### define 
../buffer_utils : BufferUtils
###


class Cloudify

  PUBLIC : true
  COMMAND : "cloudify"
  FRIENDLY_NAME : "Cloudify"  
  DESCRIPTION : "Makes colored clouds out of the given input"
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


  execute : ({ input : { rgba, dimensions }, r, g, b, a}) ->

    { cloud, ready, size } = @

    unless ready
      return rgba

    width = dimensions[0]
    height = dimensions[1]

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")
    
    for h in [0...height] by size*0.3
      for w in [0...width] by size*0.3

        x = w + Math.floor(Math.random() * size - size*0.5)
        y = h + Math.floor(Math.random() * size - size*0.5)

        testA = rgba[(y * width + x) * 4 + 3]
        
        if testA isnt 0
          context.drawImage(cloud, x - size*0.5, y - size*0.5)


    canvasData = context.getImageData(0, 0, width, height).data
    for l in [0...canvasData.length] by 4
      ao = canvasData[l + 3]
      rgba[l + 0] = r
      rgba[l + 1] = g
      rgba[l + 2] = b
      rgba[l + 3] = ao * a
