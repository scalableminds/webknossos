### define 
../buffer_utils : BufferUtils
###


class SmoothEdges

  PUBLIC : true
  COMMAND : "smoothEdges()"
  FRIENDLY_NAME : "Smooth Edges"  
  DESCRIPTION : "Removes Artefactes and Smooths Edges"
  PARAMETER :
    input :
      rgba: "Uint8Array"
      dimensions : '[]'
    threshold : "0-8"
    rounds : "0-5"
    fill : "true, false"
  EXAMPLES : [
      { description : "Smooth end and start segments with default values", lines :
        [ "time(start : 0, end : 10) ->"
          "  importSlides(start : 0, end : 30)"
          "  filterAll()"
          "  filterEndSegmentation(mode:\"in\")"
          "  filterStartSegmentation(mode: \"in\")"
          "  smoothEdges()"
        ]
      }
    ] 


  constructor : () ->


  execute : ({ input : { rgba, dimensions }, threshold, rounds, fill}) ->

    threshold = 5 unless threshold?   
    rounds = 2 unless rounds?
    fill = true unless fill?

    for i in [0..rounds] by 1
      @smooth(dimensions, rgba, threshold)

    for i in [0...threshold] by 1
      @smooth(dimensions, rgba, threshold - 1 - i)

    if fill
      @fill(dimensions, rgba, 1)

    if fill
      @fill(dimensions, rgba, 0.8)

    if fill
      @fill(dimensions, rgba, 0.5)

    rgba

  smooth : (dimensions, rgba, threshold) ->

    width = dimensions[0]
    height = dimensions[1]

    tempBuffer = new Uint8Array(rgba.length)

    for h in [0...height] by 1
      for w in [0...width] by 1
        
        base = (h * width + w) * 4 + 3
        
        if rgba[base] is 0 
          continue

        neighbours = 0

        #left
        neighbours++ if rgba[base - 4] isnt 0 or w - 1 < 0
        #left up
        neighbours++ if rgba[base + width * 4 - 4] isnt 0 or w - 1 < 0 or h + 1 > height
        #up
        neighbours++ if rgba[base + width * 4] isnt 0 or h + 1 > height
        #right up
        neighbours++ if rgba[base + width * 4 + 4] isnt 0 or h + 1 > height or w + 1 > width
        #right
        neighbours++ if rgba[base + 4] isnt 0 or w + 1 > width
        #right down
        neighbours++ if rgba[base - width * 4 + 4] isnt 0 or h - 1 < 0 or w + 1 > width
        #down
        neighbours++ if rgba[base - width * 4] isnt 0 or h - 1 < 0
        #left down
        neighbours++ if rgba[base - width * 4 - 4] isnt 0 or h - 1 < 0 or w - 1 < 0

        if neighbours >= threshold
          tempBuffer[base] = rgba[base]        
        else
          tempBuffer[base] = 0

    for i in [0...rgba.length] by 4
      rgba[i + 3] = tempBuffer[i + 3]

    rgba


  fill : (dimensions, rgba, alpha) ->

    width = dimensions[0]
    height = dimensions[1]

    tempBuffer = new Uint8Array(rgba.length)

    for h in [0...height] by 1
      for w in [0...width] by 1
        
        base = (h * width + w) * 4 + 3
        
        a = rgba[base] * alpha
        if a is 0 
          continue

        #left
        tempBuffer[base - 4]             = a if rgba[base - 4] is 0
        #left up if 
        tempBuffer[base + width * 4 - 4] = a if rgba[base + width * 4 - 4] is 0
        #up if 
        tempBuffer[base + width * 4]     = a if rgba[base + width * 4] is 0
        #right up if 
        tempBuffer[base + width * 4 + 4] = a if rgba[base + width * 4 + 4] is 0
        #right if 
        tempBuffer[base + 4]             = a if rgba[base + 4] is 0
        #right down if 
        tempBuffer[base - width * 4 + 4] = a if rgba[base - width * 4 + 4] is 0
        #down if 
        tempBuffer[base - width * 4]     = a if rgba[base - width * 4] is 0
        #left down if 
        tempBuffer[base - width * 4 - 4] = a if rgba[base - width * 4 - 4] is 0



    for i in [0...rgba.length] by 4
      rgba[i + 3] = tempBuffer[i + 3] if tempBuffer[i + 3] isnt 0

    rgba