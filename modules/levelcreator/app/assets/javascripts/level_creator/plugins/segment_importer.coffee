### define 
underscore : _
../libs/jenkins: Jenkins
###

class SegmentImporter

  PUBLIC : false
  DESCRIPTION : "Generates all metadata from the original grey values"
  PARAMETER : 
    input: 
      segmentation: 'Uint16Array'
      dimensions : '[x, y, z]'


  Z_FACTOR : 2

  directions : [ 
    {x: -1,  y:  0} 
    {x:  0,  y:  1}
    {x:  1,  y:  0}
    {x:  0,  y: -1}
  ]


  execute : ({ input }) ->

    { segmentation, dimensions } = input

    for i in [0...2] by 1
      @smooth(dimensions, segmentation, 5)

    segments = @getSegments(segmentation, dimensions)

    @setAbsoluteCenter(segments)
    @setAbsoluteDistance(segments, dimensions)
    @setWeightedCenter(segments)
    @setWeightedDistance(segments, dimensions)
    @setRandomColor(segments)

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
        segment = _.detect(segments, (s) -> s.value is value)

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
            aggregatedX : 0
            aggregatedY : 0
            pathStart: {
              x: x
              y: y
            } 
            size: 1
            absoluteCenter: {
              x: 0
              y: 0
            }
            weightedCenter: {
              x: 0
              y: 0
            }
            display : true
            randomColor : {
              r: 0
              g: 0
              b: 0
            }
          }

          segments.push(segment)

        #size
        segment.size++
        segment.aggregatedX += x
        segment.aggregatedY += y

    segments


  setAbsoluteCenter : (segments) ->

    for segment in segments
      segment.absoluteCenter.x = (segment.xMax + segment.xMin) * 0.5
      segment.absoluteCenter.y = (segment.yMax + segment.yMin) * 0.5


  setWeightedCenter : (segments) ->

    for segment in segments
      segment.weightedCenter.x = segment.aggregatedX / segment.size
      segment.weightedCenter.y = segment.aggregatedY / segment.size      


  setAbsoluteDistance : (segments, [ width, height ]) ->

    for segment in segments
      dx = segment.absoluteCenter.x - width * 0.5
      dy = segment.absoluteCenter.y - height * 0.5
      segment.absoluteDistance = Math.sqrt(dx*dx + dy*dy)


  setWeightedDistance : (segments, [ width, height ]) ->

    for segment in segments
      dx = segment.weightedCenter.x - width * 0.5
      dy = segment.weightedCenter.y - height * 0.5
      segment.weightedDistance = Math.sqrt(dx*dx + dy*dy)


  setRandomColor : (segments) ->

    for segment in segments
      color = Jenkins.hashlittle2("#{segment.value}", 0, 0)
      segment.randomColor.r = color.b % 256
      segment.randomColor.g = Math.abs((color.b >> 4) % 256)
      segment.randomColor.b = color.c % 256


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
      
      if 0 <= (y + directions[direction].y) < height and 
      0 <= (x + directions[direction].x) < width
        front = segmentationData[(y + directions[direction].y ) * 
          height + (x + directions[direction].x)]  

      else
        front = -1


      if front is value
        x += directions[direction].x
        y += directions[direction].y
        
        path.push x
        path.push y

        leftDirection = (direction + 3) % 4
        backDirection = (leftDirection + 3) % 4

        if 0 <= (y + directions[leftDirection].y) < height and 
        0 <= (x + directions[leftDirection].x) < width
          left = segmentationData[(y + directions[leftDirection].y ) * height + 
            (x + directions[leftDirection].x)]            
        else
          left = -1


        if 0 <= (y + directions[leftDirection].y) < height and
        0 <= (y + directions[backDirection].y) < height and
        0 <= (x + directions[leftDirection].x) < width and
        0 <= (x + directions[backDirection].x) < width

          leftBack = segmentationData[(y + directions[leftDirection].y + 
            directions[backDirection].y) * height + 
            (x + directions[leftDirection].x + directions[backDirection].x)] 
        else
          leftBack = -1


        if leftBack isnt value and left is value
          direction = (direction + 3) % 4

      else
        direction = (direction + 1) % 4

    segment.path = path


  setArtPath : (segment, [ width, height ]) ->

    path = []
    radius = Math.sqrt(segment.size) * 0.5
    count = segment.path.length * 0.5

    mx = segment.weightedCenter.x - (width*0.5)
    my = segment.weightedCenter.y - (height*0.5)

    mx += segment.weightedCenter.x
    my += segment.weightedCenter.y

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


  smooth : (dimensions, segmentation, removeThreshold) ->

    width = dimensions[0]
    height = dimensions[1]

    tempBuffer = new Uint16Array(segmentation.length)

    for h in [0...height] by 1
      for w in [0...width] by 1
        
        base = (h * width + w)
        
        a = segmentation[base]
        if segmentation[base] is 0 
          continue

        neighbours = 0

        #left
        neighbours++ if segmentation[base - 1] is a or w - 1 < 0
        #left up
        neighbours++ if segmentation[base + width - 1] is a or w - 1 < 0 or h + 1 > height
        #up
        neighbours++ if segmentation[base + width ] is a or h + 1 > height
        #right up
        neighbours++ if segmentation[base + width + 1] is a or h + 1 > height or w + 1 > width
        #right
        neighbours++ if segmentation[base + 1] is a or w + 1 > width
        #right down
        neighbours++ if segmentation[base - width + 1] is a or h - 1 < 0 or w + 1 > width
        #down
        neighbours++ if segmentation[base - width ] is a or h - 1 < 0
        #left down
        neighbours++ if segmentation[base - width - 1] is a or h - 1 < 0 or w - 1 < 0

        if neighbours >= removeThreshold
          tempBuffer[base] = segmentation[base]        
        else
          tempBuffer[base] = 0

    for i in [0...segmentation.length]
      segmentation[i] = tempBuffer[i]

    segmentation