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
    removeThreshold : "0-8, default: 5"
    removePasses : "0-10, default: 2"
    fillPasses : "0-10, default: 3"
    fillAlpha : "\"linear\", \"proportional\" (default)"
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


  execute : ({ input : { rgba, dimensions }, removeThreshold, removePasses, fillPasses, fillAlpha}) ->

    removeThreshold = 5 unless removeThreshold?   
    removePasses = 2 unless removePasses?
    fillPasses = 3 unless fillPasses?
    fillAlpha = "proportional" unless fillAlpha?

    for i in [0...removePasses] by 1
      @smooth(dimensions, rgba, removeThreshold)

    if removePasses > 0
      for i in [removeThreshold-1..1] by -1
        @smooth(dimensions, rgba, i)

    for i in [0..fillPasses-1] by 1
      
      if fillAlpha is "proportional"
        g = i / (fillPasses)
        t = 1 - (g * g * g)
        t = t * t * t
      else
        t = (1 / fillPasses) * (fillPasses - i)

      @fillPasses(dimensions, rgba, t)

    rgba

  smooth : (dimensions, rgba, removeThreshold) ->

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

        if neighbours >= removeThreshold
          tempBuffer[base] = rgba[base]        
        else
          tempBuffer[base] = 0

    for i in [0...rgba.length] by 4
      rgba[i + 3] = tempBuffer[i + 3]

    rgba


  fillPasses : (dimensions, rgba, alpha) ->

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
        tempBuffer[base - 4]             = a if rgba[base - 4] is 0 and w - 1 > 0
        #left up if 
        tempBuffer[base + width * 4 - 4] = a if rgba[base + width * 4 - 4] is 0 and w - 1 > 0 and h + 1 < height
        #up if 
        tempBuffer[base + width * 4]     = a if rgba[base + width * 4] is 0 and h + 1 < height
        #right up if 
        tempBuffer[base + width * 4 + 4] = a if rgba[base + width * 4 + 4] is 0 and h + 1 < height and w + 1 < width
        #right if 
        tempBuffer[base + 4]             = a if rgba[base + 4] is 0 and w + 1 < width
        #right down if 
        tempBuffer[base - width * 4 + 4] = a if rgba[base - width * 4 + 4] is 0 and h - 1 > 0 and w + 1 < width
        #down if 
        tempBuffer[base - width * 4]     = a if rgba[base - width * 4] is 0 and h - 1 > 0
        #left down if 
        tempBuffer[base - width * 4 - 4] = a if rgba[base - width * 4 - 4] is 0 and h - 1 > 0 and w - 1 > 0



    for i in [0...rgba.length] by 4
      rgba[i + 3] = tempBuffer[i + 3] if tempBuffer[i + 3] isnt 0

    rgba