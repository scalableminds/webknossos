### define 
underscore : _
###

class Preprocessor

  DESCRIPTION : "Generates all metadata from the original grey values"

  PARAMETER : {input: {raw: 'Uint8Array'}, width: 'int', height: 'int'}


  directions : [ 
    {x: -1,  y:  0} 
    {x:  0,  y:  1}
    {x:  1,  y:  0}
    {x:  0,  y: -1}
  ]

  constructor : () ->


  process : ({input : {raw}, width, height}) ->

    segments = @getSegments(raw, width, height)

    @setCenter segments
    @setDistance segments

    for segment in segments
      @setPath raw, segment
      @setArtPath segment

    segments


  getSegments : (raw, width, height) ->

    segments = []

    for h in [0...height] by 1
      for w in [0...width] by 1
        value = slide[h * height + w] 

        if value is 0
          continue

        #is segment allready there
        segment = null
        for s in segments
          if s.value is value
            segment = s
            break

        unless segment?
          segment = { 
            value: value 
            xMin: w
            xMax: w
            yMin: h
            yMax: h
            pathStart: {
              x: w 
              y: h 
            } 
            size: 1
            center: {
              x: 0
              y: 0
            }
          }
          segments.push segment

        #set boundries
        if w < segment.xMin
          segment.xMin = w

        if w > segment.xMax 
          segment.xMax = w

        if h < segment.yMin
          segment.yMin = h

        if h > segment.yMax
          segment.yMax = h

        #size
        segment.size++

    segments


  setCenter : (segments) ->

    for segment in segments
      segment.center.x = (segment.xMax + segment.xMin) * 0.5
      segment.center.y = (segment.yMax + segment.yMin) * 0.5


  setDistance : (segments) ->

    { width, height } = @

    for segment in segments
      dx = segment.center.x - width * 0.5
      dy = segment.center.y - height * 0.5
      segment.distance = Math.sqrt(dx*dx + dy*dy)


  setPath : (segmentationData, segment) ->

    { width, height, directions } = @

    path = []
    direction = 0

    x = startX = segment.pathStart.x
    y = startY = segment.pathStart.y

    value = segment.value
    
    i = 0

    while (x isnt startX or y isnt startY) or i < 5
      i++
      
      front = segmentationData[(y + directions[direction].y ) * 
        height + (x + directions[direction].x)]

      if front is value
        x += directions[direction].x
        y += directions[direction].y
        
        path.push x
        path.push y

        leftDirection = (direction + 3) % 4
        backDirection = (leftDirection + 3) % 4

        left = segmentationData[(y + directions[leftDirection].y ) * height + 
          (x + directions[leftDirection].x)] 

        leftBack = segmentationData[(y + directions[leftDirection].y + 
          directions[backDirection].y) * height + 
          (x + directions[leftDirection].x + directions[backDirection].x)] 

        if leftBack isnt value and left is value
          direction = (direction + 3) % 4

      else
        direction = (direction + 1) % 4

    segment.path = path


  setArtPath : (segment) ->

    { width, height } = @
    
    path = []
    radius = Math.sqrt(segment.size) * 0.5
    count = segment.path.length * 0.5

    mx = segment.center.x - (width*0.5)
    my = segment.center.y - (height*0.5)

    mx += segment.center.x
    my += segment.center.y

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


    segment.artPath = path
