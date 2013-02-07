### define 
../buffer_utils : BufferUtils
###

class DrawArtCells

  PUBLIC : true
  COMMAND : "drawArtCells()"
  FRIENDLY_NAME : "Draw Art Cells"  
  DESCRIPTION : "Draws the morphing art cells"
  PARAMETER : 
    input: 
      rgba: 'Uint8Array'
      segments: '[]'
      relativeTime : 'float' # 0 <= time <= 1
      dimensions : '[]'
    customTime : '0.0 - 1.0'


  constructor : () ->


  execute : ({ input : { rgba, segments, relativeTime, dimensions }, customTime}) ->

    width = dimensions[0]
    height = dimensions[1]

    if customTime?
      relativeTime = customTime

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")

    context.fillStyle = "rgba(0, 0, 255, 1)"
    context.strokeStyle = "rgba(0, 0, 0, 1)"
    context.lineWidth = 2
    
    for segment in segments

      path = segment.path
      artPath = segment.artPath

      context.beginPath()

      x = path[0] * relativeTime + artPath[0] * (1 - relativeTime)
      y = path[1] * relativeTime + artPath[1] * (1 - relativeTime)      

      context.moveTo(x, y)

      i = 0

      while i < path.length
        x = path[i] * relativeTime + artPath[i] * (1 - relativeTime)
        i++
        y = path[i] * relativeTime + artPath[i] * (1 - relativeTime)
        i++

        context.lineTo(x, y)

      context.fill()
      context.stroke()    

    canvasData = context.getImageData(0, 0, width, height).data
    BufferUtils.alphaBlendBuffer(rgba, canvasData)

    rgba