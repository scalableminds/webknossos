### define 
../buffer_utils : BufferUtils
../color_utils : ColorUtils
###

class DrawArtCells

  PUBLIC : true
  COMMAND : "drawArtCells()"
  FRIENDLY_NAME : "Draw Art Cells"  
  DESCRIPTION : "Draws the morphing art cells"
  PARAMETER : 
    input: 
      rgba: "Uint8Array"
      segments: "[]"
      relativeTime : "float" # 0 <= time <= 1
      dimensions : "[]"
    customTime : "0.0 - 1.0 (opt)"
    reverse : "true, false (default)"
    colorRandom : "true, false (default)"
    endPosition : "\"edge\", \"segmentCenter\" (default)"
    startPosition : "\"segmentCenter\" (default)"
    lineWidth : "0 - 5"
    size : "0 - 100"
    hitMode : "true, false (default)"
    fillColor : "\"hitMode\", \"random\", \"randomWhole\", \"rgba(0, 0, 255, 0.3)\""
    strokeColor : "\"hitMode\", \"random\", \"randomWhole\", \"rgba(0, 0, 255, 0.3)\""
    shadowOffsetX : "float"
    shadowOffsetY : "float"
    shadowBlur : "float"
    shadowColor : "\"rgba(0, 0, 255, 0.3)\""


  constructor : () ->


  execute : ({ input : { rgba, segments, relativeTime, dimensions, mission }, fillColor, strokeColor, hitMode, lineWidth, colorRandom, customTime, reverse, endPosition, size, shadowOffsetX, shadowOffsetY, shadowBlur, shadowColor, mergeSegments}) ->

    width = dimensions[0]
    height = dimensions[1]

    hitMode = false unless hitMode?
    lineWidth = 0 unless lineWidth?
    mergeSegments = false unless mergeSegments?

    if reverse? and reverse
      relativeTime = 1 - relativeTime

    if customTime?
      relativeTime = customTime

    shadowOffsetX = 0 unless shadowOffsetX
    shadowOffsetY = 0 unless shadowOffsetY
    shadowBlur = 0 unless shadowBlur
    shadowColor = "rgba(0, 0, 0, 0)" unless shadowColor    

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")
    context.lineWidth = lineWidth

    activeSegments = _.filter(segments, (segment) -> segment.display is true)
    
    @setArtPaths(activeSegments, width, height, endPosition, size, mergeSegments)

    endValues = [mission.start.id]
    for possibleEnd in mission.possibleEnds
      endValues.push possibleEnd.id

    activeSegments = _.sortBy(activeSegments, (s) -> s.artPath.circlePosition)
    for segment in activeSegments

      path = segment.path
      artPath = segment.artPath
      randomColor = segment.randomColor
      color = "rgba(#{randomColor.r}, #{randomColor.g}, #{randomColor.b}, 1)"
      if hitMode
        if _.contains(endValues, segment.value) is true
          context.strokeStyle = "rgba(255, 0, 0, 1)"
          context.fillStyle = "rgba(255, 0, 0, 1)" 
        else
          context.strokeStyle = "rgba(128, 0, 0, 1)"
          context.fillStyle = "rgba(128, 0, 0, 1)" 

      else
        if colorRandom? and colorRandom
          context.fillStyle = color
          context.strokeStyle = "rgba(0, 0, 0, 1)"
        else
          context.fillStyle = "rgba(160, 160, 160, 1)" #color #"rgba(0, 0, 255, 1)"
          context.strokeStyle = "rgba(100, 100, 100, 1)" # color #"rgba(0, 0, 0, 1)"

      if fillColor?
        if fillColor is "random"
          context.fillStyle = "rgb(#{segment.randomColor2.r}, #{segment.randomColor2.g}, #{segment.randomColor2.b})"
        else if fillColor is "randomWhole"
          context.fillStyle = "rgb(#{segment.randomColor3.r}, #{segment.randomColor3.g}, #{segment.randomColor3.b})"
        else
          context.fillStyle = fillColor

      if strokeColor?
        if strokeColor is "random"
          context.strokeStyle = "rgb(#{segment.randomColor2.r}, #{segment.randomColor2.g}, #{segment.randomColor2.b})"
        else if strokeColor is "randomWhole"
          context.strokeStyle = "rgb(#{segment.randomColor3.r}, #{segment.randomColor3.g}, #{segment.randomColor3.b})"
        else
          context.strokeStyle = strokeColor   

      context.shadowOffsetX = shadowOffsetX
      context.shadowOffsetY = shadowOffsetY
      context.shadowBlur = shadowBlur
      context.shadowColor = shadowColor  

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
      
      x = path[0] * relativeTime + artPath[0] * (1 - relativeTime)
      y = path[1] * relativeTime + artPath[1] * (1 - relativeTime)
      context.lineTo(x, y)

      context.stroke() 
      context.fill()
   

    canvasData = context.getImageData(0, 0, width, height).data
    BufferUtils.alphaBlendBuffer(rgba, canvasData)

    rgba


  setArtPaths : (segments, width, height, endPosition, size, mergeSegments) ->

    if mergeSegments
      values = _.pluck(segments, "value")
    else
      values = _.pluck(segments, "id")

    values = _.uniq(values)

    count = values.length
    positions = []

    if endPosition? and endPosition is "edge"

      for i in [0...count] by 1
      
        radians = 2 * Math.PI * i / count
        x = Math.sin(radians)
        y = -Math.cos(radians)

        x *= Math.min(width, height) * 0.4
        y *= Math.min(width, height) * 0.4

        x += width * 0.5
        y += height * 0.5

        positions.push({x, y, i})

      for value in values
        
        if mergeSegments
          tempSegments = _.filter(segments, (s) => s.value is value)
        else
          tempSegments = _.filter(segments, (s) => s.id is value )

        nearestEndPoint = _.sortBy(positions, (position) =>  
          Math.sqrt(
            Math.pow(tempSegments[0].weightedCenter.x - position.x, 2) +
            Math.pow(tempSegments[0].weightedCenter.y - position.y, 2)
          )
        )
        positions.splice(positions.indexOf(nearestEndPoint[0]), 1)

        for segment in tempSegments
          @setArtPath(segment, width, height, nearestEndPoint[0], size)

    else

      for segment in segments
        @setArtPath(segment, width, height, segment.weightedCenter, size)


  setArtPath : (segment, width, height, position, size) ->

    path = []
    if size? and size > 0
      radius = size
    else
      radius = Math.sqrt(segment.size) * 0.5
    count = segment.path.length * 0.5

    #mx = 2 * segment.weightedCenter.x - (width * 0.5)
    #my = 2 * segment.weightedCenter.y - (height * 0.5)

    mx = position.x
    my = position.y

    for i in [count..0] by -1
    
      radians = 2 * Math.PI * i / count
      x = Math.sin(radians)
      y = -Math.cos(radians)

      x *= radius
      y *= radius

      x += mx
      y += my 

      path.push x
      path.push y

    path.circlePosition = position.i

    segment.artPath = path    