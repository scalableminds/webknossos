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

  cache : []


  execute : ({ input }, z) ->

    z = Math.round(z)

    { segmentation } = input

    cacheSegments = @cache[z]
    if cacheSegments?
      input.segments = cacheSegments.segments
      input.segmentation = cacheSegments.cSegmentation
      return

    [width, height, depth] = input.dimensions

    cSegmentation = new Uint16Array(width * height)

    for i in [0...2] by 1
      @smooth(width, height, segmentation, 5)

    for i in [4..1] by -1
      @smooth(width, height, segmentation, i)

    segments = @getSegments(segmentation, cSegmentation, width, height)

    @setAbsoluteCenter(segments)
    @setAbsoluteDistance(segments, width, height)
    @setWeightedCenter(segments)
    @setWeightedDistance(segments, width, height)
    @setRandomColor(segments)

    for segment in segments
      @setArtPath(segment, width, height)

    input.segments = segments
    input.segmentation = cSegmentation

    @cache[z] = {segments, cSegmentation}


  getSegments : (segmentation, cSegmentation, width, height) ->

    segments = []
    count = 1

    i = 0
    for y in [0...height] by 1
      for x in [0...width] by 1

        value = segmentation[i]
        id = cSegmentation[i]
        i++

        continue if value is 0

        if id is 0
          segment = { 
            id: count++
            value: value 
            xMin: x
            xMax: x
            yMin: y
            yMax: y
            aggregatedX : 0
            aggregatedY : 0
            path: null
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
          
          @fillCSegmentation(x, y, width, height, false, segmentation, cSegmentation, segment)
          @setPath(cSegmentation, segment, x, y, width, height)

        else
          segment = _.detect(segments, (s) -> s.id is id)

        segment.xMin = Math.min(x, segment.xMin)
        segment.xMax = Math.max(x, segment.xMax)

        segment.yMin = Math.min(y, segment.yMin)
        segment.yMax = Math.max(y, segment.yMax)

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


  setAbsoluteDistance : (segments, width, height) ->

    for segment in segments
      dx = segment.absoluteCenter.x - width * 0.5
      dy = segment.absoluteCenter.y - height * 0.5
      segment.absoluteDistance = Math.sqrt(dx*dx + dy*dy)


  setWeightedDistance : (segments, width, height) ->

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


  setPath : (segmentation, segment, startX, startY, width, height) ->

    { directions } = @

    path = []
    direction = 0

    x = startX
    y = startY

    value = segment.id
    
    i = 0

    while (x isnt startX or y isnt startY) or i < 5
      i++
      
      if 0 <= (y + directions[direction].y) < height and 
      0 <= (x + directions[direction].x) < width
        front = segmentation[(y + directions[direction].y ) * 
          width + (x + directions[direction].x)]  
      else
        front = -1

      if front is value
        x += directions[direction].x
        y += directions[direction].y
        
        path.push x
        path.push y

        rightDirection = (direction + 3) % 4
        backDirection = (rightDirection + 3) % 4

        if 0 <= (y + directions[rightDirection].y) < height and 
        0 <= (x + directions[rightDirection].x) < width
          right = segmentation[(y + directions[rightDirection].y ) * width + 
            (x + directions[rightDirection].x)]            
        else
          right = -1

        if 0 <= (y + directions[rightDirection].y) < height and
        0 <= (y + directions[backDirection].y) < height and 
        0 <= (x + directions[rightDirection].x) < width and 
        0 <= (x + directions[backDirection].x) < width
          rightBack = segmentation[(y + directions[rightDirection].y + 
            directions[backDirection].y) * width + 
            (x + directions[rightDirection].x + directions[backDirection].x)] 
        else
          rightBack = -1

        if rightBack isnt value and right is value
          direction = (direction + 3) % 4

      else
        direction = (direction + 1) % 4

    segment.path = path


  setArtPath : (segment, width, height) ->

    path = []
    radius = Math.sqrt(segment.size) * 0.5
    count = segment.path.length * 0.5

    mx = 2 * segment.weightedCenter.x - (width * 0.5)
    my = 2 * segment.weightedCenter.y - (height * 0.5)

    mx = segment.weightedCenter.x
    my = segment.weightedCenter.y

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


  smooth : (width, height, segmentation, removeThreshold) ->

    tempBuffer = new Uint16Array(segmentation.length)

    for h in [0...height] by 1
      for w in [0...width] by 1
        
        base = (h * width + w)
        
        a = segmentation[base]
        if segmentation[base] is 0 
          continue

        neighbours = 0

        #right
        neighbours++ if segmentation[base - 1] is a or w - 1 < 0
        #right up
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
        #right down
        neighbours++ if segmentation[base - width - 1] is a or h - 1 < 0 or w - 1 < 0

        if neighbours >= removeThreshold
          tempBuffer[base] = segmentation[base]        
        else
          tempBuffer[base] = 0

    for i in [0...segmentation.length]
      segmentation[i] = tempBuffer[i]

    segmentation


  # http://will.thimbleby.net/scanline-flood-fill/
  fillCSegmentation : (x, y, width, height, diagonal, segmentation, cSegmentation, segment ) ->
    
    value = segment.value
    id = segment.id

    test = (xx, yy) =>
      segmentation[yy * width + xx] is value and
      cSegmentation[yy * width + xx] isnt id

    paint = (xx, yy) =>
      cSegmentation[yy * width + xx] = id

    # xMin, xMax, y, down[true] / up[false], extendLeft, extendRight
    ranges = [[x, x, y, null, true, true]]
    paint x, y
    while ranges.length
      
      # extendLeft
      
      # extendRight
      
      # extend range looked at for next lines
      
      # extend range ignored from previous line
      addNextLine = (newY, isNext, downwards) ->
        rMinX = minX
        inRange = false
        x = minX

        while x <= maxX
          
          # skip testing, if testing previous line within previous range
          empty = (isNext or (x < r[0] or x > r[1])) and test(x, newY)
          if not inRange and empty
            rMinX = x
            inRange = true
          else if inRange and not empty
            ranges.push [rMinX, x - 1, newY, downwards, rMinX is minX, false]
            inRange = false
          paint x, newY  if inRange
          
          # skip
          x = r[1]  if not isNext and x is r[0]
          x++
        ranges.push [rMinX, x - 1, newY, downwards, rMinX is minX, true]  if inRange
      r = ranges.pop()
      down = r[3] is true
      up = r[3] is false
      minX = r[0]
      y = r[2]
      if r[4]
        while minX > 0 and test(minX - 1, y)
          minX--
          paint minX, y
      maxX = r[1]
      if r[5]
        while maxX < width - 1 and test(maxX + 1, y)
          maxX++
          paint maxX, y
      if diagonal
        minX--  if minX > 0
        maxX++  if maxX < width - 1
      else
        r[0]--
        r[1]++
      addNextLine y + 1, not up, true  if y < height
      addNextLine y - 1, not down, false  if y > 0    