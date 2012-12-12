### define 
underscore : _
###

class SegmentImporter

  DESCRIPTION : "Generates all metadata from the original grey values"

  PARAMETER : 
    input: 
      raw: 'Uint8Array'
    width: 'int'
    height: 'int'


  directions : [ 
    {x: -1,  y:  0} 
    {x:  0,  y:  1}
    {x:  1,  y:  0}
    {x:  0,  y: -1}
  ]

  execute : ({ input }) ->

    { segmentation, dimensions } = input

    segments = @getSegments(segmentation, dimensions)

    @setCenter(segments)
    @setDistance(segments)

    for segment in segments
      @setPath(segmentation, segment, dimensions)
      @setArtPath(segment, dimensions)

    input.segments = segments


  getSegments : (segmentation, [ width, height ]) ->

    segments = []

    i = 0
    for y in [0...height] by 1
      for x in [0...width] by 1

        value = segmentation[i]
        i++

        continue if value is 0

        #is segment already there
        segment = _.detect(segements, (s) -> s.value is value)

        if segment?
          
          #set boundries
          segment.xMin = Math.min(x, segment.xMin)
          segment.xMax = Math.max(x, segment.xMax)

          segment.yMin = Math.min(y, segment.yMin)
          segment.yMax = Math.max(y, segment.yMax)

        else
          segment = { 
            value: value 
            xMin: x
            xMax: x
            yMin: y
            yMax: y
            pathStart: {
              x: x
              y: y
            } 
            size: 1
            center: {
              x: 0
              y: 0
            }
          }
          segments.push(segment)

        #size
        segment.size++

    segments


  setCenter : (segments) ->

    for segment in segments
      segment.center.x = (segment.xMax + segment.xMin) * 0.5
      segment.center.y = (segment.yMax + segment.yMin) * 0.5


  setDistance : (segments, [ width, height ]) ->

    for segment in segments
      dx = segment.center.x - width * 0.5
      dy = segment.center.y - height * 0.5
      segment.distance = Math.sqrt(dx*dx + dy*dy)


  setPath : (segmentationData, segment, [ width, height ]) ->

    { directions } = @

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


  setArtPath : (segment, [ width, height ]) ->

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
