### define ###

class DrawArtCells

  DESCRIPTION : "Draws the morphing art cells (produced by segment importer) depending on a given time"

  PARAMETER : 
    input: 
      rgba: 'Uint8Array'
      segments: '[]'
      relativeTime : 'float' # 0 <= time <= 1
      dimensions : '[]'


  constructor : () ->


  execute : ({ input : { rgba, segments, relativeTime, dimensions }}) ->

    width = dimensions[0]
    height = dimensions[1]

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")

    context.fillStyle = "rgba(0, 0, 255, 1)"
    context.strokeStyle = "rgba(0, 0, 0, 1)"
    context.lineWidth = 2
    context.putImageData(rgba, 0, 0)

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


    context.getImageData(0, 0, width, height).data      