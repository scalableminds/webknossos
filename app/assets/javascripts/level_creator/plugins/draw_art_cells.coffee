### define ###

class DrawArtCells

  DESCRIPTION : "Draws the morphing art cells (produced by segment importer) depending on a given time"

  PARAMETER : 
    input: 
      rgba: 'Uint8Array'
      segments: '[]'
    width: 'int'
    height: 'int'
    time : 'float' # 0 <= time <= 1


  constructor : () ->


  execute : ({ input : { rgba, segments }, width, height, time}) ->

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

      x = path[0] * time + artPath[0] * (1 - time)
      y = path[1] * time + artPath[1] * (1 - time)      

      context.moveTo(x, y)

      i = 0

      while i < path.length
        x = path[i] * time + artPath[i] * (1 - time)
        i++
        y = path[i] * time + artPath[i] * (1 - time)
        i++

        context.lineTo(x, y)

      context.fill()
      context.stroke()    


    context.getImageData(0, 0, width, height).data      