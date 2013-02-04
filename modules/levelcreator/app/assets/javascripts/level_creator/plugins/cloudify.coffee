### define 
../buffer_utils : BufferUtils
../color_utils : ColorUtils
###


class Cloudify

  PUBLIC : true
  COMMAND : "cloudify()"
  FRIENDLY_NAME : "Cloudify"  
  DESCRIPTION : "Makes colored clouds out of the given input"
  PARAMETER :
    input :
      rgba: "Uint8Array"
      dimensions : '[]'
    color : "\"rgba(200, 50, 10, 0.9)\" or \"#0f00ff42\""
  EXAMPLES : [
      { description : "Cloudify the segments in the center", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  filterSegmentationByDistance(distance: 40, mode: \"<\")"
          "  cloudify(color: \"rgba(200, 50, 10, 0.9)\")"
        ]
      }
    ]    


  ready: false
  cloud: null
  size: 16


  constructor : () ->

    @cloud = new Image()
    @cloud.src = "/assets/images/cloud32.png"   
    @cloud.onload = => @ready = true


  execute : ({ input : { rgba, dimensions }, color}) ->

    { cloud, ready, size } = @

    unless ready
      return rgba

    if color?
        [r, g, b, a] = ColorUtils.parseColor(color)
    else
        [r, g, b, a] = [0, 0, 0, 1]

    width = dimensions[0]
    height = dimensions[1]

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")
    
    for h in [0...height] by size*0.3
      for w in [0...width] by size*0.3

        x = Math.floor( w + (Math.random() * size - size * 0.5))
        y = Math.floor( h + (Math.random() * size - size * 0.5))

        x = 0 if x < 0
        y = 0 if y < 0
        x = width - 1 if x > width
        y = height - 1 if y > height

        testA = rgba[(y * width + x) * 4 + 3]
        
        if testA? and testA isnt 0
          context.drawImage(cloud, x - size*0.5, y - size*0.5)


    canvasData = context.getImageData(0, 0, width, height).data
    for l in [0...canvasData.length] by 4
      ao = canvasData[l + 3]
      rgba[l + 0] = r
      rgba[l + 1] = g
      rgba[l + 2] = b
      rgba[l + 3] = ao * a

    rgba
